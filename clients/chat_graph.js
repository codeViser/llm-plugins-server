// ================================================================
//  TypingMind — Chat Branch Graph  v1.6.0
//
//  New features:
//  1. CONTENT PREVIEW PANEL: Clicking any node opens a right-side
//     panel showing the full rendered message text. Navigation
//     happens from the panel's "Switch to This Branch" button,
//     preventing accidental navigation on misclick.
//
//  2. APPLY CHANGES BUTTON: After a branch switch, the DOM is
//     checked 1.5s later. If TM's chat area still shows the old
//     messages (Zustand store not updated by our dispatch), an
//     "Apply Changes" button appears. The user clicks it to do a
//     page reload. This is intentionally user-initiated, NOT
//     automatic, per the stated constraint.
//
//  State sync investigation conclusion (see comments in
//  navigateToNode): TM uses Zustand-style in-memory state that
//  persists across SPA navigation. Only window.location.reload()
//  guarantees a fresh IDB read. Our dispatch updates the React
//  fiber hook (which is why getChatState reads new data and the
//  graph rebuilds), but the actual message list reads from the
//  Zustand store which we cannot update from outside TM.
//
//  Preserved from v1.5.0:
//  - Pure upfront multi-step computation (computeSingleSwitch)
//  - React fiber reads (not IDB reads — reliable for new chats)
//  - Fixed forceReloadCurrentChat with stored container ref
//  - Complete tree at all depths (switchPath from v1.3.0)
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
        background:transparent;cursor:pointer;color:inherit;transition:background .15s;
      }
      #${EXT}-btn:hover { background:rgba(255,255,255,.12); }
      #${EXT}-btn svg { width:18px;height:18px; }

      #${EXT}-ov {
        position:fixed;inset:0;z-index:2147483647;background:rgba(11,20,26,.96);
        display:flex;flex-direction:column;
        font-family:system-ui,-apple-system,sans-serif;color:#e9edef;
      }
      #${EXT}-bar {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;
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
        border-bottom:1px solid rgba(255,255,255,.06);font-size:10px;color:#8696a0;
      }
      #${EXT}-leg span { display:flex;align-items:center;gap:4px; }
      .${EXT}-dot { width:9px;height:9px;border-radius:50%;display:inline-block; }

      /* Main content row: canvas + preview panel */
      #${EXT}-main {
        flex:1;display:flex;flex-direction:row;overflow:hidden;min-height:0;
      }
      #${EXT}-wrap {
        flex:1;overflow:hidden;position:relative;touch-action:none;min-width:0;
      }
      #${EXT}-cv { display:block;width:100%;height:100%;cursor:grab;touch-action:none; }
      #${EXT}-cv.drag { cursor:grabbing!important; }

      /* Preview panel */
      #${EXT}-panel {
        width:0;overflow:hidden;display:flex;flex-direction:column;
        background:#111b21;border-left:1px solid rgba(255,255,255,.08);
        transition:width .2s ease;flex-shrink:0;
      }
      #${EXT}-panel.open { width:min(340px,42vw); }
      #${EXT}-phead {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;
      }
      #${EXT}-prole {
        display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;
      }
      .${EXT}-prole-dot { width:8px;height:8px;border-radius:50%; }
      #${EXT}-pclose {
        background:none;border:none;cursor:pointer;color:#8696a0;
        font-size:16px;padding:2px 6px;border-radius:4px;transition:all .15s;
      }
      #${EXT}-pclose:hover { background:rgba(255,255,255,.1);color:#e9edef; }
      #${EXT}-pbody {
        flex:1;overflow-y:auto;padding:12px;font-size:13px;line-height:1.65;
        color:#e9edef;-webkit-overflow-scrolling:touch;
      }
      #${EXT}-pbody p   { margin:.35em 0; }
      #${EXT}-pbody pre { background:rgba(255,255,255,.08);padding:.6em .75em;border-radius:5px;overflow-x:auto;font-size:.85em;margin:.5em 0; }
      #${EXT}-pbody code { background:rgba(255,255,255,.14);padding:.1em .3em;border-radius:3px;font-size:.88em; }
      #${EXT}-pbody pre code { background:none;padding:0; }
      #${EXT}-pbody strong { font-weight:700; }
      #${EXT}-pbody em { font-style:italic; }
      #${EXT}-pbody blockquote { border-left:3px solid rgba(255,255,255,.3);padding-left:.75em;opacity:.85;margin:.4em 0; }
      #${EXT}-pbody ul,#${EXT}-pbody ol { padding-left:1.4em;margin:.35em 0; }
      #${EXT}-pbody .path-hint { font-size:10px;color:#8696a0;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.08); }
      #${EXT}-pfoot {
        padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);
        display:flex;flex-direction:column;gap:7px;flex-shrink:0;
      }
      .${EXT}-pbtn {
        padding:8px 12px;border-radius:8px;border:none;cursor:pointer;
        font-size:12px;font-weight:600;width:100%;text-align:center;
        transition:opacity .15s;
      }
      .${EXT}-pbtn:hover { opacity:.85; }
      .${EXT}-pbtn.primary { background:#00a884;color:#0b141a; }
      .${EXT}-pbtn.secondary { background:rgba(255,255,255,.1);color:#e9edef; }
      .${EXT}-pbtn.muted    { background:transparent;border:1px solid rgba(255,255,255,.2);color:#8696a0; }

      /* Footer (Apply Changes button) */
      #${EXT}-footer {
        display:none;padding:8px 16px;border-top:1px solid rgba(255,255,255,.08);
        flex-shrink:0;align-items:center;gap:10px;
      }
      #${EXT}-footer.show { display:flex; }
      #${EXT}-footer span { font-size:11px;color:#8696a0;flex:1; }
      #${EXT}-apply-btn {
        padding:7px 16px;background:#f59e0b;color:#0b141a;
        border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;
        transition:opacity .15s;white-space:nowrap;
      }
      #${EXT}-apply-btn:hover { opacity:.85; }

      /* Toast */
      #${EXT}-toast {
        position:absolute;bottom:20px;left:50%;
        transform:translateX(-50%) translateY(60px);
        padding:7px 18px;border-radius:20px;font-size:12px;font-weight:700;
        transition:transform .22s;pointer-events:none;white-space:nowrap;z-index:10;
      }
      #${EXT}-toast.ok   { background:#00a884;color:#0b141a;transform:translateX(-50%) translateY(0); }
      #${EXT}-toast.warn { background:#f59e0b;color:#0b141a;transform:translateX(-50%) translateY(0); }
      #${EXT}-toast.err  { background:#ef4444;color:#fff;   transform:translateX(-50%) translateY(0); }

      /* Mobile: panel becomes bottom sheet */
      @media (max-width: 700px) {
        #${EXT}-main    { flex-direction:column; }
        #${EXT}-panel   { width:100%!important;max-height:0;border-left:none;border-top:1px solid rgba(255,255,255,.1); }
        #${EXT}-panel.open { max-height:55vh;width:100%!important; }
      }
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
        if (!prev) { db.close(); res(); return; } // not yet in IDB, skip gracefully
        const p = st.put({ ...prev, messages: msgs, updatedAt: new Date() }, key);
        p.onsuccess = () => { db.close(); res(); };
        p.onerror   = () => { db.close(); rej(p.error); };
      };
      g.onerror = () => { db.close(); rej(g.error); };
    });
  }

  /* ── TEXT & RENDER HELPERS ───────────────────────────────────── */
  const extractText = c =>
    !c ? '' : typeof c === 'string' ? c :
    Array.isArray(c) ? c.map(x => x?.text ?? x?.content ?? '').join(' ') : '';

  /** Render message content to HTML for the preview panel.
   *  Uses window.marked if available (loaded by preview script),
   *  otherwise applies a minimal inline fallback renderer. */
  function renderForPreview(content) {
    const text = extractText(content);
    if (!text.trim()) return '<span style="opacity:.5;font-style:italic">(empty)</span>';
    if (typeof window.marked !== 'undefined') {
      try { return window.marked.parse(text); } catch (_) {}
    }
    // Minimal fallback
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/```([\s\S]*?)```/g, (_,c) => `<pre><code>${c}</code></pre>`)
      .replace(/`([^`\n]+)`/g, (_,c) => `<code>${c}</code>`)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  /* ── TREE BUILDER ────────────────────────────────────────────── */
  function buildChain(msgs, start, isActive, switchPath) {
    if (!msgs || start >= msgs.length) return [];
    const m = msgs[start];
    const node = {
      id:          m.uuid,
      role:        m.role === 'user' ? 'user' : 'asst',
      label:       extractText(m.content).replace(/\s+/g, ' ').slice(0, 85),
      rawContent:  m.content,     // full content for preview panel
      active:      isActive,
      switchPath:  isActive ? [] : switchPath,
      sourceUUID:  switchPath.length > 0 ? switchPath[switchPath.length-1].sourceUUID : m.uuid,
      branchIdx:   switchPath.length > 0 ? switchPath[switchPath.length-1].branchIdx  : null,
      x:0, y:0, w:0, h:0, children:[], variants:[]
    };
    if (m.role === 'user' && m.threads?.length > 0) {
      node.variants = m.threads.map((thread, ti) => {
        const vp = [...(isActive ? [] : switchPath), { sourceUUID: m.uuid, branchIdx: ti }];
        const hd = {
          id:         `${m.uuid}__t${ti}`, role: 'user',
          label:      extractText(thread.userMessageContent).replace(/\s+/g,' ').slice(0, 85),
          rawContent: thread.userMessageContent,  // full content for preview panel
          active:     false, switchPath: vp,
          sourceUUID: vp[vp.length-1].sourceUUID,
          branchIdx:  vp[vp.length-1].branchIdx,
          x:0, y:0, w:0, h:0, children:[], variants:[]
        };
        hd.children = buildChain(thread.messages || [], 0, false, vp);
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
  const NW = 200, NH = 58, VGAP = 36, slotW = 228;
  const colsPx = n => n * slotW - 28;
  function treeCols(node) {
    if (!node) return 1;
    if (node.variants.length > 0)
      return treeCols(node.children[0] || null) + node.variants.reduce((s,v) => s + treeCols(v), 0);
    return node.children.length ? treeCols(node.children[0]) : 1;
  }
  function placeNode(node, cx, cy, all, edges) {
    if (!node) return;
    node.x = cx - NW/2; node.y = cy; node.w = NW; node.h = NH;
    all.push(node);
    const nextY = cy + NH + VGAP;
    if (node.variants.length > 0) {
      const ac = treeCols(node.children[0] || null);
      const vcs = node.variants.map(v => treeCols(v));
      const tc = ac + vcs.reduce((s,c) => s+c, 0);
      let sx = cx - colsPx(tc)/2;
      if (node.children[0]) {
        const aCx = sx + colsPx(ac)/2;
        edges.push({fx:cx,fy:cy+NH,tx:aCx,ty:nextY,active:true});
        placeNode(node.children[0], aCx, nextY, all, edges);
        sx += ac * slotW;
      }
      node.variants.forEach((v, vi) => {
        const vCx = sx + colsPx(vcs[vi])/2;
        edges.push({fx:cx,fy:cy+NH,tx:vCx,ty:nextY,active:false});
        placeNode(v, vCx, nextY, all, edges);
        sx += vcs[vi] * slotW;
      });
    } else if (node.children[0]) {
      edges.push({fx:cx,fy:cy+NH,tx:cx,ty:nextY,active:node.active});
      placeNode(node.children[0], cx, nextY, all, edges);
    }
  }
  function doLayout(root) {
    const all = [], edges = [];
    placeNode(root, colsPx(treeCols(root))/2 + 60, 60, all, edges);
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(n => { minX=Math.min(minX,n.x); maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+n.h); });
    return { all, edges, bounds:{minX,maxX,maxY} };
  }

  /* ── CANVAS RENDERER ─────────────────────────────────────────── */
  const C = {
    uA:'#005c4b',uAb:'#00a884', uI:'#1f2c34',uIb:'#2a3942',
    aA:'#202c33',aAb:'#2a3942', aI:'#111b21',aIb:'#1a2530',
    eA:'#00a884', eI:'rgba(50,70,80,.6)',
    tA:'#e9edef', tI:'#44606f', hov:'#f59e0b', dot:'#f59e0b', sel:'#3b82f6'
  };
  function rr(ctx,x,y,w,h,r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
  }
  function doRender(canvas, all, edges, tr, hoverId, selectedId) {
    const dpr=window.devicePixelRatio||1, W=canvas.clientWidth, H=canvas.clientHeight;
    if (!W||!H) return;
    canvas.width=W*dpr; canvas.height=H*dpr;
    const ctx=canvas.getContext('2d');
    ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
    ctx.save(); ctx.translate(tr.tx,tr.ty); ctx.scale(tr.s,tr.s);
    edges.forEach(e=>{
      ctx.beginPath(); ctx.moveTo(e.fx,e.fy);
      const m=(e.fy+e.ty)/2;
      ctx.bezierCurveTo(e.fx,m,e.tx,m,e.tx,e.ty);
      ctx.strokeStyle=e.active?C.eA:C.eI; ctx.lineWidth=e.active?2:1.5;
      ctx.setLineDash(e.active?[]:[6,4]); ctx.stroke(); ctx.setLineDash([]);
    });
    all.forEach(n=>{
      const isU=n.role==='user', ia=n.active;
      const isSel=n.id===selectedId, isHov=n.id===hoverId;
      const bg=isU?(ia?C.uA:C.uI):(ia?C.aA:C.aI);
      const bdr=isSel?C.sel:isHov?C.hov:isU?(ia?C.uAb:C.uIb):(ia?C.aAb:C.aIb);
      ctx.shadowColor='rgba(0,0,0,.35)'; ctx.shadowBlur=isSel?20:isHov?14:5;
      ctx.shadowOffsetY=isSel?5:isHov?3:2;
      rr(ctx,n.x,n.y,n.w,n.h,10); ctx.fillStyle=bg; ctx.fill();
      ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
      rr(ctx,n.x,n.y,n.w,n.h,10);
      ctx.strokeStyle=bdr; ctx.lineWidth=(isSel||isHov)?2.5:1.5; ctx.stroke();
      const bW=isU?36:22;
      ctx.fillStyle=isU?(ia?'rgba(0,168,132,.28)':'rgba(42,57,66,.55)'):'rgba(255,255,255,.05)';
      if(ctx.roundRect){ctx.beginPath();ctx.roundRect(n.x+7,n.y+7,bW,15,3);ctx.fill();}
      ctx.fillStyle=isU?(ia?'#00a884':'#3b4a54'):(ia?'#8696a0':'#243340');
      ctx.font='bold 8px system-ui'; ctx.textAlign='left';
      ctx.fillText(isU?'USER':'AI',n.x+11,n.y+17);
      ctx.fillStyle=ia?C.tA:C.tI; ctx.font=`${ia?500:400} 10.5px system-ui`;
      let lbl=n.label||'(empty)', maxW=n.w-18;
      while(ctx.measureText(lbl).width>maxW&&lbl.length>6) lbl=lbl.slice(0,-4)+'…';
      ctx.fillText(lbl,n.x+8,n.y+41);
      if(n.variants?.length){ ctx.fillStyle=C.dot; ctx.beginPath(); ctx.arc(n.x+n.w-9,n.y+9,4.5,0,Math.PI*2); ctx.fill(); }
      if(!ia&&n.switchPath?.length>1){ ctx.fillStyle='rgba(245,158,11,.75)'; ctx.font='bold 8px system-ui'; ctx.textAlign='right'; ctx.fillText(`${n.switchPath.length}↓`,n.x+n.w-6,n.y+n.h-7); }
    });
    ctx.restore();
  }

  /* ── HIT TEST ────────────────────────────────────────────────── */
  function hitTest(all,mx,my,tr) {
    const wx=(mx-tr.tx)/tr.s, wy=(my-tr.ty)/tr.s;
    return all.find(n=>wx>=n.x&&wx<=n.x+n.w&&wy>=n.y&&wy<=n.y+n.h)||null;
  }

  /* ── SCROLL ──────────────────────────────────────────────────── */
  function scrollToMessage(uuid) {
    if(!uuid||uuid.includes('__t')) return;
    const ts=document.getElementById(`message-timestamp-${uuid}`);
    (ts?.closest('[data-element-id="response-block"]')||ts?.parentElement)
      ?.scrollIntoView({behavior:'smooth',block:'center'});
  }

  /* ── DOM UPDATE VERIFICATION ─────────────────────────────────── */
  function isDOMShowingContent(srcUUID, expectedContent) {
    const tsEl = document.getElementById(`message-timestamp-${srcUUID}`);
    const rb   = tsEl?.closest('[data-element-id="response-block"]');
    const um   = rb?.querySelector('[data-element-id="user-message"]');
    if (!um) return false;
    const domTxt = um.textContent.replace(/\s+/g,' ').trim().slice(0, 60);
    const expTxt = extractText(expectedContent).replace(/\s+/g,' ').trim().slice(0, 20);
    return expTxt.length > 0 && domTxt.includes(expTxt);
  }

  /* ── MODULE STATE ────────────────────────────────────────────── */
  let graphCtx=null, overlay=null, toastEl=null, toastTmr=null, navigating=false;

  /* ── CLOSE ───────────────────────────────────────────────────── */
  function closeOverlay() {
    if(!overlay) return;
    graphCtx?.ro?.disconnect();
    graphCtx?.ac?.abort();
    const uuid=graphCtx?.lastSrcUUID;
    overlay.remove(); overlay=null; toastEl=null; graphCtx=null;
    clearTimeout(toastTmr);
    document.dispatchEvent(new CustomEvent('tmg:branchSwitched'));
    if(uuid) setTimeout(()=>scrollToMessage(uuid), 200);
  }

  /* ── TOAST ───────────────────────────────────────────────────── */
  function showToast(msg,type='ok') {
    if(!toastEl) return;
    clearTimeout(toastTmr);
    toastEl.textContent=msg; toastEl.className=type;
    toastTmr=setTimeout(()=>{ if(toastEl) toastEl.className=''; }, 3500);
  }

  /* ── PREVIEW PANEL ───────────────────────────────────────────── */
  function openPreview(node, panelEl) {
    if (!node || !panelEl) return;

    // Update graphCtx selected state
    if (graphCtx) { graphCtx.selectedId = node.id; graphCtx.draw(); }

    const phead = panelEl.querySelector('.phead');
    const pbody = panelEl.querySelector('.pbody');
    const pfoot = panelEl.querySelector('.pfoot');

    // Role badge
    const isUser = node.role === 'user';
    const color  = isUser
      ? (node.active ? '#00a884' : '#3b4a54')
      : (node.active ? '#8696a0' : '#2a3942');
    const label  = isUser ? (node.active ? 'YOU (active)' : 'YOU (inactive branch)') :
                            (node.active ? 'AI (active)' : 'AI (inactive branch)');
    phead.innerHTML = `
      <div style="display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span>${label}</span>
        ${node.switchPath?.length > 1 ? `<span style="color:#f59e0b;font-size:9px">${node.switchPath.length}-step switch</span>` : ''}
      </div>
      <button class="pclose" title="Close preview" style="background:none;border:none;cursor:pointer;color:#8696a0;font-size:16px;padding:2px 6px;border-radius:4px">✕</button>`;
    phead.querySelector('.pclose').onclick = () => closePreview(panelEl);

    // Message path hint
    const depth = node.switchPath?.length || 0;
    const pathHint = depth === 0 ? 'Currently active branch'
      : `Requires ${depth} branch switch${depth > 1 ? 'es' : ''} to activate`;

    // Content
    const rendered = renderForPreview(node.rawContent);
    pbody.innerHTML = `
      <div class="path-hint">${pathHint}</div>
      ${rendered}`;

    // Action buttons
    pfoot.innerHTML = '';
    if (node.active) {
      const goBtn = document.createElement('button');
      goBtn.className = `${EXT}-pbtn primary`;
      goBtn.textContent = '↓ Go to This Message';
      goBtn.onclick = () => {
        closePreview(panelEl);
        if (graphCtx && !node.id.includes('__t')) graphCtx.lastSrcUUID = node.id;
        closeOverlay();
      };
      pfoot.appendChild(goBtn);
    } else {
      const switchBtn = document.createElement('button');
      switchBtn.className = `${EXT}-pbtn primary`;
      switchBtn.textContent = depth > 1
        ? `⚡ Switch (${depth} steps)`
        : '⚑ Switch to This Branch';
      switchBtn.onclick = () => {
        closePreview(panelEl);
        navigateToNode(node);
      };
      pfoot.appendChild(switchBtn);
    }
    const cancelBtn = document.createElement('button');
    cancelBtn.className = `${EXT}-pbtn muted`;
    cancelBtn.textContent = 'Close Preview';
    cancelBtn.onclick = () => closePreview(panelEl);
    pfoot.appendChild(cancelBtn);

    panelEl.classList.add('open');
  }

  function closePreview(panelEl) {
    if (graphCtx) { graphCtx.selectedId = null; graphCtx.draw(); }
    panelEl.classList.remove('open');
  }

  /* ── PURE BRANCH SWITCH ──────────────────────────────────────── */
  function computeSingleSwitch(msgs, sourceUUID, branchIdx) {
    const srcIdx = msgs.findIndex(m => m.uuid === sourceUUID);
    if (srcIdx < 0) throw new Error(`UUID ${sourceUUID} not found in messages`);
    const srcMsg = msgs[srcIdx];
    const target = srcMsg.threads?.[branchIdx];
    if (!target) throw new Error(`threads[${branchIdx}] missing on ${sourceUUID}`);
    const newThreads = [
      ...srcMsg.threads.filter((_,i) => i !== branchIdx),
      { userMessageContent:srcMsg.content, messages:msgs.slice(srcIdx+1), createdAt:new Date().toISOString() }
    ];
    return [
      ...msgs.slice(0, srcIdx),
      { ...srcMsg, content:target.userMessageContent, threads:newThreads, updatedAt:new Date().toISOString() },
      ...(target.messages || [])
    ];
  }

  /* ── SIDEBAR HELPERS ─────────────────────────────────────────── */
  function getOriginalChatContainer() {
    const sel = document.querySelector('[data-element-id="selected-chat-item"]');
    return sel?.closest('[data-element-id="custom-chat-item"]') || sel?.parentElement || null;
  }
  async function attemptSidebarReload(origContainer) {
    if (!origContainer) return;
    const allChats = [...document.querySelectorAll('[data-element-id="custom-chat-item"]')];
    const other = allChats.find(c => c !== origContainer);
    if (!other) return;
    other.click();
    await new Promise(r => setTimeout(r, 600));
    origContainer.click();
    await new Promise(r => setTimeout(r, 800));
  }

  /* ── NAVIGATION ──────────────────────────────────────────────────
   *
   *  STATE SYNC NOTE (v1.6.0):
   *  TM uses persistent in-memory state (likely Zustand) that is
   *  initialized from IDB on cold browser start. Client-side
   *  navigation (Next.js SPA) does NOT reinitialize this store.
   *
   *  Our cs.dispatch() updates the React fiber hook state (hook 0
   *  of component "o"), which is why getChatState() reads new
   *  messages and the graph rebuilds correctly. However, TM's
   *  message list renderer subscribes to the Zustand store
   *  directly — not to component "o"'s derived hook state —
   *  so the visible chat DOM may not reflect the change.
   *
   *  The sidebar bounce (attemptSidebarReload) sometimes helps but
   *  is not guaranteed because Next.js SPA keeps the component
   *  mounted across navigation, and the Zustand store persists.
   *
   *  Only window.location.reload() guarantees IDB→Zustand→DOM.
   *  This is exposed as a USER-INITIATED "Apply Changes" button,
   *  not as an automatic reload.
   * ─────────────────────────────────────────────────────────────── */
  async function navigateToNode(node) {
    if (navigating) return;
    if (!node.switchPath?.length) return;

    navigating = true;

    try {
      const cs = getChatState();
      if (!cs?.state?.chatID) { showToast('Cannot read chat state','err'); return; }

      const origContainer = getOriginalChatContainer();
      const steps = node.switchPath.length;
      showToast(steps>1 ? `Computing ${steps}-step switch…`:'Switching branch…','warn');

      // Pure upfront computation: no getChatState() between steps
      let msgs = cs.state.messages;
      for (const step of node.switchPath) {
        msgs = computeSingleSwitch(msgs, step.sourceUUID, step.branchIdx);
      }

      if (!graphCtx) return;

      // React dispatch (best-effort — see STATE SYNC NOTE above)
      if (cs.dispatch) {
        try { cs.dispatch({...cs.state, messages:msgs}); }
        catch (e) { console.warn('[TM Graph] dispatch:',e.message); }
      }

      // IDB write (needed for Apply Changes / page reload path)
      persistMessages(cs.state.chatID, msgs)
        .catch(e => console.warn('[TM Graph] IDB:',e.message));

      // Attempt sidebar reload (sometimes works if TM re-reads on nav)
      showToast('Refreshing…','warn');
      await attemptSidebarReload(origContainer);

      if (!graphCtx) return;

      // Rebuild graph from fresh fiber state
      const cs2 = getChatState();
      if (cs2?.state?.messages) {
        const newRoot = buildChain(cs2.state.messages, 0, true, [])[0];
        if (newRoot) {
          const {all:na, edges:ne, bounds:nb} = doLayout(newRoot);
          graphCtx.all = na; graphCtx.edges = ne; graphCtx.bounds = nb;
          graphCtx.hoverId = null; graphCtx.selectedId = null;
          graphCtx.lastSrcUUID = node.switchPath[0].sourceUUID;
          graphCtx.centre(); graphCtx.draw();
        }
      }

      // DOM verification: did the chat actually visually update?
      await new Promise(r => setTimeout(r, 300));
      const step0   = node.switchPath[0];
      const expContent = (() => {
        // The target content at step 0 is what was in threads[branchIdx]
        // We stored it in our computed msgs — find the message
        const switched = msgs.find(m => m.uuid === step0.sourceUUID);
        return switched?.content;
      })();

      const domUpdated = expContent
        ? isDOMShowingContent(step0.sourceUUID, expContent)
        : false;

      if (domUpdated) {
        showToast(steps>1?`${steps}-step switch ✓ — close ✕`:'Switched ✓ — close ✕','ok');
        if (graphCtx) document.getElementById(EXT+'-footer')?.classList.remove('show');
      } else {
        // Chat DOM didn't update — show Apply button
        showToast('Graph updated. Chat requires Apply →','warn');
        if (graphCtx) {
          const footer = document.getElementById(EXT+'-footer');
          if (footer) footer.classList.add('show');
        }
      }

    } catch (err) {
      console.warn('[TM Graph] navigation error:', err.message);
      showToast('Error: '+err.message.slice(0,55),'err');
    } finally {
      navigating = false;
    }
  }

  /* ── OPEN GRAPH ──────────────────────────────────────────────── */
  function openGraph() {
    if (overlay) { closeOverlay(); return; }
    const cs = getChatState();
    if (!cs) { alert('[TM Graph] No active conversation.'); return; }
    const root = buildChain(cs.state.messages, 0, true, [])[0];
    if (!root) { alert('[TM Graph] No messages found.'); return; }
    const {all, edges, bounds} = doLayout(root);

    overlay = document.createElement('div'); overlay.id = EXT+'-ov';
    // Top bar
    const bar = document.createElement('div'); bar.id = EXT+'-bar';
    bar.innerHTML = `
      <div style="display:flex;align-items:center">
        <h2>Chat Branch Graph</h2>
        <span class="hint">Tap node to preview · Drag to pan · Scroll/pinch to zoom</span>
      </div>
      <button id="${EXT}-xbtn" title="Close (Esc)">✕</button>`;
    // Legend
    const leg = document.createElement('div'); leg.id = EXT+'-leg';
    leg.innerHTML = `
      <span><span class="${EXT}-dot" style="background:#00a884"></span>Active path</span>
      <span><span class="${EXT}-dot" style="background:#1f2c34;border:1px solid #3b4a54"></span>Inactive branch</span>
      <span><span class="${EXT}-dot" style="background:#f59e0b"></span>Branch point</span>
      <span style="color:#3b82f6;font-size:9px">Blue outline = selected preview</span>`;
    // Main row: canvas + panel
    const main = document.createElement('div'); main.id = EXT+'-main';
    const wrap = document.createElement('div'); wrap.id = EXT+'-wrap';
    const canvas = document.createElement('canvas'); canvas.id = EXT+'-cv';
    toastEl = document.createElement('div'); toastEl.id = EXT+'-toast';
    wrap.appendChild(canvas); wrap.appendChild(toastEl);
    // Preview panel
    const panel = document.createElement('div'); panel.id = EXT+'-panel';
    panel.innerHTML = `
      <div class="phead" style="display:flex;align-items:center;justify-content:space-between;
        padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0"></div>
      <div class="pbody" style="flex:1;overflow-y:auto;padding:12px;font-size:13px;
        line-height:1.65;color:#e9edef;-webkit-overflow-scrolling:touch"></div>
      <div class="pfoot" style="padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);
        display:flex;flex-direction:column;gap:7px;flex-shrink:0"></div>`;
    main.appendChild(wrap); main.appendChild(panel);
    // Footer (Apply Changes)
    const footer = document.createElement('div'); footer.id = EXT+'-footer';
    footer.innerHTML = `
      <span>⚠ Chat view not updated — IDB is saved. Click to apply.</span>
      <button id="${EXT}-apply-btn">Apply Changes ↺</button>`;
    overlay.appendChild(bar); overlay.appendChild(leg);
    overlay.appendChild(main); overlay.appendChild(footer);
    document.body.appendChild(overlay);

    // Apply button: user-initiated page reload
    document.getElementById(EXT+'-apply-btn').addEventListener('click', () => {
      closeOverlay();
      window.location.reload();
    });

    const ac = new AbortController(), sig = ac.signal;
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => { graphCtx?.centre(); graphCtx?.draw(); })
    );
    ro.observe(wrap);

    graphCtx = {
      all, edges, bounds, ac, ro,
      tr:{tx:0,ty:0,s:1}, hoverId:null, selectedId:null, lastSrcUUID:null,
      centre() {
        const W=canvas.clientWidth, H=canvas.clientHeight;
        if(!W||!H) return;
        const cW=this.bounds.maxX-this.bounds.minX+120;
        const cH=this.bounds.maxY-60+120;
        this.tr.s=Math.max(0.2,Math.min(1.3,Math.min(W/cW,H/cH)));
        this.tr.tx=(W-cW*this.tr.s)/2-this.bounds.minX*this.tr.s+60*this.tr.s;
        this.tr.ty=(H-cH*this.tr.s)/2-60*this.tr.s+60*this.tr.s;
      },
      draw() { doRender(canvas,this.all,this.edges,this.tr,this.hoverId,this.selectedId); }
    };

    requestAnimationFrame(() => { graphCtx.centre(); graphCtx.draw(); });

    bar.querySelector('#'+EXT+'-xbtn').addEventListener('click', closeOverlay, {signal:sig});
    window.addEventListener('keydown', e=>{
      if(e.key==='Escape') {
        if(panel.classList.contains('open')) closePreview(panel);
        else closeOverlay();
      }
    }, {signal:sig});

    // Wheel zoom
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
    let mdrag=null, dragDist=0;
    canvas.addEventListener('mousedown',e=>{
      mdrag={sx:e.clientX-graphCtx.tr.tx,sy:e.clientY-graphCtx.tr.ty};
      dragDist=0; canvas.classList.add('drag');
    },{signal:sig});
    window.addEventListener('mousemove',e=>{
      if(!graphCtx) return;
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      const hit=hitTest(graphCtx.all,mx,my,graphCtx.tr);
      const nid=hit?.id||null;
      if(nid!==graphCtx.hoverId){ graphCtx.hoverId=nid; graphCtx.draw(); }
      canvas.style.cursor=mdrag?'grabbing':nid?'pointer':'grab';
      if(mdrag){
        dragDist+=Math.hypot(e.movementX,e.movementY);
        graphCtx.tr.tx=e.clientX-mdrag.sx; graphCtx.tr.ty=e.clientY-mdrag.sy;
        graphCtx.draw();
      }
    },{signal:sig});
    window.addEventListener('mouseup',()=>{ mdrag=null; canvas.classList.remove('drag'); },{signal:sig});

    // Click → open preview (only if didn't drag)
    canvas.addEventListener('click',e=>{
      if(dragDist>5) return;
      const rect=canvas.getBoundingClientRect();
      const hit=hitTest(graphCtx.all,e.clientX-rect.left,e.clientY-rect.top,graphCtx.tr);
      if(hit) openPreview(hit,panel);
      else closePreview(panel);
    },{signal:sig});

    // Touch (Android PWA)
    let lastTouches=null, touchStart=null, panning=false;
    canvas.addEventListener('touchstart',e=>{
      e.preventDefault();
      const ts=[...e.touches].map(t=>({x:t.clientX,y:t.clientY}));
      lastTouches=ts; panning=false;
      if(e.touches.length===1){
        const t=e.touches[0]; touchStart={x:t.clientX,y:t.clientY,time:Date.now()};
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
          if(hit){ graphCtx.hoverId=hit.id; graphCtx.draw(); setTimeout(()=>openPreview(hit,panel),60); }
          else closePreview(panel);
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
  function tryInject() {
    const bar=document.querySelector(TOOLBAR);
    if(!bar||bar.querySelector('#'+EXT+'-btn')) return;
    const btn=document.createElement('button');
    btn.id=EXT+'-btn'; btn.title='Chat Branch Graph';
    btn.innerHTML=`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2.2"/><circle cx="16" cy="4" r="2.2"/><circle cx="4" cy="16" r="2.2"/><circle cx="16" cy="16" r="2.2"/><circle cx="10" cy="10" r="2.2"/><line x1="4" y1="4" x2="10" y2="10"/><line x1="16" y1="4" x2="10" y2="10"/><line x1="10" y1="10" x2="4" y2="16"/><line x1="10" y1="10" x2="16" y2="16"/></svg>`;
    btn.addEventListener('click', openGraph);
    bar.appendChild(btn);
  }

  /* ── BOOTSTRAP ───────────────────────────────────────────────── */
  function init() {
    injectStyles(); tryInject();
    let r=10;
    const retry=()=>{ if(document.querySelector('#'+EXT+'-btn'))return; tryInject(); if(--r>0)setTimeout(retry,650); };
    setTimeout(retry,400);
    new MutationObserver(tryInject).observe(document.body,{childList:true,subtree:true});
    console.log('[TM Chat Graph] ✅ v1.6.0');
  }
  init();
})();
