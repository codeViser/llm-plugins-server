(() => {
  /******************************************************************
   * TypingMind Exporter v8
   *
   * GOAL:
   * - Desktop: one-click full "super JSON" export (sidebar kebab -> Export) + convert to HTML / PDF
   * - Mobile/PWA: NO UI automation (prevents TypingMind crashes). Instead:
   *     tap our button -> arms a listener (30s)
   *     user manually: sidebar -> kebab -> Export
   *     listener captures FULL JSON download -> converts -> downloads HTML / opens print
   *
   * SAFETY:
   * - No overrides of Blob / URL.createObjectURL / element prototypes
   * - Only temporary document-level click listener to capture the next JSON download anchor
   *
   * PRIVACY:
   * - Output renders ONLY conversation content + tool outputs (collapsed), not system prompts, tokens, costs, etc.
   * - No timestamps shown
   * - No model name shown
   ******************************************************************/

  const TAG = "[TM Export v8]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const SEL = {
    shareButton: '[data-element-id="share-button"]',
    shareModal: '[data-element-id="pop-up-modal"]',
    chatTitle: '[data-element-id="current-chat-title"]',

    // sidebar stuff (desktop automation only)
    sidebarToggleCompact: '[data-element-id="workspace-logo-button-compact"]',
    sidebarChatItem: '[data-element-id="custom-chat-item"]',
    sidebarSelectedChatItem: '[data-element-id="selected-chat-item"]',
    chatItemKebab: 'button[aria-label="Chat settings"]',
    exportChatBtn: 'button[data-element-id="export-chat-button"]',
  };

  const CSS = `
    .tmx-toast{
      position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 2147483647;
      background: rgba(17,24,39,.96); color: #fff;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 14px; padding: 10px 12px;
      font: 13px/1.35 system-ui, -apple-system, sans-serif;
      box-shadow: 0 10px 34px rgba(0,0,0,.45);
    }
    .tmx-toast .row{display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:8px}
    .tmx-toast button{
      border: none; border-radius: 12px; padding: 8px 10px;
      font-weight: 800; font-size: 12px; cursor: pointer;
      background: #00a884; color: #111;
    }
    .tmx-toast button.alt{ background: #f59e0b; }
    .tmx-toast button.ghost{ background: rgba(255,255,255,.12); color:#fff; font-weight:700; }
    .tmx-toast code{background:rgba(255,255,255,.12); padding:2px 6px; border-radius:8px}
    .tmx-wait{
      font: 14px/1.5 system-ui, -apple-system, sans-serif; padding: 18px;
      color: #111; background: #fff; min-height: 100vh;
    }
    .tmx-wait h1{font-size:18px;margin:0 0 8px}
    .tmx-wait p{margin:8px 0}
    .tmx-wait ol{padding-left:18px}
    .tmx-wait li{margin:6px 0}
  `;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.documentElement.appendChild(style);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(getter, timeoutMs = 4000, stepMs = 50) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = getter();
      if (v) return v;
      await sleep(stepMs);
    }
    return null;
  }

  function textOf(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isMobileLike() {
    // robust: coarse pointer + small min dimension -> mobile/PWA
    const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const m = Math.min(window.innerWidth || 0, window.innerHeight || 0);
    return coarse && m < 900;
  }

  function toast(msg, actions = []) {
    try { document.querySelectorAll(".tmx-toast").forEach((x) => x.remove()); } catch {}
    const t = document.createElement("div");
    t.className = "tmx-toast";
    t.innerHTML = `<div>${msg}</div><div class="row"></div>`;
    const row = t.querySelector(".row");
    actions.forEach((a) => {
      const b = document.createElement("button");
      b.textContent = a.label;
      if (a.kind) b.className = a.kind;
      b.onclick = () => { try { a.onClick?.(); } finally { try { t.remove(); } catch {} } };
      row.appendChild(b);
    });
    const close = document.createElement("button");
    close.textContent = "Close";
    close.className = "ghost";
    close.onclick = () => { try { t.remove(); } catch {} };
    row.appendChild(close);
    document.body.appendChild(t);
    return t;
  }

  function getTopChatTitle() {
    const el = document.querySelector(SEL.chatTitle);
    if (!el) return "Chat Conversation";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("button,svg").forEach((n) => n.remove());
    return textOf(clone) || "Chat Conversation";
  }

  function closeShareModalIfOpen() {
    const modal = document.querySelector(SEL.shareModal);
    if (!modal) return false;
    const closeBtn = [...modal.querySelectorAll("button")].find((b) => textOf(b).toLowerCase() === "close");
    if (closeBtn) closeBtn.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return true;
  }

  /******************************************************************
   * CAPTURE: Arm a temporary listener that captures the next JSON download.
   * We intercept the click on an <a download ... href="blob:..."> link.
   *
   * We prevent the original download, then re-download ourselves from captured text.
   * This guarantees the blob URL isn't revoked before we read it.
   ******************************************************************/
  let CAPTURE_BUSY = false;

  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || ("download-" + Date.now());
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch {}
      try { URL.revokeObjectURL(url); } catch {}
    }, 400);
  }

  async function armCaptureNextFullExportJSON({ timeoutMs = 30000 } = {}) {
    if (CAPTURE_BUSY) throw new Error("Capture already in progress");
    CAPTURE_BUSY = true;

    return new Promise((resolve, reject) => {
      const t0 = Date.now();

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for Export JSON click"));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        document.removeEventListener("click", onClick, true);
        CAPTURE_BUSY = false;
      }

      async function onClick(e) {
        try {
          const a = e.target?.closest?.("a");
          if (!a) return;

          const href = String(a.href || "");
          const dl = String(a.getAttribute("download") || a.download || "").trim();

          if (!href.startsWith("blob:")) return;
          if (!dl.toLowerCase().includes("json")) return;

          // Intercept and read
          e.preventDefault();
          e.stopPropagation();

          const txt = await (await fetch(href)).text();

          // Always re-download what the user initiated (preserve expected behavior)
          downloadText(txt, dl || "typingmind-export.json", "application/json");

          // Validate JSON
          let parsed;
          try { parsed = JSON.parse(txt); }
          catch { return; } // keep listening if not valid

          // Must be FULL export: data.chats exists
          const isFull = !!(parsed && parsed.data && Array.isArray(parsed.data.chats));
          if (!isFull) {
            // Keep listening; user might have clicked Share->JSON by mistake
            const secs = Math.max(0, Math.floor((timeoutMs - (Date.now() - t0)) / 1000));
            toast(
              `Captured JSON but it is NOT the full export. Please do sidebar kebab → <b>Export</b> (full JSON). Still listening… <code>${secs}s</code>`,
              []
            );
            return;
          }

          cleanup();
          resolve(txt);
        } catch (err) {
          cleanup();
          reject(err);
        }
      }

      document.addEventListener("click", onClick, true);
    });
  }

  /******************************************************************
   * Desktop automation to click sidebar kebab->Export
   * (only used when NOT mobile-like)
   ******************************************************************/
  async function ensureSidebarHasAnything() {
    const hasAny = () =>
      document.querySelector(SEL.sidebarSelectedChatItem) ||
      document.querySelector(SEL.sidebarChatItem);

    if (hasAny()) return true;
    document.querySelector(SEL.sidebarToggleCompact)?.click();
    return !!(await waitFor(() => (hasAny() ? true : null), 3500));
  }

  function scoreTitleMatch(target, candidate) {
    const t = (target || "").toLowerCase();
    const c = (candidate || "").toLowerCase();
    if (!t || !c) return 0;
    if (t === c) return 1000;
    if (t.includes(c)) return 600 + Math.min(100, c.length);
    if (c.includes(t)) return 500 + Math.min(100, t.length);
    return 0;
  }

  function findRowForCurrentChatDesktop() {
    const selected = document.querySelector(SEL.sidebarSelectedChatItem);
    if (selected && selected.querySelector(SEL.chatItemKebab)) return selected;

    const topTitle = getTopChatTitle();
    const items = [...document.querySelectorAll(SEL.sidebarChatItem)].filter((it) => it.querySelector(SEL.chatItemKebab));
    let best = null, bestScore = 0;
    for (const it of items) {
      const t = textOf(it.querySelector(".truncate") || it);
      const sc = scoreTitleMatch(topTitle, t);
      if (sc > bestScore) { bestScore = sc; best = it; }
    }
    return bestScore >= 450 ? best : null;
  }

  async function desktopOneClickTriggerExport() {
    closeShareModalIfOpen();
    const ok = await ensureSidebarHasAnything();
    if (!ok) throw new Error("Sidebar not available");

    const row = findRowForCurrentChatDesktop();
    if (!row) throw new Error("Could not identify current chat row in sidebar");

    const kebab = row.querySelector(SEL.chatItemKebab);
    if (!kebab) throw new Error("Kebab not found");
    kebab.click();

    const kebabId = kebab.id;
    const menuSel = kebabId ? `[role="menu"][aria-labelledby="${CSS.escape(kebabId)}"]` : `[role="menu"]`;
    const menu = await waitFor(() => document.querySelector(menuSel), 2500);
    if (!menu) throw new Error("Kebab menu did not open");

    const exportBtn = menu.querySelector(SEL.exportChatBtn);
    if (!exportBtn) throw new Error("Export button not found");

    exportBtn.click();
  }

  /******************************************************************
   * KaTeX (only for rendering output). We render TeX to HTML strings.
   ******************************************************************/
  async function ensureKaTeXLoaded() {
    if (window.katex && typeof window.katex.renderToString === "function") return true;

    const cssHref = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
    const jsSrc = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js";

    if (![...document.querySelectorAll("link")].some((l) => l.href === cssHref)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssHref;
      document.head.appendChild(link);
    }

    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = jsSrc;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load KaTeX"));
      document.head.appendChild(s);
    });

    return !!(window.katex && window.katex.renderToString);
  }

  /******************************************************************
   * Converter (v6 core, privacy-safe: no model, no timestamps)
   ******************************************************************/
  function S(c) {
    if (c == null) return "";
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x) => (x && (x.text || x.content)) ? (x.text || x.content) : String(x)).join("\n");
    if (typeof c === "object") return JSON.stringify(c, null, 2);
    return String(c);
  }
  function SH(s) {
    if (!s) return "";
    const el = document.createElement("div");
    el.innerHTML = s;
    el.querySelectorAll("script,iframe,object,embed").forEach((x) => x.remove());
    el.querySelectorAll("*").forEach((x) => {
      for (let i = x.attributes.length - 1; i >= 0; i--) {
        const a = x.attributes[i].name;
        if (/^on/i.test(a)) x.removeAttribute(a);
        if (a === "href" && ((x.getAttribute(a) || "").trim().toLowerCase().startsWith("javascript:"))) x.setAttribute(a, "#");
      }
    });
    return el.innerHTML;
  }
  function E(s) { const d = document.createElement("div"); d.textContent = S(s); return d.innerHTML; }

  function renderTeX(tex, display) {
    if (window.katex) {
      try { return window.katex.renderToString(tex, { throwOnError: false, displayMode: !!display }); } catch {}
    }
    return display ? `<div style="text-align:center;margin:6px 0"><code>${E(tex)}</code></div>` : `<code>${E(tex)}</code>`;
  }

  function protectTeX(raw, arr) {
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => (arr.push(renderTeX(t.trim(), true)), `%%TX${arr.length - 1}%%`));
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => (arr.push(renderTeX(t.trim(), false)), `%%TX${arr.length - 1}%%`));
    raw = raw.replace(/\$\$([\s\S]+?)\$\$/g, (match, t, offset) => {
      const hasNL = t.includes("\n");
      const chB = offset > 0 ? raw.charAt(offset - 1) : "\n";
      const chA = offset + match.length < raw.length ? raw.charAt(offset + match.length) : "\n";
      const isDisplay = hasNL || (chB === "\n" && (chA === "\n" || chA === ""));
      arr.push(renderTeX(String(t).trim(), isDisplay));
      return `%%TX${arr.length - 1}%%`;
    });
    return raw;
  }

  function Icell(raw) {
    if (!raw) return "";
    let h = String(raw);

    const ic = [];
    h = h.replace(/`([^`\n]+)`/g, (_, c) => (ic.push(`<code>${E(c)}</code>`), `%%ic${ic.length}%%`));

    const tx = [];
    h = h.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => (tx.push(renderTeX(t.trim(), false)), `%%tx${tx.length}%%`));
    h = h.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => (tx.push(renderTeX(t.trim(), false)), `%%tx${tx.length}%%`));
    h = h.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => (tx.push(renderTeX(t.trim(), false)), `%%tx${tx.length}%%`));

    h = SH(h);
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, `<img src="$2" alt="$1" loading="lazy" style="max-height:1.2em;vertical-align:middle">`);
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);
    for (let i = 1; i <= ic.length; i++) h = h.replace(`%%ic${i}%%`, ic[i - 1]);
    for (let i = 1; i <= tx.length; i++) h = h.replace(`%%tx${i}%%`, tx[i - 1]);
    return h;
  }

  function parseMdTables(text) {
    const lines = String(text || "").split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i].trim();
      if (ln.startsWith("|") && ln.endsWith("|")) {
        const tl = [];
        while (i < lines.length) {
          const cl = lines[i].trim();
          if (cl.startsWith("|") && cl.endsWith("|")) { tl.push(cl); i++; } else break;
        }
        if (tl.length >= 3) {
          const sepCells = tl[1].split("|").slice(1, -1);
          const isSep = sepCells.every((c) => /^[:=-]+$/.test(c.trim()));
          if (isSep) {
            let h = "<table><thead><tr>";
            tl[0].split("|").slice(1, -1).forEach((c) => (h += `<th>${Icell(c.trim())}</th>`));
            h += "</tr></thead><tbody>";
            for (let r = 2; r < tl.length; r++) {
              h += "<tr>";
              tl[r].split("|").slice(1, -1).forEach((c) => (h += `<td>${Icell(c.trim())}</td>`));
              h += "</tr>";
            }
            h += "</tbody></table>";
            out.push(h);
          } else {
            let h = "<table><tbody>";
            tl.forEach((row) => {
              const cells = row.split("|").slice(1, -1);
              const empty = cells.every((c) => /^[-:=\s]*$/.test(c.trim()));
              if (!empty) {
                h += "<tr>";
                cells.forEach((c) => (h += `<td>${Icell(c.trim())}</td>`));
                h += "</tr>";
              }
            });
            h += "</tbody></table>";
            out.push(h);
          }
        } else out.push(...tl);
      } else { out.push(lines[i]); i++; }
    }
    return out.join("\n");
  }

  function Mblock(rawText) {
    if (!rawText) return "";
    let h = String(rawText);

    const cb = [];
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, __lang, c) => (cb.push(`<pre><code>${E(c)}</code></pre>`), `\n%%CB${cb.length - 1}%%\n`));

    const ic = [];
    h = h.replace(/`([^`\n]+)`/g, (_, c) => (ic.push(`<code>${E(c)}</code>`), `%%IC${ic.length - 1}%%`));

    const tx = [];
    h = protectTeX(h, tx);

    h = SH(h);

    const hb = [];
    h = h.replace(/(<(?:table|div|details|figure|section|article|style)[\s\S]*?<\/(?:table|div|details|figure|section|article|style)>)/gi, (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`));

    h = parseMdTables(h);
    h = h.replace(/(<table[\s\S]*?<\/table>)/gi, (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`));

    h = h.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
    h = h.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
    h = h.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
    h = h.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

    h = h.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, `<img src="$2" alt="$1" loading="lazy">`);
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);

    h = h.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");
    h = h.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");
    h = h.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");
    h = h.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");
    h = h.replace(/^---+$/gm, "<hr>");

    h = h.replace(/\n\n/g, "</p><p>");
    h = h.replace(/\n/g, "<br>");

    for (let i = 0; i < cb.length; i++) h = h.replace(`%%CB${i}%%`, cb[i]);
    for (let i = 0; i < ic.length; i++) h = h.replace(`%%IC${i}%%`, ic[i]);
    for (let i = 0; i < tx.length; i++) h = h.replace(`%%TX${i}%%`, tx[i]);
    for (let i = 0; i < hb.length; i++) h = h.replace(`%%HB${i}%%`, hb[i]);

    return `<p>${h}</p>`;
  }

  const RENDER_TOOLS = {
    render_html: 1, render_interactive_canvas: 1, render_web_app: 1,
    render_chart: 1, render_plotly_chart: 1, render_highcharts_chart: 1,
    render_matplotlib_plot: 1, render_vis_graph: 1, render_jsmind_map: 1,
    diffusionPlus: 1, gpt_image_editor: 1,
  };

  function parseExportFull(raw) {
    const d = JSON.parse(raw);
    if (!(d && d.data && Array.isArray(d.data.chats) && d.data.chats[0])) {
      throw new Error("Not a full export JSON (data.chats missing)");
    }
    const chat = d.data.chats[0];
    const title = chat.chatTitle || "Chat Conversation";
    const messages = chat.messages || [];
    return { title, messages };
  }

  function buildMaps(ms) {
    const tcArgs = {};  // index -> { toolName: args }
    const tcNames = {}; // tool_call_id -> toolName
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        const byName = {};
        m.tool_calls.forEach((tc) => {
          const fn = tc.function || tc;
          const nm = fn.name || "";
          const ag = fn.arguments || "{}";
          if (tc.id) tcNames[tc.id] = nm;
          try { byName[nm] = (typeof ag === "string") ? JSON.parse(ag) : ag; }
          catch { byName[nm] = { raw: ag }; }
        });
        tcArgs[i] = byName;
      }
    }
    return { args: tcArgs, names: tcNames };
  }

  function renderArtifact(name, args) {
    let src = "";
    if (args) src = args.htmlSource || args.html_source || args.htmlsource || "";
    if (src && src.length > 50) {
      return `<details class="render-wrap" open><summary>Rendered: ${E(name)}</summary>` +
        `<iframe srcdoc="${src.replace(/"/g, "&quot;")}" sandbox="allow-scripts" style="width:100%;min-height:300px;border:none;border-radius:0 0 6px 6px;background:#fff" loading="lazy"></iframe></details>`;
    }
    return `<div class="artifact-notice">${E(name)} — Not in export</div>`;
  }

  const OUTPUT_CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#e5ddd5;color:#111b21;line-height:1.6}
    .w{width:100%;padding:12px 16px;min-height:100vh;background:#efeae2}
    @media(min-width:1400px){.w{padding:12px 8%}}
    .hd{text-align:center;padding:16px;margin:-12px -16px 16px;background:#00a884;color:#fff}
    .hd h1{font-size:1.1rem}
    .hd p{font-size:.72rem;opacity:.85;margin-top:3px}
    .turn{margin-bottom:10px}
    .msg{padding:8px 12px;border-radius:8px;max-width:95%;overflow-wrap:break-word;margin-bottom:2px;box-shadow:0 1px 1px rgba(0,0,0,.08)}
    @media(min-width:900px){.msg{max-width:75%}}
    .msg.u{background:#d9fdd3;margin-left:auto;border-top-right-radius:0}
    .msg.a{background:#fff;margin-right:auto;border-top-left-radius:0}
    .rl{font-weight:800;font-size:.62rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;display:block;color:#00a884}
    .bd{font-size:.86rem;line-height:1.6}
    .bd h1,.bd h2,.bd h3,.bd h4{margin:6px 0 3px}
    .bd code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:.82em;color:#005c4b}
    .bd pre{background:#1e1e1e;color:#d4d4d4;padding:10px;border-radius:6px;overflow-x:auto;margin:6px 0;font-size:.76rem}
    .bd pre code{background:transparent;padding:0;color:inherit}
    .bd a{color:#027d5e}
    .bd blockquote{border-left:3px solid #c8c8c8;padding-left:10px;color:#667781;margin:4px 0}
    .bd table{border-collapse:collapse;margin:6px 0;width:100%;display:block;overflow-x:auto}
    .bd th,.bd td{border:1px solid #d1d7db;padding:4px 8px;font-size:.8rem;white-space:nowrap}
    .bd th{background:#f0f2f5;font-weight:600}
    .bd img{max-width:100%;border-radius:4px;margin:4px 0}
    .bd .katex-display{overflow-x:auto;padding:4px 0;margin:6px 0}
    details.tc{background:#f0f2f5;border:1px solid #d1d7db;border-radius:6px;margin:3px 0;font-size:.76rem;max-width:95%}
    @media(min-width:900px){details.tc{max-width:75%}}
    details.tc summary{padding:5px 10px;cursor:pointer;color:#667781;list-style:none;display:flex;align-items:center;gap:6px}
    .tb{padding:6px 10px;border-top:1px solid #d1d7db;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.7rem;color:#667781;background:#f9f9f9}
    details.render-wrap{background:#f0f2f5;border:1px solid #d1d7db;border-radius:6px;margin:3px 0;max-width:95%}
    @media(min-width:900px){details.render-wrap{max-width:75%}}
    details.render-wrap summary{padding:8px 12px;cursor:pointer;color:#027d5e;font-weight:800;font-size:.8rem;list-style:none}
    .artifact-notice{background:#fff3cd;border:1px dashed #d1a000;border-radius:6px;padding:6px 10px;margin:3px 0;max-width:95%;font-size:.76rem;color:#856404;font-style:italic}
    @media(min-width:900px){.artifact-notice{max-width:75%}}
    @media print{
      details.render-wrap iframe{display:none!important}
      details.tc .tb{display:none!important}
      .msg{box-shadow:none;break-inside:avoid}
      .msg.u{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }
  `;

  function buildChatHTML(ms) {
    const maps = buildMaps(ms);
    let out = "";

    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (m.role !== "user") continue;

      out += `<div class="turn"><div class="msg u"><span class="rl">You</span><div class="bd">${Mblock(S(m.content))}</div></div>`;

      let tools = "";
      const replies = [];
      let j = i + 1;

      while (j < ms.length && ms[j].role !== "user") {
        const n = ms[j];

        if (n.role === "tool") {
          const toolName = n.name || maps.names[n.tool_call_id] || "tool";
          if (RENDER_TOOLS[toolName]) {
            let args = null;
            for (let k = j - 1; k >= Math.max(0, j - 7); k--) {
              if (maps.args[k] && maps.args[k][toolName]) { args = maps.args[k][toolName]; break; }
            }
            tools += renderArtifact(toolName, args);
          } else {
            const body = S(n.content || "");
            const pv = body.replace(/[\n\r]+/g, " ").slice(0, 100) + (body.length > 100 ? "..." : "");
            tools += `<details class="tc"><summary><b>${E(toolName)}</b> — ${E(pv)}</summary><div class="tb">${E(body || "(empty)")}</div></details>`;
          }
        } else if (n.role === "assistant") {
          const ac = S(n.content);
          if (ac.trim().length > 2) replies.push(ac);
        }

        j++;
      }

      out += tools;
      if (replies.length) out += `<div class="msg a"><span class="rl">Assistant</span><div class="bd">${Mblock(replies[replies.length - 1])}</div></div>`;
      out += `</div>`;
      i = j - 1;
    }

    return out || `<div style="text-align:center;color:#999;padding:40px">No messages found.</div>`;
  }

  function buildShareableHTML(title, messages) {
    const dt = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return `<!DOCTYPE html><html lang="en"><head>` +
      `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${E(title)}</title>` +
      `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">` +
      `<style>${OUTPUT_CSS}</style>` +
      `</head><body><div class="w">` +
      `<div class="hd"><h1>${E(title)}</h1><p>${E("Exported " + dt)}</p></div>` +
      buildChatHTML(messages) +
      `</div></body></html>`;
  }

  /******************************************************************
   * Output actions
   ******************************************************************/
  function safeFileBase(s) {
    return String(s || "chat").replace(/[^a-zA-Z0-9 -]/g, "").trim() || "chat";
  }

  function openPrintWindowSkeleton() {
    const w = window.open("", "_blank");
    if (!w) return null;
    w.document.open();
    w.document.write(`
      <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Preparing…</title></head>
      <body>
        <div class="tmx-wait">
          <h1>Waiting for full export…</h1>
          <p>Now do this:</p>
          <ol>
            <li>Open sidebar</li>
            <li>Tap the kebab (⋯) for the current chat</li>
            <li>Tap <b>Export</b> (full JSON)</li>
          </ol>
          <p>When the export is captured, this page will update and printing will start.</p>
        </div>
      </body></html>
    `);
    w.document.close();
    return w;
  }

  /******************************************************************
   * Main flows (HTML vs PDF)
   ******************************************************************/
  async function runFlow(kind) {
    // kind: "html" | "pdf"
    const mobile = isMobileLike();
    const fallbackTitle = getTopChatTitle();

    // Always load KaTeX before conversion (safe)
    await ensureKaTeXLoaded().catch(() => {});

    // For PDF, open print window immediately (user gesture)
    const printWin = (kind === "pdf") ? openPrintWindowSkeleton() : null;

    if (mobile) {
      // MOBILE: listener only (no automation)
      closeShareModalIfOpen();

      toast(
        `Listener armed (30s). Now: sidebar → kebab → <b>Export</b> (full JSON).`,
        []
      );

      const fullJSON = await armCaptureNextFullExportJSON({ timeoutMs: 30000 });
      const { title, messages } = parseExportFull(fullJSON);

      const html = buildShareableHTML(title || fallbackTitle, messages);

      if (kind === "html") {
        const base = safeFileBase(title || fallbackTitle);
        downloadText(html, `${base}-${Date.now()}.html`, "text/html;charset=utf-8");
        toast(`HTML exported.`, []);
      } else {
        if (printWin) {
          printWin.document.open();
          printWin.document.write(html);
          printWin.document.close();
          setTimeout(() => { try { printWin.focus(); printWin.print(); } catch {} }, 900);
        } else {
          // fallback: download html
          const base = safeFileBase(title || fallbackTitle);
          downloadText(html, `${base}-print-${Date.now()}.html`, "text/html;charset=utf-8");
          toast(`Popup blocked; downloaded print HTML instead.`, []);
        }
      }

      return;
    }

    // DESKTOP: do one-click automation (and still uses the same listener capture)
    closeShareModalIfOpen();

    const captureP = armCaptureNextFullExportJSON({ timeoutMs: 30000 });

    try {
      await desktopOneClickTriggerExport();
    } catch (e) {
      // fallback: keep listener alive and ask user to do it manually
      warn("Desktop automation failed; switching to manual capture:", e?.message || e);
      toast(
        `Automation failed. Please do sidebar kebab → <b>Export</b> manually (still listening 30s).`,
        []
      );
    }

    const fullJSON = await captureP;
    const { title, messages } = parseExportFull(fullJSON);

    const html = buildShareableHTML(title || fallbackTitle, messages);

    if (kind === "html") {
      const base = safeFileBase(title || fallbackTitle);
      downloadText(html, `${base}-${Date.now()}.html`, "text/html;charset=utf-8");
    } else {
      const w = printWin || window.open("", "_blank");
      if (w) {
        w.document.open(); w.document.write(html); w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 900);
      } else {
        const base = safeFileBase(title || fallbackTitle);
        downloadText(html, `${base}-print-${Date.now()}.html`, "text/html;charset=utf-8");
      }
    }
  }

  /******************************************************************
   * Inject 2 buttons into Share modal
   ******************************************************************/
  function injectButtons(modal) {
    if (!modal || modal.querySelector("[data-tmx='v8']")) return;
    const grid = modal.querySelector(".grid.grid-cols-2");
    if (!grid) return;

    const mkBtn = (label, bg, handler) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = `
        display:inline-flex;align-items:center;justify-content:center;
        padding:10px 14px;border-radius:10px;border:none;
        font-weight:900;font-size:12px;background:${bg};
        color:#111b21;box-shadow:0 1px 2px rgba(0,0,0,.2);width:100%
      `;
      b.addEventListener("click", async () => {
        b.disabled = true;
        const old = b.textContent;
        b.textContent = "Working…";
        try { await handler(); }
        catch (e) { alert("Export failed: " + (e?.message || e)); }
        finally { b.disabled = false; b.textContent = old; }
      });
      return b;
    };

    const addRow = (btn, desc) => {
      const left = document.createElement("div");
      left.className = "flex items-center justify-end";
      left.appendChild(btn);
      const right = document.createElement("div");
      right.textContent = desc;
      grid.appendChild(left);
      grid.appendChild(right);
    };

    addRow(
      mkBtn("Interactive HTML (Full)", "#00a884", () => runFlow("html")),
      isMobileLike()
        ? "Mobile: arms listener; you manually sidebar → Export (full JSON)."
        : "Desktop: one-click full export; manual fallback if needed."
    );

    addRow(
      mkBtn("Nice PDF (Full)", "#f59e0b", () => runFlow("pdf")),
      isMobileLike()
        ? "Mobile: opens a waiting tab, then prints after you Export."
        : "Desktop: prints after full export."
    );

    const marker = document.createElement("div");
    marker.setAttribute("data-tmx", "v8");
    marker.style.display = "none";
    modal.appendChild(marker);

    log("Injected v8 buttons.");
  }

  new MutationObserver(() => {
    const modal = document.querySelector(SEL.shareModal);
    if (modal) injectButtons(modal);
  }).observe(document.documentElement, { childList: true, subtree: true });

  log("TypingMind Exporter v8 loaded.");
})();
