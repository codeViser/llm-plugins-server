// ============================================================
//  TypingMind — User Message Markdown + Math Renderer
//  Version : 2.4.0
//
//  What changed vs 2.3.1:
//  ─────────────────────────────────────────────────────────
//  NEW: Mermaid.js diagram rendering
//    • Loads mermaid@11 from CDN (Stage 3, non-blocking)
//    • renderMermaidBlocks() fires asynchronously AFTER the
//      view div is in the live DOM — required for mermaid
//      v10+ render() API
//    • Targets <pre><code.language-mermaid|mmd>
//    • Falls back to the code block on render error
//    • theme:'dark', securityLevel:'antiscript'
//    • reRenderAll() called after load to catch already-
//      visible messages
//
//  NEW: Sandboxed HTML block rendering
//    • postProcessDom() converts <pre><code.language-html>
//      into an <iframe srcdoc sandbox="allow-scripts"> embed
//    • Injects base dark-theme styles for bare snippets
//    • Supports Chart.js, Plotly, D3, canvas, Three.js and
//      any self-contained HTML/JS visual
//
//  All v2.3.1 behaviour (LaTeX, Markdown, branch history,
//  edit detection, fingerprinting, list rendering, table
//  wrapping, characterData observer, tmg:branchSwitched)
//  is preserved without structural change.
//  parseMixedContent() is NOT modified.
//  ─────────────────────────────────────────────────────────
//  v2.3.1 — FIX: list-style-type (ol/ul Tailwind reset)
//  v2.3.0 — Branch history preservation, getSourceText()
//           A_VIEW exclusion, data-umr-src fingerprint,
//           characterData observer, tmg:branchSwitched
// ============================================================

(() => {
  'use strict';

  const CFG = {
    cdn: {
      marked   : 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js',
      katexCss : 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
      katexJs  : 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
      mermaidJs: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
    },
    sel: {
      chatArea  : '[data-element-id="chat-space-middle-part"]',
      userMsg   : '[data-element-id="user-message"]',
      responseBlk: '[data-element-id="response-block"]',
    },
    attr: {
      done : 'data-umr-done',
      view : 'data-umr-view',
      src  : 'data-umr-src',
    },
  };

  const { done: A_DONE, view: A_VIEW, src: A_SRC } = CFG.attr;
  const parser = { fn: null };

  /* ── CSS ─────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('umr-styles')) return;
    const UM   = `[data-element-id="user-message"]`;
    const DONE = `${UM}[${A_DONE}]`;
    const VIEW = `[${A_VIEW}]`;
    const s = document.createElement('style');
    s.id = 'umr-styles';
    s.textContent = `
${DONE} { white-space:normal!important; color:transparent!important; }
${DONE} > *:not(${VIEW}) { display:none!important; }
${DONE} > ${VIEW} { color:white!important; font-size:0.9375rem; line-height:1.62; white-space:normal!important; }
${VIEW} { word-break:break-word; overflow-wrap:break-word; }
${VIEW} > *:first-child { margin-top:0!important; }
${VIEW} > *:last-child  { margin-bottom:0!important; }
${VIEW} p { margin:0.4em 0; }
${VIEW} h1,${VIEW} h2,${VIEW} h3,${VIEW} h4,${VIEW} h5,${VIEW} h6
  { font-weight:700; line-height:1.25; margin:0.6em 0 0.25em; }
${VIEW} h1{font-size:1.50em}${VIEW} h2{font-size:1.30em}${VIEW} h3{font-size:1.13em}
${VIEW} h4{font-size:1.02em}${VIEW} h5{font-size:0.92em}${VIEW} h6{font-size:0.86em;opacity:.82}
${VIEW} strong,${VIEW} b{font-weight:700}${VIEW} em,${VIEW} i{font-style:italic}
${VIEW} del,${VIEW} s{text-decoration:line-through}${VIEW} u{text-decoration:underline}
${VIEW} sup{vertical-align:super;font-size:.75em;line-height:1}
${VIEW} sub{vertical-align:sub;font-size:.75em;line-height:1}
${VIEW} mark{background:rgba(255,230,0,.35);color:inherit;padding:.05em .22em;border-radius:2px}
${VIEW} abbr[title]{text-decoration:underline dotted;cursor:help}
${VIEW} a{text-decoration:underline;opacity:.9}${VIEW} a:hover{opacity:1}
${VIEW} :not(pre)>code,${VIEW} kbd
  {font-family:ui-monospace,'Cascadia Code','Fira Code',monospace;font-size:.85em;
   padding:.1em .38em;border-radius:3px;background:rgba(255,255,255,.18);word-break:break-all}
${VIEW} kbd{border:1px solid rgba(255,255,255,.35);padding:.05em .42em;box-shadow:0 1px 0 rgba(255,255,255,.22)}
${VIEW} pre{margin:.5em 0;padding:.72em .95em;border-radius:6px;overflow-x:auto;
  -webkit-overflow-scrolling:touch;background:rgba(255,255,255,.10);font-size:.9em}
${VIEW} pre code{background:none!important;padding:0!important;font-size:1em!important;word-break:normal}
${VIEW} blockquote{margin:.48em 0;padding:.1em 0 .1em .8em;border-left:3px solid rgba(255,255,255,.44)}
${VIEW} blockquote blockquote{margin-left:0;border-left-color:rgba(255,255,255,.28)}
${VIEW} blockquote blockquote blockquote{border-left-color:rgba(255,255,255,.16)}
${VIEW} ul,${VIEW} ol{padding-left:1.5em;margin:.38em 0}
${VIEW} ul{list-style-type:disc}
${VIEW} ol{list-style-type:decimal}
${VIEW} ul ul,${VIEW} ol ul{list-style-type:circle}
${VIEW} ul ul ul,${VIEW} ol ul ul,${VIEW} ul ol ul,${VIEW} ol ol ul{list-style-type:square}
${VIEW} ul ol,${VIEW} ol ol{list-style-type:lower-alpha}
${VIEW} ul ol ol,${VIEW} ol ol ol,${VIEW} ul ul ol,${VIEW} ol ul ol{list-style-type:lower-roman}
${VIEW} li{margin:.18em 0}
${VIEW} li>ul,${VIEW} li>ol{margin:.1em 0}
${VIEW} li.task-list-item{list-style:none;margin-left:-1.5em;padding-left:0}
${VIEW} input[type="checkbox"]{margin:0 .42em .1em 0;vertical-align:middle;cursor:default;accent-color:rgba(255,255,255,.8)}
.umr-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:.5em 0;border-radius:4px}
${VIEW} table{border-collapse:collapse;min-width:100%;margin:0}
${VIEW} th,${VIEW} td{border:1px solid rgba(255,255,255,.26);padding:.3em .62em;text-align:left}
${VIEW} thead th{font-weight:700;background:rgba(255,255,255,.09);border-bottom-width:2px}
${VIEW} tbody tr:nth-child(even){background:rgba(255,255,255,.04)}
${VIEW} img{max-width:100%;height:auto;border-radius:4px;display:inline-block;vertical-align:middle;margin:.2em 0}
${VIEW} hr{border:0;border-top:1px solid rgba(255,255,255,.26);margin:.65em 0}
${VIEW} dl{margin:.38em 0}${VIEW} dt{font-weight:700;margin-top:.38em}${VIEW} dd{margin-left:1.5em;margin-bottom:.2em}
${VIEW} .katex-display{margin:.6em 0;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}
${VIEW} .katex{font-size:1.06em}
${VIEW} .umr-math-err{opacity:.7;font-style:italic;border:1px dashed rgba(255,255,255,.4);padding:.1em .4em;border-radius:3px}
/* ── Mermaid diagrams ──────────────────────────────────────────────────── */
.umr-mermaid-view{max-width:100%;overflow-x:auto;margin:.5em 0;
  background:rgba(255,255,255,.05);border-radius:6px;padding:.6em .9em}
.umr-mermaid-view svg{max-width:100%;height:auto;display:block}
.umr-mermaid-view svg text{fill:#e8e8e8!important}
.umr-mermaid-err::before{content:'⚠ Diagram error — shown as code';
  display:block;font-size:.72em;color:rgba(255,120,120,.8);padding:.15em 0 .4em}
/* ── Sandboxed HTML embeds ─────────────────────────────────────────────── */
.umr-html-embed{margin:.5em 0;border-radius:6px;overflow:hidden;
  border:1px solid rgba(255,255,255,.16)}
.umr-html-embed iframe{display:block;width:100%;min-height:300px;
  border:none;background:rgba(22,22,28,.9)}
    `;
    document.head.appendChild(s);
  }

  /* ── LOADERS ─────────────────────────────────────────────────── */
  function injectKatexCss() {
    if (document.getElementById('umr-katex-css')) return;
    const l = document.createElement('link');
    l.id = 'umr-katex-css'; l.rel = 'stylesheet'; l.href = CFG.cdn.katexCss;
    document.head.appendChild(l);
  }

  function loadScript(src, globalKey) {
    return new Promise((res, rej) => {
      if (globalKey && window[globalKey]) { res(window[globalKey]); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload  = () => res(globalKey ? window[globalKey] : true);
      s.onerror = () => rej(new Error('[TM-UserMD] Failed: ' + src));
      document.head.appendChild(s);
    });
  }

  /* ── REACT FIBER & IDB HELPERS (for branch history preservation) */
  function umrGetChatState() {
    const el = document.querySelector('[data-element-id="chat-space-middle-part"]');
    if (!el) return null;
    const fk = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    if (!fk) return null;
    let f = el[fk];
    for (let d = 0; f && d < 80; f = f.return, d++) {
      let hs = f.memoizedState, hi = 0;
      for (; hs && hi < 6; hs = hs.next, hi++) {
        const v = hs.memoizedState;
        if (v && !Array.isArray(v) && typeof v === 'object' && Array.isArray(v.messages) && v.chatID)
          return { state: v, dispatch: hs.queue?.dispatch };
      }
    }
    return null;
  }

  const umrOpenIDB = () => new Promise((res, rej) => {
    const r = indexedDB.open('keyval-store');
    r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error);
  });

  async function umrPersistMessages(chatID, msgs) {
    const db = await umrOpenIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('keyval', 'readwrite'), st = tx.objectStore('keyval');
      const key = `CHAT_${chatID}`, g = st.get(key);
      g.onsuccess = () => {
        const prev = g.result;
        if (!prev) { db.close(); res(); return; }
        const p = st.put({ ...prev, messages: msgs, updatedAt: new Date() }, key);
        p.onsuccess = () => { db.close(); res(); };
        p.onerror   = () => { db.close(); rej(p.error); };
      };
      g.onerror = () => { db.close(); rej(g.error); };
    });
  }

  /* ── POST PROCESS ────────────────────────────────────────────── */
  function postProcessDom(root) {
    // Wrap tables for horizontal scroll
    root.querySelectorAll('table').forEach(tbl => {
      const w = document.createElement('div');
      w.className = 'umr-table-wrap';
      tbl.parentNode.insertBefore(w, tbl);
      w.appendChild(tbl);
    });
    // External links open in new tab
    root.querySelectorAll('a[href]').forEach(a => {
      if (/^https?:\/\//i.test(a.getAttribute('href') || '')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
    // Lazy-load images
    root.querySelectorAll('img').forEach(img => img.setAttribute('loading', 'lazy'));

    // ── NEW v2.4.0: convert ```html blocks → sandboxed iframes ───
    root.querySelectorAll('pre code.language-html').forEach(codeEl => {
      const pre = codeEl.closest('pre');
      if (!pre) return;
      const src  = codeEl.textContent;
      const wrap = document.createElement('div');
      wrap.className = 'umr-html-embed';
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts allow-modals';
      // Inject base dark-theme styles for bare snippets; skip for complete HTML docs
      const baseHead = `<meta charset="utf-8"><style>`
        + `*{box-sizing:border-box}`
        + `body{margin:8px;background:#1a1a22;color:#e8e8e8;`
        + `font-family:system-ui,sans-serif;font-size:14px}`
        + `</style>`;
      const full = /^\s*<!doctype|<html/i.test(src)
        ? src
        : `<!DOCTYPE html><html><head>${baseHead}</head><body>${src}</body></html>`;
      iframe.srcdoc = full;
      wrap.appendChild(iframe);
      pre.replaceWith(wrap);
    });
  }

  /* ── MATH ────────────────────────────────────────────────────── */
  function parseMixedContent(rawText, marked, katex) {
    const rnd  = Math.random().toString(36).slice(2, 10);
    const MTOK = `UMRmath${rnd}`, CTOK = `UMRcode${rnd}`;
    const mathStore = [], codeStore = [];
    let t = rawText;

    t = t.replace(/(`{3,}|~{3,})([^\n]*\n[\s\S]*?)\1/g, m => {
           const i = codeStore.length; codeStore.push(m); return `${CTOK}${i}`;
         })
         .replace(/`([^`\n]+)`/g, m => {
           const i = codeStore.length; codeStore.push(m); return `${CTOK}${i}`;
         });

    t = t.replace(/((?:^|\n)[ \t>]*)\$\$((?:[^$]|\$(?!\$))*?)\$\$([ \t]*(?=\n|$))/g, (_, b, f, a) => {
      const i = mathStore.length;
      mathStore.push(katexRender(katex, f.trim(), true));
      return `${b}${MTOK}D${i}${a}`;
    });
    t = t.replace(/\$\$((?:[^$]|\$(?!\$))*?)\$\$/g, (_, f) => {
      const i = mathStore.length;
      mathStore.push(katexRender(katex, f.trim(), false));
      return `${MTOK}I${i}`;
    });

    t = t.replace(new RegExp(`${CTOK}(\\d+)`, 'g'), (_, i) => codeStore[parseInt(i)]);
    let html = marked.parse(t);
    html = html.replace(new RegExp(`\n\\s*${MTOK}D(\\d+)\\s*\n\n`, 'g'), (_, i) => mathStore[parseInt(i)])
               .replace(new RegExp(`${MTOK}[DI](\\d+)`, 'g'),            (_, i) => mathStore[parseInt(i)]);
    return html;
  }

  function katexRender(katex, formula, displayMode) {
    try {
      return katex.renderToString(formula, { displayMode, throwOnError: false });
    } catch (e) {
      const tag = displayMode ? 'div' : 'span';
      return `<${tag} class="umr-math-err">$$${formula}$$`;
    }
  }

  const extractText = c =>
    !c ? '' : typeof c === 'string' ? c
    : Array.isArray(c) ? c.map(x => x?.text ?? x?.content ?? '').join(' ') : '';

  /* ── EDIT DETECTION ──────────────────────────────────────────── */
  function isEditing(msgEl) {
    if (msgEl.querySelector('textarea')) return true;
    const rb = msgEl.closest(CFG.sel.responseBlk);
    return rb ? !!rb.querySelector('textarea') : false;
  }

  /* ── SOURCE TEXT ─────────────────────────────────────────────── */
  function getSourceText(msgEl) {
    let text = '';
    for (const child of msgEl.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && child.hasAttribute(A_VIEW)) continue;
      text += child.textContent;
    }
    return text.trim();
  }

  /* ── MESSAGE UUID HELPER ─────────────────────────────────────── */
  function getMsgUUID(msgEl) {
    const rb  = msgEl.closest('[data-element-id="response-block"]');
    const btn = rb?.querySelector('button[id^="message-timestamp-"]');
    return btn?.id?.replace('message-timestamp-', '') || null;
  }

  /* ── BRANCH HISTORY PRESERVATION ──────────────────────────────── *
   *                                                                  *
   * TM's own edit flow REPLACES threads[] with a single entry       *
   * (the immediate predecessor) on every new edit. After n edits,   *
   * only v(n) [active] and v(n-1) [in threads] remain — all        *
   * earlier versions are silently lost.                              *
   *                                                                  *
   * Fix: snapshot the full threads structure BEFORE the edit        *
   * executes. After the edit completes and render() re-runs,        *
   * compare the new threads with the snapshot and restore any       *
   * entries that TM dropped.                                         *
   * ─────────────────────────────────────────────────────────────── */
  let _editSnapshot = null; // { uuid, chatID, existingThreads }

  function snapshotBeforeEdit(msgEl) {
    const uuid = getMsgUUID(msgEl);
    if (!uuid) return;
    if (_editSnapshot && _editSnapshot.uuid !== uuid) _editSnapshot = null;
    if (_editSnapshot?.uuid === uuid) return;
    const cs = umrGetChatState();
    if (!cs?.state) return;
    const msg = cs.state.messages.find(m => m.uuid === uuid);
    if (!msg) return;
    _editSnapshot = {
      uuid,
      chatID         : cs.state.chatID,
      existingThreads: JSON.parse(JSON.stringify(msg.threads || [])),
    };
  }

  async function mergeHistoryAfterEdit(uuid, snap) {
    if (!snap.existingThreads.length) return;
    const cs = umrGetChatState();
    if (!cs?.state) return;
    const msg = cs.state.messages.find(m => m.uuid === uuid);
    if (!msg) return;
    const nowKeys = new Set(
      (msg.threads || []).map(t => extractText(t.userMessageContent).trim().slice(0, 60))
    );
    const lostThreads = snap.existingThreads.filter(
      t => !nowKeys.has(extractText(t.userMessageContent).trim().slice(0, 60))
    );
    if (!lostThreads.length) return;
    const mergedMsg   = { ...msg, threads: [...(msg.threads || []), ...lostThreads] };
    const newMessages = cs.state.messages.map(m => m.uuid === uuid ? mergedMsg : m);
    const newState    = { ...cs.state, messages: newMessages };
    if (cs.dispatch) {
      try { cs.dispatch(newState); } catch (e) { console.warn('[TM-UserMD] dispatch:', e.message); }
    }
    await umrPersistMessages(snap.chatID, newMessages);
    console.info(`[TM-UserMD] Branch history merged: ${lostThreads.length} version(s) preserved for ${uuid}`);
  }

  /* ── MERMAID ─────────────────────────────────────────────────── */
  // NEW v2.4.0 — called AFTER msgEl.appendChild(view) because
  // mermaid.render() in v10+ requires a live DOM context.
  async function renderMermaidBlocks(viewEl) {
    if (!window.mermaid) return;
    const blocks = viewEl.querySelectorAll(
      'pre code.language-mermaid, pre code.language-mmd'
    );
    if (!blocks.length) return;
    let seq = 0;
    for (const codeEl of Array.from(blocks)) {
      const pre = codeEl.closest('pre');
      if (!pre) continue;
      const diagramDef = codeEl.textContent.trim();
      const renderID   = `umr-mm-${Date.now()}-${seq++}`;
      const wrap       = document.createElement('div');
      wrap.className   = 'umr-mermaid-view';
      try {
        const { svg } = await window.mermaid.render(renderID, diagramDef);
        wrap.innerHTML = svg;
      } catch (err) {
        console.warn('[TM-UserMD] Mermaid render —', err.message);
        wrap.classList.add('umr-mermaid-err');
        wrap.appendChild(pre.cloneNode(true)); // show code block as fallback
      }
      pre.replaceWith(wrap);
    }
  }

  /* ── RENDER ──────────────────────────────────────────────────── */
  function render(msgEl) {
    if (!parser.fn) return;
    if (isEditing(msgEl)) {
      snapshotBeforeEdit(msgEl);
      unrender(msgEl);
      return;
    }
    if (msgEl.hasAttribute(A_DONE)) {
      const view = msgEl.querySelector('[' + A_VIEW + ']');
      if (!view) {
        msgEl.removeAttribute(A_DONE);
        msgEl.removeAttribute(A_SRC);
      } else {
        const currentSrc = getSourceText(msgEl).slice(0, 100);
        const storedSrc  = msgEl.getAttribute(A_SRC) || '';
        if (currentSrc === storedSrc) return;
        unrender(msgEl);
      }
    }
    const rawText = getSourceText(msgEl);
    if (!rawText) return;
    let html;
    try {
      html = parser.fn(rawText);
    } catch (err) {
      console.warn('[TM-UserMD] parse error:', err.message);
      return;
    }
    const view = document.createElement('div');
    view.setAttribute(A_VIEW, '1');
    view.innerHTML = html;
    view.querySelectorAll('img').forEach(img =>
      img.addEventListener('error', () => { img.style.opacity = '0.3'; }, { once: true })
    );
    msgEl.setAttribute(A_SRC,  rawText.slice(0, 100));
    msgEl.setAttribute(A_DONE, '1');
    msgEl.appendChild(view);

    // ── NEW v2.4.0: async Mermaid rendering (must be post-DOM-insert)
    if (window.mermaid) {
      renderMermaidBlocks(view)
        .catch(e => console.warn('[TM-UserMD] Mermaid:', e.message));
    }

    // After re-render: check for dropped branch history and merge
    const uuid = getMsgUUID(msgEl);
    if (uuid && _editSnapshot?.uuid === uuid) {
      const snap = _editSnapshot;
      _editSnapshot = null;
      setTimeout(() =>
        mergeHistoryAfterEdit(uuid, snap)
          .catch(e => console.warn('[TM-UserMD] merge error:', e.message)),
        120
      );
    }
  }

  /* ── UNRENDER ────────────────────────────────────────────────── */
  function unrender(msgEl) {
    if (!msgEl.hasAttribute(A_DONE)) return;
    const view = msgEl.querySelector('[' + A_VIEW + ']');
    if (view) view.remove();
    msgEl.removeAttribute(A_DONE);
    msgEl.removeAttribute(A_SRC);
  }

  /* ── OBSERVE & ATTACH ────────────────────────────────────────── */
  function processAll(chatArea) {
    chatArea.querySelectorAll(CFG.sel.userMsg).forEach(render);
  }

  const _observed = new WeakSet();

  function observe(chatArea) {
    if (_observed.has(chatArea)) return;
    _observed.add(chatArea);
    let rafId = null;
    new MutationObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => { rafId = null; processAll(chatArea); });
    }).observe(chatArea, {
      childList    : true,
      subtree      : true,
      characterData: true,
    });
  }

  function attach() {
    const ca = document.querySelector(CFG.sel.chatArea);
    if (!ca) return;
    processAll(ca);
    observe(ca);
  }

  function reRenderAll() {
    document.querySelectorAll(`${CFG.sel.userMsg}[${A_DONE}]`)
      .forEach(msg => { unrender(msg); render(msg); });
  }

  // Graph script coordination: force re-render after branch switch
  document.addEventListener('tmg:branchSwitched', () => {
    reRenderAll();
    attach();
  });

  /* ── BOOTSTRAP ───────────────────────────────────────────────── */
  async function boot() {
    injectStyles();

    // ── Stage 1: Markdown (marked.js) ────────────────────────────
    let marked;
    try {
      marked = await loadScript(CFG.cdn.marked, 'marked');
      marked.use({ breaks: true, gfm: true });
    } catch (e) {
      console.error('[TM-UserMD] marked.js failed —', e.message); return;
    }
    parser.fn = text => {
      const tmp = document.createElement('div');
      tmp.innerHTML = marked.parse(text);
      postProcessDom(tmp);
      return tmp.innerHTML;
    };
    attach();
    new MutationObserver(() => attach()).observe(document.body, { childList: true });
    console.info('[TM-UserMD] ✅ v2.4.0 — Markdown ON');

    // ── Stage 2: Math (KaTeX) ─────────────────────────────────────
    injectKatexCss();
    try {
      await loadScript(CFG.cdn.katexJs, 'katex');
      const katex = window.katex;
      parser.fn = text => {
        const tmp = document.createElement('div');
        tmp.innerHTML = parseMixedContent(text, marked, katex);
        postProcessDom(tmp);
        return tmp.innerHTML;
      };
      reRenderAll();
      console.info('[TM-UserMD] ✅ v2.4.0 — Math (KaTeX) ON');
    } catch (e) {
      console.warn('[TM-UserMD] KaTeX not loaded:', e.message);
    }

    // ── Stage 3: Diagrams (Mermaid) — non-blocking ───────────────
    loadScript(CFG.cdn.mermaidJs, 'mermaid')
      .then(mmd => {
        mmd.initialize({
          startOnLoad  : false,
          theme        : 'dark',
          securityLevel: 'antiscript',
          fontFamily   : 'ui-monospace,"Cascadia Code","Fira Code",monospace',
        });
        reRenderAll(); // pick up Mermaid blocks already on screen
        console.info('[TM-UserMD] ✅ v2.4.0 — Mermaid ON');
      })
      .catch(e => console.warn('[TM-UserMD] Mermaid not loaded:', e.message));
  }

  boot();
})();
