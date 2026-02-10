(() => {
  /******************************************************************
   * TypingMind Extension — Full Export (Super JSON) → v6 Converter
   * Adds 2 buttons in Share modal:
   *   1) Interactive HTML
   *   2) Nice PDF (Print)
   *
   * Capture strategy (robust):
   *   A) Try sidebar selected chat kebab → Export (full JSON: data.chats...)
   *   B) Fallback to Share modal → JSON (messages-only)
   *
   * Key robustness fixes:
   *   - Uses [data-element-id="selected-chat-item"] as the active row
   *   - Targets the correct kebab menu via aria-labelledby=kebab.id
   *   - Works on phone/desktop (opens sidebar if collapsed)
   ******************************************************************/

  const TAG = "[TM Export v6.2]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const SEL = {
    // Top chat area
    shareButton: '[data-element-id="share-button"]',
    shareModal: '[data-element-id="pop-up-modal"]',
    chatTitle: '[data-element-id="current-chat-title"]',

    // Sidebar toggle (mobile/collapsed)
    sidebarToggleCompact: '[data-element-id="workspace-logo-button-compact"]',

    // Sidebar chat rows
    sidebarChatItem: '[data-element-id="custom-chat-item"]',
    sidebarSelectedChatItem: '[data-element-id="selected-chat-item"]',

    // Kebab inside a row
    chatItemKebab: 'button[aria-label="Chat settings"]',

    // Menu item for full export
    exportChatBtn: 'button[data-element-id="export-chat-button"]',
  };

  // Force kebab to be clickable even if hidden until hover (desktop)
  const FORCE_CSS = `
    .tm-force-open button[aria-label="Chat settings"]{
      opacity: 1 !important;
      width: auto !important;
      pointer-events: auto !important;
    }
  `;
  const style = document.createElement("style");
  style.textContent = FORCE_CSS;
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
    const closeBtn = [...modal.querySelectorAll("button")].find(
      (b) => textOf(b).toLowerCase() === "close"
    );
    if (closeBtn) closeBtn.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return true;
  }

  function openShareModal() {
    document.querySelector(SEL.shareButton)?.click();
  }

  function findShareJsonButton(modal) {
    return [...modal.querySelectorAll("button")].find((b) => textOf(b) === "JSON") || null;
  }

  /******************************************************************
   * Capture JSON download by intercepting Blob + anchor click
   ******************************************************************/
  function decodeBlobPartsToText(parts) {
    const dec = new TextDecoder("utf-8");
    let out = "";
    for (const p of parts || []) {
      try {
        if (typeof p === "string") out += p;
        else if (p instanceof ArrayBuffer) out += dec.decode(new Uint8Array(p));
        else if (ArrayBuffer.isView(p)) out += dec.decode(p);
        else out += String(p);
      } catch {}
    }
    return out;
  }

  async function captureJSONDownload(triggerFn, predicate, timeoutMs = 14000) {
    const OrigBlob = window.Blob;
    const OrigAClick = HTMLAnchorElement.prototype.click;

    let capturedText = null;
    let resolved = false;

    function restore() {
      window.Blob = OrigBlob;
      HTMLAnchorElement.prototype.click = OrigAClick;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!resolved) {
          restore();
          reject(new Error("Timed out capturing JSON download"));
        }
      }, timeoutMs);

      window.Blob = function (parts, opts) {
        const blob = new OrigBlob(parts, opts);
        const type = (opts && opts.type) ? String(opts.type).toLowerCase() : "";
        const txt = decodeBlobPartsToText(parts);
        const looksJson = type.includes("json") || (/^\s*[{[]/.test(txt) && txt.length > 10);

        if (looksJson && !capturedText) {
          try {
            if (!predicate || predicate(txt)) {
              JSON.parse(txt);
              capturedText = txt;
            }
          } catch {}
        }
        return blob;
      };

      HTMLAnchorElement.prototype.click = function () {
        try {
          const dl = (this && this.download) ? String(this.download).toLowerCase() : "";
          if (capturedText && (dl.includes(".json") || dl.includes("json"))) {
            resolved = true;
            clearTimeout(timer);
            restore();
            resolve(capturedText);
            return;
          }
        } catch {}
        return OrigAClick.apply(this, arguments);
      };

      try {
        triggerFn();
      } catch (e) {
        clearTimeout(timer);
        restore();
        reject(e);
        return;
      }

      (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
          if (capturedText && !resolved) {
            resolved = true;
            clearTimeout(timer);
            restore();
            resolve(capturedText);
            return;
          }
          await sleep(50);
        }
      })();
    });
  }

  /******************************************************************
   * Sidebar automation (full export) — correct selected chat handling
   ******************************************************************/
  async function ensureSidebarHasAnything() {
    const hasAny = () =>
      document.querySelector(SEL.sidebarSelectedChatItem) ||
      document.querySelector(SEL.sidebarChatItem);

    if (hasAny()) return true;

    const toggle = document.querySelector(SEL.sidebarToggleCompact);
    if (toggle) toggle.click();

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

  function fallbackFindSidebarChatItemByTitle() {
    const topTitle = getTopChatTitle();
    const items = [...document.querySelectorAll(SEL.sidebarChatItem)];
    if (!items.length) return null;

    let best = null, bestScore = 0;
    for (const it of items) {
      const titleEl = it.querySelector(".truncate");
      const sidebarTitle = textOf(titleEl) || textOf(it);
      const s = scoreTitleMatch(topTitle, sidebarTitle);
      if (s > bestScore) {
        bestScore = s;
        best = it;
      }
    }
    return best || items[0];
  }

  async function captureFullExportJSON() {
    closeShareModalIfOpen();

    const okSidebar = await ensureSidebarHasAnything();
    if (!okSidebar) throw new Error("Sidebar not available");

    // Prefer TypingMind's active row marker
    let row = document.querySelector(SEL.sidebarSelectedChatItem);
    if (!row) row = fallbackFindSidebarChatItemByTitle();
    if (!row) throw new Error("Could not locate active chat row in sidebar");

    row.classList.add("tm-force-open");
    try { row.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}

    const kebab = row.querySelector(SEL.chatItemKebab);
    if (!kebab) throw new Error("Chat settings (kebab) button not found in active row");

    kebab.click();

    const kebabId = kebab.id;
    const menuSel = kebabId
      ? `[role="menu"][aria-labelledby="${CSS.escape(kebabId)}"]`
      : `[role="menu"]`;

    const menu = await waitFor(() => document.querySelector(menuSel), 3500);
    if (!menu) throw new Error("Kebab menu did not open");

    const exportBtn = menu.querySelector(SEL.exportChatBtn);
    if (!exportBtn) throw new Error("Export button not found in kebab menu");

    const txt = await captureJSONDownload(
      () => exportBtn.click(),
      (t) => /"data"\s*:\s*\{[\s\S]*"chats"\s*:\s*\[/.test(t) || /"messages"\s*:\s*\[/.test(t)
    );

    return txt;
  }

  async function captureShareExportJSON() {
    openShareModal();
    const modal = await waitFor(() => document.querySelector(SEL.shareModal), 3500);
    if (!modal) throw new Error("Share modal did not open");

    const jsonBtn = findShareJsonButton(modal);
    if (!jsonBtn) throw new Error("JSON button not found in Share modal");

    const txt = await captureJSONDownload(
      () => jsonBtn.click(),
      (t) => /"messages"\s*:\s*\[/.test(t) || /^\s*\[/.test(t)
    );
    return txt;
  }

  /******************************************************************
   * KaTeX loader (render LaTeX at export-time, output HTML has KaTeX CSS)
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
   * v6 Converter (tables, inline HTML, artifact renders, LaTeX, robust stringify)
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

  function E(s) {
    const d = document.createElement("div");
    d.textContent = S(s);
    return d.innerHTML;
  }

  function tr(s, n = 100) {
    s = S(s);
    return s.length > n ? s.slice(0, n) + "..." : s;
  }

  function renderTeX(tex, display) {
    if (window.katex) {
      try {
        return window.katex.renderToString(tex, { throwOnError: false, displayMode: !!display });
      } catch {}
    }
    return display
      ? `<div style="text-align:center;margin:6px 0"><code>${E(tex)}</code></div>`
      : `<code>${E(tex)}</code>`;
  }

  // Extract TeX from RAW (before SH) to avoid &lt; &gt; encoding issues
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

  // Inline markdown for table cells (supports bold/links/img + inline TeX)
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
          if (cl.startsWith("|") && cl.endsWith("|")) { tl.push(cl); i++; }
          else break;
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
        } else {
          out.push(...tl);
        }
      } else {
        out.push(lines[i]);
        i++;
      }
    }

    return out.join("\n");
  }

  function Mblock(rawText) {
    if (!rawText) return "";
    let h = String(rawText);

    // Code blocks from RAW
    const cb = [];
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, __lang, c) => {
      cb.push(`<pre><code>${E(c)}</code></pre>`);
      return `\n%%CB${cb.length - 1}%%\n`;
    });

    // Inline code from RAW
    const ic = [];
    h = h.replace(/`([^`\n]+)`/g, (_, c) => {
      ic.push(`<code>${E(c)}</code>`);
      return `%%IC${ic.length - 1}%%`;
    });

    // TeX from RAW (before SH)
    const tx = [];
    h = protectTeX(h, tx);

    // Sanitize remainder
    h = SH(h);

    // Protect existing HTML blocks
    const hb = [];
    h = h.replace(
      /(<(?:table|div|details|figure|section|article|style)[\s\S]*?<\/(?:table|div|details|figure|section|article|style)>)/gi,
      (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`)
    );

    // Tables
    h = parseMdTables(h);
    h = h.replace(/(<table[\s\S]*?<\/table>)/gi, (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`));

    // Headings
    h = h.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
    h = h.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
    h = h.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
    h = h.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

    // Bold/italic
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Images before links
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, `<img src="$2" alt="$1" loading="lazy">`);
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);

    // Quotes, lists, hr
    h = h.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");
    h = h.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");
    h = h.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");
    h = h.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");
    h = h.replace(/^---+$/gm, "<hr>");

    // Paragraphs
    h = h.replace(/\n\n/g, "</p><p>");
    h = h.replace(/\n/g, "<br>");

    // Restore
    for (let i = 0; i < cb.length; i++) h = h.replace(`%%CB${i}%%`, cb[i]);
    for (let i = 0; i < ic.length; i++) h = h.replace(`%%IC${i}%%`, ic[i]);
    for (let i = 0; i < tx.length; i++) h = h.replace(`%%TX${i}%%`, tx[i]);
    for (let i = 0; i < hb.length; i++) h = h.replace(`%%HB${i}%%`, hb[i]);

    return `<p>${h}</p>`;
  }

  function fmtTime(ts) {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  const RENDER_TOOLS = {
    render_html: 1,
    render_interactive_canvas: 1,
    render_web_app: 1,
    render_chart: 1,
    render_plotly_chart: 1,
    render_highcharts_chart: 1,
    render_matplotlib_plot: 1,
    render_vis_graph: 1,
    render_jsmind_map: 1,
    diffusionPlus: 1,
    gpt_image_editor: 1,
  };

  function parseExport(raw) {
    const d = JSON.parse(raw);
    const r = { messages: [], title: "", model: "", created: "" };

    // Full export
    if (d?.data?.chats && Array.isArray(d.data.chats)) {
      const chat = d.data.chats[0];
      r.messages = chat.messages || [];
      r.title = chat.chatTitle || "";
      r.model = (chat.modelInfo && chat.modelInfo.title) || "";
      r.created = chat.createdAt || "";
      return r;
    }

    // Small export
    if (d?.messages && Array.isArray(d.messages)) { r.messages = d.messages; return r; }

    // Raw array
    if (Array.isArray(d)) { r.messages = d; return r; }

    throw new Error("Unrecognized JSON format");
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
    if (args) {
      src = args.htmlSource || args.html_source || args.htmlsource || "";
      if (!src && args.matplotlib_code) {
        return `<details class="render-wrap"><summary>Code: ${E(name)}</summary><pre><code>${E(args.matplotlib_code)}</code></pre></details>`;
      }
      if (!src && args.graphCode) {
        return `<details class="render-wrap"><summary>Code: ${E(name)}</summary><pre><code>${E(args.graphCode)}</code></pre></details>`;
      }
      if (!src && args.prompt) {
        return `<div class="artifact-notice">${E(name)}: ${E(args.prompt)}</div>`;
      }
    }

    if (src && src.length > 50) {
      // Note: allow-scripts enables interactive renders; still sandboxed.
      return `<details class="render-wrap" open><summary>Rendered: ${E(name)}</summary>` +
        `<iframe srcdoc="${src.replace(/"/g, "&quot;")}" sandbox="allow-scripts" ` +
        `style="width:100%;min-height:300px;border:none;border-radius:0 0 6px 6px;background:#fff" loading="lazy"></iframe></details>`;
    }

    return `<div class="artifact-notice">${E(name)} — Content not available in export</div>`;
  }

  const OUTPUT_CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#e5ddd5;color:#111b21;line-height:1.6}
    .w{width:100%;padding:12px 16px;min-height:100vh;background:#efeae2}
    @media(min-width:1400px){.w{padding:12px 8%}}
    .hd{text-align:center;padding:16px;margin:-12px -16px 16px;background:#00a884;color:#fff}
    .hd h1{font-size:1.1rem}.hd p{font-size:.72rem;opacity:.85;margin-top:3px}
    .turn{margin-bottom:10px}
    .msg{padding:8px 12px;border-radius:8px;max-width:95%;overflow-wrap:break-word;margin-bottom:2px;box-shadow:0 1px 1px rgba(0,0,0,.08)}
    @media(min-width:900px){.msg{max-width:75%}}
    .msg.u{background:#d9fdd3;margin-left:auto;border-top-right-radius:0}
    .msg.a{background:#fff;margin-right:auto;border-top-left-radius:0}
    .rl{font-weight:700;font-size:.62rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;display:block;color:#00a884}
    .msg.u .rl{color:#027d5e}
    .ts{font-size:.58rem;color:#999;margin-top:3px;text-align:right}
    .bd{font-size:.86rem;line-height:1.6}
    .bd h1,.bd h2,.bd h3,.bd h4{margin:6px 0 3px}
    .bd h1{font-size:1.05rem}.bd h2{font-size:.95rem}.bd h3{font-size:.88rem}
    .bd code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:.82em;color:#005c4b}
    .bd pre{background:#1e1e1e;color:#d4d4d4;padding:10px;border-radius:6px;overflow-x:auto;margin:6px 0;font-size:.76rem}
    .bd pre code{background:transparent;padding:0;color:inherit}
    .bd a{color:#027d5e}
    .bd ul,.bd ol{padding-left:18px;margin:4px 0}
    .bd blockquote{border-left:3px solid #c8c8c8;padding-left:10px;color:#667781;margin:4px 0}
    .bd table{border-collapse:collapse;margin:6px 0;width:100%;display:block;overflow-x:auto}
    .bd th,.bd td{border:1px solid #d1d7db;padding:4px 8px;font-size:.8rem;white-space:nowrap}
    .bd th{background:#f0f2f5;font-weight:600}
    .bd img{max-width:100%;border-radius:4px;margin:4px 0}
    .bd .katex-display{overflow-x:auto;padding:4px 0;margin:6px 0}
    details.tc{background:#f0f2f5;border:1px solid #d1d7db;border-radius:6px;margin:3px 0;font-size:.76rem;max-width:95%;box-shadow:0 1px 1px rgba(0,0,0,.05)}
    @media(min-width:900px){details.tc{max-width:75%}}
    details.tc summary{padding:5px 10px;cursor:pointer;color:#667781;list-style:none;display:flex;align-items:center;gap:4px}
    details.tc summary::before{content:"\\25B6";font-size:.5rem;transition:transform .15s}
    details.tc[open] summary::before{transform:rotate(90deg)}
    .tb{padding:6px 10px;border-top:1px solid #d1d7db;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.7rem;color:#667781;background:#f9f9f9}
    details.render-wrap{background:#f0f2f5;border:1px solid #d1d7db;border-radius:6px;margin:3px 0;max-width:95%}
    @media(min-width:900px){details.render-wrap{max-width:75%}}
    details.render-wrap summary{padding:8px 12px;cursor:pointer;color:#027d5e;font-weight:600;font-size:.8rem;list-style:none;display:flex;align-items:center;gap:6px}
    details.render-wrap summary::before{content:"\\25B6";font-size:.6rem;transition:transform .15s}
    details.render-wrap[open] summary::before{transform:rotate(90deg)}
    .artifact-notice{background:#fff3cd;border:1px dashed #d1a000;border-radius:6px;padding:6px 10px;margin:3px 0;max-width:95%;font-size:.76rem;color:#856404;font-style:italic}
    @media(min-width:900px){.artifact-notice{max-width:75%}}
    @media print{
      body{background:#fff!important}
      .w{background:#fff!important;padding:10px}
      .msg{box-shadow:none;break-inside:avoid;max-width:100%}
      .msg.u{background:#d9fdd3!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      details.tc .tb{display:none!important}
      details.tc summary{color:#999;font-style:italic}
      details.tc,details.render-wrap{break-inside:avoid;max-width:100%}
      .bd table,.bd th,.bd td{font-size:.75rem}
    }
  `;

  function buildChatHTML(ms) {
    const maps = buildMaps(ms);
    let out = "";

    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (m.role !== "user") continue;

      const userTs = fmtTime(m.createdAt);

      out += `<div class="turn">` +
        `<div class="msg u"><span class="rl">You</span><div class="bd">${Mblock(S(m.content))}</div>` +
        (userTs ? `<div class="ts">${E(userTs)}</div>` : "") +
        `</div>`;

      let tools = "";
      const replies = [];
      let lastTs = "";
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
            const pv = tr(body.replace(/[\n\r]+/g, " "), 100);
            tools += `<details class="tc"><summary><b>${E(toolName)}</b> — ${E(pv)}</summary><div class="tb">${E(body || "(empty)")}</div></details>`;
          }
        } else if (n.role === "assistant") {
          const ac = S(n.content);
          if (ac.trim().length > 2) {
            replies.push(ac);
            lastTs = fmtTime(n.createdAt);
          }
        }

        j++;
      }

      out += tools;

      if (replies.length) {
        out += `<div class="msg a"><span class="rl">Assistant</span><div class="bd">${Mblock(replies[replies.length - 1])}</div>` +
          (lastTs ? `<div class="ts">${E(lastTs)}</div>` : "") +
          `</div>`;
      }

      out += `</div>`;
      i = j - 1;
    }

    return out || `<div style="text-align:center;color:#999;padding:40px">No messages found.</div>`;
  }

  function buildShareableHTML(parsed, fallbackTitle) {
    const title = parsed.title || fallbackTitle || "Chat Conversation";
    const dt = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const sub = [];
    if (parsed.model) sub.push(`Model: ${parsed.model}`);
    sub.push(`Exported ${dt}`);

    return `<!DOCTYPE html><html lang="en"><head>` +
      `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${E(title)}</title>` +
      `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">` +
      `<style>${OUTPUT_CSS}</style>` +
      `</head><body><div class="w">` +
      `<div class="hd"><h1>${E(title)}</h1><p>${E(sub.join(" | "))}</p></div>` +
      buildChatHTML(parsed.messages) +
      `</div></body></html>`;
  }

  function downloadTextAsFile(text, filename, mime = "text/html;charset=utf-8") {
    const b = new Blob([text], { type: mime });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(u);
    }, 300);
  }

  /******************************************************************
   * Main actions
   ******************************************************************/
  async function getBestJSON() {
    try {
      const full = await captureFullExportJSON();
      return { jsonText: full, source: "full" };
    } catch (e) {
      warn("Full export capture failed; falling back to Share JSON.", e);
      const share = await captureShareExportJSON();
      return { jsonText: share, source: "share" };
    }
  }

  async function doInteractiveHTML() {
    const fallbackTitle = getTopChatTitle();
    await ensureKaTeXLoaded();

    const { jsonText, source } = await getBestJSON();
    const parsed = parseExport(jsonText);

    const html = buildShareableHTML(parsed, fallbackTitle);
    const safeBase = (parsed.title || fallbackTitle || "chat").replace(/[^a-zA-Z0-9 -]/g, "").trim() || "chat";
    downloadTextAsFile(html, `${safeBase}-${source}-${Date.now()}.html`);
  }

  async function doNicePDF() {
    // Open popup immediately to avoid popup blockers
    const w = window.open("", "_blank");
    if (!w) {
      alert("Pop-up blocked. Please allow pop-ups for TypingMind to print.");
      return;
    }

    const fallbackTitle = getTopChatTitle();
    await ensureKaTeXLoaded();

    const { jsonText } = await getBestJSON();
    const parsed = parseExport(jsonText);

    const html = buildShareableHTML(parsed, fallbackTitle);

    w.document.open();
    w.document.write(html);
    w.document.close();

    setTimeout(() => {
      try { w.focus(); w.print(); } catch (e) { alert("Print failed: " + (e?.message || e)); }
    }, 800);
  }

  /******************************************************************
   * Inject buttons into Share modal
   ******************************************************************/
  function injectButtons(modal) {
    if (!modal || modal.querySelector("[data-tm-added='v62']")) return;

    const grid = modal.querySelector(".grid.grid-cols-2");
    if (!grid) return;

    const mkBtn = (label, bg, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = `
        display:inline-flex;align-items:center;justify-content:center;
        padding:10px 14px;border-radius:10px;border:none;
        font-weight:800;font-size:12px;
        background:${bg};color:#111b21;
        box-shadow:0 1px 2px rgba(0,0,0,.2);
        width:100%;
      `;
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await onClick(); }
        catch (e) { alert("Export failed: " + (e?.message || e)); }
        finally { b.disabled = false; }
      });
      return b;
    };

    const left1 = document.createElement("div");
    left1.className = "flex items-center justify-end";
    left1.appendChild(mkBtn("Interactive HTML", "#00a884", doInteractiveHTML));

    const right1 = document.createElement("div");
    right1.textContent = "Prefers sidebar Export (full JSON). Falls back to Share JSON.";

    const left2 = document.createElement("div");
    left2.className = "flex items-center justify-end";
    left2.appendChild(mkBtn("Nice PDF", "#f59e0b", doNicePDF));

    const right2 = document.createElement("div");
    right2.textContent = "Print-ready output. Uses full JSON when available.";

    const marker = document.createElement("div");
    marker.setAttribute("data-tm-added", "v62");
    marker.style.display = "none";
    modal.appendChild(marker);

    grid.appendChild(left1);
    grid.appendChild(right1);
    grid.appendChild(left2);
    grid.appendChild(right2);

    log("Buttons injected.");
  }

  const mo = new MutationObserver(() => {
    const modal = document.querySelector(SEL.shareModal);
    if (modal) injectButtons(modal);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  log("Loaded. Open Share → use Interactive HTML / Nice PDF.");
})();
