// ================================================================
//  TypingMind — Chat Branch Graph  v2.0.0
//
//  Breaking architectural change from v1.x:
//  PREVIEW / COMMIT separation:
//
//  • Click any node   → preview panel opens (ZERO state change)
//  • Close (X)        → overlay dismissed (ZERO state change,
//                        ZERO scroll, ZERO events)
//  • Apply Changes    → compute switches → IDB write →
//                        sessionStorage(uuid) → window.location.reload()
//  • Go to Message    → closeOverlay() + poll-scroll in current session
//
//  After reload, checkScrollAfterReload() (called first in init)
//  polls for message-timestamp-{uuid} up to 30 times × 400ms
//  (= up to 12s). Safe on slow Android PWA devices.
//
//  REMOVED (per requirements):
//  • All sidebar interaction (forceReloadCurrentChat, etc.)
//  • Automatic state changes on node click
//  • tmg:branchSwitched event dispatch from close path
//  • Separate Apply Changes footer bar
//
//  PRESERVED:
//  • Complete tree at all depths (all inactive branches visible)
//  • switchPath multi-step pure computation
//  • Preview panel with full markdown rendering
//  • AbortController single-function closeOverlay
// ================================================================
(() => {
  'use strict';
  const EXT        = 'tmChatGraph';
  const SCROLL_KEY = 'tmg_scroll_uuid'; // sessionStorage key

  /* ── SCROLL AFTER RELOAD ─────────────────────────────────────────
   *  Called FIRST in init() before any DOM work.
   *  Reads sessionStorage UUID set by applyAndReload(), then polls
   *  for the target element. Handles variable TM render times.
   * ─────────────────────────────────────────────────────────────── */
  function checkScrollAfterReload() {
    const uuid = sessionStorage.getItem(SCROLL_KEY);
    if (!uuid) return;
    sessionStorage.removeItem(SCROLL_KEY);

    let attempts = 0;
    function tryScroll() {
      const el    = document.getElementById(`message-timestamp-${uuid}`);
      const block = el?.closest('[data-element-id="response-block"]') || el?.parentElement;
      if (block) { block.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      // Retry: covers slow TM render on Android PWA
      if (++attempts < 30) setTimeout(tryScroll, 400);
    }
    setTimeout(tryScroll, 1500); // initial wait for TM to render chat
  }

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

      /* Main row */
      #${EXT}-main { flex:1;display:flex;flex-direction:row;overflow:hidden;min-height:0; }
      #${EXT}-wrap { flex:1;overflow:hidden;position:relative;touch-action:none;min-width:0; }
      #${EXT}-cv   { display:block;width:100%;height:100%;cursor:grab;touch-action:none; }
      #${EXT}-cv.drag { cursor:grabbing!important; }

      /* Preview panel — slides right (desktop) or up (mobile) */
      #${EXT}-panel {
        width:0;overflow:hidden;display:flex;flex-direction:column;flex-shrink:0;
        background:#111b21;border-left:1px solid rgba(255,255,255,.08);
        transition:width .22s ease;
      }
      #${EXT}-panel.open { width:min(340px,44vw); }

      .${EXT}-phead {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);
        flex-shrink:0;gap:8px;
      }
      .${EXT}-pbody {
        flex:1;overflow-y:auto;padding:12px;font-size:13px;line-height:1.65;
        color:#e9edef;-webkit-overflow-scrolling:touch;min-height:0;
      }
      /* Markdown in preview body */
      .${EXT}-pbody p   { margin:.3em 0; }
      .${EXT}-pbody h1,.${EXT}-pbody h2,.${EXT}-pbody h3
        { font-weight:700;margin:.5em 0 .2em; }
      .${EXT}-pbody h1 { font-size:1.35em; }
      .${EXT}-pbody h2 { font-size:1.18em; }
      .${EXT}-pbody h3 { font-size:1.05em; }
      .${EXT}-pbody strong { font-weight:700; }
      .${EXT}-pbody em { font-style:italic; }
      .${EXT}-pbody code {
        background:rgba(255,255,255,.13);padding:.1em .32em;border-radius:3px;font-size:.88em;
      }
      .${EXT}-pbody pre {
        background:rgba(255,255,255,.08);padding:.6em .8em;border-radius:6px;
        overflow-x:auto;margin:.45em 0;font-size:.86em;
      }
      .${EXT}-pbody pre code { background:none;padding:0;font-size:1em; }
      .${EXT}-pbody blockquote {
        border-left:3px solid rgba(255,255,255,.3);padding-left:.75em;margin:.4em 0;opacity:.85;
      }
      .${EXT}-pbody ul,.${EXT}-pbody ol { padding-left:1.4em;margin:.3em 0; }
      .${EXT}-pbody li { margin:.15em 0; }
      .${EXT}-pbody table { border-collapse:collapse;font-size:.9em;width:100%; }
      .${EXT}-pbody th,.${EXT}-pbody td
        { border:1px solid rgba(255,255,255,.2);padding:.25em .5em;text-align:left; }
      .${EXT}-pbody thead th { background:rgba(255,255,255,.08);font-weight:700; }
      .${EXT}-pinfobadge {
        font-size:10px;color:#8696a0;padding-bottom:8px;margin-bottom:10px;
        border-bottom:1px solid rgba(255,255,255,.07);
      }

      .${EXT}-pfoot {
        padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);
        display:flex;flex-direction:column;gap:7px;flex-shrink:0;
      }
      /* Button taxonomy:
         primary = safe action (green)
         apply   = state-changing action (amber, reload follows)
         muted   = cancel/neutral */
      .${EXT}-pbtn {
        padding:8px 12px;border-radius:8px;border:none;cursor:pointer;
        font-size:12px;font-weight:600;width:100%;transition:opacity .15s;
      }
      .${EXT}-pbtn:hover { opacity:.82; }
      .${EXT}-pbtn.primary { background:#00a884;color:#0b141a; }
      .${EXT}-pbtn.apply   { background:#f59e0b;color:#0b141a; }
      .${EXT}-pbtn.muted   {
        background:transparent;border:1px solid rgba(255,255,255,.18);color:#8696a0;
      }

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
      @media (max-width: 680px) {
        #${EXT}-main   { flex-direction:column; }
        #${EXT}-panel  {
          width:100%!important;max-height:0;border-left:none;
          border-top:1px solid rgba(255,255,255,.1);
          transition:max-height .25s ease;
        }
        #${EXT}-panel.open { max-height:58vh;width:100%!important; }
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
          return { state: v };
      }
    }
    return null;
  }

  /* ── IDB ─────────────────────────────────────────────────────── */
  const openIDB = () => new Promise((res, rej) => {
    const r = indexedDB.open('keyval-store');
    r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error);
  });
  async function persistMessages(chatID, msgs) {
    const db  = await openIDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction('keyval', 'readwrite');
      const st  = tx.objectStore('keyval');
      const key = `CHAT_${chatID}`;
      const g   = st.get(key);
      g.onsuccess = () => {
        const prev = g.result;
        if (!prev) { db.close(); res(); return; } // gracefully skip new chats not yet in IDB
        const p = st.put({ ...prev, messages: msgs, updatedAt: new Date() }, key);
        p.onsuccess = () => { db.close(); res(); };
        p.onerror   = () => { db.close(); rej(p.error); };
      };
      g.onerror = () => { db.close(); rej(g.error); };
    });
  }

  /* ── TEXT HELPERS ────────────────────────────────────────────── */
  const extractText = c =>
    !c ? '' : typeof c === 'string' ? c :
    Array.isArray(c) ? c.map(x => x?.text ?? x?.content ?? '').join(' ') : '';

  /** Render message content to HTML for the preview panel.
   *  Uses window.marked if available (loaded by preview script),
   *  otherwise applies a minimal inline fallback. */
  function renderForPreview(content) {
    const text = extractText(content);
    if (!text.trim()) return '<span style="opacity:.45;font-style:italic">(empty)</span>';
    if (typeof window.marked !== 'undefined') {
      try { return window.marked.parse(text); } catch (_) {}
    }
    // Minimal fallback renderer
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`)
      .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
  }

  /* ── TREE BUILDER ────────────────────────────────────────────────
   *  switchPath = [{sourceUUID, branchIdx}, …]
   *  Processes threads at ALL depths (inactive → nested variants).
   *  rawContent stored on every node for the preview panel.
   * ─────────────────────────────────────────────────────────────── */
  function buildChain(msgs, start, isActive, switchPath) {
    if (!msgs || start >= msgs.length) return [];
    const m = msgs[start];
    const node = {
      id:         m.uuid,
      role:       m.role === 'user' ? 'user' : 'asst',
      label:      extractText(m.content).replace(/\s+/g, ' ').slice(0, 82),
      rawContent: m.content,      // full content for preview
      active:     isActive,
      switchPath: isActive ? [] : switchPath,
      sourceUUID: switchPath.length > 0 ? switchPath[switchPath.length-1].sourceUUID : m.uuid,
      branchIdx:  switchPath.length > 0 ? switchPath[switchPath.length-1].branchIdx  : null,
      x:0, y:0, w:0, h:0, children:[], variants:[]
    };
    if (m.role === 'user' && m.threads?.length > 0) {
      node.variants = m.threads.map((thread, ti) => {
        const vp = [...(isActive ? [] : switchPath), { sourceUUID: m.uuid, branchIdx: ti }];
        const hd = {
          id:         `${m.uuid}__t${ti}`, role: 'user',
          label:      extractText(thread.userMessageContent).replace(/\s+/g, ' ').slice(0, 82),
          rawContent: thread.userMessageContent,  // full content for preview
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
  const NW = 200, NH = 56, VGAP = 34, slotW = 226;
  const colsPx = n => n * slotW - 26;
  function treeCols(node) {
    if (!node) return 1;
    if (node.variants.length > 0)
      return treeCols(node.children[0] || null) + node.variants.reduce((s, v) => s + treeCols(v), 0);
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
      const tc = ac + vcs.reduce((s, c) => s + c, 0);
      let sx = cx - colsPx(tc) / 2;
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
    all.forEach(n => { minX=Math.min(minX,n.x); maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+n.h); });
    return { all, edges, bounds: { minX, maxX, maxY } };
  }

  /* ── CANVAS RENDERER ─────────────────────────────────────────── */
  const C = {
    uA:'#005c4b', uAb:'#00a884',  uI:'#1c2b33', uIb:'#263742',
    aA:'#1e2d35', aAb:'#2a3942',  aI:'#0f1a22', aIb:'#1a2730',
    eA:'#00a884', eI:'rgba(40,60,70,.6)',
    tA:'#e9edef', tI:'#3d5566',
    hov:'#f59e0b', dot:'#f59e0b', sel:'#3b82f6'
  };
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
  }
  function doRender(canvas, all, edges, tr, hoverId, selectedId) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.translate(tr.tx, tr.ty); ctx.scale(tr.s, tr.s);

    // Edges
    edges.forEach(e => {
      ctx.beginPath(); ctx.moveTo(e.fx, e.fy);
      const mid = (e.fy + e.ty) / 2;
      ctx.bezierCurveTo(e.fx, mid, e.tx, mid, e.tx, e.ty);
      ctx.strokeStyle = e.active ? C.eA : C.eI;
      ctx.lineWidth   = e.active ? 2.2 : 1.5;
      ctx.setLineDash(e.active ? [] : [6, 4]);
      ctx.stroke(); ctx.setLineDash([]);
    });

    // Nodes (active first so inactive render on top for z-order clarity)
    const sorted = [...all].sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
    sorted.forEach(n => {
      const isU = n.role === 'user', ia = n.active;
      const isSel = n.id === selectedId, isHov = n.id === hoverId && !isSel;
      const bg  = isU ? (ia ? C.uA : C.uI)  : (ia ? C.aA  : C.aI);
      const bdr = isSel ? C.sel : isHov ? C.hov : isU ? (ia ? C.uAb : C.uIb) : (ia ? C.aAb : C.aIb);
      const shadowAlpha = isSel ? 22 : isHov ? 14 : ia ? 6 : 3;

      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = shadowAlpha; ctx.shadowOffsetY = isSel ? 5 : 2;
      rr(ctx, n.x, n.y, n.w, n.h, 10); ctx.fillStyle = bg; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

      rr(ctx, n.x, n.y, n.w, n.h, 10);
      ctx.strokeStyle = bdr; ctx.lineWidth = (isSel || isHov) ? 2.5 : (ia ? 1.5 : 1);
      ctx.stroke();

      // Role badge
      const bW = isU ? 34 : 20;
      ctx.fillStyle = isU ? (ia ? 'rgba(0,168,132,.28)' : 'rgba(38,55,66,.6)') : 'rgba(255,255,255,.04)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(n.x+7, n.y+7, bW, 14, 3); ctx.fill(); }
      ctx.fillStyle = isU ? (ia ? '#00a884' : '#3b4a54') : (ia ? '#8696a0' : '#243340');
      ctx.font = 'bold 7.5px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(isU ? 'USER' : 'AI', n.x + 11, n.y + 16.5);

      // Label
      ctx.fillStyle = ia ? C.tA : C.tI;
      ctx.font = `${ia ? 500 : 400} 10px system-ui`;
      let lbl = n.label || '(empty)', maxW = n.w - 16;
      while (ctx.measureText(lbl).width > maxW && lbl.length > 6) lbl = lbl.slice(0, -4) + '…';
      ctx.fillText(lbl, n.x + 8, n.y + 38);

      // Orange dot = branch point
      if (n.variants?.length) {
        ctx.fillStyle = C.dot; ctx.beginPath();
        ctx.arc(n.x + n.w - 8, n.y + 8, 4, 0, Math.PI * 2); ctx.fill();
      }
      // Step count for deep inactive nodes
      if (!ia && n.switchPath?.length > 1) {
        ctx.fillStyle = 'rgba(245,158,11,.7)'; ctx.font = 'bold 8px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText(`${n.switchPath.length}↓`, n.x + n.w - 5, n.y + n.h - 6);
      }
    });
    ctx.restore();
  }

  /* ── HIT TEST ────────────────────────────────────────────────── */
  function hitTest(all, mx, my, tr) {
    const wx = (mx - tr.tx) / tr.s, wy = (my - tr.ty) / tr.s;
    return all.find(n => wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) || null;
  }

  /* ── SCROLL (immediate, with retry for Android PWA) ─────────── */
  function scrollToMessage(uuid) {
    if (!uuid || uuid.includes('__t')) return;
    let attempts = 0;
    function tryScroll() {
      const el    = document.getElementById(`message-timestamp-${uuid}`);
      const block = el?.closest('[data-element-id="response-block"]') || el?.parentElement;
      if (block) { block.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (++attempts < 12) setTimeout(tryScroll, 250);
    }
    tryScroll();
  }

  /* ── MODULE STATE ────────────────────────────────────────────── */
  let graphCtx = null, overlay = null, toastEl = null, toastTmr = null;

  /* ── CLOSE OVERLAY ───────────────────────────────────────────────
   *  Remove overlay DOM only.
   *  Zero state changes. Zero scrolling. Zero events.
   * ─────────────────────────────────────────────────────────────── */
  function closeOverlay() {
    if (!overlay) return;
    graphCtx?.ro?.disconnect();
    graphCtx?.ac?.abort();
    overlay.remove(); overlay = null; toastEl = null; graphCtx = null;
    clearTimeout(toastTmr);
    // Intentionally NO: tmg:branchSwitched, no scroll, no state dispatch
  }

  /* ── TOAST ───────────────────────────────────────────────────── */
  function showToast(msg, type = 'ok') {
    if (!toastEl) return;
    clearTimeout(toastTmr);
    toastEl.textContent = msg; toastEl.className = type;
    toastTmr = setTimeout(() => { if (toastEl) toastEl.className = ''; }, 3500);
  }

  /* ── PREVIEW PANEL ───────────────────────────────────────────── */
  function openPreview(node, panelEl) {
    if (!node || !panelEl) return;
    if (graphCtx) { graphCtx.selectedId = node.id; graphCtx.draw(); }

    const isUser   = node.role === 'user';
    const isActive = node.active;
    const steps    = node.switchPath?.length || 0;

    // Role badge color
    const dotColor = isUser
      ? (isActive ? '#00a884' : '#3b4a54')
      : (isActive ? '#8696a0' : '#2a3942');
    const roleText = isUser
      ? (isActive ? 'USER · Active branch' : `USER · Inactive${steps > 1 ? ` · ${steps}-step switch` : ''}`)
      : (isActive ? 'AI · Active branch'   : `AI · Inactive${steps > 1 ? ` · ${steps}-step switch` : ''}`);

    // Build head
    const phead = panelEl.querySelector('.phead');
    phead.innerHTML = `
      <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1">
        <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0"></span>
        <span style="font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${roleText}</span>
      </div>
      <button class="pclose-btn" title="Close preview" style="background:none;border:none;
        cursor:pointer;color:#8696a0;font-size:16px;line-height:1;padding:2px 6px;
        border-radius:4px;flex-shrink:0;transition:color .15s">✕</button>`;
    phead.querySelector('.pclose-btn').onclick = () => closePreview(panelEl);

    // Build body: path hint + content
    const pbody = panelEl.querySelector('.pbody');
    const pathHint = isActive
      ? 'Currently visible in chat'
      : (steps === 1 ? '1 branch switch to activate' : `${steps} branch switches to activate`);
    pbody.innerHTML = `
      <div class="${EXT}-pinfobadge">${pathHint}</div>
      ${renderForPreview(node.rawContent)}`;

    // Build footer: action buttons
    const pfoot = panelEl.querySelector('.pfoot');
    pfoot.innerHTML = '';

    if (isActive) {
      // Safe action — no state change, no reload
      const goBtn = document.createElement('button');
      goBtn.className = EXT + '-pbtn primary';
      goBtn.textContent = '↓ Go to This Message';
      goBtn.onclick = () => {
        closePreview(panelEl);
        const uuid = node.id.includes('__t') ? null : node.id;
        closeOverlay();
        if (uuid) setTimeout(() => scrollToMessage(uuid), 150);
      };
      pfoot.appendChild(goBtn);
    } else {
      // State-changing action — amber to signal reload will follow
      const applyBtn = document.createElement('button');
      applyBtn.className = EXT + '-pbtn apply';
      applyBtn.textContent = steps > 1
        ? `⚡ Apply Changes (${steps} steps)`
        : '⚑ Apply Changes';
      applyBtn.onclick = () => applyAndReload(node);
      pfoot.appendChild(applyBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = EXT + '-pbtn muted';
    cancelBtn.textContent = 'Close Preview';
    cancelBtn.onclick = () => closePreview(panelEl);
    pfoot.appendChild(cancelBtn);

    panelEl.classList.add('open');
  }

  function closePreview(panelEl) {
    if (graphCtx) { graphCtx.selectedId = null; graphCtx.draw(); }
    panelEl?.classList.remove('open');
  }

  /* ── PURE SWITCH COMPUTATION ─────────────────────────────────── */
  function computeSingleSwitch(msgs, sourceUUID, branchIdx) {
    const srcIdx = msgs.findIndex(m => m.uuid === sourceUUID);
    if (srcIdx < 0) throw new Error(`UUID ${sourceUUID} not found`);
    const srcMsg = msgs[srcIdx];
    const target = srcMsg.threads?.[branchIdx];
    if (!target)   throw new Error(`threads[${branchIdx}] missing on ${sourceUUID}`);
    const newThreads = [
      ...srcMsg.threads.filter((_, i) => i !== branchIdx),
      { userMessageContent: srcMsg.content, messages: msgs.slice(srcIdx + 1), createdAt: new Date().toISOString() }
    ];
    return [
      ...msgs.slice(0, srcIdx),
      { ...srcMsg, content: target.userMessageContent, threads: newThreads, updatedAt: new Date().toISOString() },
      ...(target.messages || [])
    ];
  }

  /* ── APPLY AND RELOAD ────────────────────────────────────────────
   *
   *  The ONLY path that changes chat state.
   *  Called from "Apply Changes" button in preview panel.
   *
   *  Steps:
   *  1. Pure upfront computation: apply all switchPath steps
   *  2. Write final messages to IDB
   *  3. Save scroll UUID to sessionStorage (survives reload)
   *  4. closeOverlay() — clean dismiss
   *  5. window.location.reload() — TM reads fresh from IDB
   *
   *  After reload, checkScrollAfterReload() polls for the target
   *  element and scrolls. Works on all platforms including Android.
   * ─────────────────────────────────────────────────────────────── */
  async function applyAndReload(node) {
    if (!node || !node.switchPath?.length || node.active) return;

    const cs = getChatState();
    if (!cs?.state?.chatID) { showToast('Cannot read chat state', 'err'); return; }

    showToast('Applying…', 'warn');

    try {
      // Pure computation — all steps in one pass, no interim getChatState() calls
      let msgs = cs.state.messages;
      for (const step of node.switchPath) {
        msgs = computeSingleSwitch(msgs, step.sourceUUID, step.branchIdx);
      }

      // Persist to IDB — TM will read this on reload
      await persistMessages(cs.state.chatID, msgs);

      // Tell checkScrollAfterReload (runs after reload) where to scroll
      sessionStorage.setItem(SCROLL_KEY, node.switchPath[0].sourceUUID);

      // Dismiss overlay cleanly before reload navigation
      closeOverlay();

      // Full reload: TM reinitialises from IDB — guaranteed correct state
      window.location.reload();

    } catch (err) {
      console.warn('[TM Graph] applyAndReload error:', err.message);
      showToast('Error: ' + err.message.slice(0, 55), 'err');
    }
  }

  /* ── OPEN GRAPH ──────────────────────────────────────────────── */
  function openGraph() {
    if (overlay) { closeOverlay(); return; }

    const cs = getChatState();
    if (!cs) { alert('[TM Graph] No active conversation.'); return; }

    const root = buildChain(cs.state.messages, 0, true, [])[0];
    if (!root) { alert('[TM Graph] No messages found.'); return; }

    const { all, edges, bounds } = doLayout(root);

    /* ── Build overlay DOM ─────────────────────────────────────── */
    overlay = document.createElement('div'); overlay.id = EXT + '-ov';

    const bar = document.createElement('div'); bar.id = EXT + '-bar';
    bar.innerHTML = `
      <div style="display:flex;align-items:center">
        <h2>Chat Branch Graph</h2>
        <span class="hint">Tap node to preview · Drag to pan · Scroll/pinch to zoom</span>
      </div>
      <button id="${EXT}-xbtn" title="Close — no changes (Esc)">✕</button>`;

    const leg = document.createElement('div'); leg.id = EXT + '-leg';
    leg.innerHTML = `
      <span><span class="${EXT}-dot" style="background:#00a884"></span>Active path</span>
      <span><span class="${EXT}-dot" style="background:#1c2b33;border:1px solid #263742"></span>Inactive branch</span>
      <span><span class="${EXT}-dot" style="background:#f59e0b"></span>Branch point</span>
      <span><span class="${EXT}-dot" style="background:#3b82f6"></span>Selected preview</span>`;

    const main   = document.createElement('div');   main.id = EXT + '-main';
    const wrap   = document.createElement('div');   wrap.id = EXT + '-wrap';
    const canvas = document.createElement('canvas'); canvas.id = EXT + '-cv';
    toastEl = document.createElement('div');         toastEl.id = EXT + '-toast';
    wrap.appendChild(canvas); wrap.appendChild(toastEl);

    // Preview panel (hidden until node clicked)
    const panel = document.createElement('div'); panel.id = EXT + '-panel';
    panel.innerHTML = `
      <div class="${EXT}-phead phead" style="display:flex;align-items:center;justify-content:space-between;
        padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;gap:8px"></div>
      <div class="${EXT}-pbody pbody" style="flex:1;overflow-y:auto;padding:12px;
        font-size:13px;line-height:1.65;color:#e9edef;-webkit-overflow-scrolling:touch;min-height:0"></div>
      <div class="${EXT}-pfoot pfoot" style="padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);
        display:flex;flex-direction:column;gap:7px;flex-shrink:0"></div>`;

    main.appendChild(wrap); main.appendChild(panel);
    overlay.appendChild(bar); overlay.appendChild(leg); overlay.appendChild(main);
    document.body.appendChild(overlay);

    /* ── AbortController + ResizeObserver ──────────────────────── */
    const ac = new AbortController(), sig = ac.signal;
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => { graphCtx?.centre(); graphCtx?.draw(); })
    );
    ro.observe(wrap);

    graphCtx = {
      all, edges, bounds, ac, ro,
      tr: { tx:0, ty:0, s:1 },
      hoverId: null, selectedId: null,
      centre() {
        const W = canvas.clientWidth, H = canvas.clientHeight;
        if (!W || !H) return;
        const cW = this.bounds.maxX - this.bounds.minX + 120;
        const cH = this.bounds.maxY - 60 + 120;
        this.tr.s  = Math.max(0.2, Math.min(1.3, Math.min(W / cW, H / cH)));
        this.tr.tx = (W - cW * this.tr.s) / 2 - this.bounds.minX * this.tr.s + 60 * this.tr.s;
        this.tr.ty = (H - cH * this.tr.s) / 2 - 60 * this.tr.s + 60 * this.tr.s;
      },
      draw() { doRender(canvas, this.all, this.edges, this.tr, this.hoverId, this.selectedId); }
    };

    requestAnimationFrame(() => { graphCtx.centre(); graphCtx.draw(); });

    /* ── X button ───────────────────────────────────────────────── */
    bar.querySelector('#' + EXT + '-xbtn')
      .addEventListener('click', closeOverlay, { signal: sig });

    /* ── Escape: close panel first, then overlay ──────────────── */
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (panel.classList.contains('open')) closePreview(panel);
      else closeOverlay();
    }, { signal: sig });

    /* ── MOUSE: wheel zoom ──────────────────────────────────────── */
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const d = e.deltaY < 0 ? 1.09 : 0.92;
      graphCtx.tr.tx = mx - (mx - graphCtx.tr.tx) * d;
      graphCtx.tr.ty = my - (my - graphCtx.tr.ty) * d;
      graphCtx.tr.s  = Math.min(3.5, Math.max(0.12, graphCtx.tr.s * d));
      graphCtx.draw();
    }, { passive: false, signal: sig });

    /* ── MOUSE: drag pan ─────────────────────────────────────────── */
    let mdrag = null, dragDist = 0;
    canvas.addEventListener('mousedown', e => {
      mdrag = { sx: e.clientX - graphCtx.tr.tx, sy: e.clientY - graphCtx.tr.ty };
      dragDist = 0; canvas.classList.add('drag');
    }, { signal: sig });
    window.addEventListener('mousemove', e => {
      if (!graphCtx) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const hit = hitTest(graphCtx.all, mx, my, graphCtx.tr);
      const nid = hit?.id || null;
      if (nid !== graphCtx.hoverId) { graphCtx.hoverId = nid; graphCtx.draw(); }
      canvas.style.cursor = mdrag ? 'grabbing' : nid ? 'pointer' : 'grab';
      if (mdrag) {
        dragDist += Math.hypot(e.movementX || 0, e.movementY || 0);
        graphCtx.tr.tx = e.clientX - mdrag.sx;
        graphCtx.tr.ty = e.clientY - mdrag.sy;
        graphCtx.draw();
      }
    }, { signal: sig });
    window.addEventListener('mouseup', () => {
      mdrag = null; canvas.classList.remove('drag');
    }, { signal: sig });

    /* ── MOUSE: click → preview (not navigation) ─────────────────── */
    canvas.addEventListener('click', e => {
      if (dragDist > 5) { dragDist = 0; return; } // was a drag, not a click
      dragDist = 0;
      const rect = canvas.getBoundingClientRect();
      const hit  = hitTest(graphCtx.all, e.clientX - rect.left, e.clientY - rect.top, graphCtx.tr);
      if (hit) openPreview(hit, panel);
      else     closePreview(panel);
    }, { signal: sig });

    /* ── TOUCH: Android PWA ─────────────────────────────────────────
     *  Strategy: touchstart/move/end prevent default for canvas control.
     *  Tap detection in touchend: move < 15px, duration < 350ms,
     *  all fingers lifted → opens preview (NOT direct navigation).
     * ─────────────────────────────────────────────────────────────── */
    let lastTouches = null, touchStart = null, panning = false;

    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const ts = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
      lastTouches = ts; panning = false;
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
        const rect = canvas.getBoundingClientRect();
        const hit  = hitTest(graphCtx.all, t.clientX - rect.left, t.clientY - rect.top, graphCtx.tr);
        if ((hit?.id || null) !== graphCtx.hoverId) {
          graphCtx.hoverId = hit?.id || null; graphCtx.draw();
        }
      } else {
        touchStart = null;
      }
    }, { passive: false, signal: sig });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const ts = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
      if (touchStart) {
        const mv = Math.hypot(ts[0].x - touchStart.x, ts[0].y - touchStart.y);
        if (mv > 8) panning = true;
      }
      if (ts.length === 1 && lastTouches?.length === 1) {
        graphCtx.tr.tx += ts[0].x - lastTouches[0].x;
        graphCtx.tr.ty += ts[0].y - lastTouches[0].y;
        const rect = canvas.getBoundingClientRect();
        graphCtx.hoverId = hitTest(graphCtx.all, ts[0].x - rect.left, ts[0].y - rect.top, graphCtx.tr)?.id || null;
        graphCtx.draw();
      } else if (ts.length === 2 && lastTouches?.length === 2) {
        const pd = Math.hypot(lastTouches[1].x - lastTouches[0].x, lastTouches[1].y - lastTouches[0].y);
        const cd = Math.hypot(ts[1].x - ts[0].x, ts[1].y - ts[0].y);
        if (pd > 0) {
          const d = cd / pd;
          const rect = canvas.getBoundingClientRect();
          const mx = (ts[0].x + ts[1].x) / 2 - rect.left;
          const my = (ts[0].y + ts[1].y) / 2 - rect.top;
          graphCtx.tr.tx = mx - (mx - graphCtx.tr.tx) * d;
          graphCtx.tr.ty = my - (my - graphCtx.tr.ty) * d;
          graphCtx.tr.s  = Math.min(3.5, Math.max(0.12, graphCtx.tr.s * d));
          graphCtx.draw();
        }
      }
      lastTouches = ts;
    }, { passive: false, signal: sig });

    canvas.addEventListener('touchend', e => {
      e.preventDefault();
      // Tap: no pan, single finger, short distance, short duration → open preview
      if (touchStart && !panning && e.touches.length === 0 && e.changedTouches.length === 1) {
        const t  = e.changedTouches[0];
        const mv = Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y);
        const dt = Date.now() - touchStart.time;
        if (mv < 15 && dt < 350) {
          const rect = canvas.getBoundingClientRect();
          const hit  = hitTest(graphCtx.all, t.clientX - rect.left, t.clientY - rect.top, graphCtx.tr);
          if (hit) {
            graphCtx.hoverId = hit.id; graphCtx.draw();
            setTimeout(() => openPreview(hit, panel), 60);
          } else {
            closePreview(panel);
          }
        }
      }
      touchStart = null; panning = false;
      if (e.touches.length === 0) {
        lastTouches = null; graphCtx.hoverId = null; graphCtx.draw();
      } else {
        lastTouches = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
      }
    }, { passive: false, signal: sig });

    canvas.addEventListener('touchcancel', () => {
      lastTouches = null; touchStart = null; panning = false;
      if (graphCtx) { graphCtx.hoverId = null; graphCtx.draw(); }
    }, { passive: false, signal: sig });
  }

  /* ── BUTTON INJECTION ────────────────────────────────────────── */
  const TOOLBAR = '[data-element-id="chat-input-actions"]';
  function tryInject() {
    const bar = document.querySelector(TOOLBAR);
    if (!bar || bar.querySelector('#' + EXT + '-btn')) return;
    const btn = document.createElement('button');
    btn.id = EXT + '-btn'; btn.title = 'Chat Branch Graph';
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="4" cy="4" r="2.2"/><circle cx="16" cy="4" r="2.2"/>
      <circle cx="4" cy="16" r="2.2"/><circle cx="16" cy="16" r="2.2"/>
      <circle cx="10" cy="10" r="2.2"/>
      <line x1="4" y1="4" x2="10" y2="10"/><line x1="16" y1="4" x2="10" y2="10"/>
      <line x1="10" y1="10" x2="4" y2="16"/><line x1="10" y1="10" x2="16" y2="16"/>
    </svg>`;
    btn.addEventListener('click', openGraph);
    bar.appendChild(btn);
  }

  /* ── BOOTSTRAP ───────────────────────────────────────────────── */
  function init() {
    checkScrollAfterReload(); // MUST run first — reads sessionStorage before any DOM work
    injectStyles();
    tryInject();
    let r = 10;
    const retry = () => {
      if (document.querySelector('#' + EXT + '-btn')) return;
      tryInject();
      if (--r > 0) setTimeout(retry, 650);
    };
    setTimeout(retry, 400);
    new MutationObserver(tryInject).observe(document.body, { childList: true, subtree: true });
    console.log('[TM Chat Graph] ✅ v2.0.0');
  }

  init();
})();
