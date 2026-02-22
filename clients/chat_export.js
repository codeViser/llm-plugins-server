(() => {
  /******************************************************************
   * TypingMind Exporter v12
   *
   * UI/UX overhaul from v11:
   * - CSS-variable theming with dark/light toggle
   * - Compact tool calls (collapsed ~22px, passive gray, accent on expand)
   * - Refined color palette (no pure black/white)
   * - PDF defaults to dark mode with print-color-adjust
   * - Unified class names (rw/an) across both tools
   *
   * Preserved from v11:
   * - Desktop: fully automated (sidebar full-export -> fallback share JSON)
   * - Mobile/PWA: passive listener + overlay
   * - DOM JSON extraction from Share modal preview
   * - All parsing, privacy filtering, markdown rendering logic
   ******************************************************************/

  const TAG = "[TMX v12]";
  const log = (...a) => console.log(TAG, ...a);

  const SEL = {
    shareBtn: '[data-element-id="share-button"]',
    shareModal: '[data-element-id="pop-up-modal"]',
    chatTitle: '[data-element-id="current-chat-title"]',
    sidebarToggle: '[data-element-id="workspace-logo-button-compact"]',
    selectedChat: '[data-element-id="selected-chat-item"]',
    chatItem: '[data-element-id="custom-chat-item"]',
    kebab: 'button[aria-label="Chat settings"]',
    exportBtn: 'button[data-element-id="export-chat-button"]',
  };

  /* ============ STYLES ============ */
  const sEl = document.createElement("style");
  sEl.textContent = `
    .tm-force-open button[aria-label="Chat settings"]{opacity:1!important;width:auto!important;pointer-events:auto!important}

    /* pass-through overlay: does NOT block touches except Cancel */
    .tmx-bar{position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:rgba(17,24,39,.85);color:#fff;border-top:2px solid #00a884;padding:10px 16px;font:13px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 -4px 24px rgba(0,0,0,.4);pointer-events:none}
    .tmx-bar *{pointer-events:none}
    .tmx-bar button{pointer-events:auto}
    .tmx-bar b{color:#00a884}
    .tmx-bar .row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    .tmx-bar button{border:none;border-radius:10px;padding:8px 14px;font-weight:800;font-size:12px;cursor:pointer}
    .tmx-bar .cancel{background:rgba(255,255,255,.15);color:#fff}
    .tmx-bar .pulsedot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#00a884;margin-right:6px;animation:tmxpulse 1.2s infinite}
    @keyframes tmxpulse{0%,100%{opacity:1}50%{opacity:.3}}

    /* non-blocking status toast (desktop) */
    .tmx-status{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(17,24,39,.92);color:#fff;padding:8px 16px;border-radius:10px;font:12px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;transition:opacity .3s}
  `;
  document.documentElement.appendChild(sEl);

  /* ============ HELPERS ============ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms = 4000) {
    const t = Date.now();
    while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(40); }
    return null;
  }
  function textOf(el) { return (el?.textContent || "").replace(/\s+/g, " ").trim(); }
  function cssEsc(s) { try { return CSS.escape(s); } catch { return s.replace(/([^\w-])/g, "\\$1"); } }

  function isMobileLike() {
    const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    return coarse && Math.min(window.innerWidth || 9999, window.innerHeight || 9999) < 900;
  }

  function showStatus(msg, durationMs) {
    try { document.querySelectorAll('.tmx-status').forEach(x => x.remove()); } catch {}
    const d = document.createElement('div');
    d.className = 'tmx-status';
    d.textContent = msg;
    document.body.appendChild(d);
    if (durationMs) setTimeout(() => { d.style.opacity = '0'; setTimeout(() => { try { d.remove(); } catch {} }, 400); }, durationMs);
    return d;
  }

  function getTitle() {
    const el = document.querySelector(SEL.chatTitle);
    if (!el) return "Chat";
    const c = el.cloneNode(true);
    c.querySelectorAll("button,svg").forEach((n) => n.remove());
    return textOf(c) || "Chat";
  }

  function closeModal() {
    const m = document.querySelector(SEL.shareModal);
    if (!m) return;
    const b = [...m.querySelectorAll("button")].find((b) => textOf(b).toLowerCase() === "close");
    if (b) b.click(); else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  function openModal() { document.querySelector(SEL.shareBtn)?.click(); }

  /* ============================================================
   * 1) CAPTURE ENGINE (unchanged from v11)
   * ============================================================ */
  function createCapture({ timeoutMs = 15000, suppressDownload = false, acceptSmall = false } = {}) {
    const OrigClick = HTMLAnchorElement.prototype.click;
    let done = false;
    let resolveFn, rejectFn;

    const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });

    const timer = setTimeout(() => {
      if (!done) cancel(new Error("Capture timed out"));
    }, timeoutMs);

    function cleanup() {
      HTMLAnchorElement.prototype.click = OrigClick;
      document.removeEventListener("click", onDocClick, true);
    }

    function cancel(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      rejectFn(err || new Error("Cancelled"));
    }

    function restore() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
    }

    function processText(txt) {
      if (done) return;
      try {
        const obj = JSON.parse(txt);
        const isFull = !!(obj?.data?.chats?.[0]);
        const isSmall = !!(obj?.messages || Array.isArray(obj));

        if (isFull) {
          restore();
          resolveFn({ text: txt, kind: "full" });
        } else if (isSmall && acceptSmall) {
          restore();
          resolveFn({ text: txt, kind: "share" });
        }
      } catch {}
    }

    function isJSONDownloadAnchor(a) {
      if (!a || a.tagName !== "A") return false;
      const href = String(a.href || "");
      const dl = String(a.getAttribute("download") || a.download || "").toLowerCase();
      return href.startsWith("blob:") && (dl.includes("json") || dl.endsWith(".json"));
    }

    HTMLAnchorElement.prototype.click = function () {
      if (!done && isJSONDownloadAnchor(this)) {
        const href = this.href;
        fetch(href).then(r => r.text()).then(processText).catch(() => {});
        if (suppressDownload) return;
      }
      return OrigClick.call(this);
    };

    function onDocClick(e) {
      if (done) return;
      try {
        const a = e.target?.closest?.("a");
        if (!a || !isJSONDownloadAnchor(a)) return;
        fetch(a.href).then(r => r.text()).then(processText).catch(() => {});
      } catch {}
    }
    document.addEventListener("click", onDocClick, true);

    return { promise, cancel, feedText: processText };
  }

  /* ============================================================
   * 2) DOM JSON EXTRACTOR (unchanged from v11)
   * ============================================================ */
  function looksLikeJSON(s) {
    if (!s) return false;
    const t = String(s).replace(/\u00A0/g, " ").trim();
    if (!(t.startsWith("{") || t.startsWith("["))) return false;
    return (t.includes('"messages"') || t.includes('"role"') || t.includes('"data"'));
  }

  function extractJSONFromShareModal() {
    const modal = document.querySelector(SEL.shareModal);
    if (!modal) return null;

    const ta = modal.querySelector("textarea");
    if (ta && looksLikeJSON(ta.value)) return ta.value.trim();

    const blocks = [...modal.querySelectorAll("pre, code")];
    let best = "";
    for (const el of blocks) {
      const t = (el.textContent || "").replace(/\u00A0/g, " ").trim();
      if (t.length > best.length && looksLikeJSON(t)) best = t;
    }
    if (best) return best;

    const candidates = [...modal.querySelectorAll("div, span, p")];
    for (const el of candidates) {
      const t = (el.textContent || "").replace(/\u00A0/g, " ").trim();
      if (t.length > 500 && looksLikeJSON(t)) return t;
    }
    return null;
  }

  function isDownloadJsonUIButton(btn) {
    if (!btn || btn.tagName !== "BUTTON") return false;
    const t = textOf(btn).toLowerCase();
    return t.includes("download") && t.includes("json");
  }

  function isCopyContentUIButton(btn) {
    if (!btn || btn.tagName !== "BUTTON") return false;
    const t = textOf(btn).toLowerCase();
    return t.includes("copy") && t.includes("content");
  }

  /* ============================================================
   * 3) DESKTOP: SIDEBAR AUTOMATION (unchanged from v11)
   * ============================================================ */
  async function desktopTriggerFullExport() {
    const hasAny = () => document.querySelector(SEL.selectedChat) || document.querySelector(SEL.chatItem);
    if (!hasAny()) { document.querySelector(SEL.sidebarToggle)?.click(); await waitFor(hasAny, 3000); }

    let row = document.querySelector(SEL.selectedChat);
    if (!row) {
      const top = getTitle().toLowerCase();
      const items = [...document.querySelectorAll(SEL.chatItem)].filter((it) => it.querySelector(SEL.kebab));
      let best = null, bs = 0;
      for (const it of items) {
        const t = textOf(it.querySelector(".truncate") || it).toLowerCase();
        const s = t === top ? 1000 : top.includes(t) ? 600 + t.length : t.includes(top) ? 500 + top.length : 0;
        if (s > bs) { bs = s; best = it; }
      }
      if (best && bs >= 450) row = best;
    }
    if (!row) throw new Error("Active chat not found in sidebar");

    row.classList.add("tm-force-open");
    const kb = row.querySelector(SEL.kebab);
    if (!kb) throw new Error("Kebab not found");
    kb.click();

    const kbId = kb.id;
    const menuSel = kbId ? `[role="menu"][aria-labelledby="${cssEsc(kbId)}"]` : '[role="menu"]';
    const menu = await waitFor(() => document.querySelector(menuSel), 2500);
    if (!menu) throw new Error("Kebab menu didn't open");

    const exp = menu.querySelector(SEL.exportBtn);
    if (!exp) throw new Error("Export button not found");
    exp.click();
  }

  async function desktopTriggerShareJSON() {
    openModal();
    const modal = await waitFor(() => document.querySelector(SEL.shareModal), 2500);
    if (!modal) throw new Error("Share modal didn't open");

    const jsonBtn = [...modal.querySelectorAll("button")].find((b) => textOf(b) === "JSON");
    if (!jsonBtn) throw new Error("JSON button not found");
    jsonBtn.click();

    const dl = await waitFor(() => {
      const m = document.querySelector(SEL.shareModal);
      if (!m) return null;
      const btns = [...m.querySelectorAll("button")];
      return btns.find(isDownloadJsonUIButton) || null;
    }, 3000);

    if (!dl) throw new Error("Download .json button not found");
    dl.click();
  }

  /* ============================================================
   * 4) CONVERTER CORE
   *    Updated v12: new OCSS with CSS variables + theme toggle
   *    All parsing/rendering logic unchanged from v11
   * ============================================================ */
  function S(c) {
    if (c == null) return "";
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x) => x?.text || x?.content || String(x)).join("\n");
    if (typeof c === "object") return JSON.stringify(c, null, 2);
    return String(c);
  }
  function SH(s) {
    if (!s) return "";
    const el = document.createElement("div"); el.innerHTML = s;
    el.querySelectorAll("script,iframe,object,embed").forEach((x) => x.remove());
    el.querySelectorAll("*").forEach((x) => {
      for (let i = x.attributes.length - 1; i >= 0; i--) {
        const a = x.attributes[i].name;
        if (/^on/i.test(a)) x.removeAttribute(a);
        if (a === "href" && (x.getAttribute(a) || "").trim().toLowerCase().startsWith("javascript:")) x.setAttribute(a, "#");
      }
    });
    return el.innerHTML;
  }
  function E(s) { const d = document.createElement("div"); d.textContent = S(s); return d.innerHTML; }

  function renderTeX(tex, disp) {
    if (window.katex) try { return katex.renderToString(tex, { throwOnError: false, displayMode: !!disp }); } catch {}
    return disp ? `<div style="text-align:center;margin:6px 0"><code>${E(tex)}</code></div>` : `<code>${E(tex)}</code>`;
  }
  function protectTeX(raw, arr) {
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => (arr.push(renderTeX(t.trim(), true)), `%%TX${arr.length - 1}%%`));
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => (arr.push(renderTeX(t.trim(), false)), `%%TX${arr.length - 1}%%`));
    raw = raw.replace(/\$\$([\s\S]+?)\$\$/g, (m, t, o) => {
      const nl = t.includes("\n"), cb = o > 0 ? raw[o - 1] : "\n", ca = o + m.length < raw.length ? raw[o + m.length] : "\n";
      arr.push(renderTeX(t.trim(), nl || (cb === "\n" && (ca === "\n" || ca === ""))));
      return `%%TX${arr.length - 1}%%`;
    });
    return raw;
  }
  function Icell(raw) {
    if (!raw) return ""; let h = String(raw);
    const ic = []; h = h.replace(/`([^`\n]+)`/g, (_, c) => (ic.push(`<code>${E(c)}</code>`), `%%ic${ic.length}%%`));
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
    const lines = String(text || "").split("\n"), out = []; let i = 0;
    while (i < lines.length) {
      const ln = lines[i].trim();
      if (ln.startsWith("|") && ln.endsWith("|")) {
        const tl = []; while (i < lines.length) { const cl = lines[i].trim(); if (cl.startsWith("|") && cl.endsWith("|")) { tl.push(cl); i++; } else break; }
        if (tl.length >= 3 && tl[1].split("|").slice(1, -1).every((c) => /^[:=-]+$/.test(c.trim()))) {
          let h = "<table><thead><tr>"; tl[0].split("|").slice(1, -1).forEach((c) => (h += `<th>${Icell(c.trim())}</th>`)); h += "</tr></thead><tbody>";
          for (let r = 2; r < tl.length; r++) { h += "<tr>"; tl[r].split("|").slice(1, -1).forEach((c) => (h += `<td>${Icell(c.trim())}</td>`)); h += "</tr>"; }
          h += "</tbody></table>"; out.push(h);
        } else out.push(...tl);
      } else { out.push(lines[i]); i++; }
    }
    return out.join("\n");
  }

  /* ============================================================
   * Mblock — fixed Markdown-to-HTML renderer
   *
   * Changes vs baseline:
   *   1. Inline formatting (bold/italic/links/images) applied BEFORE
   *      heading & list extraction, so heading/list content inherits it.
   *   2. Headings, blockquotes, <hr> pushed into hb[] (treated as HTML
   *      blocks) so they are not wrapped inside <p> tags.
   *   3. List items tagged with %%LISTU%%/%%LISTO%% markers, grouped
   *      into consecutive runs, wrapped in <ul>/<ol> and pushed to hb[].
   *
   * Return type is unchanged: an HTML string.
   * All other functions in this file are identical to the v12 baseline.
   * ============================================================ */
  function Mblock(raw) {
    if (!raw) return ""; let h = String(raw);

    // ── 1. Fenced code blocks (closing ``` must be on its own line) ─────────
    const cb = [];
    h = h.replace(/```(\w*)\s*\n([\s\S]*?)\n```/g,
      (_, _l, c) => (cb.push(`<pre><code>${E(c)}</code></pre>`), `\n%%CB${cb.length - 1}%%\n`));

    // ── 2. Inline code ───────────────────────────────────────────────────────
    const ic = [];
    h = h.replace(/`([^`\n]+)`/g,
      (_, c) => (ic.push(`<code>${E(c)}</code>`), `%%IC${ic.length - 1}%%`));

    // ── 3. TeX ───────────────────────────────────────────────────────────────
    const tx = []; h = protectTeX(h, tx);

    // ── 4. HTML-sanitize plain text ──────────────────────────────────────────
    h = SH(h);

    // ── 5. Protect existing block-level HTML from paragraph processing ───────
    const hb = [];
    h = h.replace(
      /(<(?:table|div|details|figure|section|article|style)[\s\S]*?<\/(?:table|div|details|figure|section|article|style)>)/gi,
      (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`));

    // ── 6. Markdown tables → HB ──────────────────────────────────────────────
    h = parseMdTables(h);
    h = h.replace(/(<table[\s\S]*?<\/table>)/gi,
      (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`));

    // ── 7. Inline formatting — applied BEFORE heading/list extraction so ─────
    //       heading text, list items, and quotes inherit bold/links/images.
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, `<img src="$2" alt="$1" loading="lazy">`);
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);

    // ── 8. Block headings → HB (prevents them being wrapped in <p>) ──────────
    h = h.replace(/^####\s+(.+)$/gm, (_, c) => (hb.push(`<h4>${c}</h4>`),   `\n%%HB${hb.length - 1}%%\n`));
    h = h.replace(/^###\s+(.+)$/gm,  (_, c) => (hb.push(`<h3>${c}</h3>`),   `\n%%HB${hb.length - 1}%%\n`));
    h = h.replace(/^##\s+(.+)$/gm,   (_, c) => (hb.push(`<h2>${c}</h2>`),   `\n%%HB${hb.length - 1}%%\n`));
    h = h.replace(/^#\s+(.+)$/gm,    (_, c) => (hb.push(`<h1>${c}</h1>`),   `\n%%HB${hb.length - 1}%%\n`));

    // ── 9. Blockquotes → HB ──────────────────────────────────────────────────
    h = h.replace(/^&gt;\s+(.+)$/gm, (_, c) => (hb.push(`<blockquote>${c}</blockquote>`), `\n%%HB${hb.length - 1}%%\n`));
    h = h.replace(/^>\s+(.+)$/gm,    (_, c) => (hb.push(`<blockquote>${c}</blockquote>`), `\n%%HB${hb.length - 1}%%\n`));

    // ── 10. Lists: tag type, group consecutive items, wrap in <ul>/<ol> → HB ─
    //   %%LISTU%% / %%LISTO%% are unambiguous transient markers (never in output).
    h = h.replace(/^[-*]\s+(.+)$/gm,  (_, c) => `%%LISTU%%${c}`);
    h = h.replace(/^\d+\.\s+(.+)$/gm, (_, c) => `%%LISTO%%${c}`);
    h = h.replace(/(%%LISTU%%[^\n]*(?:\n%%LISTU%%[^\n]*)*)/g, (m) => {
      const items = m.split("\n").map((l) => `<li>${l.replace("%%LISTU%%", "")}</li>`).join("");
      hb.push(`<ul>${items}</ul>`);
      return `\n%%HB${hb.length - 1}%%\n`;
    });
    h = h.replace(/(%%LISTO%%[^\n]*(?:\n%%LISTO%%[^\n]*)*)/g, (m) => {
      const items = m.split("\n").map((l) => `<li>${l.replace("%%LISTO%%", "")}</li>`).join("");
      hb.push(`<ol>${items}</ol>`);
      return `\n%%HB${hb.length - 1}%%\n`;
    });

    // ── 11. Horizontal rules → HB ────────────────────────────────────────────
    h = h.replace(/^---+$/gm, () => (hb.push(`<hr>`), `\n%%HB${hb.length - 1}%%\n`));

    // ── 12. Paragraph / line-break processing for remaining inline text ───────
    h = h.replace(/\n\n/g, "</p><p>");
    h = h.replace(/\n/g, "<br>");

    // ── 13. Restore all protected content ────────────────────────────────────
    for (let i = 0; i < cb.length; i++) h = h.replace(`%%CB${i}%%`, cb[i]);
    for (let i = 0; i < ic.length; i++) h = h.replace(`%%IC${i}%%`, ic[i]);
    for (let i = 0; i < tx.length; i++) h = h.replace(`%%TX${i}%%`, tx[i]);
    for (let i = 0; i < hb.length; i++) h = h.replace(`%%HB${i}%%`, hb[i]);

    return `<p>${h}</p>`;
  }

  const RT = { render_html: 1, render_interactive_canvas: 1, render_web_app: 1, render_chart: 1, render_plotly_chart: 1, render_highcharts_chart: 1, render_matplotlib_plot: 1, render_vis_graph: 1, render_jsmind_map: 1, diffusionPlus: 1, gpt_image_editor: 1 };

  function parseJSON(raw) {
    const d = JSON.parse(raw), r = { messages: [], title: "", kind: "unknown" };
    if (d?.data?.chats?.[0]) { const c = d.data.chats[0]; r.messages = c.messages || []; r.title = c.chatTitle || ""; r.kind = "full"; return r; }
    if (d?.messages) { r.messages = d.messages; r.kind = "share"; return r; }
    if (Array.isArray(d)) { r.messages = d; r.kind = "share"; return r; }
    throw new Error("Unrecognized JSON format");
  }

  function buildMaps(ms) {
    const a = {}, n = {};
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        const bn = {};
        m.tool_calls.forEach((tc) => {
          const fn = tc.function || tc, nm = fn.name || "", ag = fn.arguments || "{}";
          if (tc.id) n[tc.id] = nm;
          try { bn[nm] = typeof ag === "string" ? JSON.parse(ag) : ag; } catch { bn[nm] = { raw: ag }; }
        });
        a[i] = bn;
      }
    }
    return { args: a, names: n };
  }

  function renderArt(name, args) {
    let src = ""; if (args) src = args.htmlSource || args.html_source || args.htmlsource || "";
    if (src && src.length > 50) return `<details class="rw" open><summary>Rendered: ${E(name)}</summary><iframe srcdoc="${src.replace(/"/g, "&quot;")}" sandbox="allow-scripts" style="width:100%;min-height:300px;border:none;background:#fff" loading="lazy"></iframe></details>`;
    if (args) {
      if (args.matplotlib_code) return `<details class="rw"><summary>Code: ${E(name)}</summary><pre><code>${E(args.matplotlib_code)}</code></pre></details>`;
      if (args.graphCode) return `<details class="rw"><summary>Code: ${E(name)}</summary><pre><code>${E(args.graphCode)}</code></pre></details>`;
      if (args.prompt) return `<div class="an">${E(name)}: ${E(args.prompt)}</div>`;
    }
    return `<div class="an">${E(name)} \u2014 Not in export</div>`;
  }

  /* ═══════════════════════════════════════════════════════════
   * NEW v12: Output CSS with CSS variables + theme toggle
   * Dark/Light mode support, compact tool calls, refined palette
   * ═══════════════════════════════════════════════════════════ */
  const OCSS =
    `:root,[data-theme="dark"]{--bp:#0b141a;--bh:#1f2c34;--bu:#005c4b;--ba:#202c33;--bc:#111b21;--bci:#172026;--bto:#111b21;--bth:rgba(255,255,255,.03);--bd:#2a3942;--bdt:#1f2c34;--c1:#e9edef;--c2:#8696a0;--ca:#00a884;--cl:#53bdeb;--cc:#00a884;--cp:#d1d7db;--tbh:#1a2930;--tbb:#3b4a54;--bqb:#3b4a54;--bqt:#8696a0;--sh:rgba(0,0,0,.12);--ht:#fff;--hs:rgba(255,255,255,.7);--tg:rgba(255,255,255,.1)}` +
    `[data-theme="light"]{--bp:#f0f2f5;--bh:#fff;--bu:#d9fdd3;--ba:#fff;--bc:#f6f8fa;--bci:#eef1f3;--bto:#f6f8fa;--bth:rgba(0,0,0,.03);--bd:#d1d7db;--bdt:#e4e6e8;--c1:#1a1c20;--c2:#65676b;--ca:#00875a;--cl:#027d5e;--cc:#005c4b;--cp:#d4d4d4;--tbh:#f0f2f5;--tbb:#d1d7db;--bqb:#d1d7db;--bqt:#65676b;--sh:rgba(0,0,0,.06);--ht:#1a1c20;--hs:#65676b;--tg:rgba(0,0,0,.06)}` +
    `*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,sans-serif;background:var(--bp);color:var(--c1);line-height:1.6}` +
    `.w{width:100%;padding:12px 16px;min-height:100vh;background:var(--bp)}@media(min-width:1400px){.w{padding:12px 8%}}` +
    `.hd{text-align:center;padding:18px 52px;margin:-12px -16px 16px;background:var(--bh);border-bottom:1px solid var(--bd);position:relative;box-shadow:0 1px 3px var(--sh)}` +
    `.hd h1{font-size:1.1rem;font-weight:700;color:var(--ht)}.hd p{font-size:.72rem;color:var(--hs);margin-top:3px}` +
    `.tt{position:absolute;top:50%;right:16px;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;border:1px solid var(--bd);background:var(--tg);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;padding:0;transition:transform .2s}.tt:hover{transform:translateY(-50%) scale(1.1)}` +
    `.tl{display:none}[data-theme="light"] .td{display:none}[data-theme="light"] .tl{display:inline}` +
    `.turn{margin-bottom:10px}.msg{padding:10px 14px;border-radius:10px;max-width:95%;overflow-wrap:break-word;margin-bottom:2px;box-shadow:0 1px 2px var(--sh)}` +
    `.msg.u{background:var(--bu);margin-left:auto;border-top-right-radius:2px}.msg.a{background:var(--ba);margin-right:auto;border-top-left-radius:2px}` +
    `@media(min-width:900px){.msg{max-width:75%}}` +
    `.rl{font-weight:800;font-size:.62rem;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;display:block;color:var(--ca)}` +
    `.ts{font-size:.58rem;color:var(--c2);opacity:.5;margin-top:3px;text-align:right}` +
    `.bd{font-size:.86rem;line-height:1.65;color:var(--c1)}.bd h1,.bd h2,.bd h3,.bd h4{margin:8px 0 4px;color:var(--c1)}.bd h1{font-size:1.08rem}.bd h2{font-size:.98rem}.bd h3{font-size:.9rem}.bd h4{font-size:.86rem}` +
    `.bd code{background:var(--bci);padding:1px 5px;border-radius:3px;font-size:.82em;color:var(--cc)}` +
    `.bd pre{background:#1e1e1e;color:var(--cp);padding:10px;border-radius:6px;overflow-x:auto;margin:6px 0;font-size:.76rem}.bd pre code{background:transparent;padding:0;color:inherit}` +
    `.bd a{color:var(--cl)}.bd ul,.bd ol{padding-left:20px;margin:4px 0}.bd blockquote{border-left:3px solid var(--bqb);padding-left:10px;color:var(--bqt);margin:4px 0}` +
    `.bd table{border-collapse:collapse;margin:6px 0;width:100%;display:block;overflow-x:auto}.bd th,.bd td{border:1px solid var(--tbb);padding:4px 8px;font-size:.8rem;color:var(--c1);white-space:nowrap}.bd th{background:var(--tbh);font-weight:600}` +
    `.bd strong{font-weight:700;color:var(--c1)}.bd img{max-width:100%;border-radius:6px;margin:4px 0}.bd .katex-display{overflow-x:auto;padding:4px 0;margin:6px 0}.bd .katex{font-size:1em}` +
    `details.tc{background:none;border:1px solid transparent;border-radius:4px;margin:1px 0;font-size:.7rem;max-width:95%;transition:all .15s}` +
    `@media(min-width:900px){details.tc{max-width:75%}}` +
    `details.tc summary{padding:2px 10px;cursor:pointer;color:var(--c2);opacity:.45;list-style:none;display:flex;align-items:center;gap:5px;font-size:.68rem;line-height:1.4;transition:opacity .15s}` +
    `details.tc summary::before{content:"\\203A";font-size:.8rem;font-weight:700;flex-shrink:0;transition:transform .15s;width:8px;text-align:center}` +
    `details.tc[open] summary::before{transform:rotate(90deg)}` +
    `details.tc:hover{background:var(--bth)}details.tc:hover summary{opacity:.7}` +
    `details.tc[open]{background:var(--bto);border-color:var(--bdt);border-radius:6px;margin:3px 0}` +
    `details.tc[open] summary{opacity:1;color:var(--ca);padding:5px 10px}` +
    `.tb{padding:6px 10px;border-top:1px solid var(--bdt);max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.68rem;color:var(--c2);background:var(--bc)}` +
    `details.rw{background:var(--bc);border:1px solid var(--bd);border-radius:6px;margin:3px 0;max-width:95%}@media(min-width:900px){details.rw{max-width:75%}}` +
    `details.rw summary{padding:8px 12px;cursor:pointer;color:var(--ca);font-weight:700;font-size:.8rem;list-style:none;display:flex;align-items:center;gap:6px}` +
    `details.rw summary::before{content:"\\203A";font-size:.8rem;font-weight:700;transition:transform .15s}details.rw[open] summary::before{transform:rotate(90deg)}` +
    `.an{background:var(--bto);border:1px dashed var(--bd);border-radius:6px;padding:6px 10px;margin:3px 0;max-width:95%;font-size:.76rem;color:var(--c2);font-style:italic}@media(min-width:900px){.an{max-width:75%}}` +
    `@media print{.tt{display:none!important}body,.w,.hd,.msg.u,.msg.a{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.msg{box-shadow:none;break-inside:avoid}details.rw iframe{display:none!important}details.tc .tb{display:none!important}details.tc{break-inside:avoid}}`;

  function buildChatHTML(ms) {
    const maps = buildMaps(ms); let out = "";
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]; if (m.role !== "user") continue;
      out += `<div class="turn"><div class="msg u"><span class="rl">You</span><div class="bd">${Mblock(S(m.content))}</div></div>`;
      let tools = ""; const replies = []; let j = i + 1;
      while (j < ms.length && ms[j].role !== "user") {
        const n = ms[j];
        if (n.role === "tool") {
          const tn = n.name || maps.names[n.tool_call_id] || "tool";
          if (RT[tn]) {
            let ag = null;
            for (let k = j - 1; k >= Math.max(0, j - 7); k--) { if (maps.args[k]?.[tn]) { ag = maps.args[k][tn]; break; } }
            tools += renderArt(tn, ag);
          } else {
            const b = S(n.content || ""), pv = b.replace(/[\n\r]+/g, " ").slice(0, 100);
            tools += `<details class="tc"><summary><b>${E(tn)}</b> \u2014 ${E(pv)}${b.length > 100 ? "\u2026" : ""}</summary><div class="tb">${E(b || "(empty)")}</div></details>`;
          }
        } else if (n.role === "assistant") {
          const ac = S(n.content); if (ac.trim().length > 2) replies.push(ac);
        }
        j++;
      }
      out += tools;
      if (replies.length) out += `<div class="msg a"><span class="rl">Assistant</span><div class="bd">${Mblock(replies[replies.length - 1])}</div></div>`;
      out += `</div>`; i = j - 1;
    }
    return out || `<div style="text-align:center;color:var(--c2);padding:40px">No messages.</div>`;
  }

  /* ═══ NEW v12: buildHTML includes data-theme="dark" + theme toggle ═══ */
  function buildHTML(title, messages) {
    const dt = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return `<!DOCTYPE html><html lang="en" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${E(title)}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"><style>${OCSS}</style></head><body><div class="w"><div class="hd"><h1>${E(title)}</h1><p>${E("Exported " + dt)}</p><button class="tt" onclick="TT()" title="Toggle theme"><span class="td">&#x2600;&#xFE0F;</span><span class="tl">&#x1F319;</span></button></div>${buildChatHTML(messages)}</div><script>function TT(){var h=document.documentElement,c=h.getAttribute("data-theme")||"dark";h.setAttribute("data-theme",c==="dark"?"light":"dark")}<\/script></body></html>`;
  }

  function dlFile(html, name) {
    const b = new Blob([html], { type: "text/html;charset=utf-8" }), u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch {} try { URL.revokeObjectURL(u); } catch {} }, 400);
  }

  async function ensureKaTeX() {
    if (window.katex?.renderToString) return;
    const css = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css", js = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js";
    if (![...document.querySelectorAll("link")].some((l) => l.href === css)) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = css; document.head.appendChild(l); }
    await new Promise((r, j) => { const s = document.createElement("script"); s.src = js; s.async = true; s.onload = r; s.onerror = () => j(new Error("KaTeX fail")); document.head.appendChild(s); });
  }

  function safeName(s) { return String(s || "chat").replace(/[^a-zA-Z0-9 -]/g, "").trim() || "chat"; }

  function convertAndOutput(jsonText, mode, fallbackTitle) {
    const parsed = parseJSON(jsonText);
    const title = parsed.title || fallbackTitle;
    const html = buildHTML(title, parsed.messages);
    const base = safeName(title);

    if (mode === "html") {
      dlFile(html, `${base}-${parsed.kind}-${Date.now()}.html`);
      return parsed.kind;
    }

    const w = window.open("", "_blank");
    if (w) {
      w.document.open(); w.document.write(html); w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 900);
    } else {
      dlFile(html, `${base}-print-${Date.now()}.html`);
    }
    return parsed.kind;
  }

  /* ============ DESKTOP FLOWS (unchanged from v11) ============ */
  async function desktopFlow(mode) {
    const title = getTitle();
    await ensureKaTeX().catch(() => {});
    closeModal();

    showStatus("Attempting full export (sidebar)\u2026");
    const cap1 = createCapture({ timeoutMs: 12000, suppressDownload: true, acceptSmall: false });

    try {
      await desktopTriggerFullExport();
      const { text, kind } = await cap1.promise;
      showStatus("Captured " + kind + " JSON. Converting\u2026", 2000);
      convertAndOutput(text, mode, title);
      showStatus("Done! " + mode.toUpperCase() + " from " + kind + " JSON.", 3000);
      return;
    } catch (e) {
      cap1.cancel(e);
      showStatus("Full export failed. Trying Share JSON\u2026");
    }

    await sleep(250);
    const cap2 = createCapture({ timeoutMs: 15000, suppressDownload: true, acceptSmall: true });
    try {
      await desktopTriggerShareJSON();
      await sleep(50);
      const domTxt = extractJSONFromShareModal();
      if (domTxt) cap2.feedText(domTxt);

      const { text, kind } = await cap2.promise;
      showStatus("Captured " + kind + " JSON. Converting\u2026", 2000);
      convertAndOutput(text, mode, title);
      showStatus("Done! " + mode.toUpperCase() + " from " + kind + " JSON.", 3000);
    } catch (e2) {
      cap2.cancel(e2);
      throw new Error("Both full export and share JSON failed: " + (e2?.message || e2));
    }
  }

  /* ============ MOBILE FLOW (unchanged from v11) ============ */
  let mobileCapture = null;
  let mobileDomListenerInstalled = false;

  function removeOverlay() {
    document.querySelectorAll(".tmx-bar").forEach((el) => el.remove());
    if (mobileCapture) { mobileCapture.cancel(new Error("Cancelled by user")); mobileCapture = null; }
  }

  function installMobileShareDomCapture(cap) {
    if (mobileDomListenerInstalled) return;
    mobileDomListenerInstalled = true;

    const handler = (e) => {
      if (!mobileCapture || mobileCapture !== cap) return;
      const modal = document.querySelector(SEL.shareModal);
      if (!modal) return;

      const btn = e.target?.closest?.("button");
      if (!btn) return;

      if (!isDownloadJsonUIButton(btn) && !isCopyContentUIButton(btn)) return;

      setTimeout(() => {
        if (!mobileCapture || mobileCapture !== cap) return;
        const txt = extractJSONFromShareModal();
        if (txt) cap.feedText(txt);
      }, 0);
    };

    document.addEventListener("click", handler, true);

    const origCancel = cap.cancel;
    cap.cancel = (err) => {
      try { document.removeEventListener("click", handler, true); } catch {}
      mobileDomListenerInstalled = false;
      return origCancel(err);
    };
    const origPromise = cap.promise;
    cap.promise = origPromise.finally(() => {
      try { document.removeEventListener("click", handler, true); } catch {}
      mobileDomListenerInstalled = false;
    });
  }

  async function mobileFlow(mode) {
    const title = getTitle();
    await ensureKaTeX().catch(() => {});
    closeModal();

    removeOverlay();

    const cap = createCapture({ timeoutMs: 60000, suppressDownload: false, acceptSmall: true });
    mobileCapture = cap;
    installMobileShareDomCapture(cap);

    const bar = document.createElement("div");
    bar.className = "tmx-bar";
    bar.innerHTML = `
      <div><span class="pulsedot"></span>Listening for JSON export\u2026</div>
      <div style="margin-top:6px;font-size:12px;opacity:.85">
        Option A: <b>sidebar \u2192 kebab (\u22EF) \u2192 Export</b> (full JSON).<br>
        Option B: <b>Share \u2192 JSON \u2192 Download .json</b> (small JSON; v12 captures from preview).
      </div>
      <div class="row"></div>
    `;
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => removeOverlay();
    bar.querySelector(".row").appendChild(cancelBtn);
    document.body.appendChild(bar);

    try {
      const { text, kind } = await cap.promise;
      mobileCapture = null;

      bar.innerHTML = `<div>Captured <b>${kind}</b> JSON. Converting\u2026</div>`;
      await sleep(50);
      convertAndOutput(text, mode, title);

      bar.innerHTML = `<div>Done! Exported <b>${kind}</b> JSON \u2192 ${mode === "html" ? "HTML" : "PDF"}.</div><div class="row"></div>`;
      const closeBtn = document.createElement("button");
      closeBtn.className = "cancel";
      closeBtn.textContent = "Close";
      closeBtn.onclick = () => bar.remove();
      bar.querySelector(".row").appendChild(closeBtn);
      setTimeout(() => { try { bar.remove(); } catch {} }, 5000);
    } catch (e) {
      mobileCapture = null;
      if (bar.parentNode) {
        bar.innerHTML = `<div>Export ${e?.message === "Cancelled by user" ? "cancelled" : "failed"}: ${E(e?.message || "unknown error")}</div><div class="row"></div>`;
        const closeBtn = document.createElement("button");
        closeBtn.className = "cancel";
        closeBtn.textContent = "Close";
        closeBtn.onclick = () => bar.remove();
        bar.querySelector(".row").appendChild(closeBtn);
        setTimeout(() => { try { bar.remove(); } catch {} }, 4000);
      }
    }
  }

  /* ============ ROUTER ============ */
  async function doHTML() { return isMobileLike() ? mobileFlow("html") : desktopFlow("html"); }
  async function doPDF()  { return isMobileLike() ? mobileFlow("pdf")  : desktopFlow("pdf");  }

  /* ============ INJECT BUTTONS ============ */
  function inject(modal) {
    if (!modal || modal.querySelector("[data-tmx='v12']")) return;
    const grid = modal.querySelector(".grid.grid-cols-2");
    if (!grid) return;

    const mobile = isMobileLike();

    const mkBtn = (label, bg, fn) => {
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
        b.disabled = true; const old = b.textContent; b.textContent = "Working\u2026";
        try { await fn(); }
        catch (e) { if (e?.message !== "Cancelled by user") alert("Export failed: " + (e?.message || e)); }
        finally { b.disabled = false; b.textContent = old; }
      });
      return b;
    };

    const addRow = (btn, desc) => {
      const l = document.createElement("div");
      l.className = "flex items-center justify-end";
      l.appendChild(btn);
      const r = document.createElement("div");
      r.textContent = desc;
      grid.appendChild(l);
      grid.appendChild(r);
    };

    addRow(
      mkBtn("Interactive HTML", "#00a884", doHTML),
      mobile ? "Listener: Export OR Share\u2192JSON\u2192Download .json." : "One-click: full export (fallback: share JSON)."
    );
    addRow(
      mkBtn("Nice PDF", "#f59e0b", doPDF),
      mobile ? "Listener: Export OR Share\u2192JSON\u2192Download .json \u2192 print." : "One-click: full export \u2192 print."
    );

    const m = document.createElement("div");
    m.setAttribute("data-tmx", "v12");
    m.style.display = "none";
    modal.appendChild(m);

    log("Buttons injected.", mobile ? "(mobile)" : "(desktop)");
  }

  new MutationObserver(() => {
    const m = document.querySelector(SEL.shareModal);
    if (m) inject(m);
  }).observe(document.documentElement, { childList: true, subtree: true });

  log("v12 loaded.", isMobileLike() ? "Mobile mode." : "Desktop mode.");
})();
