(() => {
  /******************************************************************
   * TypingMind Extension — v6.4 (Mobile-safe)
   *
   * Fixes Android/PWA crash by:
   *  - NOT overriding window.Blob (that can break TypingMind internals on mobile)
   *  - Capturing exports by intercepting URL.createObjectURL(blob) + <a>.click()
   *  - Only attempting sidebar full-export when we can confidently identify
   *    the active chat row (selected-chat-item with kebab).
   *  - If not confident, falls back to Share→JSON (messages-only) instead of crashing.
   *
   * Adds 2 buttons in Share modal:
   *  - Interactive HTML  (download/shareable HTML)
   *  - Nice PDF          (opens print window; fallback = download HTML)
   ******************************************************************/

  const TAG = "[TM Export v6.4]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const SEL = {
    // Top chat area
    shareButton: '[data-element-id="share-button"]',
    shareModal: '[data-element-id="pop-up-modal"]',
    chatTitle: '[data-element-id="current-chat-title"]',

    // Sidebar (mobile collapsed)
    sidebarToggleCompact: '[data-element-id="workspace-logo-button-compact"]',

    // Sidebar rows
    sidebarChatItem: '[data-element-id="custom-chat-item"]',
    sidebarSelectedChatItem: '[data-element-id="selected-chat-item"]',

    // Chat row kebab
    chatItemKebab: 'button[aria-label="Chat settings"]',

    // Kebab menu item for export
    exportChatBtn: 'button[data-element-id="export-chat-button"]',
  };

  // Force kebab clickable even if normally hidden until hover (desktop)
  const FORCE_CSS = `
    .tm-force-open ${SEL.chatItemKebab}{
      opacity: 1 !important;
      width: auto !important;
      pointer-events: auto !important;
    }
    .tm-toast{
      position: fixed; left: 12px; right: 12px; bottom: 14px; z-index: 2147483647;
      background: rgba(17,24,39,.95); color: #fff; border: 1px solid rgba(255,255,255,.12);
      border-radius: 12px; padding: 10px 12px; font: 13px/1.35 system-ui, -apple-system, sans-serif;
      box-shadow: 0 8px 30px rgba(0,0,0,.35);
    }
    .tm-toast .row{display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:8px}
    .tm-toast button{
      border: none; border-radius: 10px; padding: 8px 10px; font-weight: 800; font-size: 12px;
      background: #00a884; color: #111; cursor: pointer;
    }
    .tm-toast button.alt{ background: #f59e0b; }
    .tm-toast button.ghost{ background: rgba(255,255,255,.12); color:#fff; font-weight:700; }
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

  function toast(msg, actions = []) {
    try { document.querySelectorAll(".tm-toast").forEach((x) => x.remove()); } catch {}
    const t = document.createElement("div");
    t.className = "tm-toast";
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
   * SAFE CAPTURE (mobile-safe): intercept URL.createObjectURL(blob) + <a>.click()
   * - No Blob override
   ******************************************************************/
  async function captureDownloadViaObjectURL(triggerFn, {
    shouldCaptureBlob,
    predicateText,
    timeoutMs = 14000,
    suppressDownload = true,
  } = {}) {
    const OrigCOU = URL.createObjectURL.bind(URL);
    const OrigRVO = URL.revokeObjectURL.bind(URL);
    const OrigAClick = HTMLAnchorElement.prototype.click;

    const urlToTextPromise = new Map(); // url -> Promise<string>
    let clickedUrl = null;

    function restore() {
      URL.createObjectURL = OrigCOU;
      URL.revokeObjectURL = OrigRVO;
      HTMLAnchorElement.prototype.click = OrigAClick;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        restore();
        reject(new Error("Timed out capturing download"));
      }, timeoutMs);

      URL.createObjectURL = function (blob) {
        const url = OrigCOU(blob);
        try {
          const type = (blob && blob.type) ? String(blob.type).toLowerCase() : "";
          const ok = shouldCaptureBlob
            ? !!shouldCaptureBlob(blob)
            : (type.includes("json") || type.includes("application"));
          if (ok && blob && typeof blob.text === "function") {
            urlToTextPromise.set(url, blob.text());
          }
        } catch {}
        return url;
      };

      HTMLAnchorElement.prototype.click = function () {
        try {
          const href = (this && this.href) ? String(this.href) : "";
          if (href && urlToTextPromise.has(href)) {
            clickedUrl = href;
            if (suppressDownload) return; // swallow the click
          }
        } catch {}
        return OrigAClick.apply(this, arguments);
      };

      // Trigger after hooks installed
      try { triggerFn(); }
      catch (e) {
        clearTimeout(timer);
        restore();
        reject(e);
        return;
      }

      (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
          if (clickedUrl && urlToTextPromise.has(clickedUrl)) {
            try {
              const txt = await urlToTextPromise.get(clickedUrl);
              // Clean up URL
              try { OrigRVO(clickedUrl); } catch {}
              restore();
              clearTimeout(timer);

              try {
                if (predicateText && !predicateText(txt)) {
                  reject(new Error("Captured download but content did not match predicate"));
                  return;
                }
                JSON.parse(txt); // validate JSON
              } catch (e) {
                reject(new Error("Captured content is not valid JSON"));
                return;
              }

              resolve(txt);
              return;
            } catch (e) {
              restore();
              clearTimeout(timer);
              reject(e);
              return;
            }
          }
          await sleep(50);
        }
        restore();
        clearTimeout(timer);
        reject(new Error("No captured object URL click detected"));
      })();
    });
  }

  /******************************************************************
   * Sidebar full export capture (super JSON)
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

  function pickActiveChatRowConfidently() {
    const topTitle = getTopChatTitle();

    // 1) Best: TypingMind marks active row explicitly
    const selected = document.querySelector(SEL.sidebarSelectedChatItem);
    if (selected && selected.querySelector(SEL.chatItemKebab)) {
      // If it has a visible title, verify match roughly (avoid edge case where selected is transient)
      const titleEl = selected.querySelector(".truncate");
      const sTitle = textOf(titleEl) || textOf(selected);
      const sc = scoreTitleMatch(topTitle, sTitle);
      // Even if score is low, selected marker is authoritative—accept.
      return { row: selected, confidence: Math.max(700, sc), reason: "selected-chat-item" };
    }

    // 2) Fallback: find best title match among visible chat items (not folders)
    const items = [...document.querySelectorAll(SEL.sidebarChatItem)]
      .filter((it) => it.querySelector(SEL.chatItemKebab)); // ensure it's a chat row

    if (!items.length) return { row: null, confidence: 0, reason: "no-chat-items" };

    let best = null, bestScore = 0, bestTitle = "";
    for (const it of items) {
      const titleEl = it.querySelector(".truncate");
      const sTitle = textOf(titleEl) || textOf(it);
      const sc = scoreTitleMatch(topTitle, sTitle);
      if (sc > bestScore) {
        bestScore = sc;
        best = it;
        bestTitle = sTitle;
      }
    }
    return { row: best, confidence: bestScore, reason: `best-match:${bestTitle}` };
  }

  async function captureFullExportJSON() {
    // IMPORTANT: on mobile, share modal can block sidebar interactions
    closeShareModalIfOpen();

    const okSidebar = await ensureSidebarHasAnything();
    if (!okSidebar) throw new Error("Sidebar not available");

    const pick = pickActiveChatRowConfidently();
    if (!pick.row) throw new Error("Could not locate active chat row in sidebar");
    // If we are not confident, do NOT attempt full-export (avoids app crash on mobile)
    if (pick.confidence < 450) {
      throw new Error("Low confidence identifying active chat in sidebar; skipping full export");
    }

    const row = pick.row;
    row.classList.add("tm-force-open");
    try { row.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}

    const kebab = row.querySelector(SEL.chatItemKebab);
    if (!kebab) throw new Error("Chat settings (kebab) button not found in active row");

    // Open THIS row's menu
    kebab.click();

    // Identify the menu for THIS kebab via aria-labelledby
    const kebabId = kebab.id;
    const menuSel = kebabId
      ? `[role="menu"][aria-labelledby="${(window.CSS && CSS.escape) ? CSS.escape(kebabId) : kebabId}"]`
      : `[role="menu"]`;

    const menu = await waitFor(() => document.querySelector(menuSel), 3500);
    if (!menu) throw new Error("Kebab menu did not open");

    const exportBtn = menu.querySelector(SEL.exportChatBtn);
    if (!exportBtn) throw new Error("Export button not found in kebab menu");

    // Capture the JSON export download in a mobile-safe way
    const txt = await captureDownloadViaObjectURL(
      () => exportBtn.click(),
      {
        shouldCaptureBlob: (blob) => String(blob?.type || "").toLowerCase().includes("json"),
        predicateText: (t) => /"data"\s*:\s*\{[\s\S]*"chats"\s*:\s*\[/.test(t) || /"messages"\s*:\s*\[/.test(t),
        suppressDownload: true,
        timeoutMs: 14000,
      }
    );

    return txt;
  }

  /******************************************************************
   * Share modal JSON capture (fallback)
   ******************************************************************/
  async function captureShareExportJSON() {
    openShareModal();
    const modal = await waitFor(() => document.querySelector(SEL.shareModal), 3500);
    if (!modal) throw new Error("Share modal did not open");

    const jsonBtn = findShareJsonButton(modal);
    if (!jsonBtn) throw new Error("JSON button not found in Share modal");

    const txt = await captureDownloadViaObjectURL(
      () => jsonBtn.click(),
      {
        shouldCaptureBlob: (blob) => String(blob?.type || "").toLowerCase().includes("json"),
        predicateText: (t) => /"messages"\s*:\s*\[/.test(t) || /^\s*\[/.test(t),
        suppressDownload: true,
        timeoutMs: 12000,
      }
    );

    return txt;
  }

  /******************************************************************
   * KaTeX loader (render LaTeX during export)
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
   * v6 Converter (core)
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

  // Extract TeX from RAW before SH() to avoid &lt; &gt; encoding issues
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

  // Inline markdown for table cells
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

    const cb = [];
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, __lang, c) => {
      cb.push(`<pre><code>${E(c)}</code></pre>`);
      return `\n%%CB${cb.length - 1}%%\n`;
    });

    const ic = [];
    h = h.replace(/`([^`\n]+)`/g, (_, c) => {
      ic.push(`<code>${E(c)}</code>`);
      return `%%IC${ic.length - 1}%%`;
    });

    const tx = [];
    h = protectTeX(h, tx);

    h = SH(h);

    const hb = [];
    h = h.replace(
      /(<(?:table|div|details|figure|section|article|style)[\s\S]*?<\/(?:table|div|details|figure|section|article|style)>)/gi,
      (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`)
    );

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

    if (d?.data?.chats && Array.isArray(d.data.chats)) {
      const chat = d.data.chats[0];
      r.messages = chat.messages || [];
      r.title = chat.chatTitle || "";
      r.model = (chat.modelInfo && chat.modelInfo.title) || "";
      r.created = chat.createdAt || "";
      return r;
    }

    if (d?.messages && Array.isArray(d.messages)) { r.messages = d.messages; return r; }
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

  function downloadHTML(html, filename) {
    const b = new Blob([html], { type: "text/html;charset=utf-8" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch {}
      try { URL.revokeObjectURL(u); } catch {}
    }, 300);
    return { blob: b, url: u };
  }

  function canShareFile(file) {
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [file] }));
    } catch {
      return false;
    }
  }

  async function tryShareFile(file, title) {
    if (!navigator.share || !canShareFile(file)) return false;
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch {
      return false;
    }
  }

  /******************************************************************
   * Main action helpers
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

    // Capture JSON first (keeps mobile user-gesture chain as short as possible)
    toast("Exporting… (capturing JSON, please wait)");
    const { jsonText, source } = await getBestJSON();

    // Load KaTeX only after capture
    try { await ensureKaTeXLoaded(); } catch {}

    const parsed = parseExport(jsonText);
    const html = buildShareableHTML(parsed, fallbackTitle);

    const safeBase = (parsed.title || fallbackTitle || "chat").replace(/[^a-zA-Z0-9 -]/g, "").trim() || "chat";
    const filename = `${safeBase}-${source}-${Date.now()}.html`;

    const { blob } = downloadHTML(html, filename);

    // Mobile-friendly fallback actions (if download didn’t start, user can Share)
    const file = new File([blob], filename, { type: "text/html" });
    toast("HTML ready. If download didn’t start, tap Share.", [
      { label: "Share HTML", kind: "alt", onClick: () => tryShareFile(file, safeBase) },
      { label: "Download again", onClick: () => downloadHTML(html, filename) },
    ]);
  }

  async function doNicePDF() {
    // On mobile PWAs, printing can be flaky; we open a window immediately (gesture)
    const w = window.open("", "_blank");
    if (!w) {
      toast("Pop-up blocked. Generating HTML instead.", []);
      await doInteractiveHTML();
      return;
    }

    const fallbackTitle = getTopChatTitle();

    toast("Exporting… (capturing JSON, please wait)");
    const { jsonText } = await getBestJSON();

    try { await ensureKaTeXLoaded(); } catch {}

    const parsed = parseExport(jsonText);
    const html = buildShareableHTML(parsed, fallbackTitle);

    w.document.open();
    w.document.write(html);
    w.document.close();

    // Try print
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch (e) {
        // Fallback: also offer HTML download/share
        const safeBase = (parsed.title || fallbackTitle || "chat").replace(/[^a-zA-Z0-9 -]/g, "").trim() || "chat";
        const filename = `${safeBase}-print-${Date.now()}.html`;
        const { blob } = downloadHTML(html, filename);
        const file = new File([blob], filename, { type: "text/html" });
        toast("Print failed on this device. Use the HTML instead.", [
          { label: "Share HTML", kind: "alt", onClick: () => tryShareFile(file, safeBase) },
          { label: "Download HTML", onClick: () => downloadHTML(html, filename) },
        ]);
      }
    }, 900);
  }

  /******************************************************************
   * Inject buttons into Share modal
   ******************************************************************/
  function injectButtons(modal) {
    if (!modal || modal.querySelector("[data-tm-added='v64']")) return;

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
        catch (e) {
          alert("Export failed: " + (e?.message || e));
        } finally {
          b.disabled = false;
        }
      });
      return b;
    };

    const left1 = document.createElement("div");
    left1.className = "flex items-center justify-end";
    left1.appendChild(mkBtn("Interactive HTML", "#00a884", doInteractiveHTML));

    const right1 = document.createElement("div");
    right1.textContent = "Uses full sidebar Export when safely detectable; otherwise falls back to Share JSON.";

    const left2 = document.createElement("div");
    left2.className = "flex items-center justify-end";
    left2.appendChild(mkBtn("Nice PDF", "#f59e0b", doNicePDF));

    const right2 = document.createElement("div");
    right2.textContent = "Opens print window; if printing fails on mobile, provides HTML fallback.";

    const marker = document.createElement("div");
    marker.setAttribute("data-tm-added", "v64");
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
