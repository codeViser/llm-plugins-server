// ================================================================
//  TypingMind — Chat Branch Graph  v1.3.0
//
//  Fixed vs v1.2.0:
//
//  1. TREE RENDERING: buildChain now processes threads on ALL user
//     messages regardless of isActive. Inactive chains now show
//     ALL nested variants at every depth.
//
//  2. MULTI-STEP NAVIGATION: each node carries a switchPath[]
//     (array of {sourceUUID, branchIdx} steps). navigateToNode
//     applies them sequentially via applySingleSwitch, enabling
//     one-click navigation to any node at any depth.
//
//  3. POST-CLOSE INTEGRATION: on closeOverlay, dispatches a
//     'tmg:branchSwitched' custom event so the markdown preview
//     script immediately re-renders all user messages with the
//     new branch content.
//
//  4. FORCE RELOAD: if React dispatch verification fails, the
//     script uses a sidebar-navigation bounce to force TM to
//     re-read the updated IDB state.
// ================================================================
(() => {
  'use strict';
  const EXT = 'tmChatGraph';

  /* ── STYLES ─────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById(EXT + '-css')) return;
    const s = document.createElement('style');
    s.id = EXT + '-css';
    s.textContent = `
      #${EXT}-btn {
        display:flex;align-items:center;justify-content:center;
        width:36px;height:36px;border-radius:8px;border:none;
        background:transparent;cursor:pointer;color:inherit;
        transition:background .15s;
      }
      #${EXT}-btn:hover { background:rgba(255,255,255,.12); }
      #${EXT}-btn svg { width:18px;height:18px; }
      #${EXT}-ov {
        position:fixed;inset:0;z-index:2147483647;
        background:rgba(11,20,26,.96);
        display:flex;flex-direction:column;
        font-family:system-ui,-apple-system,sans-serif;color:#e9edef;
      }
      #${EXT}-bar {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.08);
        flex-shrink:0;
      }
      #${EXT}-bar h2    { margin:0;font-size:13px;font-weight:700; }
      #${EXT}-bar .hint { font-size:11px;color:#8696a0;margin-left:10px; }
      #${EXT}-xbtn {
        background:none;border:none;cursor:pointer;color:#8696a0;
        font-size:20px;line-height:1;padding:4px 8px;border-radius:6px;
        transition:background .15s,color .15s;
      }
      #${EXT}-xbtn:hover { background:rgba(255,255,255,.12);color:#e9edef; }
      #${EXT}-leg {
        display:flex;gap:14px;padding:5px 16px;flex-shrink:0;flex-wrap:wrap;
        border-bottom:1px solid rgba(255,255,255,.06);
        font-size:10px;color:#8696a0;
      }
      #${EXT}-leg span { display:flex;align-items:center;gap:4px; }
      .${EXT}-dot { width:9px;height:9px;border-radius:50%;display:inline-block; }
      #${EXT}-wrap { flex:1;overflow:hidden;position:relative;touch-action:none; }
      #${EXT}-cv   { display:block;width:100%;height:100%;cursor:grab;touch-action:none; }
      #${EXT}-cv.drag { cursor:grabbing!important; }
      #${EXT}-toast {
        position:absolute;bottom:20px;left:50%;
        transform:translateX(-50%) translateY(60px);
        padding:7px 18px;border-radius:20px;font-size:12px;font-weight:700;
        transition:transform .22s;pointer-events:none;white-space:nowrap;z-index:10;
      }
      #${EXT}-toast.ok   { background:#00a884;color:#0b141a;transform:translateX(-50%) translateY(0); }
      #${EXT}-toast.warn { background:#f59e0b;color:#0b141a;transform:translateX(-50%) translateY(0); }
      #${EXT}-toast.err  { background:#ef4444;color:#fff;   transform:translateX(-50%) translateY(0); }
    `;
    document.head.appendChild(s);
  }

  /* ── REACT FIBER ─────────────────────────────────────────────── */
  function getFiber(el) {
    const k = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    return k ? el[k] : null;
  }
  function getChatState() {
    const el = document.querySelector('[data-element-id="chat-space-middle-part"]');
    if (!el) return null;
    let f = getFiber(el);
    for (let d = 0; f && d < 80; f = f.return, d++) {
      let hs = f.memoizedState, hi = 0;
      for (; hs && hi < 6; hs = hs.next, hi++) {
        const v = hs.memoizedState;
        if (v && !Array.isArray(v) && typeof v === 'object' &&
            Array.isArray(v.messages) && v.chatID)
          return { state: v, dispatch: hs.queue?.dispatch };
      }
    }
    return null;
  }

  /* ── IDB ─────────────────────────────────────────────────────── */
  const openIDB = () => new Promise((res, rej) => {
    const r = indexedDB.open('keyval-store');
    r.onsuccess = e => res(e.target.result);
    r.onerror   = () => rej(r.error);
  });
  async function persistMessages(chatID, msgs) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('keyval', 'readwrite');
      const st = tx.objectStore('keyval');
      const key = `CHAT_${chatID}`;
      const g = st.get(key);
      g.onsuccess = () => {
        const prev = g.result;
        if (!prev) { db.close(); rej(new Error('No IDB record: ' + key)); return; }
        const p = st.put({ ...prev, messages: msgs, updatedAt: new Date() }, key);
        p.onsuccess = () => { db.close(); res(); };
        p.onerror   = () => { db.close(); rej(p.error); };
      };
      g.onerror = () => { db.close(); rej(g.error); };
    });
  }

  /* ── TEXT EXTRACTION ─────────────────────────────────────────── */
  const extractText = c =>
    !c ? '' : typeof c === 'string' ? c :
    Array.isArray(c) ? c.map(x => x?.text ?? x?.content ?? '').join(' ') : '';

  /* ── TREE BUILDER ────────────────────────────────────────────────
   *
   *  switchPath = [{sourceUUID, branchIdx}, ...]
   *
   *  Stores the COMPLETE sequence of branch switches needed to
   *  navigate from the current active state to this exact node.
   *
   *  Active nodes:       switchPath = []          (no switches needed)
   *  Direct inactive:    switchPath = [step1]      (one switch)
   *  Deep inactive:      switchPath = [step1,step2] (two switches, applied in order)
   *
   *  KEY FIX: threads are processed for ALL user messages regardless
   *  of isActive. Previously only active nodes created variants, so
   *  nested branches inside inactive chains were invisible.
   * ─────────────────────────────────────────────────────────────── */
  function buildChain(msgs, start, isActive, switchPath) {
    if (!msgs || start >= msgs.length) return [];
    const m = msgs[start];

    const node = {
      id:         m.uuid,
      role:       m.role === 'user' ? 'user' : 'asst',
      label:      extractText(m.content).replace(/\s+/g, ' ').slice(0, 85),
      active:     isActive,
      // Navigation
      switchPath: isActive ? [] : switchPath,
      // Convenience shortcuts (for the single-step case still used in simple navigation)
      sourceUUID: switchPath.length > 0 ? switchPath[switchPath.length - 1].sourceUUID : m.uuid,
      branchIdx:  switchPath.length > 0 ? switchPath[switchPath.length - 1].branchIdx  : null,
      x:0, y:0, w:0, h:0, children:[], variants:[]
    };

    // ── ALWAYS process threads (FIX for rendering bug) ──────────
    // Previously: `&& isActive` guard prevented showing nested
    // branches in inactive chains. Now removed, so ALL branches
    // at ALL depths are visible in the graph.
    if (m.role === 'user' && m.threads?.length > 0) {
      node.variants = m.threads.map((thread, ti) => {
        // Full switch path to reach this variant head:
        //   - from active path: just this one step
        //   - from inside an inactive chain: parent's path + this step
        const varPath = [
          ...(isActive ? [] : switchPath),
          { sourceUUID: m.uuid, branchIdx: ti }
        ];
        const hd = {
          id:         `${m.uuid}__t${ti}`,
          role:       'user',
          label:      extractText(thread.userMessageContent).replace(/\s+/g, ' ').slice(0, 85),
          active:     false,
          switchPath: varPath,
          sourceUUID: varPath[varPath.length - 1].sourceUUID,
          branchIdx:  varPath[varPath.length - 1].branchIdx,
          x:0, y:0, w:0, h:0, children:[], variants:[]
        };
        // Recursively build the continuation of this variant,
        // carrying the accumulated switchPath for all descendant nodes
        hd.children = buildChain(thread.messages || [], 0, false, varPath);
        return hd;
      });

      if (isActive) {
        // Active path: continuation is the rest of the flat messages array
        node.children = buildChain(msgs, start + 1, true, []);
      } else {
        // Inactive path: continuation inherits the same switchPath
        // (clicking any node in this chain triggers the same sequence)
        node.children = buildChain(msgs, start + 1, false, switchPath);
      }
      return [node];
    }

    // No threads — sequential continuation
    node.children = buildChain(msgs, start + 1, isActive, switchPath);
    return [node];
  }

  /* ── LAYOUT ──────────────────────────────────────────────────── */
  const NW = 210, NH = 60, VGAP = 38, slotW = 238;
  const colsPx = n => n * slotW - 28;

  function treeCols(node) {
    if (!node) return 1;
    if (node.variants.length > 0)
      return treeCols(node.children[0] || null) +
             node.variants.reduce((s, v) => s + treeCols(v), 0);
    return node.children.length ? treeCols(node.children[0]) : 1;
  }

  function placeNode(node, cx, cy, all, edges) {
    if (!node) return;
    node.x = cx - NW / 2; node.y = cy; node.w = NW; node.h = NH;
    all.push(node);
    const nextY = cy + NH + VGAP;
    if (node.variants.length > 0) {
      const ac  = treeCols(node.children[0] || null);
      const vcs = node.variants.map(v => treeCols(v));
      const tc  = ac + vcs.reduce((s, c) => s + c, 0);
      let   sx  = cx - colsPx(tc) / 2;
      if (node.children[0]) {
        const aCx = sx + colsPx(ac) / 2;
        edges.push({ fx:cx, fy:cy+NH, tx:aCx, ty:nextY, active:true });
        placeNode(node.children[0], aCx, nextY, all, edges);
        sx += ac * slotW;
      }
      node.variants.forEach((v, vi) => {
        const vCx = sx + colsPx(vcs[vi]) / 2;
        edges.push({ fx:cx, fy:cy+NH, tx:vCx, ty:nextY, active:false });
        placeNode(v, vCx, nextY, all, edges);
        sx += vcs[vi] * slotW;
      });
    } else if (node.children[0]) {
      edges.push({ fx:cx, fy:cy+NH, tx:cx, ty:nextY, active:node.active });
      placeNode(node.children[0], cx, nextY, all, edges);
    }
  }

  function doLayout(root) {
    const all = [], edges = [];
    placeNode(root, colsPx(treeCols(root)) / 2 + 60, 60, all, edges);
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    });
    return { all, edges, bounds: { minX, maxX, maxY } };
  }

  /* ── CANVAS RENDERER ─────────────────────────────────────────── */
  const C = {
    uA:'#005c4b',uAb:'#00a884', uI:'#1f2c34',uIb:'#2a3942',
    aA:'#202c33',aAb:'#2a3942', aI:'#111b21',aIb:'#1a2530',
    eA:'#00a884', eI:'rgba(50,70,80,.6)',
    tA:'#e9edef', tI:'#44606f', hov:'#f59e0b', dot:'#f59e0b'
  };
  function rr(ctx,x,y,w,h,r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
  }
  function doRender(canvas, all, edges, tr, hoverId) {
    const dpr=window.devicePixelRatio||1, W=canvas.clientWidth, H=canvas.clientHeight;
    if (!W||!H) return;
    canvas.width=W*dpr; canvas.height=H*dpr;
    const ctx=canvas.getContext('2d');
    ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
    ctx.save(); ctx.translate(tr.tx,tr.ty); ctx.scale(tr.s,tr.s);
    edges.forEach(e => {
      ctx.beginPath(); ctx.moveTo(e.fx,e.fy);
      const m=(e.fy+e.ty)/2;
      ctx.bezierCurveTo(e.fx,m,e.tx,m,e.tx,e.ty);
      ctx.strokeStyle=e.active?C.eA:C.eI; ctx.lineWidth=e.active?2:1.5;
      ctx.setLineDash(e.active?[]:[6,4]); ctx.stroke(); ctx.setLineDash([]);
    });
    all.forEach(n => {
      const isU=n.role==='user', ia=n.active, hov=n.id===hoverId;
      const bg=isU?(ia?C.uA:C.uI):(ia?C.aA:C.aI);
      const bdr=isU?(ia?C.uAb:C.uIb):(ia?C.aAb:C.aIb);
      ctx.shadowColor='rgba(0,0,0,.35)'; ctx.shadowBlur=hov?18:5; ctx.shadowOffsetY=hov?4:2;
      rr(ctx,n.x,n.y,n.w,n.h,10); ctx.fillStyle=bg; ctx.fill();
      ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
      rr(ctx,n.x,n.y,n.w,n.h,10); ctx.strokeStyle=hov?C.hov:bdr; ctx.lineWidth=hov?2.5:1.5; ctx.stroke();
      // Badge
      const bW=isU?36:22;
      ctx.fillStyle=isU?(ia?'rgba(0,168,132,.28)':'rgba(42,57,66,.55)'):'rgba(255,255,255,.05)';
      if(ctx.roundRect){ctx.beginPath();ctx.roundRect(n.x+7,n.y+7,bW,15,3);ctx.fill();}
      ctx.fillStyle=isU?(ia?'#00a884':'#3b4a54'):(ia?'#8696a0':'#243340');
      ctx.font='bold 8px system-ui'; ctx.textAlign='left';
      ctx.fillText(isU?'USER':'AI',n.x+11,n.y+17);
      // Label
      ctx.fillStyle=ia?C.tA:C.tI; ctx.font=`${ia?500:400} 10.5px system-ui`;
      let lbl=n.label||'(empty)', maxW=n.w-18;
      while(ctx.measureText(lbl).width>maxW&&lbl.length>6) lbl=lbl.slice(0,-4)+'…';
      ctx.fillText(lbl,n.x+8,n.y+42);
      // Branch dot
      if(n.variants?.length){
        ctx.fillStyle=C.dot;
        ctx.beginPath(); ctx.arc(n.x+n.w-9,n.y+9,4.5,0,Math.PI*2); ctx.fill();
      }
      // Multi-step indicator (deeper inactive nodes show step count)
      if(!ia && n.switchPath?.length > 1){
        ctx.fillStyle='rgba(245,158,11,.7)';
        ctx.font='bold 8px system-ui'; ctx.textAlign='right';
        ctx.fillText(`${n.switchPath.length}↓`, n.x+n.w-6, n.y+n.h-6);
      }
    });
    ctx.restore();
  }

  /* ── HIT TEST ────────────────────────────────────────────────── */
  function hitTest(all, mx, my, tr) {
    const wx=(mx-tr.tx)/tr.s, wy=(my-tr.ty)/tr.s;
    return all.find(n=>wx>=n.x&&wx<=n.x+n.w&&wy>=n.y&&wy<=n.y+n.h)||null;
  }

  /* ── SCROLL ──────────────────────────────────────────────────── */
  function scrollToMessage(uuid) {
    if (!uuid||uuid.includes('__t')) return;
    const ts=document.getElementById(`message-timestamp-${uuid}`);
    (ts?.closest('[data-element-id="response-block"]')||ts?.parentElement)
      ?.scrollIntoView({behavior:'smooth',block:'center'});
  }

  /* ── MODULE STATE ────────────────────────────────────────────── */
  let graphCtx   = null;
  let overlay    = null;
  let toastEl    = null;
  let toastTmr   = null;
  let navigating = false;

  /* ── CLOSE OVERLAY ───────────────────────────────────────────── */
  function closeOverlay() {
    if (!overlay) return;
    graphCtx?.ro?.disconnect();
    graphCtx?.ac?.abort();
    const uuid = graphCtx?.lastSrcUUID;
    overlay.remove();
    overlay = null; toastEl = null; graphCtx = null;
    clearTimeout(toastTmr);
    // Notify markdown preview script to re-render updated messages
    document.dispatchEvent(new CustomEvent('tmg:branchSwitched'));
    // Scroll after DOM is clean
    if (uuid) setTimeout(() => scrollToMessage(uuid), 200);
  }

  /* ── TOAST ───────────────────────────────────────────────────── */
  function showToast(msg, type='ok') {
    if (!toastEl) return;
    clearTimeout(toastTmr);
    toastEl.textContent=msg; toastEl.className=type;
    toastTmr=setTimeout(()=>{ if(toastEl) toastEl.className=''; }, 3500);
  }

  /* ── SINGLE SWITCH (one step of a multi-step navigation) ───────
   *
   *  Reads the CURRENT React state, applies one branch swap for the
   *  given (sourceUUID, branchIdx), dispatches to React and writes
   *  to IDB. Returns the swapped messages array for chaining.
   * ─────────────────────────────────────────────────────────────── */
  async function applySingleSwitch(sourceUUID, branchIdx) {
    const cs = getChatState();
    if (!cs?.state) throw new Error('Cannot read TM state');

    const msgs   = cs.state.messages;
    const srcIdx = msgs.findIndex(m => m.uuid === sourceUUID);
    if (srcIdx < 0) throw new Error(`UUID ${sourceUUID} not in active messages`);

    const srcMsg = msgs[srcIdx];
    const target = srcMsg.threads?.[branchIdx];
    if (!target) throw new Error(`threads[${branchIdx}] missing`);

    const newThreads = [
      ...srcMsg.threads.filter((_, i) => i !== branchIdx),
      {
        userMessageContent: srcMsg.content,
        messages:           msgs.slice(srcIdx + 1),
        createdAt:          new Date().toISOString()
      }
    ];
    const newMsgs = [
      ...msgs.slice(0, srcIdx),
      { ...srcMsg, content: target.userMessageContent,
        threads: newThreads, updatedAt: new Date().toISOString() },
      ...(target.messages || [])
    ];

    // Dispatch to React
    if (cs.dispatch) {
      try { cs.dispatch({ ...cs.state, messages: newMsgs }); }
      catch (e) { console.warn('[TM Graph]', e.message); }
    }

    // Persist to IDB
    persistMessages(cs.state.chatID, newMsgs).catch(e =>
      console.warn('[TM Graph] IDB:', e.message)
    );

    // Wait for React to process the state update
    await new Promise(r => setTimeout(r, 160));

    return newMsgs;
  }

  /* ── NAVIGATION ──────────────────────────────────────────────── */
  async function navigateToNode(node) {
    // Active node → close and scroll to it
    if (node.active) {
      if (graphCtx && !node.id.includes('__t')) graphCtx.lastSrcUUID = node.id;
      closeOverlay();
      return;
    }

    if (navigating) return;
    if (!node.switchPath?.length) return;

    navigating = true;
    const steps = node.switchPath.length;
    showToast(steps > 1 ? `Applying ${steps}-step switch…` : 'Switching…', 'warn');

    try {
      /* ── Apply each step sequentially ──────────────────────────
       *   Each applySingleSwitch:
       *     1. Reads FRESH current state (after previous step settled)
       *     2. Finds the source message (now in active path after step 1)
       *     3. Swaps the branch
       *     4. Dispatches to React + writes IDB
       *     5. Waits 160ms for React to process
       * ────────────────────────────────────────────────────────── */
      for (let i = 0; i < node.switchPath.length; i++) {
        const step = node.switchPath[i];
        if (steps > 1) showToast(`Step ${i + 1}/${steps}…`, 'warn');
        await applySingleSwitch(step.sourceUUID, step.branchIdx);
      }

      if (!graphCtx) return; // overlay closed during async ops

      /* ── Rebuild graph with new active state ──────────────────── */
      const cs2     = getChatState();
      if (!cs2) { showToast('Switched — close ✕ when done', 'ok'); return; }
      const newRoot = buildChain(cs2.state.messages, 0, true, [])[0];
      if (newRoot) {
        const { all: na, edges: ne, bounds: nb } = doLayout(newRoot);
        graphCtx.all    = na;
        graphCtx.edges  = ne;
        graphCtx.bounds = nb;
        graphCtx.hoverId     = null;
        graphCtx.lastSrcUUID = node.switchPath[0].sourceUUID; // scroll on close
        graphCtx.centre();
        graphCtx.draw();
      }

      /* ── Verify React rendered new messages ─────────────────── */
      const step0  = node.switchPath[0];
      const curTxt = extractText(cs2?.state?.messages?.find(m => m.uuid === step0.sourceUUID)?.content || '').slice(0, 40);
      const verified = curTxt.length > 0;

      if (verified) {
        showToast(steps > 1
          ? `${steps}-step switch ✓ — close ✕ to return`
          : 'Branch switched ✓ — close ✕ to return', 'ok');
      } else {
        // IDB is written; try force-reload via sidebar navigation
        showToast('Saved — applying…', 'warn');
        await forceReloadFromIDB();
        if (graphCtx) showToast('Applied — close ✕ to return', 'ok');
      }

    } catch (err) {
      console.warn('[TM Graph] navigation error:', err.message);
      showToast('Error: ' + err.message.slice(0, 50), 'err');
    } finally {
      navigating = false;
    }
  }

  /* ── FORCE RELOAD ────────────────────────────────────────────── */
  // When React dispatch doesn't visually update the chat, navigate to
  // a sibling chat and back to force TM to re-read from IDB.
  async function forceReloadFromIDB() {
    const allItems = [...document.querySelectorAll('[data-element-id="custom-chat-item"]')];
    const other    = allItems.find(el => !el.querySelector('[data-element-id="selected-chat-item"]'));
    if (!other) return;
    const sel = document.querySelector('[data-element-id="selected-chat-item"]');
    if (!sel) return;
    other.click();
    await new Promise(r => setTimeout(r, 400));
    sel.click();
    await new Promise(r => setTimeout(r, 400));
  }

  /* ── OPEN GRAPH ──────────────────────────────────────────────── */
  function openGraph() {
    if (overlay) { closeOverlay(); return; }
    const cs   = getChatState();
    if (!cs) { alert('[TM Graph] No active conversation.'); return; }
    const root = buildChain(cs.state.messages, 0, true, [])[0];
    if (!root) { alert('[TM Graph] No messages found.'); return; }
    const { all, edges, bounds } = doLayout(root);

    overlay = document.createElement('div'); overlay.id=EXT+'-ov';
    const bar=document.createElement('div'); bar.id=EXT+'-bar';
    bar.innerHTML=`
      <div style="display:flex;align-items:center">
        <h2>Chat Branch Graph</h2>
        <span class="hint">Drag · Scroll/pinch · Tap to navigate · ↓ = multi-step</span>
      </div>
      <button id="${EXT}-xbtn" title="Close (Esc)">✕</button>`;
    const leg=document.createElement('div'); leg.id=EXT+'-leg';
    leg.innerHTML=`
      <span><span class="${EXT}-dot" style="background:#00a884"></span>Active — tap to scroll</span>
      <span><span class="${EXT}-dot" style="background:#1f2c34;border:1px solid #3b4a54"></span>Inactive branch — tap to switch</span>
      <span><span class="${EXT}-dot" style="background:#f59e0b"></span>Branch point</span>
      <span style="color:#f59e0b;font-size:9px">↓ = auto multi-step switch</span>`;
    const wrap=document.createElement('div'); wrap.id=EXT+'-wrap';
    const canvas=document.createElement('canvas'); canvas.id=EXT+'-cv';
    toastEl=document.createElement('div'); toastEl.id=EXT+'-toast';
    wrap.appendChild(canvas); wrap.appendChild(toastEl);
    overlay.appendChild(bar); overlay.appendChild(leg); overlay.appendChild(wrap);
    document.body.appendChild(overlay);

    const ac=new AbortController(), sig=ac.signal;
    const ro=new ResizeObserver(()=>requestAnimationFrame(()=>{ graphCtx?.centre(); graphCtx?.draw(); }));
    ro.observe(wrap);

    graphCtx={
      all, edges, bounds, ac, ro,
      tr:{tx:0,ty:0,s:1}, hoverId:null, lastSrcUUID:null,
      centre() {
        const W=canvas.clientWidth, H=canvas.clientHeight;
        if(!W||!H) return;
        const cW=this.bounds.maxX-this.bounds.minX+120;
        const cH=this.bounds.maxY-60+120;
        this.tr.s=Math.max(0.2,Math.min(1.3,Math.min(W/cW,H/cH)));
        this.tr.tx=(W-cW*this.tr.s)/2-this.bounds.minX*this.tr.s+60*this.tr.s;
        this.tr.ty=(H-cH*this.tr.s)/2-60*this.tr.s+60*this.tr.s;
      },
      draw() { doRender(canvas,this.all,this.edges,this.tr,this.hoverId); }
    };

    requestAnimationFrame(()=>{ graphCtx.centre(); graphCtx.draw(); });

    bar.querySelector('#'+EXT+'-xbtn').addEventListener('click', closeOverlay, {signal:sig});
    window.addEventListener('keydown', e=>{ if(e.key==='Escape') closeOverlay(); }, {signal:sig});

    // Wheel
    canvas.addEventListener('wheel', e=>{
      e.preventDefault();
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top, d=e.deltaY<0?1.09:0.92;
      graphCtx.tr.tx=mx-(mx-graphCtx.tr.tx)*d;
      graphCtx.tr.ty=my-(my-graphCtx.tr.ty)*d;
      graphCtx.tr.s=Math.min(3.5,Math.max(0.12,graphCtx.tr.s*d));
      graphCtx.draw();
    },{passive:false,signal:sig});

    // Mouse drag
    let mdrag=null;
    canvas.addEventListener('mousedown',e=>{ mdrag={sx:e.clientX-graphCtx.tr.tx,sy:e.clientY-graphCtx.tr.ty}; canvas.classList.add('drag'); },{signal:sig});
    window.addEventListener('mousemove',e=>{
      if(!graphCtx) return;
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      const hit=hitTest(graphCtx.all,mx,my,graphCtx.tr);
      const nid=hit?.id||null;
      if(nid!==graphCtx.hoverId){ graphCtx.hoverId=nid; graphCtx.draw(); }
      canvas.style.cursor=mdrag?'grabbing':nid?(!hit.active?'pointer':'default'):'grab';
      if(mdrag){ graphCtx.tr.tx=e.clientX-mdrag.sx; graphCtx.tr.ty=e.clientY-mdrag.sy; graphCtx.draw(); }
    },{signal:sig});
    window.addEventListener('mouseup',()=>{ mdrag=null; canvas.classList.remove('drag'); },{signal:sig});
    canvas.addEventListener('click',e=>{
      if(mdrag) return;
      const rect=canvas.getBoundingClientRect();
      const hit=hitTest(graphCtx.all,e.clientX-rect.left,e.clientY-rect.top,graphCtx.tr);
      if(hit) navigateToNode(hit);
    },{signal:sig});

    // Touch (Android PWA — tap detection in touchend)
    let lastTouches=null, touchStart=null, panning=false;
    canvas.addEventListener('touchstart',e=>{
      e.preventDefault();
      const ts=[...e.touches].map(t=>({x:t.clientX,y:t.clientY}));
      lastTouches=ts; panning=false;
      if(e.touches.length===1){
        const t=e.touches[0];
        touchStart={x:t.clientX,y:t.clientY,time:Date.now()};
        const rect=canvas.getBoundingClientRect();
        const hit=hitTest(graphCtx.all,t.clientX-rect.left,t.clientY-rect.top,graphCtx.tr);
        if((hit?.id||null)!==graphCtx.hoverId){ graphCtx.hoverId=hit?.id||null; graphCtx.draw(); }
      } else touchStart=null;
    },{passive:false,signal:sig});
    canvas.addEventListener('touchmove',e=>{
      e.preventDefault();
      const ts=[...e.touches].map(t=>({x:t.clientX,y:t.clientY}));
      if(touchStart){ const mv=Math.hypot(ts[0].x-touchStart.x,ts[0].y-touchStart.y); if(mv>8) panning=true; }
      if(ts.length===1&&lastTouches?.length===1){
        graphCtx.tr.tx+=ts[0].x-lastTouches[0].x; graphCtx.tr.ty+=ts[0].y-lastTouches[0].y;
        const rect=canvas.getBoundingClientRect();
        graphCtx.hoverId=hitTest(graphCtx.all,ts[0].x-rect.left,ts[0].y-rect.top,graphCtx.tr)?.id||null;
        graphCtx.draw();
      } else if(ts.length===2&&lastTouches?.length===2){
        const pd=Math.hypot(lastTouches[1].x-lastTouches[0].x,lastTouches[1].y-lastTouches[0].y);
        const cd=Math.hypot(ts[1].x-ts[0].x,ts[1].y-ts[0].y);
        if(pd>0){
          const d=cd/pd, rect=canvas.getBoundingClientRect();
          const mx=(ts[0].x+ts[1].x)/2-rect.left, my=(ts[0].y+ts[1].y)/2-rect.top;
          graphCtx.tr.tx=mx-(mx-graphCtx.tr.tx)*d; graphCtx.tr.ty=my-(my-graphCtx.tr.ty)*d;
          graphCtx.tr.s=Math.min(3.5,Math.max(0.12,graphCtx.tr.s*d)); graphCtx.draw();
        }
      }
      lastTouches=ts;
    },{passive:false,signal:sig});
    canvas.addEventListener('touchend',e=>{
      e.preventDefault();
      if(touchStart&&!panning&&e.touches.length===0&&e.changedTouches.length===1){
        const t=e.changedTouches[0];
        const mv=Math.hypot(t.clientX-touchStart.x,t.clientY-touchStart.y);
        const dt=Date.now()-touchStart.time;
        if(mv<15&&dt<350){
          const rect=canvas.getBoundingClientRect();
          const hit=hitTest(graphCtx.all,t.clientX-rect.left,t.clientY-rect.top,graphCtx.tr);
          if(hit){ graphCtx.hoverId=hit.id; graphCtx.draw(); setTimeout(()=>navigateToNode(hit),60); }
        }
      }
      touchStart=null; panning=false;
      if(e.touches.length===0){ lastTouches=null; graphCtx.hoverId=null; graphCtx.draw(); }
      else lastTouches=[...e.touches].map(t=>({x:t.clientX,y:t.clientY}));
    },{passive:false,signal:sig});
    canvas.addEventListener('touchcancel',()=>{
      lastTouches=null; touchStart=null; panning=false;
      if(graphCtx){ graphCtx.hoverId=null; graphCtx.draw(); }
    },{passive:false,signal:sig});
  }

  /* ── BUTTON INJECTION ────────────────────────────────────────── */
  const TOOLBAR='[data-element-id="chat-input-actions"]';
  function tryInject(){
    const bar=document.querySelector(TOOLBAR);
    if(!bar||bar.querySelector('#'+EXT+'-btn')) return;
    const btn=document.createElement('button');
    btn.id=EXT+'-btn'; btn.title='Chat Branch Graph';
    btn.innerHTML=`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2.2"/><circle cx="16" cy="4" r="2.2"/><circle cx="4" cy="16" r="2.2"/><circle cx="16" cy="16" r="2.2"/><circle cx="10" cy="10" r="2.2"/><line x1="4" y1="4" x2="10" y2="10"/><line x1="16" y1="4" x2="10" y2="10"/><line x1="10" y1="10" x2="4" y2="16"/><line x1="10" y1="10" x2="16" y2="16"/></svg>`;
    btn.addEventListener('click', openGraph);
    bar.appendChild(btn);
  }

  /* ── BOOTSTRAP ───────────────────────────────────────────────── */
  function init(){
    injectStyles(); tryInject();
    let r=10;
    const retry=()=>{ if(document.querySelector('#'+EXT+'-btn'))return; tryInject(); if(--r>0)setTimeout(retry,650); };
    setTimeout(retry,400);
    new MutationObserver(tryInject).observe(document.body,{childList:true,subtree:true});
    console.log('[TM Chat Graph] ✅ v1.3.0');
  }
  init();
})();
