(() => {
  const TAG = "[TMX v10]";
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

  const sEl = document.createElement("style");
  sEl.textContent = `
    .tm-force-open button[aria-label="Chat settings"]{opacity:1!important;width:auto!important;pointer-events:auto!important}
    .tmx-bar{position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:rgba(17,24,39,.85);color:#fff;border-top:2px solid #00a884;padding:10px 16px;font:13px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 -4px 24px rgba(0,0,0,.4);pointer-events:none}
    .tmx-bar *{pointer-events:none}
    .tmx-bar button{pointer-events:auto}
    .tmx-bar b{color:#00a884}
    .tmx-bar .row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    .tmx-bar button{border:none;border-radius:10px;padding:8px 14px;font-weight:800;font-size:12px;cursor:pointer}
    .tmx-bar .cancel{background:rgba(255,255,255,.15);color:#fff}
    .tmx-bar .pulsedot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#00a884;margin-right:6px;animation:tmxpulse 1.2s infinite}
    @keyframes tmxpulse{0%,100%{opacity:1}50%{opacity:.3}}
  `;
  document.documentElement.appendChild(sEl);

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

  function showStatus(msg, durationMs) {
    try { document.querySelectorAll('.tmx-status').forEach(x => x.remove()); } catch {}
    const d = document.createElement('div');
    d.className = 'tmx-status';
    d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(17,24,39,.92);color:#fff;padding:8px 16px;border-radius:10px;font:12px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;transition:opacity .3s';
    d.textContent = msg;
    document.body.appendChild(d);
    if (durationMs) setTimeout(() => { d.style.opacity = '0'; setTimeout(() => { try { d.remove(); } catch {} }, 400); }, durationMs);
    return d;
  }

  /* ============ CAPTURE ENGINE (quad interception) ============ */
  function createCapture({ timeoutMs = 15000, suppressDownload = false, acceptSmall = false } = {}) {
    const OrigClick = HTMLAnchorElement.prototype.click;
    const OrigDispatch = HTMLAnchorElement.prototype.dispatchEvent;
    const OrigRevoke = URL.revokeObjectURL;
    let done = false;
    let resolveFn, rejectFn;

    const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });

    const timer = setTimeout(() => {
      if (!done) cancel(new Error("Capture timed out"));
    }, timeoutMs);

    function cancel(err) {
      if (done) return;
      restore();
      rejectFn(err || new Error("Cancelled"));
    }

    function restore() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      HTMLAnchorElement.prototype.click = OrigClick;
      HTMLAnchorElement.prototype.dispatchEvent = OrigDispatch;
      URL.revokeObjectURL = OrigRevoke;
      document.removeEventListener('click', onDocClick, true);
      if (domObs) domObs.disconnect();
    }

    function processText(txt) {
      if (done) return;
      try {
        const obj = JSON.parse(txt);
        const isFull = !!(obj && obj.data && obj.data.chats && obj.data.chats[0]);
        const isSmall = !!(obj && (obj.messages || Array.isArray(obj)));

        if (isFull) {
          restore();
          resolveFn({ text: txt, kind: "full" });
        } else if (isSmall && acceptSmall) {
          restore();
          resolveFn({ text: txt, kind: "share" });
        }
      } catch {}
    }

    function isTarget(el) {
      if (!el || !el.tagName || el.tagName !== 'A') return false;
      var href = String(el.href || '');
      var dl = String(el.getAttribute('download') || el.download || '').toLowerCase();
      return href.startsWith('blob:') && (dl.includes('json') || dl.endsWith('.json'));
    }

    function readAnchor(a) {
      if (done) return;
      try { fetch(a.href).then(function(r) { return r.text(); }).then(processText).catch(function() {}); } catch {}
    }

    /* Method 1: .click() override */
    HTMLAnchorElement.prototype.click = function () {
      if (!done && isTarget(this)) {
        readAnchor(this);
        if (suppressDownload) return;
      }
      return OrigClick.call(this);
    };

    /* Method 2: .dispatchEvent() override for click events */
    HTMLAnchorElement.prototype.dispatchEvent = function (event) {
      if (!done && event && event.type === 'click' && isTarget(this)) {
        readAnchor(this);
      }
      return OrigDispatch.call(this, event);
    };

    /* Method 3: document click listener (capture phase) */
    function onDocClick(e) {
      if (done) return;
      try {
        var a = e.target;
        if (!a) return;
        if (a.tagName !== 'A') a = a.closest ? a.closest('a') : null;
        if (a && isTarget(a)) readAnchor(a);
      } catch {}
    }
    document.addEventListener('click', onDocClick, true);

    /* Method 4: MutationObserver — catches anchors added to DOM */
    var domObs = null;
    try {
      domObs = new MutationObserver(function (muts) {
        if (done) return;
        for (var mi = 0; mi < muts.length; mi++) {
          var nodes = muts[mi].addedNodes;
          for (var ni = 0; ni < nodes.length; ni++) {
            var node = nodes[ni];
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'A' && isTarget(node)) { readAnchor(node); continue; }
            if (node.querySelectorAll) {
              var anchors = node.querySelectorAll('a[download][href^="blob:"]');
              for (var ai = 0; ai < anchors.length; ai++) {
                if (isTarget(anchors[ai])) readAnchor(anchors[ai]);
              }
            }
          }
        }
      });
      domObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch {}

    /* Method 4b: delay URL.revokeObjectURL so MutationObserver fetch can read blob */
    URL.revokeObjectURL = function (url) {
      if (!done && typeof url === 'string' && url.startsWith('blob:')) {
        setTimeout(function () { OrigRevoke(url); }, 150);
      } else {
        OrigRevoke(url);
      }
    };

    return { promise: promise, cancel: cancel };
  }

  /* ============ DESKTOP AUTOMATION ============ */
  async function desktopTriggerFullExport() {
    var hasAny = function () { return document.querySelector(SEL.selectedChat) || document.querySelector(SEL.chatItem); };
    if (!hasAny()) { var tog = document.querySelector(SEL.sidebarToggle); if (tog) tog.click(); await waitFor(hasAny, 3000); }

    var row = document.querySelector(SEL.selectedChat);
    if (!row) {
      var top = getTitle().toLowerCase();
      var items = [].slice.call(document.querySelectorAll(SEL.chatItem)).filter(function (it) { return it.querySelector(SEL.kebab); });
      var best = null, bs = 0;
      for (var ii = 0; ii < items.length; ii++) {
        var it = items[ii];
        var t = textOf(it.querySelector(".truncate") || it).toLowerCase();
        var s = t === top ? 1000 : top.indexOf(t) >= 0 ? 600 + t.length : t.indexOf(top) >= 0 ? 500 + top.length : 0;
        if (s > bs) { bs = s; best = it; }
      }
      if (best && bs >= 450) row = best;
    }
    if (!row) throw new Error("Active chat not found in sidebar");

    row.classList.add("tm-force-open");
    var kb = row.querySelector(SEL.kebab);
    if (!kb) throw new Error("Kebab not found");
    kb.click();

    var kbId = kb.id;
    var menuSel = kbId ? '[role="menu"][aria-labelledby="' + cssEsc(kbId) + '"]' : '[role="menu"]';
    var menu = await waitFor(function () { return document.querySelector(menuSel); }, 2500);
    if (!menu) throw new Error("Kebab menu didn't open");

    var exp = menu.querySelector(SEL.exportBtn);
    if (!exp) throw new Error("Export button not found");
    exp.click();
  }

  async function desktopTriggerShareJSON() {
    openModal();
    var modal = await waitFor(function () { return document.querySelector(SEL.shareModal); }, 2500);
    if (!modal) throw new Error("Share modal didn't open");
    var btns = [].slice.call(modal.querySelectorAll("button"));
    var jsonBtn = null;
    for (var i = 0; i < btns.length; i++) { if (textOf(btns[i]) === "JSON") { jsonBtn = btns[i]; break; } }
    if (!jsonBtn) throw new Error("JSON button not found");
    jsonBtn.click();
    // Now we need to click "Download .json" in the sub-view
    var dlBtn = await waitFor(function () {
      var allBtns = [].slice.call(document.querySelectorAll('button'));
      for (var b = 0; b < allBtns.length; b++) {
        if (textOf(allBtns[b]).toLowerCase().indexOf('download') >= 0 && textOf(allBtns[b]).toLowerCase().indexOf('json') >= 0) return allBtns[b];
      }
      return null;
    }, 3000);
    if (!dlBtn) throw new Error("Download .json button not found");
    dlBtn.click();
  }

  /* ============ CONVERTER ============ */
  function S(c) {
    if (c == null) return "";
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map(function (x) { return (x && (x.text || x.content)) ? (x.text || x.content) : String(x); }).join("\n");
    if (typeof c === "object") return JSON.stringify(c, null, 2);
    return String(c);
  }
  function SH(s) {
    if (!s) return "";
    var el = document.createElement("div"); el.innerHTML = s;
    el.querySelectorAll("script,iframe,object,embed").forEach(function (x) { x.remove(); });
    el.querySelectorAll("*").forEach(function (x) { for (var i = x.attributes.length - 1; i >= 0; i--) { var a = x.attributes[i].name; if (/^on/i.test(a)) x.removeAttribute(a); if (a === "href" && (x.getAttribute(a) || "").trim().toLowerCase().indexOf("javascript:") === 0) x.setAttribute(a, "#"); } });
    return el.innerHTML;
  }
  function E(s) { var d = document.createElement("div"); d.textContent = S(s); return d.innerHTML; }

  function renderTeX(tex, disp) {
    if (window.katex) try { return katex.renderToString(tex, { throwOnError: false, displayMode: !!disp }); } catch (e) {}
    return disp ? '<div style="text-align:center;margin:6px 0"><code>' + E(tex) + '</code></div>' : '<code>' + E(tex) + '</code>';
  }
  function protectTeX(raw, arr) {
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g, function (_, t) { arr.push(renderTeX(t.trim(), true)); return '%%TX' + (arr.length - 1) + '%%'; });
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g, function (_, t) { arr.push(renderTeX(t.trim(), false)); return '%%TX' + (arr.length - 1) + '%%'; });
    raw = raw.replace(/\$\$([\s\S]+?)\$\$/g, function (m, t, o) {
      var nl = t.indexOf('\n') >= 0, cb = o > 0 ? raw.charAt(o - 1) : '\n', ca = o + m.length < raw.length ? raw.charAt(o + m.length) : '\n';
      arr.push(renderTeX(t.trim(), nl || (cb === '\n' && (ca === '\n' || ca === ''))));
      return '%%TX' + (arr.length - 1) + '%%';
    });
    return raw;
  }
  function Icell(raw) {
    if (!raw) return ''; var h = String(raw);
    var ic = []; h = h.replace(/`([^`\n]+)`/g, function (_, c) { ic.push('<code>' + E(c) + '</code>'); return '%%ic' + ic.length + '%%'; });
    var tx = [];
    h = h.replace(/\\\[([\s\S]+?)\\\]/g, function (_, t) { tx.push(renderTeX(t.trim(), false)); return '%%tx' + tx.length + '%%'; });
    h = h.replace(/\\\(([\s\S]+?)\\\)/g, function (_, t) { tx.push(renderTeX(t.trim(), false)); return '%%tx' + tx.length + '%%'; });
    h = h.replace(/\$\$([\s\S]+?)\$\$/g, function (_, t) { tx.push(renderTeX(t.trim(), false)); return '%%tx' + tx.length + '%%'; });
    h = SH(h);
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" style="max-height:1.2em;vertical-align:middle">');
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    for (var i = 1; i <= ic.length; i++) h = h.replace('%%ic' + i + '%%', ic[i - 1]);
    for (var i = 1; i <= tx.length; i++) h = h.replace('%%tx' + i + '%%', tx[i - 1]);
    return h;
  }
  function parseMdTables(text) {
    var lines = String(text || '').split('\n'), out = [], i = 0;
    while (i < lines.length) {
      var ln = lines[i].trim();
      if (ln.charAt(0) === '|' && ln.charAt(ln.length - 1) === '|') {
        var tl = []; while (i < lines.length) { var cl = lines[i].trim(); if (cl.charAt(0) === '|' && cl.charAt(cl.length - 1) === '|') { tl.push(cl); i++; } else break; }
        if (tl.length >= 3 && tl[1].split('|').slice(1, -1).every(function (c) { return /^[:=-]+$/.test(c.trim()); })) {
          var h = '<table><thead><tr>'; tl[0].split('|').slice(1, -1).forEach(function (c) { h += '<th>' + Icell(c.trim()) + '</th>'; }); h += '</tr></thead><tbody>';
          for (var r = 2; r < tl.length; r++) { h += '<tr>'; tl[r].split('|').slice(1, -1).forEach(function (c) { h += '<td>' + Icell(c.trim()) + '</td>'; }); h += '</tr>'; }
          h += '</tbody></table>'; out.push(h);
        } else { for (var ti = 0; ti < tl.length; ti++) out.push(tl[ti]); }
      } else { out.push(lines[i]); i++; }
    }
    return out.join('\n');
  }
  function Mblock(raw) {
    if (!raw) return ''; var h = String(raw);
    var cb = []; h = h.replace(/```(\w*)\s*\n([\s\S]*?)\n```/g, function (_, _l, c) { cb.push('<pre><code>' + E(c) + '</code></pre>'); return '\n%%CB' + (cb.length - 1) + '%%\n'; });
    var ic = []; h = h.replace(/`([^`\n]+)`/g, function (_, c) { ic.push('<code>' + E(c) + '</code>'); return '%%IC' + (ic.length - 1) + '%%'; });
    var tx = []; h = protectTeX(h, tx);
    h = SH(h);
    var hb = [];
    h = h.replace(/(<(?:table|div|details|figure|section|article|style)[\s\S]*?<\/(?:table|div|details|figure|section|article|style)>)/gi, function (m) { hb.push(m); return '\n%%HB' + (hb.length - 1) + '%%\n'; });
    h = parseMdTables(h);
    h = h.replace(/(<table[\s\S]*?<\/table>)/gi, function (m) { hb.push(m); return '\n%%HB' + (hb.length - 1) + '%%\n'; });
    h = h.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>'); h = h.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>'); h = h.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>'); h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>'); h = h.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    h = h.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>'); h = h.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
    h = h.replace(/^---+$/gm, '<hr>'); h = h.replace(/\n\n/g, '</p><p>'); h = h.replace(/\n/g, '<br>');
    for (var i = 0; i < cb.length; i++) h = h.replace('%%CB' + i + '%%', cb[i]);
    for (var i = 0; i < ic.length; i++) h = h.replace('%%IC' + i + '%%', ic[i]);
    for (var i = 0; i < tx.length; i++) h = h.replace('%%TX' + i + '%%', tx[i]);
    for (var i = 0; i < hb.length; i++) h = h.replace('%%HB' + i + '%%', hb[i]);
    return '<p>' + h + '</p>';
  }

  var RT = { render_html: 1, render_interactive_canvas: 1, render_web_app: 1, render_chart: 1, render_plotly_chart: 1, render_highcharts_chart: 1, render_matplotlib_plot: 1, render_vis_graph: 1, render_jsmind_map: 1, diffusionPlus: 1, gpt_image_editor: 1 };

  function parseJSON(raw) {
    var d = JSON.parse(raw), r = { messages: [], title: '', kind: 'unknown' };
    if (d && d.data && d.data.chats && d.data.chats[0]) { var c = d.data.chats[0]; r.messages = c.messages || []; r.title = c.chatTitle || ''; r.kind = 'full'; return r; }
    if (d && d.messages) { r.messages = d.messages; r.kind = 'share'; return r; }
    if (Array.isArray(d)) { r.messages = d; r.kind = 'share'; return r; }
    throw new Error('Unrecognized JSON format');
  }
  function buildMaps(ms) {
    var a = {}, n = {};
    for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.role === 'assistant' && Array.isArray(m.tool_calls)) { var bn = {}; m.tool_calls.forEach(function (tc) { var fn = tc['function'] || tc, nm = fn.name || '', ag = fn.arguments || '{}'; if (tc.id) n[tc.id] = nm; try { bn[nm] = typeof ag === 'string' ? JSON.parse(ag) : ag; } catch (e) { bn[nm] = { raw: ag }; } }); a[i] = bn; } }
    return { args: a, names: n };
  }
  function renderArt(name, args) {
    var src = ''; if (args) src = args.htmlSource || args.html_source || args.htmlsource || '';
    if (src && src.length > 50) return '<details class="rw" open><summary>Rendered: ' + E(name) + '</summary><iframe srcdoc="' + src.replace(/"/g, '&quot;') + '" sandbox="allow-scripts" style="width:100%;min-height:300px;border:none;background:#fff" loading="lazy"></iframe></details>';
    return '<div class="an">' + E(name) + ' \u2014 Not in export</div>';
  }

  var OCSS = '*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,sans-serif;background:#e5ddd5;color:#111b21;line-height:1.6}.w{width:100%;padding:12px 16px;min-height:100vh;background:#efeae2}@media(min-width:1400px){.w{padding:12px 8%}}.hd{text-align:center;padding:16px;margin:-12px -16px 16px;background:#00a884;color:#fff}.hd h1{font-size:1.1rem}.hd p{font-size:.72rem;opacity:.85;margin-top:3px}.turn{margin-bottom:10px}.msg{padding:8px 12px;border-radius:8px;max-width:95%;overflow-wrap:break-word;margin-bottom:2px;box-shadow:0 1px 1px rgba(0,0,0,.08)}@media(min-width:900px){.msg{max-width:75%}}.msg.u{background:#d9fdd3;margin-left:auto;border-top-right-radius:0}.msg.a{background:#fff;margin-right:auto;border-top-left-radius:0}.rl{font-weight:800;font-size:.62rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;display:block;color:#00a884}.bd{font-size:.86rem;line-height:1.6}.bd h1,.bd h2,.bd h3,.bd h4{margin:6px 0 3px}.bd code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:.82em;color:#005c4b}.bd pre{background:#1e1e1e;color:#d4d4d4;padding:10px;border-radius:6px;overflow-x:auto;margin:6px 0;font-size:.76rem}.bd pre code{background:transparent;padding:0;color:inherit}.bd a{color:#027d5e}.bd blockquote{border-left:3px solid #c8c8c8;padding-left:10px;color:#667781;margin:4px 0}.bd table{border-collapse:collapse;margin:6px 0;width:100%;display:block;overflow-x:auto}.bd th,.bd td{border:1px solid #d1d7db;padding:4px 8px;font-size:.8rem;white-space:nowrap}.bd th{background:#f0f2f5;font-weight:600}.bd img{max-width:100%;border-radius:4px;margin:4px 0}.bd .katex-display{overflow-x:auto;padding:4px 0;margin:6px 0}details.tc{background:#f0f2f5;border:1px solid #d1d7db;border-radius:6px;margin:3px 0;font-size:.76rem;max-width:95%}@media(min-width:900px){details.tc{max-width:75%}}details.tc summary{padding:5px 10px;cursor:pointer;color:#667781;list-style:none;display:flex;align-items:center;gap:6px}.tb{padding:6px 10px;border-top:1px solid #d1d7db;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.7rem;color:#667781;background:#f9f9f9}details.rw{background:#f0f2f5;border:1px solid #d1d7db;border-radius:6px;margin:3px 0;max-width:95%}@media(min-width:900px){details.rw{max-width:75%}}details.rw summary{padding:8px 12px;cursor:pointer;color:#027d5e;font-weight:800;font-size:.8rem;list-style:none}.an{background:#fff3cd;border:1px dashed #d1a000;border-radius:6px;padding:6px 10px;margin:3px 0;max-width:95%;font-size:.76rem;color:#856404;font-style:italic}@media print{details.rw iframe{display:none!important}details.tc .tb{display:none!important}.msg{box-shadow:none;break-inside:avoid}.msg.u{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';

  function buildChatHTML(ms) {
    var maps = buildMaps(ms), out = '';
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i]; if (m.role !== 'user') continue;
      out += '<div class="turn"><div class="msg u"><span class="rl">You</span><div class="bd">' + Mblock(S(m.content)) + '</div></div>';
      var tools = '', replies = [], j = i + 1;
      while (j < ms.length && ms[j].role !== 'user') {
        var n = ms[j];
        if (n.role === 'tool') {
          var tn = n.name || maps.names[n.tool_call_id] || 'tool';
          if (RT[tn]) { var ag = null; for (var k = j - 1; k >= Math.max(0, j - 7); k--) { if (maps.args[k] && maps.args[k][tn]) { ag = maps.args[k][tn]; break; } } tools += renderArt(tn, ag); }
          else { var b = S(n.content || ''), pv = b.replace(/[\n\r]+/g, ' ').substring(0, 100); tools += '<details class="tc"><summary><b>' + E(tn) + '</b> \u2014 ' + E(pv) + (b.length > 100 ? '\u2026' : '') + '</summary><div class="tb">' + E(b || '(empty)') + '</div></details>'; }
        } else if (n.role === 'assistant') { var ac = S(n.content); if (ac.trim().length > 2) replies.push(ac); }
        j++;
      }
      out += tools;
      if (replies.length) out += '<div class="msg a"><span class="rl">Assistant</span><div class="bd">' + Mblock(replies[replies.length - 1]) + '</div></div>';
      out += '</div>'; i = j - 1;
    }
    return out || '<div style="text-align:center;color:#999;padding:40px">No messages.</div>';
  }

  function buildHTML(title, messages) {
    var dt = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + E(title) + '<\/title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"><style>' + OCSS + '<\/style><\/head><body><div class="w"><div class="hd"><h1>' + E(title) + '<\/h1><p>' + E('Exported ' + dt) + '<\/p><\/div>' + buildChatHTML(messages) + '<\/div><\/body><\/html>';
  }

  function dlFile(html, name) {
    var b = new Blob([html], { type: 'text/html;charset=utf-8' }), u = URL.createObjectURL(b);
    var a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); } catch (e) {} try { URL.revokeObjectURL(u); } catch (e) {} }, 400);
  }

  function ensureKaTeX() {
    if (window.katex && window.katex.renderToString) return Promise.resolve();
    var css = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css', js = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
    if (![].slice.call(document.querySelectorAll('link')).some(function (l) { return l.href === css; })) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = css; document.head.appendChild(l); }
    return new Promise(function (r, j) { var s = document.createElement('script'); s.src = js; s.async = true; s.onload = r; s.onerror = function () { j(new Error('KaTeX fail')); }; document.head.appendChild(s); });
  }

  function safeName(s) { return String(s || 'chat').replace(/[^a-zA-Z0-9 -]/g, '').trim() || 'chat'; }

  function convertAndOutput(jsonText, mode, fallbackTitle) {
    var parsed = parseJSON(jsonText);
    var title = parsed.title || fallbackTitle;
    var html = buildHTML(title, parsed.messages);
    var base = safeName(title);
    if (mode === 'html') { dlFile(html, base + '-' + parsed.kind + '-' + Date.now() + '.html'); return parsed.kind; }
    var w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 900); }
    else { dlFile(html, base + '-print-' + Date.now() + '.html'); }
    return parsed.kind;
  }

  /* ============ DESKTOP FLOW ============ */
  async function desktopFlow(mode) {
    var title = getTitle();
    await ensureKaTeX().catch(function () {});
    closeModal();

    showStatus('Attempting full export (sidebar)\u2026');
    var cap1 = createCapture({ timeoutMs: 12000, suppressDownload: true, acceptSmall: false });
    try {
      await desktopTriggerFullExport();
      var r1 = await cap1.promise;
      showStatus('Captured ' + r1.kind + ' JSON. Converting\u2026', 2000);
      convertAndOutput(r1.text, mode, title);
      showStatus('Done! ' + mode.toUpperCase() + ' from ' + r1.kind + ' JSON.', 3000);
      return;
    } catch (e) {
      cap1.cancel(e);
      log('Full export failed:', e && e.message, '\u2192 fallback');
      showStatus('Full export failed. Trying Share JSON\u2026');
    }

    await sleep(300);
    var cap2 = createCapture({ timeoutMs: 12000, suppressDownload: true, acceptSmall: true });
    try {
      await desktopTriggerShareJSON();
      var r2 = await cap2.promise;
      showStatus('Captured ' + r2.kind + ' JSON. Converting\u2026', 2000);
      convertAndOutput(r2.text, mode, title);
      showStatus('Done! ' + mode.toUpperCase() + ' from ' + r2.kind + ' JSON.', 3000);
    } catch (e2) {
      cap2.cancel(e2);
      throw new Error('Both full export and share JSON failed: ' + ((e2 && e2.message) || e2));
    }
  }

  /* ============ MOBILE FLOW ============ */
  var mobileCapture = null;

  function removeOverlay() {
    [].slice.call(document.querySelectorAll('.tmx-bar')).forEach(function (el) { el.remove(); });
    if (mobileCapture) { mobileCapture.cancel(new Error('Cancelled by user')); mobileCapture = null; }
  }

  async function mobileFlow(mode) {
    var title = getTitle();
    await ensureKaTeX().catch(function () {});
    closeModal();
    removeOverlay();

    var cap = createCapture({ timeoutMs: 60000, suppressDownload: false, acceptSmall: true });
    mobileCapture = cap;

    var bar = document.createElement('div');
    bar.className = 'tmx-bar';
    bar.innerHTML = '<div><span class="pulsedot"></span>Listening for JSON export\u2026</div><div style="margin-top:6px;font-size:12px;opacity:.8">Go to <b>sidebar \u2192 kebab (\u22EF) \u2192 Export</b> for full JSON.<br>Or use <b>Share \u2192 JSON \u2192 Download .json</b> for basic export.</div><div class="row"></div>';
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = function () { removeOverlay(); };
    bar.querySelector('.row').appendChild(cancelBtn);
    document.body.appendChild(bar);

    try {
      var result = await cap.promise;
      mobileCapture = null;
      bar.innerHTML = '<div>Captured <b>' + result.kind + '</b> JSON. Converting\u2026</div>';
      await sleep(100);
      convertAndOutput(result.text, mode, title);
      bar.innerHTML = '<div>Done! <b>' + result.kind + '</b> JSON \u2192 ' + (mode === 'html' ? 'HTML' : 'PDF') + '.</div><div class="row"></div>';
      var closeBtn = document.createElement('button'); closeBtn.className = 'cancel'; closeBtn.textContent = 'Close';
      closeBtn.onclick = function () { bar.remove(); };
      bar.querySelector('.row').appendChild(closeBtn);
      setTimeout(function () { try { bar.remove(); } catch (e) {} }, 5000);
    } catch (e) {
      mobileCapture = null;
      if (bar.parentNode) {
        var msg = e && e.message === 'Cancelled by user' ? 'cancelled' : 'failed: ' + E((e && e.message) || 'unknown');
        bar.innerHTML = '<div>Export ' + msg + '</div><div class="row"></div>';
        var closeBtn2 = document.createElement('button'); closeBtn2.className = 'cancel'; closeBtn2.textContent = 'Close';
        closeBtn2.onclick = function () { bar.remove(); };
        bar.querySelector('.row').appendChild(closeBtn2);
        setTimeout(function () { try { bar.remove(); } catch (e) {} }, 4000);
      }
    }
  }

  /* ============ ROUTER ============ */
  async function doHTML() { if (isMobileLike()) return mobileFlow('html'); return desktopFlow('html'); }
  async function doPDF() { if (isMobileLike()) return mobileFlow('pdf'); return desktopFlow('pdf'); }

  /* ============ INJECT ============ */
  function inject(modal) {
    if (!modal || modal.querySelector('[data-tmx="v10"]')) return;
    var grid = modal.querySelector('.grid.grid-cols-2');
    if (!grid) return;

    var mobile = isMobileLike();
    function mkBtn(label, bg, fn) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:10px;border:none;font-weight:900;font-size:12px;background:' + bg + ';color:#111b21;box-shadow:0 1px 2px rgba(0,0,0,.2);width:100%';
      b.addEventListener('click', async function () {
        b.disabled = true; var old = b.textContent; b.textContent = 'Working\u2026';
        try { await fn(); }
        catch (e) { if (!e || e.message !== 'Cancelled by user') alert('Export failed: ' + ((e && e.message) || e)); }
        finally { b.disabled = false; b.textContent = old; }
      });
      return b;
    }
    function addRow(btn, desc) {
      var l = document.createElement('div'); l.className = 'flex items-center justify-end'; l.appendChild(btn);
      var r = document.createElement('div'); r.textContent = desc;
      grid.appendChild(l); grid.appendChild(r);
    }
    addRow(mkBtn('Interactive HTML', '#00a884', doHTML), mobile ? 'Starts listener \u2192 you manually Export or Share\u2192JSON.' : 'One-click: full export (fallback: share JSON).');
    addRow(mkBtn('Nice PDF', '#f59e0b', doPDF), mobile ? 'Starts listener \u2192 you manually Export \u2192 opens print.' : 'One-click: full export \u2192 print window.');

    var m = document.createElement('div'); m.setAttribute('data-tmx', 'v10'); m.style.display = 'none'; modal.appendChild(m);
    log('Buttons injected.', mobile ? '(mobile)' : '(desktop)');
  }

  new MutationObserver(function () { var m = document.querySelector(SEL.shareModal); if (m) inject(m); }).observe(document.documentElement, { childList: true, subtree: true });
  log('v10 loaded.', isMobileLike() ? 'Mobile.' : 'Desktop.');
})();
