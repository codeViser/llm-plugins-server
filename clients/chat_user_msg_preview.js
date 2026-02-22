// ============================================================
//  TypingMind — User Message Markdown + Math Renderer
//  Version : 2.3.1
//
//  What changed vs 2.3.0:
//  ─────────────────────────────────────────────────────────
//  FIX: Ordered (numbered) and unordered (bulleted) list
//  markers were not rendering. Root cause: TypingMind's
//  Tailwind CSS Preflight resets `list-style: none` globally
//  for all ol/ul elements. The extension restored padding &
//  margin but never restored list-style-type.
//
//  Added explicit list-style-type declarations for:
//    • ol  → decimal    (level 1 ordered)
//    • ul  → disc       (level 1 unordered)
//    • Nested ol/ul combinations up to 3 levels deep
//      (cross-nested: ol>ul, ul>ol, etc.)
//  Uses descendant selectors — inherently recursive, so lists
//  inside <td>, <blockquote>, or any nesting depth are covered
//  without additional rules. Cross-platform (browser/PWA/
//  Android WebView): all properties have universal support.
//
//  Everything from v2.3.0 is preserved without structural
//  change. Only injectStyles() was modified.
//  ─────────────────────────────────────────────────────────
//  v2.3.0 — Branch history preservation (snapshotBeforeEdit /
//  mergeHistoryAfterEdit), getSourceText() [A_VIEW] exclusion,
//  data-umr-src fingerprint, characterData observer,
//  tmg:branchSwitched listener — all retained.
// ============================================================

(() => {
  'use strict';

  const CFG = {
    cdn: {
      marked  : 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js',
      katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
      katexJs : 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
    },
    sel: {
      chatArea    : '[data-element-id="chat-space-middle-part"]',
      userMsg     : '[data-element-id="user-message"]',
      responseBlk : '[data-element-id="response-block"]',
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
    `;
    document.head.appendChild(s);
  }

  /* ── LOADERS ─────────────────────────────────────────────────── */
  function injectKatexCss() {
    if (document.getElementById('umr-katex-css')) return;
    const l=document.createElement('link');
    l.id='umr-katex-css'; l.rel='stylesheet'; l.href=CFG.cdn.katexCss;
    document.head.appendChild(l);
  }
  function loadScript(src, globalKey) {
    return new Promise((res, rej) => {
      if (globalKey && window[globalKey]) { res(window[globalKey]); return; }
      const s=document.createElement('script');
      s.src=src;
      s.onload=()=>res(globalKey?window[globalKey]:true);
      s.onerror=()=>rej(new Error('[TM-UserMD] Failed: '+src));
      document.head.appendChild(s);
    });
  }

  /* ── REACT FIBER & IDB HELPERS (for branch history preservation) */
  function umrGetChatState() {
    const el=document.querySelector('[data-element-id="chat-space-middle-part"]');
    if (!el) return null;
    const fk=Object.keys(el).find(k=>k.startsWith('__reactFiber'));
    if (!fk) return null;
    let f=el[fk];
    for (let d=0; f&&d<80; f=f.return,d++) {
      let hs=f.memoizedState, hi=0;
      for (; hs&&hi<6; hs=hs.next,hi++) {
        const v=hs.memoizedState;
        if (v&&!Array.isArray(v)&&typeof v==='object'&&Array.isArray(v.messages)&&v.chatID)
          return { state:v, dispatch:hs.queue?.dispatch };
      }
    }
    return null;
  }

  const umrOpenIDB = () => new Promise((res,rej)=>{
    const r=indexedDB.open('keyval-store');
    r.onsuccess=e=>res(e.target.result); r.onerror=()=>rej(r.error);
  });
  async function umrPersistMessages(chatID, msgs) {
    const db=await umrOpenIDB();
    return new Promise((res,rej)=>{
      const tx=db.transaction('keyval','readwrite'), st=tx.objectStore('keyval');
      const key=`CHAT_${chatID}`, g=st.get(key);
      g.onsuccess=()=>{
        const prev=g.result;
        if (!prev){ db.close(); res(); return; } // new chat not yet in IDB — skip
        const p=st.put({...prev,messages:msgs,updatedAt:new Date()},key);
        p.onsuccess=()=>{ db.close(); res(); };
        p.onerror=()=>{ db.close(); rej(p.error); };
      };
      g.onerror=()=>{ db.close(); rej(g.error); };
    });
  }

  /* ── POST PROCESS ────────────────────────────────────────────── */
  function postProcessDom(root) {
    root.querySelectorAll('table').forEach(tbl=>{
      const w=document.createElement('div'); w.className='umr-table-wrap';
      tbl.parentNode.insertBefore(w,tbl); w.appendChild(tbl);
    });
    root.querySelectorAll('a[href]').forEach(a=>{
      if(/^https?:\/\//i.test(a.getAttribute('href')||'')){
        a.setAttribute('target','_blank'); a.setAttribute('rel','noopener noreferrer');
      }
    });
    root.querySelectorAll('img').forEach(img=>img.setAttribute('loading','lazy'));
  }

  /* ── MATH ────────────────────────────────────────────────────── */
  function parseMixedContent(rawText, marked, katex) {
    const rnd=Math.random().toString(36).slice(2,10);
    const MTOK=`UMRmath${rnd}`, CTOK=`UMRcode${rnd}`;
    const mathStore=[], codeStore=[];
    let t=rawText;
    t=t.replace(/(`{3,}|~{3,})([^\n]*\n[\s\S]*?)\1/g,m=>{ const i=codeStore.length; codeStore.push(m); return `${CTOK}${i}`; })
       .replace(/`([^`\n]+)`/g,m=>{ const i=codeStore.length; codeStore.push(m); return `${CTOK}${i}`; });
    t=t.replace(/((?:^|\n)[ \t>]*)\$\$((?:[^$]|\$(?!\$))*?)\$\$([ \t]*(?=\n|$))/g,(_,b,f,a)=>{
      const i=mathStore.length; mathStore.push(katexRender(katex,f.trim(),true));
      return `${b}${MTOK}D${i}${a}`;
    });
    t=t.replace(/\$\$((?:[^$]|\$(?!\$))*?)\$\$/g,(_,f)=>{
      const i=mathStore.length; mathStore.push(katexRender(katex,f.trim(),false));
      return `${MTOK}I${i}`;
    });
    t=t.replace(new RegExp(`${CTOK}(\\d+)`,'g'),(_,i)=>codeStore[parseInt(i)]);
    let html=marked.parse(t);
    html=html.replace(new RegExp(`\n\\s*${MTOK}D(\\d+)\\s*\n\n`,'g'),(_,i)=>mathStore[parseInt(i)])
             .replace(new RegExp(`${MTOK}[DI](\\d+)`,'g'),(_,i)=>mathStore[parseInt(i)]);
    return html;
  }
  function katexRender(katex, formula, displayMode) {
    try { return katex.renderToString(formula,{displayMode,throwOnError:false}); }
    catch(e){ const tag=displayMode?'div':'span'; return `<${tag} class="umr-math-err">$$${formula}$$`; }
  }
  const extractText = c =>
    !c?'':typeof c==='string'?c:Array.isArray(c)?c.map(x=>x?.text??x?.content??'').join(' '):'';

  /* ── EDIT DETECTION ──────────────────────────────────────────── */
  function isEditing(msgEl) {
    if (msgEl.querySelector('textarea')) return true;
    const rb=msgEl.closest(CFG.sel.responseBlk);
    return rb ? !!rb.querySelector('textarea') : false;
  }

  /* ── SOURCE TEXT ─────────────────────────────────────────────── */
  function getSourceText(msgEl) {
    let text='';
    for (const child of msgEl.childNodes) {
      if (child.nodeType===Node.ELEMENT_NODE&&child.hasAttribute(A_VIEW)) continue;
      text+=child.textContent;
    }
    return text.trim();
  }

  /* ── MESSAGE UUID HELPER ─────────────────────────────────────── */
  function getMsgUUID(msgEl) {
    const rb=msgEl.closest('[data-element-id="response-block"]');
    const btn=rb?.querySelector('button[id^="message-timestamp-"]');
    return btn?.id?.replace('message-timestamp-','') || null;
  }

  /* ── BRANCH HISTORY PRESERVATION ────────────────────────────────
   *
   *  TM's own edit flow REPLACES threads[] with a single entry
   *  (the immediate predecessor) on every new edit. After n edits,
   *  only v(n) [active] and v(n-1) [in threads] remain — all
   *  earlier versions are silently lost.
   *
   *  Fix: snapshot the full threads structure BEFORE the edit
   *  executes. After the edit completes and render() re-runs,
   *  compare the new threads with the snapshot and restore any
   *  entries that TM dropped.
   * ─────────────────────────────────────────────────────────────── */
  let _editSnapshot = null; // { uuid, chatID, existingThreads }

  function snapshotBeforeEdit(msgEl) {
    const uuid = getMsgUUID(msgEl);
    if (!uuid) return;

    // If a different message starts editing, discard the old snapshot
    if (_editSnapshot && _editSnapshot.uuid !== uuid) _editSnapshot = null;
    if (_editSnapshot?.uuid === uuid) return; // already snapshotted

    const cs = umrGetChatState();
    if (!cs?.state) return;

    const msg = cs.state.messages.find(m => m.uuid === uuid);
    if (!msg) return;

    _editSnapshot = {
      uuid,
      chatID:          cs.state.chatID,
      existingThreads: JSON.parse(JSON.stringify(msg.threads || []))
    };
  }

  async function mergeHistoryAfterEdit(uuid, snap) {
    if (!snap.existingThreads.length) return; // nothing to preserve

    const cs = umrGetChatState();
    if (!cs?.state) return;

    const msg = cs.state.messages.find(m => m.uuid === uuid);
    if (!msg) return;

    // Build a set of content fingerprints currently in threads
    const nowKeys = new Set(
      (msg.threads || []).map(t => extractText(t.userMessageContent).trim().slice(0, 60))
    );

    // Find threads that existed before but TM dropped on this edit
    const lostThreads = snap.existingThreads.filter(t =>
      !nowKeys.has(extractText(t.userMessageContent).trim().slice(0, 60))
    );

    if (!lostThreads.length) return; // TM preserved everything — nothing to merge

    const mergedMsg   = { ...msg, threads: [...(msg.threads || []), ...lostThreads] };
    const newMessages = cs.state.messages.map(m => m.uuid === uuid ? mergedMsg : m);
    const newState    = { ...cs.state, messages: newMessages };

    // Update React state immediately for correct graph display
    if (cs.dispatch) {
      try { cs.dispatch(newState); }
      catch (e) { console.warn('[TM-UserMD] dispatch:', e.message); }
    }

    // Persist to IDB for durability across reloads
    await umrPersistMessages(snap.chatID, newMessages);

    console.info(`[TM-UserMD] Branch history merged: ${lostThreads.length} version(s) preserved for ${uuid}`);
  }

  /* ── RENDER ──────────────────────────────────────────────────── */
  function render(msgEl) {
    if (!parser.fn) return;

    if (isEditing(msgEl)) {
      // Snapshot full thread history BEFORE TM overwrites it on submit
      snapshotBeforeEdit(msgEl);
      unrender(msgEl);
      return;
    }

    if (msgEl.hasAttribute(A_DONE)) {
      const view = msgEl.querySelector('[' + A_VIEW + ']');
      if (!view) {
        // View removed by React reconciliation → reset and re-render
        msgEl.removeAttribute(A_DONE);
        msgEl.removeAttribute(A_SRC);
      } else {
        // Content-change detection (v2.2.0 fix preserved):
        // If underlying message text changed (e.g., after branch switch),
        // the stored fingerprint won't match → unrender and re-render.
        const currentSrc = getSourceText(msgEl).slice(0, 100);
        const storedSrc  = msgEl.getAttribute(A_SRC) || '';
        if (currentSrc === storedSrc) return; // unchanged
        unrender(msgEl); // stale view — fall through to fresh render
      }
    }

    const rawText = getSourceText(msgEl);
    if (!rawText) return;

    let html;
    try { html = parser.fn(rawText); }
    catch (err) { console.warn('[TM-UserMD] parse error:', err.message); return; }

    const view = document.createElement('div');
    view.setAttribute(A_VIEW, '1');
    view.innerHTML = html;
    view.querySelectorAll('img').forEach(img =>
      img.addEventListener('error', () => { img.style.opacity='0.3'; }, { once:true })
    );

    msgEl.setAttribute(A_SRC, rawText.slice(0, 100));
    msgEl.setAttribute(A_DONE, '1');
    msgEl.appendChild(view);

    // After a successful re-render: check if this message was just edited
    // and if TM dropped any branch history. Merge asynchronously.
    const uuid = getMsgUUID(msgEl);
    if (uuid && _editSnapshot?.uuid === uuid) {
      const snap = _editSnapshot;
      _editSnapshot = null;
      // Use setTimeout to let TM fully commit its state before we merge
      setTimeout(() => mergeHistoryAfterEdit(uuid, snap).catch(e =>
        console.warn('[TM-UserMD] merge error:', e.message)
      ), 120);
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
      rafId = requestAnimationFrame(() => { rafId=null; processAll(chatArea); });
    }).observe(chatArea, {
      childList:     true,
      subtree:       true,
      characterData: true, // catch React's in-place text node updates
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

    let marked;
    try {
      marked = await loadScript(CFG.cdn.marked, 'marked');
      marked.use({ breaks:true, gfm:true });
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
    new MutationObserver(() => attach()).observe(document.body, { childList:true });
    console.info('[TM-UserMD] ✅ v2.3.1 — Markdown ON');

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
      console.info('[TM-UserMD] ✅ v2.3.1 — Math (KaTeX) ON');
    } catch (e) {
      console.warn('[TM-UserMD] KaTeX not loaded:', e.message);
    }
  }

  boot();
})();
