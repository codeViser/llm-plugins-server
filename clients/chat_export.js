(() => {
  /******************************************************************
   * TypingMind Exporter v13 — one-shot Custom Export
   * Interactive HTML, Nice PDF (file), Archival Export (import zip + PDF)
   * Reads open chat from IndexedDB; no sidebar export listener.
   ******************************************************************/

  const TAG = "[TMX v13]";
  const log = (...a) => console.log(TAG, ...a);

  const SEL = {
    shareModal: '[data-element-id="pop-up-modal"]',
    chatTitle: '[data-element-id="current-chat-title"]',
  };

  const CDN = {
    katexCss: "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css",
    katexJs: "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
    jszip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
    html2canvas: "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
    jspdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
  };

  const sEl = document.createElement("style");
  sEl.textContent = `
    .tmx-status{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(17,24,39,.92);color:#fff;padding:8px 16px;border-radius:10px;font:12px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;transition:opacity .3s;max-width:92vw;text-align:center}
    .tmx-menu{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
    .tmx-menu-panel{background:#1f2c34;color:#e9edef;border-radius:12px;padding:16px;min-width:min(320px,92vw);box-shadow:0 8px 32px rgba(0,0,0,.4);font:13px system-ui,-apple-system,sans-serif}
    .tmx-menu-panel h3{margin:0 0 12px;font-size:15px;font-weight:800}
    .tmx-menu-panel button{display:block;width:100%;margin:6px 0;padding:10px 12px;border:none;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;text-align:left}
    .tmx-menu-panel .cancel{background:rgba(255,255,255,.12);color:#fff;margin-top:10px;text-align:center}
    .tmx-menu-panel .opt-html{background:#00a884;color:#111b21}
    .tmx-menu-panel .opt-pdf{background:#f59e0b;color:#111b21}
    .tmx-menu-panel .opt-zip{background:#6366f1;color:#fff}
  `;
  document.documentElement.appendChild(sEl);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function showStatus(msg, durationMs) {
    try { document.querySelectorAll(".tmx-status").forEach((x) => x.remove()); } catch {}
    const d = document.createElement("div");
    d.className = "tmx-status";
    d.textContent = msg;
    document.body.appendChild(d);
    if (durationMs) setTimeout(() => { d.style.opacity = "0"; setTimeout(() => { try { d.remove(); } catch {} }, 400); }, durationMs);
    return d;
  }

  function getTitle() {
    const el = document.querySelector(SEL.chatTitle);
    if (!el) return "Chat";
    const c = el.cloneNode(true);
    c.querySelectorAll("button,svg").forEach((n) => n.remove());
    return (c.textContent || "").replace(/\s+/g, " ").trim() || "Chat";
  }

  function closeModal() {
    const m = document.querySelector(SEL.shareModal);
    if (!m) return;
    const buttons = [...m.querySelectorAll("button")];
    const closeBtn = buttons.find((b) => (b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "close");
    if (closeBtn) closeBtn.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  function safeName(s) { return String(s || "chat").replace(/[^a-zA-Z0-9 -]/g, "").trim() || "chat"; }

  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  async function openKeyvalDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("keyval-store");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  async function idbGet(key) {
    const db = await openKeyvalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("keyval", "readonly");
      const req = tx.objectStore("keyval").get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function readOpenChat() {
    const m = location.hash.match(/chat=([^&]+)/);
    if (!m) throw new Error("Open a chat first (no #chat= in URL).");
    const key = "CHAT_" + m[1];
    let raw = await idbGet(key);
    if (raw == null) throw new Error("Chat not found in local storage.");
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { throw new Error("Chat record is not valid JSON."); }
    }
    if (!raw || !Array.isArray(raw.messages)) throw new Error("Chat record has no messages.");
    return raw;
  }

  async function retrieveBlob(localId) {
    const v = await idbGet("BLOB_" + localId);
    return v instanceof Blob ? v : null;
  }

  async function loadScript(url, globalCheck) {
    if (globalCheck && globalCheck()) return;
    if (document.querySelector(`script[data-tmx-src="${url}"]`)) {
      for (let i = 0; i < 40; i++) {
        if (globalCheck && globalCheck()) return;
        await sleep(100);
      }
      return;
    }
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.dataset.tmxSrc = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load script"));
      document.head.appendChild(s);
    });
    for (let i = 0; i < 40; i++) {
      if (globalCheck && globalCheck()) return;
      await sleep(100);
    }
  }

  async function ensureKaTeX() {
    if (window.katex?.renderToString) return;
    if (![...document.querySelectorAll("link")].some((l) => l.href === CDN.katexCss)) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = CDN.katexCss;
      document.head.appendChild(l);
    }
    await loadScript(CDN.katexJs, () => window.katex?.renderToString);
  }

  async function ensureJsZip() {
    await loadScript(CDN.jszip, () => window.JSZip);
    if (!window.JSZip) throw new Error("JSZip unavailable");
  }

  async function ensurePdfLibs() {
    await loadScript(CDN.html2canvas, () => window.html2canvas);
    await loadScript(CDN.jspdf, () => window.jspdf?.jsPDF);
    if (!window.html2canvas || !window.jspdf?.jsPDF) throw new Error("PDF libraries unavailable");
  }

  async function deliverFile(blob, filename) {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (e) {
      if (e?.name !== "AbortError") console.warn(TAG, "share failed, falling back to download", e);
      else throw e;
    }
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { URL.revokeObjectURL(u); a.remove(); } catch {} }, 500);
  }

  function chatExportPayload(chat) {
    return { title: chat.chatTitle || getTitle(), messages: chat.messages || [] };
  }


  /* ============ CONVERTER CORE (from v12) ============ */
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
   * Identical to ReferenceScriptDiscussion baseline EXCEPT step 13:
   *
   * THE BUG (observed as %%IC3%%, %%IC6%% etc. in rendered output):
   *   Steps 8–10 push content into hb[] (headings, blockquotes, list
   *   items). That content still contains %%IC%% / %%TX%% placeholders
   *   from steps 2–3. The old step 13 restored ic[] and tx[] against h,
   *   but those tokens were no longer in h — they were entombed inside
   *   hb[] strings. hb[] restoration then inserted the literal text
   *   "%%IC6%%" into the final HTML.
   *
   * THE FIX (step 13 only):
   *   Before inserting each hb[] entry into h, pre-resolve any leftover
   *   %%IC%% / %%TX%% tokens inside it. This covers all block types
   *   (table cells, list items, headings, blockquotes) in one place.
   *   All other steps are unchanged.
   * ============================================================ */
  function Mblock(raw) {
    if (!raw) return ""; let h = String(raw);

    // ── 1. Fenced code blocks (closing ``` must be on its own line) ──────────
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

    // ── 13. FIXED: Restore all protected content ─────────────────────────────
    //
    //  Root cause of %%IC3%%/%%IC6%% visible in output:
    //  Steps 8–10 push hb[] entries (headings, blockquotes, list items,
    //  table cells) that still contain %%IC%% / %%TX%% placeholders.
    //  The old code restored ic[] / tx[] against h — but those tokens
    //  were no longer in h, they were inside hb[] strings.
    //  hb[] restoration then inserted them as literal text.
    //
    //  Fix: before inserting each hb[] entry into h, pre-resolve any
    //  %%IC%% / %%TX%% trapped inside it. Covers all block types at once.
    //  Every other step above is identical to the working baseline.

    for (let i = 0; i < cb.length; i++)
      h = h.replace(new RegExp(`%%CB${i}%%`, "g"), cb[i]);

    // Restore tokens still present in h (plain paragraph text, etc.)
    for (let i = 0; i < ic.length; i++)
      h = h.replace(new RegExp(`%%IC${i}%%`, "g"), ic[i]);
    for (let i = 0; i < tx.length; i++)
      h = h.replace(new RegExp(`%%TX${i}%%`, "g"), tx[i]);

    // Resolve any %%IC%% / %%TX%% trapped inside hb[] entries, then restore
    for (let b = 0; b < hb.length; b++) {
      hb[b] = hb[b]
        .replace(/%%IC(\d+)%%/g, (_, i) => ic[+i] ?? "")
        .replace(/%%TX(\d+)%%/g, (_, i) => tx[+i] ?? "");
      h = h.replace(new RegExp(`%%HB${b}%%`, "g"), hb[b]);
    }

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

  function buildHTML(title, messages) {
    const dt = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return `<!DOCTYPE html><html lang="en" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${E(title)}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"><style>${OCSS}</style></head><body><div class="w"><div class="hd"><h1>${E(title)}</h1><p>${E("Exported " + dt)}</p><button class="tt" onclick="TT()" title="Toggle theme"><span class="td">&#x2600;&#xFE0F;</span><span class="tl">&#x1F319;</span></button></div>${buildChatHTML(messages)}</div><script>function TT(){var h=document.documentElement,c=h.getAttribute("data-theme")||"dark";h.setAttribute("data-theme",c==="dark"?"light":"dark")}<\/script></body></html>`;
  }


  function dlFileContent(content, mime, name) {
    deliverFile(new Blob([content], { type: mime }), name);
  }

  async function htmlFromChat(chat) {
    await ensureKaTeX().catch(() => {});
    const { title, messages } = chatExportPayload(chat);
    return buildHTML(title, messages);
  }

  async function validateBlob(blob, metadata) {
    if (!blob || blob.size <= 32) throw new Error("Attachment empty or unreadable.");
    const expected = Number(metadata?.size || 0);
    if (expected > 0 && blob.size !== expected) {
      throw new Error("Attachment size mismatch (expected " + expected + ", got " + blob.size + ").");
    }
    const mime = String(metadata?.type || blob.type || "");
    if (mime === "application/pdf" || (metadata?.fileFormat === "pdf")) {
      const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      const magic = String.fromCharCode(...head);
      if (magic !== "%PDF-") throw new Error("Downloaded file is not a valid PDF.");
    }
  }

  function attachmentFetchUrl(url) {
    try {
      const u = new URL(String(url || ""));
      u.searchParams.delete("presign_token");
      return u.toString();
    } catch {
      return String(url || "");
    }
  }

  async function fetchAttachmentBlob(url, metadata) {
    const u = attachmentFetchUrl(url);
    if (!u) throw new Error("Missing attachment URL.");
    const res = await fetch(u, { credentials: "include", cache: "no-cache" });
    if (!res.ok) throw new Error("Attachment download failed (HTTP " + res.status + ").");
    const blob = await res.blob();
    await validateBlob(blob, metadata);
    return blob;
  }

  function getAtPath(root, path) {
    let cur = root;
    for (const key of path) {
      if (cur == null) return null;
      cur = cur[key];
    }
    return cur;
  }

  function setAttachmentLocal(part, localId) {
    if (!part || typeof part !== "object") return;
    const md = { ...(part.metadata || {}) };
    md.localBlobID = localId;
    delete md.base64;
    part.metadata = md;
    part.sync = null;
  }

  function forEachContentPart(chat, fn) {
    const reg = chat.attachmentRegistry || {};
    Object.keys(reg).forEach((id) => {
      const rec = reg[id];
      if (rec && (rec.type === "tm_blob_file" || rec.sync?.url || rec.metadata?.localBlobID)) {
        fn(rec, ["attachmentRegistry", id]);
      }
    });
    function walk(msgs, base) {
      if (!Array.isArray(msgs)) return;
      msgs.forEach((msg, mi) => {
        const baseMsg = [...base, mi];
        const content = msg.content;
        if (Array.isArray(content)) {
          content.forEach((part, pi) => {
            if (part && typeof part === "object" && (part.type === "tm_blob_file" || part.type === "tm_attachment_ref")) {
              if (part.type === "tm_attachment_ref" && reg[part.id]) fn(reg[part.id], ["attachmentRegistry", part.id]);
              else fn(part, [...baseMsg, "content", pi]);
            }
          });
        }
        if (Array.isArray(msg.threads)) {
          msg.threads.forEach((th, ti) => walk(th.messages, [...baseMsg, "threads", ti, "messages"]));
        }
        if (Array.isArray(msg.responses)) {
          msg.responses.forEach((resp, ri) => walk(resp.messages, [...baseMsg, "responses", ri, "messages"]));
        }
      });
    }
    walk(chat.messages || [], ["messages"]);
  }

  function collectSyncGroups(chat) {
    const groups = new Map();
    forEachContentPart(chat, (part, path) => {
      const sync = part.sync;
      if (!sync?.blobID || !sync?.url) return;
      const bid = String(sync.blobID);
      if (!groups.has(bid)) groups.set(bid, { blobID: bid, url: sync.url, metadata: part.metadata, paths: [] });
      groups.get(bid).paths.push(path);
    });
    return groups;
  }

  function collectLocalBlobIds(chat) {
    const ids = new Map();
    forEachContentPart(chat, (part, path) => {
      const lid = part.metadata?.localBlobID;
      if (lid) {
        const k = String(lid);
        if (!ids.has(k)) ids.set(k, []);
        ids.get(k).push(path);
      }
    });
    return ids;
  }

  function applyLocalIdAtPaths(chat, paths, localId) {
    for (const path of paths) {
      const target = getAtPath(chat, path);
      if (target) setAttachmentLocal(target, localId);
    }
  }

  async function buildTypingMindImportZip(chat, onProgress) {
    await ensureJsZip();
    const clone = JSON.parse(JSON.stringify(chat));
    const blobEntries = new Map();
    const say = (m) => { if (onProgress) onProgress(m); };

    const localIds = collectLocalBlobIds(clone);
    for (const [localId, paths] of localIds) {
      say("Reading local attachment…");
      let blob = await retrieveBlob(localId);
      if (!blob) {
        const sample = getAtPath(clone, paths[0]);
        const url = sample?.sync?.url;
        if (url) blob = await fetchAttachmentBlob(url, sample?.metadata);
      }
      if (!blob) throw new Error("Local attachment missing from device storage.");
      await validateBlob(blob, getAtPath(clone, paths[0])?.metadata);
      blobEntries.set(localId, { blob, mime: blob.type || getAtPath(clone, paths[0])?.metadata?.type || "application/octet-stream" });
      applyLocalIdAtPaths(clone, paths, localId);
    }

    const syncGroups = collectSyncGroups(clone);
    for (const [, group] of syncGroups) {
      say("Downloading attachment for archive…");
      const blob = await fetchAttachmentBlob(group.url, group.metadata);
      const localId = newId();
      blobEntries.set(localId, { blob, mime: blob.type || group.metadata?.type || "application/octet-stream" });
      applyLocalIdAtPaths(clone, group.paths, localId);
    }

    forEachContentPart(clone, (part) => {
      if (part.sync?.url) throw new Error("Archive still contains cloud attachment URLs.");
    });

    const zip = new window.JSZip();
    const metadata = {};
    for (const [localId, { blob, mime }] of blobEntries) {
      const path = `attachments/${localId}.blob`;
      zip.file(path, blob);
      metadata[path] = { type: mime || "application/octet-stream" };
    }
    zip.file("data.json", JSON.stringify({ data: { chats: [clone] } }));
    zip.file("metadata.json", JSON.stringify(metadata));
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }

  async function htmlToPdfBlob(html) {
    await ensurePdfLibs();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
    iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:820px;height:1200px;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    await sleep(1500);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 36;
    const contentW = pageW - margin * 2;
    let y = margin;
    const blocks = [...doc.querySelectorAll(".hd, .turn")];
    if (!blocks.length) blocks.push(doc.body);

    for (const el of blocks) {
      const canvas = await window.html2canvas(el, { scale: 1.25, useCORS: true, logging: false, backgroundColor: null });
      if (!canvas.width || !canvas.height) continue;
      const imgData = canvas.toDataURL("image/jpeg", 0.9);
      let drawH = (canvas.height * contentW) / canvas.width;
      let offsetY = 0;
      while (offsetY < drawH) {
        const space = pageH - margin - y;
        if (space < 40) {
          pdf.addPage();
          y = margin;
          continue;
        }
        const sliceH = Math.min(space, drawH - offsetY);
        const sliceRatio = sliceH / drawH;
        const srcH = canvas.height * sliceRatio;
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.max(1, Math.floor(srcH));
        const ctx = sliceCanvas.getContext("2d");
        ctx.drawImage(canvas, 0, (offsetY / drawH) * canvas.height, canvas.width, srcH, 0, 0, sliceCanvas.width, sliceCanvas.height);
        const sliceImg = sliceCanvas.toDataURL("image/jpeg", 0.9);
        pdf.addImage(sliceImg, "JPEG", margin, y, contentW, sliceH);
        y += sliceH + 8;
        offsetY += sliceH;
        if (offsetY < drawH) {
          pdf.addPage();
          y = margin;
        }
      }
    }
    iframe.remove();
    const out = pdf.output("arraybuffer");
    if (!out || out.byteLength < 800) throw new Error("PDF render produced empty output.");
    return new Blob([out], { type: "application/pdf" });
  }

  async function exportInteractiveHtml() {
    closeModal();
    showStatus("Building HTML…");
    const chat = await readOpenChat();
    const html = await htmlFromChat(chat);
    const base = safeName(chat.chatTitle || getTitle());
    await deliverFile(new Blob([html], { type: "text/html;charset=utf-8" }), `${base}-${Date.now()}.html`);
    showStatus("HTML exported.", 2500);
  }

  async function exportNicePdf() {
    closeModal();
    showStatus("Building PDF…");
    const chat = await readOpenChat();
    const html = await htmlFromChat(chat);
    const base = safeName(chat.chatTitle || getTitle());
    try {
      const pdfBlob = await htmlToPdfBlob(html);
      await deliverFile(pdfBlob, `${base}-${Date.now()}.pdf`);
      showStatus("PDF exported.", 2500);
    } catch (e) {
      console.warn(TAG, "PDF file render failed, opening print view", e);
      const w = window.open("", "_blank");
      if (w) {
        w.document.open();
        w.document.write(html);
        w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 900);
        showStatus("Opened print view (PDF file render unavailable).", 4000);
      } else {
        throw new Error("PDF render failed and popup was blocked.");
      }
    }
  }

  async function exportArchival() {
    closeModal();
    const chat = await readOpenChat();
    const base = safeName(chat.chatTitle || getTitle());
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    showStatus("Preparing archival export…");
    const html = await htmlFromChat(chat);
    let pdfBlob = null;
    let pdfName = null;
    try {
      showStatus("Rendering PDF…");
      pdfBlob = await htmlToPdfBlob(html);
      pdfName = `${base}-${stamp}.pdf`;
    } catch (e) {
      console.warn(TAG, "Archival PDF skipped, including HTML", e);
    }
    showStatus("Building import package…");
    const importZipBlob = await buildTypingMindImportZip(chat, (m) => showStatus(m));
    await ensureJsZip();
    const outer = new window.JSZip();
    outer.file("typingmind-import.zip", importZipBlob);
    if (pdfBlob && pdfName) outer.file(pdfName, pdfBlob);
    else outer.file("chat.html", html);
    showStatus("Creating zip…");
    const outerBlob = await outer.generateAsync({ type: "blob", compression: "DEFLATE" });
    await deliverFile(outerBlob, `${base}-archival-${stamp}.zip`);
    showStatus("Archival export complete.", 3000);
  }

  function openCustomExportMenu() {
    const existing = document.querySelector(".tmx-menu");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.className = "tmx-menu";
    const panel = document.createElement("div");
    panel.className = "tmx-menu-panel";
    panel.innerHTML = "<h3>Custom Export</h3>";
    const mk = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.addEventListener("click", async () => {
        overlay.remove();
        b.disabled = true;
        try { await fn(); }
        catch (e) {
          if (e?.name !== "AbortError") alert("Export failed: " + (e?.message || e));
        }
      });
      return b;
    };
    panel.appendChild(mk("Interactive HTML", "opt-html", exportInteractiveHtml));
    panel.appendChild(mk("Nice PDF", "opt-pdf", exportNicePdf));
    panel.appendChild(mk("Archival Export", "opt-zip", exportArchival));
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cancel";
    cancel.textContent = "Cancel";
    cancel.onclick = () => overlay.remove();
    panel.appendChild(cancel);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function inject(modal) {
    if (!modal || modal.querySelector("[data-tmx='v13']")) return;
    const grid = modal.querySelector(".grid.grid-cols-2");
    if (!grid) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Custom Export";
    btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:10px;border:none;font-weight:900;font-size:12px;background:#00a884;color:#111b21;box-shadow:0 1px 2px rgba(0,0,0,.2);width:100%;cursor:pointer";
    btn.addEventListener("click", () => openCustomExportMenu());

    const l = document.createElement("div");
    l.className = "flex items-center justify-end";
    l.appendChild(btn);
    const r = document.createElement("div");
    r.textContent = "HTML, PDF, or archival zip (TypingMind import + PDF). One click, no sidebar export.";
    grid.appendChild(l);
    grid.appendChild(r);

    const m = document.createElement("div");
    m.setAttribute("data-tmx", "v13");
    m.style.display = "none";
    modal.appendChild(m);
    log("Custom Export injected.");
  }

  new MutationObserver(() => {
    const modal = document.querySelector(SEL.shareModal);
    if (modal) inject(modal);
  }).observe(document.documentElement, { childList: true, subtree: true });

  log("v13 loaded.");
})();
