// ================================================================
//  TypingMind — Chat Branch Graph  v1.4.0
//
//  Fixed vs v1.3.0:
//
//  BUG 1: Verification check `curTxt.length > 0` was always true
//    (any non-empty message content passes), so forceReload was
//    NEVER triggered. React dispatch silently fails to commit to
//    the DOM in React 18 concurrent mode, leaving old messages
//    visible until a manual reload.
//
//  BUG 2: forceReloadFromIDB stored `selected-chat-item` before
//    clicking away, but after other.click() TM moves that element
//    into the other chat's DOM. The stored reference then pointed
//    to the wrong chat, so navigation never returned to original.
//
//  FIXES:
//  1. applySingleSwitch now reads from + writes to IDB only.
//     No React dispatch dependency — IDB is the single source
//     of truth. Multi-step switches always read the committed
//     result of the previous step.
//  2. forceReloadCurrentChat stores the parent custom-chat-item
//     element (not selected-chat-item) BEFORE clicking away.
//     After clicking another chat, it clicks the stored parent
//     reference directly — not a re-query that finds the wrong el.
//  3. Force reload is now UNCONDITIONAL: always applied after
//     IDB writes, no weak verification gating it.
//  4. getChatState() is used only for chatID extraction and for
//     the post-reload graph rebuild — never for branch data.
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

  /* ── REACT FIBER (used only for chatID + post-reload rebuild) ── */
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
          return { state: v };
      }
    }
    return null;
  }

  /* ── IDB — primary data layer ────────────────────────────────── */
  const openIDB = () => new Promise((res, rej) => {
    const r = indexedDB.open('keyval-store');
    r.onsuccess = e => res(e.target.result);
    r.onerror   = () => rej(r.error);
  });

  /** Read messages array from IDB — source of truth for branch ops */
  async function readMessagesFromIDB(chatID) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('keyval', 'readonly');
      const st = tx.objectStore('keyval');
      const g  = st.get(`CHAT_${chatID}`);
      g.onsuccess = () => { db.close(); res(g.result?.messages ?? null); };
      g.onerror   = () => { db.close(); rej(g.error); };
    });
  }

  /** Write updated messages back to IDB, preserving all other chat fields */
  async function writeMessagesToIDB(chatID, msgs) {
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

  /* ── TREE BUILDER ────────────────────────────────────────────── */
  //  switchPath = [{sourceUUID, branchIdx}, …]
  //  Complete sequence of branch switches to reach this node.
  //  Active nodes: []   Direct inactive: [step1]   Deep: [step1,step2,…]
  function buildChain(msgs, start, isActive, switchPath) {
    if (!msgs || start >= msgs.length) return [];
    const m = msgs[start];
    const node = {
      id:         m.uuid,
      role:       m.role === 'user' ? 'user' : 'asst',
      label:      extractText(m.content).replace(/\s+/g, ' ').slice(0, 85),
      active:     isActive,
      switchPath: isActive ? [] : switchPath,
      sourceUUID: switchPath.length > 0 ? switchPath[switchPath.length - 1].sourceUUID : m.uuid,
      branchIdx:  switchPath.length > 0 ? switchPath[switchPath.length - 1].branchIdx  : null,
      x:0, y:0, w:0, h:0, children:[], variants:[]
    };

    // Always process threads at every depth (fix from v1.3.0)
    if (m.role === 'user' && m.threads?.length > 0) {
      node.variants = m.threads.map((thread, ti) => {
        const varPath = [
          ...(isActive ? [] : switchPath),
          { sourceUUID: m.uuid, branchIdx: ti }
        ];
        const hd = {
          id: `${m.uuid}__t${ti}`, role: 'user',
          label: extractText(thread.userMessageContent).replace(/\s+/g, ' ').slice(0, 85),
          active: false, switchPath: varPath,
          sourceUUID: varPath[varPath.length - 1].sourceUUID,
          branchIdx:  varPath[varPath.length - 1].branchIdx,
          x:0, y:0, w:0, h:0, children:[], variants:[]
        };
        hd.children = buildChain(thread.messages || [], 0, false, varPath);
        return hd;
      });
      node.children = isActive
        ? buildChain(msgs, start + 1, true, [])
        : buildChain(msgs, start + 1, false, switchPath);
      return [node];
    }

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
      const bW=isU?36:22;
      ctx.fillStyle=isU?(ia?'rgba(0,168,132,.28)':'rgba(42,57,66,.55)'):'rgba(255,255,255,.05)';
      if(ctx.roundRect){ctx.beginPath();ctx.roundRect(n.x+7,n.y+7,bW,15,3);ctx.fill();}
      ctx.fillStyle=isU?(ia?'#00a884':'#3b4a54'):(ia?'#8696a0':'#243340');
      ctx.font='bold 8px system-ui'; ctx.textAlign='left';
      ctx.fillText(isU?'USER':'AI',n.x+11,n.y+17);
      ctx.fillStyle=ia?C.tA:C.tI; ctx.font=`${ia?500:400} 10.5px system-ui`;
      let lbl=n.label||'(empty)', maxW=n.w-18;
      while(ctx.measureText(lbl).width>maxW&&lbl.length>6) lbl=lbl.slice(0,-4)+'…';
      ctx.fillText(lbl,n.x+8,n.y+42);
      if(n.variants?.length){
        ctx.fillStyle=C.dot;
        ctx.beginPath(); ctx.arc(n.x+n.w-9,n.y+9,4.5,0,Math.PI*2); ctx.fill();
      }
      if(!ia && n.switchPath?.length > 1){
        ctx.fillStyle='rgba(245,158,11,.75)'; ctx.font='bold 8px system-ui'; ctx.textAlign='right';
        ctx.fillText(`${n.switchPath.length}↓`,n.x+n.w-6,n.y+n.h-6);
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
    document.dispatchEvent(new CustomEvent('tmg:branchSwitched'));
    if (uuid) setTimeout(() => scrollToMessage(uuid), 200);
  }

  /* ── TOAST ───────────────────────────────────────────────────── */
  function showToast(msg, type='ok') {
    if (!toastEl) return;
    clearTimeout(toastTmr);
    toastEl.textContent=msg; toastEl.className=type;
    toastTmr=setTimeout(()=>{ if(toastEl) toastEl.className=''; }, 3500);
  }

  /* ── IDB-PRIMARY SINGLE SWITCH ───────────────────────────────────
   *
   *  Reads current messages from IDB (not React fiber).
   *  This guarantees that in multi-step navigation, each step
   *  sees the COMMITTED result of the previous step, not an
   *  uncommitted or stale React fiber state.
   *
   *  No React dispatch is called here. The DOM update happens
   *  once at the end via forceReloadCurrentChat().
   * ─────────────────────────────────────────────────────────────── */
  async function applySingleSwitch(chatID, sourceUUID, branchIdx) {
    const msgs = await readMessagesFromIDB(chatID);
    if (!msgs) throw new Error('Cannot read messages from IDB for ' + chatID);

    const srcIdx = msgs.findIndex(m => m.uuid === sourceUUID);
    if (srcIdx < 0)
      throw new Error(`Source UUID ${sourceUUID} not found in IDB messages`);

    const srcMsg = msgs[srcIdx];
    const target = srcMsg.threads?.[branchIdx];
    if (!target)
      throw new Error(`threads[${branchIdx}] not found on message ${sourceUUID}`);

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

    await writeMessagesToIDB(chatID, newMsgs);
  }

  /* ── SIDEBAR CHAT CONTAINER FINDER ──────────────────────────────
   *
   *  Returns the `custom-chat-item` parent element of the currently
   *  selected chat. This reference stays valid even after clicking
   *  another chat (unlike `selected-chat-item` which moves).
   * ─────────────────────────────────────────────────────────────── */
  function getOriginalChatContainer() {
    const sel = document.querySelector('[data-element-id="selected-chat-item"]');
    if (!sel) return null;
    return sel.closest('[data-element-id="custom-chat-item"]') || sel.parentElement;
  }

  /* ── FORCE RELOAD FROM IDB ───────────────────────────────────────
   *
   *  Guarantees the TM chat DOM reflects the current IDB state.
   *  React dispatch is unreliable for DOM commits in concurrent mode;
   *  this sidebar-bounce approach is the definitive fallback.
   *
   *  WHY THE ORIGINAL WAS BROKEN:
   *    const sel = querySelector('selected-chat-item');
   *    other.click();  ← `selected-chat-item` now lives in `other`!
   *    sel.click();    ← clicks wrong element (other chat or stale ref)
   *
   *  FIX: store the PARENT container (custom-chat-item) BEFORE
   *  clicking away. It doesn't change when another chat is selected.
   * ─────────────────────────────────────────────────────────────── */
  async function forceReloadCurrentChat(origContainer) {
    if (!origContainer) {
      // No sidebar item found — wait briefly and hope React committed
      await new Promise(r => setTimeout(r, 700));
      return;
    }

    const allChats = [...document.querySelectorAll('[data-element-id="custom-chat-item"]')];
    const otherChat = allChats.find(c => c !== origContainer);

    if (!otherChat) {
      // Only one chat in history — nothing to bounce via. Reload page.
      window.location.reload();
      return;
    }

    // Navigate to a different chat (forces TM to unload current)
    otherChat.click();
    await new Promise(r => setTimeout(r, 500));

    // Navigate BACK using the STORED parent reference.
    // CRITICAL: do NOT re-query `selected-chat-item` here — it now
    // belongs to otherChat. The origContainer reference is stable.
    origContainer.click();
    await new Promise(r => setTimeout(r, 650));
  }

  /* ── NAVIGATION ──────────────────────────────────────────────────
   *
   *  Complete IDB-primary flow:
   *  1. Get chatID from React fiber (only thing we need React for)
   *  2. Store origContainer before any DOM changes
   *  3. Apply each switch step via IDB (reads + writes IDB)
   *  4. Force reload (sidebar bounce) — unconditional, guaranteed
   *  5. Rebuild graph from fresh fiber state (post-reload)
   *  6. Show success toast; user closes manually via X
   * ─────────────────────────────────────────────────────────────── */
  async function navigateToNode(node) {
    // Active node → close overlay and scroll to it
    if (node.active) {
      if (graphCtx && !node.id.includes('__t')) graphCtx.lastSrcUUID = node.id;
      closeOverlay();
      return;
    }

    if (navigating) return;
    if (!node.switchPath?.length) return;

    navigating = true;
    const steps = node.switchPath.length;

    try {
      // chatID is obtained from React — no messages data read
      const cs = getChatState();
      if (!cs?.state?.chatID) {
        showToast('Cannot read chat ID', 'err'); return;
      }
      const chatID = cs.state.chatID;

      // Capture original container BEFORE any clicks
      const origContainer = getOriginalChatContainer();

      // ── Step A: Apply all branch switches via IDB ─────────────
      for (let i = 0; i < node.switchPath.length; i++) {
        showToast(
          steps > 1 ? `Applying step ${i + 1} of ${steps}…` : 'Switching branch…',
          'warn'
        );
        const step = node.switchPath[i];
        await applySingleSwitch(chatID, step.sourceUUID, step.branchIdx);
      }

      if (!graphCtx) return; // overlay closed during async ops

      // ── Step B: Force TM to reload from updated IDB (UNCONDITIONAL)
      // This is the guaranteed DOM update. No weak verification needed.
      showToast('Refreshing chat view…', 'warn');
      await forceReloadCurrentChat(origContainer);

      if (!graphCtx) return;

      // ── Step C: Rebuild graph from fresh React state ───────────
      // After force reload, React state was re-initialized from IDB
      // and is now correct. Rebuild tree from this fresh state.
      const cs2 = getChatState();
      if (cs2?.state?.messages) {
        const newRoot = buildChain(cs2.state.messages, 0, true, [])[0];
        if (newRoot) {
          const { all: na, edges: ne, bounds: nb } = doLayout(newRoot);
          graphCtx.all    = na;
          graphCtx.edges  = ne;
          graphCtx.bounds = nb;
          graphCtx.hoverId     = null;
          graphCtx.lastSrcUUID = node.switchPath[0].sourceUUID;
          graphCtx.centre();
          graphCtx.draw();
        }
      }

      showToast(
        steps > 1
          ? `${steps}-step switch done ✓ — close ✕ to return`
          : 'Branch switched ✓ — close ✕ to return to chat',
        'ok'
      );

    } catch (err) {
      console.warn('[TM Graph] navigation error:', err.message);
      showToast('Error: ' + err.message.slice(0, 55), 'err');
    } finally {
      navigating = false;
    }
  }

  /* ── OPEN GRAPH ──────────────────────────────────────────────── */
  function openGraph() {
    if (overlay) { closeOverlay(); return; }
    const cs   = getChatState();
    if (!cs) { alert('[TM Graph] No active conversation.'); return; }
    const root = buildChain(cs.state.messages, 0, true, [])[0];
    if (!root) { alert('[TM Graph] No messages found.'); return; }
    const { all, edges, bounds } = doLayout(root);

    overlay = document.createElement('div'); overlay.id = EXT + '-ov';
    const bar = document.createElement('div'); bar.id = EXT + '-bar';
    bar.innerHTML = `
      <div style="display:flex;align-items:center">
        <h2>Chat Branch Graph</h2>
        <span class="hint">Drag · Scroll/pinch to zoom · Tap node to navigate</span>
      </div>
      <button id="${EXT}-xbtn" title="Close (Esc)">✕</button>`;
    const leg = document.createElement('div'); leg.id = EXT + '-leg';
    leg.innerHTML = `
      <span><span class="${EXT}-dot" style="background:#00a884"></span>Active — tap to scroll</span>
      <span><span class="${EXT}-dot" style="background:#1f2c34;border:1px solid #3b4a54"></span>Inactive — tap to switch</span>
      <span><span class="${EXT}-dot" style="background:#f59e0b"></span>Branch point</span>
      <span style="color:#f59e0b;font-size:9px">↓ = auto multi-step switch</span>`;
    const wrap   = document.createElement('div');   wrap.id = EXT + '-wrap';
    const canvas = document.createElement('canvas'); canvas.id = EXT + '-cv';
    toastEl = document.createElement('div');          toastEl.id = EXT + '-toast';
    wrap.appendChild(canvas); wrap.appendChild(toastEl);
    overlay.appendChild(bar); overlay.appendChild(leg); overlay.appendChild(wrap);
    document.body.appendChild(overlay);

    const ac  = new AbortController(), sig = ac.signal;
    const ro  = new ResizeObserver(() =>
      requestAnimationFrame(() => { graphCtx?.centre(); graphCtx?.draw(); })
    );
    ro.observe(wrap);

    graphCtx = {
      all, edges, bounds, ac, ro,
      tr: { tx:0, ty:0, s:1 }, hoverId:null, lastSrcUUID:null,
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

    requestAnimationFrame(() => { graphCtx.centre(); graphCtx.draw(); });

    bar.querySelector('#' + EXT + '-xbtn')
      .addEventListener('click', closeOverlay, { signal: sig });
    window.addEventListener('keydown',
      e => { if (e.key === 'Escape') closeOverlay(); },
      { signal: sig }
    );

    // Wheel zoom
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top, d=e.deltaY<0?1.09:0.92;
      graphCtx.tr.tx=mx-(mx-graphCtx.tr.tx)*d;
      graphCtx.tr.ty=my-(my-graphCtx.tr.ty)*d;
      graphCtx.tr.s=Math.min(3.5,Math.max(0.12,graphCtx.tr.s*d));
      graphCtx.draw();
    }, { passive:false, signal:sig });

    // Mouse drag
    let mdrag=null;
    canvas.addEventListener('mousedown', e => {
      mdrag={sx:e.clientX-graphCtx.tr.tx, sy:e.clientY-graphCtx.tr.ty};
      canvas.classList.add('drag');
    }, { signal:sig });
    window.addEventListener('mousemove', e => {
      if(!graphCtx) return;
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      const hit=hitTest(graphCtx.all,mx,my,graphCtx.tr);
      const nid=hit?.id||null;
      if(nid!==graphCtx.hoverId){ graphCtx.hoverId=nid; graphCtx.draw(); }
      canvas.style.cursor=mdrag?'grabbing':nid?(!hit.active?'pointer':'default'):'grab';
      if(mdrag){ graphCtx.tr.tx=e.clientX-mdrag.sx; graphCtx.tr.ty=e.clientY-mdrag.sy; graphCtx.draw(); }
    }, { signal:sig });
    window.addEventListener('mouseup', () => {
      mdrag=null; canvas.classList.remove('drag');
    }, { signal:sig });

    // Mouse click
    canvas.addEventListener('click', e => {
      if(mdrag) return;
      const rect=canvas.getBoundingClientRect();
      const hit=hitTest(graphCtx.all,e.clientX-rect.left,e.clientY-rect.top,graphCtx.tr);
      if(hit) navigateToNode(hit);
    }, { signal:sig });

    // Touch (Android PWA — tap in touchend, pan/pinch in touchmove)
    let lastTouches=null, touchStart=null, panning=false;
    canvas.addEventListener('touchstart', e => {
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
    }, { passive:false, signal:sig });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const ts=[...e.touches].map(t=>({x:t.clientX,y:t.clientY}));
      if(touchStart){
        const mv=Math.hypot(ts[0].x-touchStart.x,ts[0].y-touchStart.y);
        if(mv>8) panning=true;
      }
      if(ts.length===1&&lastTouches?.length===1){
        graphCtx.tr.tx+=ts[0].x-lastTouches[0].x;
        graphCtx.tr.ty+=ts[0].y-lastTouches[0].y;
        const rect=canvas.getBoundingClientRect();
        graphCtx.hoverId=hitTest(graphCtx.all,ts[0].x-rect.left,ts[0].y-rect.top,graphCtx.tr)?.id||null;
        graphCtx.draw();
      } else if(ts.length===2&&lastTouches?.length===2){
        const pd=Math.hypot(lastTouches[1].x-lastTouches[0].x,lastTouches[1].y-lastTouches[0].y);
        const cd=Math.hypot(ts[1].x-ts[0].x,ts[1].y-ts[0].y);
        if(pd>0){
          const d=cd/pd, rect=canvas.getBoundingClientRect();
          const mx=(ts[0].x+ts[1].x)/2-rect.left, my=(ts[0].y+ts[1].y)/2-rect.top;
          graphCtx.tr.tx=mx-(mx-graphCtx.tr.tx)*d;
          graphCtx.tr.ty=my-(my-graphCtx.tr.ty)*d;
          graphCtx.tr.s=Math.min(3.5,Math.max(0.12,graphCtx.tr.s*d));
          graphCtx.draw();
        }
      }
      lastTouches=ts;
    }, { passive:false, signal:sig });

    canvas.addEventListener('touchend', e => {
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
    }, { passive:false, signal:sig });

    canvas.addEventListener('touchcancel', () => {
      lastTouches=null; touchStart=null; panning=false;
      if(graphCtx){ graphCtx.hoverId=null; graphCtx.draw(); }
    }, { passive:false, signal:sig });
  }

  /* ── BUTTON INJECTION ────────────────────────────────────────── */
  const TOOLBAR = '[data-element-id="chat-input-actions"]';
  function tryInject() {
    const bar = document.querySelector(TOOLBAR);
    if (!bar || bar.querySelector('#' + EXT + '-btn')) return;
    const btn = document.createElement('button');
    btn.id = EXT + '-btn'; btn.title = 'Chat Branch Graph';
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2.2"/><circle cx="16" cy="4" r="2.2"/><circle cx="4" cy="16" r="2.2"/><circle cx="16" cy="16" r="2.2"/><circle cx="10" cy="10" r="2.2"/><line x1="4" y1="4" x2="10" y2="10"/><line x1="16" y1="4" x2="10" y2="10"/><line x1="10" y1="10" x2="4" y2="16"/><line x1="10" y1="10" x2="16" y2="16"/></svg>`;
    btn.addEventListener('click', openGraph);
    bar.appendChild(btn);
  }

  /* ── BOOTSTRAP ───────────────────────────────────────────────── */
  function init() {
    injectStyles(); tryInject();
    let r = 10;
    const retry = () => {
      if (document.querySelector('#' + EXT + '-btn')) return;
      tryInject();
      if (--r > 0) setTimeout(retry, 650);
    };
    setTimeout(retry, 400);
    new MutationObserver(tryInject).observe(document.body, { childList:true, subtree:true });
    console.log('[TM Chat Graph] ✅ v1.4.0');
  }
  init();
})();
