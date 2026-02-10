(() => {
  /******************************************************************
   * TypingMind Extension — v7 (Desktop + Mobile/PWA safe)
   *
   * ZERO interference with TypingMind internals:
   *  - No window.Blob override
   *  - No URL.createObjectURL override
   *  - Only brief <a>.click() intercept + fetch(blobURL) to read content
   *
   * Strategy:
   *  - Desktop (wide screen): sidebar kebab→Export (full JSON), fallback Share→JSON
   *  - Mobile/PWA (narrow):   Share→JSON only (no sidebar automation)
   ******************************************************************/

  const TAG = "[TM v7]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const isMobile = () => window.innerWidth < 768;

  const SEL = {
    shareButton: '[data-element-id="share-button"]',
    shareModal: '[data-element-id="pop-up-modal"]',
    chatTitle: '[data-element-id="current-chat-title"]',
    sidebarToggleCompact: '[data-element-id="workspace-logo-button-compact"]',
    sidebarChatItem: '[data-element-id="custom-chat-item"]',
    sidebarSelectedChatItem: '[data-element-id="selected-chat-item"]',
    chatItemKebab: 'button[aria-label="Chat settings"]',
    exportChatBtn: 'button[data-element-id="export-chat-button"]',
  };

  const FORCE_CSS = `.tm-force-open button[aria-label="Chat settings"]{opacity:1!important;width:auto!important;pointer-events:auto!important}`;
  const sEl = document.createElement("style"); sEl.textContent = FORCE_CSS; document.documentElement.appendChild(sEl);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms = 4000, step = 50) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step); }
    return null;
  }
  function textOf(el) { return (el?.textContent || "").replace(/\s+/g, " ").trim(); }

  function getTopChatTitle() {
    const el = document.querySelector(SEL.chatTitle);
    if (!el) return "Chat Conversation";
    const c = el.cloneNode(true);
    c.querySelectorAll("button,svg").forEach((n) => n.remove());
    return textOf(c) || "Chat Conversation";
  }

  function closeShareModal() {
    const m = document.querySelector(SEL.shareModal);
    if (!m) return;
    const b = [...m.querySelectorAll("button")].find((b) => textOf(b).toLowerCase() === "close");
    if (b) b.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  /******************************************************************
   * SAFE JSON CAPTURE: only intercepts <a>.click(), reads via fetch(blobURL)
   * Zero Blob/createObjectURL overrides.
   ******************************************************************/
  function captureNextJSONDownload(triggerFn, timeoutMs = 14000) {
    const OrigAClick = HTMLAnchorElement.prototype.click;

    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; HTMLAnchorElement.prototype.click = OrigAClick; reject(new Error("Capture timed out")); }
      }, timeoutMs);

      HTMLAnchorElement.prototype.click = function () {
        const href = (this.href || "").toString();
        const dl = (this.download || "").toLowerCase();

        if (!done && href.startsWith("blob:") && (dl.endsWith(".json") || dl.includes("json"))) {
          done = true;
          HTMLAnchorElement.prototype.click = OrigAClick;
          clearTimeout(timer);

          fetch(href).then((r) => r.text()).then((txt) => {
            try { JSON.parse(txt); resolve(txt); }
            catch { reject(new Error("Downloaded content is not valid JSON")); }
          }).catch((e) => reject(new Error("Failed to read blob: " + e.message)));

          return; // suppress the actual file download
        }

        return OrigAClick.apply(this, arguments);
      };

      try { triggerFn(); }
      catch (e) { done = true; HTMLAnchorElement.prototype.click = OrigAClick; clearTimeout(timer); reject(e); }
    });
  }

  /******************************************************************
   * DESKTOP ONLY: sidebar full-export
   ******************************************************************/
  async function captureFullExportJSON() {
    if (isMobile()) throw new Error("Skipping sidebar on mobile");

    closeShareModal();

    // Ensure sidebar items visible
    const hasAny = () => document.querySelector(SEL.sidebarSelectedChatItem) || document.querySelector(SEL.sidebarChatItem);
    if (!hasAny()) {
      document.querySelector(SEL.sidebarToggleCompact)?.click();
      await waitFor(() => hasAny() ? true : null, 3000);
    }

    let row = document.querySelector(SEL.sidebarSelectedChatItem);
    if (!row) {
      // Fallback: title match
      const topTitle = getTopChatTitle().toLowerCase();
      const items = [...document.querySelectorAll(SEL.sidebarChatItem)].filter((it) => it.querySelector(SEL.chatItemKebab));
      let best = null, bestSc = 0;
      for (const it of items) {
        const t = textOf(it.querySelector(".truncate") || it).toLowerCase();
        const sc = t === topTitle ? 1000 : topTitle.includes(t) ? 600 + t.length : t.includes(topTitle) ? 500 + topTitle.length : 0;
        if (sc > bestSc) { bestSc = sc; best = it; }
      }
      if (best && bestSc >= 450) row = best;
    }

    if (!row) throw new Error("Cannot identify active chat row");

    row.classList.add("tm-force-open");
    try { row.scrollIntoView({ block: "center" }); } catch {}

    const kebab = row.querySelector(SEL.chatItemKebab);
    if (!kebab) throw new Error("Kebab button not found");

    kebab.click();

    const kebabId = kebab.id;
    const menuSel = kebabId ? `[role="menu"][aria-labelledby="${CSS.escape(kebabId)}"]` : `[role="menu"]`;
    const menu = await waitFor(() => document.querySelector(menuSel), 3000);
    if (!menu) throw new Error("Kebab menu did not open");

    const exportBtn = menu.querySelector(SEL.exportChatBtn);
    if (!exportBtn) throw new Error("Export button not found in menu");

    return captureNextJSONDownload(() => exportBtn.click());
  }

  /******************************************************************
   * Share modal JSON capture (works on both desktop and mobile)
   ******************************************************************/
  async function captureShareJSON() {
    document.querySelector(SEL.shareButton)?.click();
    const modal = await waitFor(() => document.querySelector(SEL.shareModal), 3000);
    if (!modal) throw new Error("Share modal did not open");

    const jsonBtn = [...modal.querySelectorAll("button")].find((b) => textOf(b) === "JSON");
    if (!jsonBtn) throw new Error("JSON button not found in Share modal");

    return captureNextJSONDownload(() => jsonBtn.click());
  }

  /******************************************************************
   * Combined: best available JSON
   ******************************************************************/
  async function getBestJSON() {
    if (!isMobile()) {
      try {
        const full = await captureFullExportJSON();
        return { json: full, source: "full" };
      } catch (e) {
        warn("Full export failed, falling back:", e.message);
      }
    }
    const share = await captureShareJSON();
    return { json: share, source: "share" };
  }

  /******************************************************************
   * KaTeX loader
   ******************************************************************/
  async function ensureKaTeX() {
    if (window.katex?.renderToString) return;
    const css = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
    const js = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js";
    if (![...document.querySelectorAll("link")].some((l) => l.href === css)) {
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = css; document.head.appendChild(l);
    }
    await new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = js; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error("KaTeX load failed"));
      document.head.appendChild(s);
    });
  }

  /******************************************************************
   * v6 Converter (all features)
   ******************************************************************/
  function S(c) {
    if (c == null) return "";
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x) => (x?.text || x?.content || String(x))).join("\n");
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
    if (!raw) return "";
    let h = String(raw);
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
    const lines = String(text || "").split("\n"), out = [];
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i].trim();
      if (ln.startsWith("|") && ln.endsWith("|")) {
        const tl = [];
        while (i < lines.length) { const cl = lines[i].trim(); if (cl.startsWith("|") && cl.endsWith("|")) { tl.push(cl); i++; } else break; }
        if (tl.length >= 3) {
          const isSep = tl[1].split("|").slice(1, -1).every((c) => /^[:=-]+$/.test(c.trim()));
          if (isSep) {
            let h = "<table><thead><tr>";
            tl[0].split("|").slice(1, -1).forEach((c) => (h += `<th>${Icell(c.trim())}</th>`));
            h += "</tr></thead><tbody>";
            for (let r = 2; r < tl.length; r++) { h += "<tr>"; tl[r].split("|").slice(1, -1).forEach((c) => (h += `<td>${Icell(c.trim())}</td>`)); h += "</tr>"; }
            h += "</tbody></table>"; out.push(h);
          } else {
            let h = "<table><tbody>";
            tl.forEach((row) => { const cells = row.split("|").slice(1, -1); if (!cells.every((c) => /^[-:=\s]*$/.test(c.trim()))) { h += "<tr>"; cells.forEach((c) => (h += `<td>${Icell(c.trim())}</td>`)); h += "</tr>"; } });
            h += "</tbody></table>"; out.push(h);
          }
        } else out.push(...tl);
      } else { out.push(lines[i]); i++; }
    }
    return out.join("\n");
  }

  function Mblock(raw) {
    if (!raw) return "";
    let h = String(raw);
    const cb = []; h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _l, c) => (cb.push(`<pre><code>${E(c)}</code></pre>`), `\n%%CB${cb.length - 1}%%\n`));
    const ic = []; h = h.replace(/`([^`\n]+)`/g, (_, c) => (ic.push(`<code>${E(c)}</code>`), `%%IC${ic.length - 1}%%`));
    const tx = []; h = protectTeX(h, tx);
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

  function fmtTime(ts) { if (!ts) return ""; try { return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } }

  const RT = { render_html: 1, render_interactive_canvas: 1, render_web_app: 1, render_chart: 1, render_plotly_chart: 1, render_highcharts_chart: 1, render_matplotlib_plot: 1, render_vis_graph: 1, render_jsmind_map: 1, diffusionPlus: 1, gpt_image_editor: 1 };

  function parseExport(raw) {
    const d = JSON.parse(raw), r = { messages: [], title: "", model: "" };
    if (d?.data?.chats?.[0]) { const c = d.data.chats[0]; r.messages = c.messages || []; r.title = c.chatTitle || ""; r.model = c.modelInfo?.title || ""; return r; }
    if (d?.messages) { r.messages = d.messages; return r; }
    if (Array.isArray(d)) { r.messages = d; return r; }
    throw new Error("Unrecognized JSON");
  }

  function buildMaps(ms) {
    const a = {}, n = {};
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        const bn = {};
        m.tool_calls.forEach((tc) => { const fn = tc.function || tc, nm = fn.name || "", ag = fn.arguments || "{}"; if (tc.id) n[tc.id] = nm; try { bn[nm] = typeof ag === "string" ? JSON.parse(ag) : ag; } catch { bn[nm] = { raw: ag }; } });
        a[i] = bn;
      }
    }
    return { args: a, names: n };
  }

  function renderArt(name, args) {
    let src = "";
    if (args) {
      src = args.htmlSource || args.html_source || args.htmlsource || "";
      if (!src && args.matplotlib_code) return `<details class="render-wrap"><summary>Code: ${E(name)}</summary><pre><code>${E(args.matplotlib_code)}</code></pre></details>`;
      if (!src && args.graphCode) return `<details class="render-wrap"><summary>Code: ${E(name)}</summary><pre><code>${E(args.graphCode)}</code></pre></details>`;
      if (!src && args.prompt) return `<div class="artifact-notice">${E(name)}: ${E(args.prompt)}</div>`;
    }
    if (src && src.length > 50) return `<details class="render-wrap" open><summary>Rendered: ${E(name)}</summary><iframe srcdoc="${src.replace(/"/g, "&quot;")}" sandbox="allow-scripts" style="width:100%;min-height:300px;border:none;border-radius:0 0 6px 6px;background:#fff" loading="lazy"></iframe></details>`;
    return `<div class="artifact-notice">${E(name)} — Not in export</div>`;
  }

  const OCSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,sans-serif;background:#e5ddd5;color:#111b21;line-height:1.6}.w{width:100%;padding:12px 16px;min-height:100vh;background:#efeae2}@media(min-width:1400px){.w{padding:12px 8%}}.hd{text-align:center;padding:16px;margin:-12px -16px 16px;background:#00a884;color:#fff}.hd h1{font-size:1.1rem}.hd p{font-size:.72rem;opacity:.85;margin-top:3px}.turn{margin-bottom:10px}.msg{padding:8px 12px;border-radius:8px;max-width:95%;overflow-wrap:break-word;margin-bottom:2px;box-shadow:0 1px 1px rgba(0,0,0,.08)}@media(min-width:900px){.msg{max-width:75%}}.msg.u{background:#d9fdd3;margin-left:auto;border-top-right-radius:0}.msg.a{background:#fff;margin-right:auto;border-top-left-radius:0}.rl{font-weight:700;font-size:.62rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;display:block;color:#00a884}.msg.u .rl{color:#027d5e}.ts{font-size:.58rem;color:#999;margin-top:3px;text-align:right}.bd{font-size:.86rem;line-height:1.6}.bd h1,.bd h2,.bd h3,.bd h4{margin:6px 0 3px}.bd h1{font-size:1.05rem}.bd h2{font-size:.95rem}.bd h3{font-size:.88rem}.bd code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:.82em;color:#005c4b}.bd pre{background:#1e1e1e;color:#d4d4d4;padding:10px;border-radius:6px;overflow-x:auto;margin:6px 0;font-size:.76rem}.bd pre code{background:transparent;padding:0;color:inherit}.bd a{color:#027d5e}.bd ul,.bd ol{padding-left:18px;margin:4px 0}.bd blockquote{border-left:3px solid #c8c8c8;padding-left:10px;color:#667781;margin:4px 0}.bd table{border-collapse:collapse;margin:6px 0;width:100%;display:block;overflow-x:auto}.bd th,.bd td{border:1px solid #d1d7db;padding:4px 8px;font-size:.8rem;white-space:nowrap}.bd th{background:#f0f2f5;font-weight:600}.bd img{max-width:100%;border-radius:4px;margin:4px 0}.bd .katex-display{overflow-x:auto;padding:4px 0;margin:6px 0}details.tc{background:#f0f2f5;border:1px solid #d1d7db;border-radius:6px;margin:3px 0;font-size:.76rem;max-width:95%}@media(min-width:900px){details.tc{max-width:75%}}details.tc summary{padding:5px 10px;cursor:pointer;color:#667781;list-style:none;display:flex;align-items:center;gap:4px}details.tc summary::before{content:"\\25B6";font-size:.5rem;transition:transform .15s}details.tc[open] summary::before{transform:rotate(90deg)}.tb{padding:6px 10px;border-top:1px solid #d1d7db;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.7rem;color:#667781;background:#f9f9f9}details.render-wrap{background:#f0f2f5;border:1px solid #d1d7db;border-radius:6px;margin:3px 0;max-width:95%}@media(min-width:900px){details.render-wrap{max-width:75%}}details.render-wrap summary{padding:8px 12px;cursor:pointer;color:#027d5e;font-weight:600;font-size:.8rem;list-style:none;display:flex;align-items:center;gap:6px}details.render-wrap summary::before{content:"\\25B6";font-size:.6rem;transition:transform .15s}details.render-wrap[open] summary::before{transform:rotate(90deg)}.artifact-notice{background:#fff3cd;border:1px dashed #d1a000;border-radius:6px;padding:6px 10px;margin:3px 0;max-width:95%;font-size:.76rem;color:#856404;font-style:italic}@media(min-width:900px){.artifact-notice{max-width:75%}}@media print{body{background:#fff!important}.w{background:#fff!important;padding:10px}.msg{box-shadow:none;break-inside:avoid;max-width:100%}.msg.u{background:#d9fdd3!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}details.tc .tb{display:none!important}.bd table,.bd th,.bd td{font-size:.75rem}}`;

  function buildChatHTML(ms) {
    const maps = buildMaps(ms); let out = "";
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]; if (m.role !== "user") continue;
      const uTs = fmtTime(m.createdAt);
      out += `<div class="turn"><div class="msg u"><span class="rl">You</span><div class="bd">${Mblock(S(m.content))}</div>${uTs ? `<div class="ts">${E(uTs)}</div>` : ""}</div>`;
      let tools = ""; const replies = []; let lTs = ""; let j = i + 1;
      while (j < ms.length && ms[j].role !== "user") {
        const n = ms[j];
        if (n.role === "tool") {
          const tn = n.name || maps.names[n.tool_call_id] || "tool";
          if (RT[tn]) { let ag = null; for (let k = j - 1; k >= Math.max(0, j - 7); k--) { if (maps.args[k]?.[tn]) { ag = maps.args[k][tn]; break; } } tools += renderArt(tn, ag); }
          else { const b = S(n.content || ""), pv = b.replace(/[\n\r]+/g, " ").slice(0, 100); tools += `<details class="tc"><summary><b>${E(tn)}</b> — ${E(pv)}${b.length > 100 ? "..." : ""}</summary><div class="tb">${E(b || "(empty)")}</div></details>`; }
        } else if (n.role === "assistant") { const ac = S(n.content); if (ac.trim().length > 2) { replies.push(ac); lTs = fmtTime(n.createdAt); } }
        j++;
      }
      out += tools;
      if (replies.length) out += `<div class="msg a"><span class="rl">Assistant</span><div class="bd">${Mblock(replies[replies.length - 1])}</div>${lTs ? `<div class="ts">${E(lTs)}</div>` : ""}</div>`;
      out += `</div>`; i = j - 1;
    }
    return out || `<div style="text-align:center;color:#999;padding:40px">No messages found.</div>`;
  }

  function buildHTML(parsed, fallback) {
    const title = parsed.title || fallback || "Chat"; const dt = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const sub = []; if (parsed.model) sub.push("Model: " + parsed.model); sub.push("Exported " + dt);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${E(title)}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"><style>${OCSS}</style></head><body><div class="w"><div class="hd"><h1>${E(title)}</h1><p>${E(sub.join(" | "))}</p></div>${buildChatHTML(parsed.messages)}</div></body></html>`;
  }

  function dlFile(html, name) {
    const b = new Blob([html], { type: "text/html;charset=utf-8" }), u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch {} try { URL.revokeObjectURL(u); } catch {} }, 500);
  }

  /******************************************************************
   * Actions
   ******************************************************************/
  async function doHTML() {
    const ft = getTopChatTitle();
    try { await ensureKaTeX(); } catch {}
    const { json, source } = await getBestJSON();
    const parsed = parseExport(json);
    const html = buildHTML(parsed, ft);
    const safe = (parsed.title || ft || "chat").replace(/[^a-zA-Z0-9 -]/g, "").trim() || "chat";
    dlFile(html, `${safe}-${source}-${Date.now()}.html`);
  }

  async function doPDF() {
    // Open window IMMEDIATELY (user gesture → no popup blocker)
    const w = window.open("", "_blank");

    const ft = getTopChatTitle();
    try { await ensureKaTeX(); } catch {}

    let json, parsed, html;
    try {
      const r = await getBestJSON();
      json = r.json;
      parsed = parseExport(json);
      html = buildHTML(parsed, ft);
    } catch (e) {
      if (w) try { w.close(); } catch {}
      throw e;
    }

    if (w) {
      w.document.open(); w.document.write(html); w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 900);
    } else {
      // Popup blocked fallback
      const safe = (parsed.title || ft || "chat").replace(/[^a-zA-Z0-9 -]/g, "").trim() || "chat";
      dlFile(html, `${safe}-print-${Date.now()}.html`);
    }
  }

  /******************************************************************
   * Inject into Share modal
   ******************************************************************/
  function inject(modal) {
    if (!modal || modal.querySelector("[data-tm='v7']")) return;
    const grid = modal.querySelector(".grid.grid-cols-2");
    if (!grid) return;

    const mk = (label, bg, fn) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label;
      b.style.cssText = `display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:10px;border:none;font-weight:800;font-size:12px;background:${bg};color:#111b21;box-shadow:0 1px 2px rgba(0,0,0,.2);width:100%`;
      b.addEventListener("click", async () => { b.disabled = true; b.textContent = "Working…"; try { await fn(); } catch (e) { alert("Export failed: " + (e?.message || e)); } finally { b.disabled = false; b.textContent = label; } });
      return b;
    };

    const l1 = document.createElement("div"); l1.className = "flex items-center justify-end";
    l1.appendChild(mk("Interactive HTML", "#00a884", doHTML));
    const r1 = document.createElement("div");
    r1.textContent = isMobile() ? "Uses Share JSON on mobile." : "Full sidebar Export on desktop; Share JSON fallback.";

    const l2 = document.createElement("div"); l2.className = "flex items-center justify-end";
    l2.appendChild(mk("Nice PDF", "#f59e0b", doPDF));
    const r2 = document.createElement("div");
    r2.textContent = "Opens print-ready page; falls back to HTML download.";

    const m = document.createElement("div"); m.setAttribute("data-tm", "v7"); m.style.display = "none"; modal.appendChild(m);
    grid.appendChild(l1); grid.appendChild(r1); grid.appendChild(l2); grid.appendChild(r2);
    log("Buttons injected.");
  }

  new MutationObserver(() => { const m = document.querySelector(SEL.shareModal); if (m) inject(m); }).observe(document.documentElement, { childList: true, subtree: true });
  log("v7 loaded. Open Share → Interactive HTML / Nice PDF.");
})();
