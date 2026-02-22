// ================================================================
//  TypingMind — Chat Branch Graph  v1.1.0
//
//  Fixed vs v1.0.0:
//  • Touch/PWA: tap detection in touchend (touchstart preventDefault
//    killed the click event on Android); uses movement+time threshold
//  • Navigation: content format normalised; IDB read-modify-write
//    runs in parallel with React dispatch; 200 ms verify + sidebar
//    fallback if dispatch silently fails; scroll to message after
//  • Active node click → close overlay + scroll to that message
//  • Layout: edge origin fixed (cx, not cx+NW/2); slotW-based maths
// ================================================================
(() => {
  'use strict';
  const EXT = 'tmChatGraph';

  /* ── STYLES ─────────────────────────────────────────────── */
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
      #${EXT}-btn svg   { width:18px;height:18px; }

      #${EXT}-overlay {
        position:fixed;inset:0;z-index:2147483647;
        background:rgba(11,20,26,.96);
        display:flex;flex-direction:column;
        font-family:system-ui,-apple-system,sans-serif;color:#e9edef;
      }
      #${EXT}-topbar {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.08);
        flex-shrink:0;
      }
      #${EXT}-topbar h2  { margin:0;font-size:13px;font-weight:700; }
      #${EXT}-topbar .hint { font-size:11px;color:#8696a0;margin-left:10px; }
      #${EXT}-close {
        background:none;border:none;cursor:pointer;color:#8696a0;
        font-size:20px;line-height:1;padding:4px 8px;border-radius:6px;
        transition:background .15s,color .15s;
      }
      #${EXT}-close:hover { background:rgba(255,255,255,.1);color:#e9edef; }
      #${EXT}-legend {
        display:flex;gap:16px;padding:5px 16px;
        border-bottom:1px solid rgba(255,255,255,.06);
        font-size:10px;color:#8696a0;flex-shrink:0;
      }
      #${EXT}-legend span { display:flex;align-items:center;gap:5px; }
      .${EXT}-ldot { width:9px;height:9px;border-radius:50%;display:inline-block; }
      #${EXT}-wrap { flex:1;overflow:hidden;position:relative;touch-action:none; }
      #${EXT}-cv   { display:block;width:100%;height:100%;touch-action:none; }
      #${EXT}-cv.drag { cursor:grabbing!important; }
      #${EXT}-toast {
        position:absolute;bottom:20px;left:50%;
        transform:translateX(-50%) translateY(60px);
        padding:7px 18px;border-radius:20px;
        font-size:12px;font-weight:700;
        transition:transform .22s;pointer-events:none;
        white-space:nowrap;z-index:10;
      }
      #${EXT}-toast.ok   { background:#00a884;color:#0b141a;transform:translateX(-50%) translateY(0); }
      #${EXT}-toast.warn { background:#f59e0b;color:#0b141a;transform:translateX(-50%) translateY(0); }
      #${EXT}-toast.err  { background:#ef4444;color:#fff;   transform:translateX(-50%) translateY(0); }
    `;
    document.head.appendChild(s);
  }

  /* ── REACT FIBER ─────────────────────────────────────────── */
  function getFiber(el) {
    const k = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    return k ? el[k] : null;
  }

  /** Walk fiber tree upward from chat-space-middle-part to find
   *  the component that owns { messages[], chatID } (hook 0 of "o"). */
  function getChatState() {
    const el = document.querySelector('[data-element-id="chat-space-middle-part"]');
    if (!el) return null;
    let f = getFiber(el);
    for (let d = 0; f && d < 80; f = f.return, d++) {
      let hs = f.memoizedState, hi = 0;
      for (; hs && hi < 6; hs = hs.next, hi++) {
        const v = hs.memoizedState;
        if (v && !Array.isArray(v) && typeof v === 'object' &&
            Array.isArray(v.messages) && v.chatID) {
          return { state: v, dispatch: hs.queue?.dispatch };
        }
      }
    }
    return null;
  }

  /* ── IDB ─────────────────────────────────────────────────── */
  const openIDB = () => new Promise((res, rej) => {
    const r = indexedDB.open('keyval-store');
    r.onsuccess = e => res(e.target.result);
    r.onerror   = () => rej(r.error);
  });

  /**
   * Read-modify-write: only replaces the `messages` field so all
   * other TM-managed fields (folderID, tags, preview, etc.) survive.
   */
  async function persistMessages(chatID, newMessages) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('keyval', 'readwrite');
      const st = tx.objectStore('keyval');
      const key = `CHAT_${chatID}`;
      const g = st.get(key);
      g.onsuccess = () => {
        const prev = g.result;
        if (!prev) { db.close(); rej(new Error('Key not found: ' + key)); return; }
        const p = st.put({ ...prev, messages: newMessages, updatedAt: new Date() }, key);
        p.onsuccess = () => { db.close(); res(); };
        p.onerror   = () => { db.close(); rej(p.error); };
      };
      g.onerror = () => { db.close(); rej(g.error); };
    });
  }

  /* ── TEXT EXTRACTION ─────────────────────────────────────── */
  function extractText(c) {
    if (!c) return '';
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(x => x?.text ?? x?.content ?? '').join(' ');
    return '';
  }

  /* ── TREE BUILDER ────────────────────────────────────────────
   *
   *  branchInfo = { sourceUUID, branchIdx } | null
   *
   *  Propagated DOWN into all nodes of an inactive branch so that
   *  clicking ANY node inside that branch (head OR continuation) can
   *  resolve "which parent threads[] entry to activate".
   *
   *  null = node is on the live active path.
   * ─────────────────────────────────────────────────────────── */
  function buildChain(msgs, start, isActive, branchInfo) {
    if (!msgs || start >= msgs.length) return [];
    const m = msgs[start];

    const node = {
      id:         m.uuid,
      role:       m.role === 'user' ? 'user' : 'asst',
      label:      extractText(m.content).replace(/\s+/g, ' ').slice(0, 85),
      active:     isActive,
      // Navigation — where do we go when this is clicked?
      sourceUUID: branchInfo?.sourceUUID ?? m.uuid,
      branchIdx:  branchInfo?.branchIdx  ?? null,
      x:0, y:0, w:0, h:0,
      children:  [],
      variants:  []
    };

    // Only ACTIVE user messages show their threads as navigable variants
    if (m.role === 'user' && m.threads?.length > 0 && isActive) {
      node.variants = m.threads.map((thread, ti) => {
        const bi = { sourceUUID: m.uuid, branchIdx: ti };
        const hd = {
          id:         `${m.uuid}__t${ti}`,
          role:       'user',
          label:      extractText(thread.userMessageContent).replace(/\s+/g,' ').slice(0, 85),
          active:     false,
          sourceUUID: bi.sourceUUID,
          branchIdx:  bi.branchIdx,
          x:0, y:0, w:0, h:0,
          children:  [],
          variants:  []
        };
        // Continuation inherits bi → any node in this branch can navigate home
        hd.children = buildChain(thread.messages || [], 0, false, bi);
        return hd;
      });
      // Active continuation has no inherited branchInfo (they're active)
      node.children = buildChain(msgs, start + 1, true, null);
      return [node];
    }

    // Sequential node — pass branchInfo down for inactive chains
    node.children = buildChain(msgs, start + 1, isActive, branchInfo);
    return [node];
  }

  function buildTree(messages) {
    const chain = buildChain(messages, 0, true, null);
    return chain[0] || null;
  }

  /* ── LAYOUT ──────────────────────────────────────────────── */
  const NW = 210, NH = 60, VGAP = 38;
  // slotW: horizontal space allocated per column (node + gap)
  // Last column has no trailing gap; handled by totalPx calculation.
  const slotW = NW + 28; // 28 = HGAP

  /** Returns number of horizontal columns the subtree needs */
  function cols(node) {
    if (!node) return 1;
    if (node.variants.length > 0) {
      const ac = cols(node.children[0] || null);
      const vc = node.variants.reduce((s, v) => s + cols(v), 0);
      return ac + vc;
    }
    return node.children.length ? cols(node.children[0]) : 1;
  }

  /** Convert column count to pixel width */
  const colsPx = n => n * slotW - 28; // subtract one trailing gap

  function layoutNode(node, cx, cy, all, edges) {
    if (!node) return;
    node.x = cx - NW / 2;
    node.y = cy;
    node.w = NW;
    node.h = NH;
    all.push(node);

    const nextY = cy + NH + VGAP;

    if (node.variants.length > 0) {
      // BRANCH POINT — spread active + variants horizontally
      const ac  = cols(node.children[0] || null);
      const vcs = node.variants.map(v => cols(v));
      const tc  = ac + vcs.reduce((s, c) => s + c, 0);      // total cols
      const totalPx = colsPx(tc);
      let   sx  = cx - totalPx / 2;   // left edge of first allocation

      // Active branch (leftmost)
      if (node.children.length > 0) {
        const aPx  = colsPx(ac);
        const aCx  = sx + aPx / 2;
        edges.push({ fx: cx, fy: cy + NH, tx: aCx, ty: nextY, active: true });
        layoutNode(node.children[0], aCx, nextY, all, edges);
        sx += ac * slotW;
      }
      // Inactive variant branches (right of active)
      node.variants.forEach((v, vi) => {
        const vc  = vcs[vi];
        const vPx = colsPx(vc);
        const vCx = sx + vPx / 2;
        edges.push({ fx: cx, fy: cy + NH, tx: vCx, ty: nextY, active: false });
        layoutNode(v, vCx, nextY, all, edges);
        sx += vc * slotW;
      });
    } else if (node.children.length > 0) {
      // LINEAR — single child, same column
      edges.push({ fx: cx, fy: cy + NH, tx: cx, ty: nextY, active: node.active });
      layoutNode(node.children[0], cx, nextY, all, edges);
    }
  }

  function layout(root) {
    const all = [], edges = [];
    const tc  = cols(root);
    const tPx = colsPx(tc);
    const cx  = tPx / 2 + 60;       // 60 px left margin
    layoutNode(root, cx, 60, all, edges);
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    });
    return { all, edges, bounds: { minX, maxX, maxY } };
  }

  /* ── CANVAS RENDERER ─────────────────────────────────────── */
  const C = {
    uA:'#005c4b', uAb:'#00a884',    // user active bg / border
    uI:'#1f2c34', uIb:'#2a3942',    // user inactive
    aA:'#202c33', aAb:'#2a3942',    // asst active
    aI:'#111b21', aIb:'#1a2530',    // asst inactive
    eA:'#00a884', eI:'rgba(50,70,80,.65)', // edge active/inactive
    tA:'#e9edef', tI:'#44606f',     // text active/inactive
    hov:'#f59e0b', dot:'#f59e0b',
  };

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
  }

  function doRender(canvas, all, edges, tr, hoverId) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(tr.tx, tr.ty);
    ctx.scale(tr.s, tr.s);

    // Edges
    edges.forEach(e => {
      ctx.beginPath();
      ctx.moveTo(e.fx, e.fy);
      const mid = (e.fy + e.ty) / 2;
      ctx.bezierCurveTo(e.fx, mid, e.tx, mid, e.tx, e.ty);
      ctx.strokeStyle = e.active ? C.eA : C.eI;
      ctx.lineWidth   = e.active ? 2 : 1.5;
      ctx.setLineDash(e.active ? [] : [6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Nodes
    all.forEach(n => {
      const isU = n.role === 'user';
      const ia  = n.active;
      const hov = n.id === hoverId;
      const bg  = isU ? (ia ? C.uA : C.uI) : (ia ? C.aA : C.aI );
      const bdr = isU ? (ia ? C.uAb: C.uIb) : (ia ? C.aAb: C.aIb);

      ctx.shadowColor   = 'rgba(0,0,0,.35)';
      ctx.shadowBlur    = hov ? 18 : 5;
      ctx.shadowOffsetY = hov ? 4  : 2;
      rr(ctx, n.x, n.y, n.w, n.h, 10); ctx.fillStyle = bg; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

      rr(ctx, n.x, n.y, n.w, n.h, 10);
      ctx.strokeStyle = hov ? C.hov : bdr;
      ctx.lineWidth   = hov ? 2.5 : 1.5;
      ctx.stroke();

      // Role badge
      const bW = isU ? 36 : 22;
      ctx.fillStyle = isU
        ? (ia ? 'rgba(0,168,132,.28)' : 'rgba(42,57,66,.55)')
        : 'rgba(255,255,255,.05)';
      if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(n.x+7, n.y+7, bW, 15, 3); ctx.fill();
      }
      ctx.fillStyle = isU ? (ia ? '#00a884' : '#3b4a54') : (ia ? '#8696a0' : '#243340');
      ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(isU ? 'USER' : 'AI', n.x + 11, n.y + 17);

      // Message label
      ctx.fillStyle = ia ? C.tA : C.tI;
      ctx.font      = `${ia ? 500 : 400} 10.5px system-ui`;
      const maxW    = n.w - 18;
      let   lbl     = n.label || '(empty)';
      while (ctx.measureText(lbl).width > maxW && lbl.length > 6)
        lbl = lbl.slice(0, -4) + '…';
      ctx.fillText(lbl, n.x + 8, n.y + 42);

      // Orange dot = branch point (has variants)
      if (n.variants?.length) {
        ctx.fillStyle = C.dot;
        ctx.beginPath();
        ctx.arc(n.x + n.w - 9, n.y + 9, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.restore();
  }

  /* ── HIT TEST ────────────────────────────────────────────── */
  function hitTest(all, mx, my, tr) {
    const wx = (mx - tr.tx) / tr.s, wy = (my - tr.ty) / tr.s;
    return all.find(n => wx >= n.x && wx <= n.x + n.w &&
                         wy >= n.y && wy <= n.y + n.h) || null;
  }

  /* ── POST-NAVIGATION SCROLL ─────────────────────────────── */
  function scrollToMessage(uuid) {
    if (!uuid || uuid.includes('__t')) return;
    // TM sets id="message-timestamp-{uuid}" on the timestamp button
    // inside each message's action bar. Walk up from it to find the block.
    const ts = document.getElementById(`message-timestamp-${uuid}`);
    if (ts) {
      (ts.closest('[data-element-id="response-block"]') || ts.parentElement)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Fallback: scroll chat area to 30% (rough mid-point) if UUID not found
    const ca = document.querySelector('[data-element-id="chat-space-middle-part"]');
    if (ca) ca.scrollTop = ca.scrollHeight * 0.3;
  }

  /* ── OVERLAY STATE ───────────────────────────────────────── */
  let overlay = null, toastEl = null;

  function closeOverlay() {
    overlay?.remove(); overlay = null; toastEl = null;
  }

  let toastTimer = null;
  function showToast(msg, type = 'ok') {
    if (!toastEl) return;
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = type;
    toastTimer = setTimeout(() => { if (toastEl) toastEl.className = ''; }, 2800);
  }

  /* ── NAVIGATION ──────────────────────────────────────────────
   *
   *  Clicking an ACTIVE node → close overlay + scroll to it.
   *  Clicking an INACTIVE node → switch branches:
   *    1. React dispatch (primary, async)
   *    2. IDB read-modify-write (persistence + fallback source)
   *    3. After 200 ms verify React updated; if not, force-reload
   *       chat by clicking the currently-selected sidebar entry.
   * ─────────────────────────────────────────────────────────── */
  async function navigateToNode(node) {
    // ── Active node: just close and scroll ─────────────────────
    if (node.active) {
      closeOverlay();
      // Synthetic IDs (branch heads) have no real DOM counterpart
      if (!node.id.includes('__t')) {
        setTimeout(() => scrollToMessage(node.id), 150);
      }
      return;
    }

    // ── Validate ───────────────────────────────────────────────
    if (node.branchIdx === null || node.branchIdx === undefined) {
      showToast('No branch info on node', 'warn'); return;
    }
    const cs = getChatState();
    if (!cs?.state) { showToast('Cannot read TM state', 'err'); return; }

    const msgs   = cs.state.messages;
    const srcIdx = msgs.findIndex(m => m.uuid === node.sourceUUID);
    if (srcIdx < 0) { showToast('Branch source not in messages', 'err'); return; }

    const srcMsg = msgs[srcIdx];
    const ti     = node.branchIdx;
    const target = srcMsg.threads?.[ti];
    if (!target) { showToast('Thread data missing', 'err'); return; }

    showToast('Switching branch…', 'warn');

    /* ── Build new messages array ────────────────────────────────
     *
     *  new messages = [
     *    ...everything before the branch point,
     *    modified branch-point message  (content swapped, threads updated),
     *    ...target.messages             (the newly-active continuation)
     *  ]
     *
     *  The currently-active content and continuation are archived
     *  back into threads[] so the user can switch back later.
     * ───────────────────────────────────────────────────────── */
    const activeCont = msgs.slice(srcIdx + 1); // current active continuation

    // Archive the current branch: save current content + continuation
    // Use exactly the same format TM uses for userMessageContent
    const archivedEntry = {
      userMessageContent: srcMsg.content,   // preserve string OR array as-is
      messages:           activeCont,
      createdAt:          new Date().toISOString()
    };

    // New threads = everything except the one we're activating + archived current
    const newThreads = [
      ...srcMsg.threads.filter((_, i) => i !== ti),
      archivedEntry
    ];

    const newSrcMsg = {
      ...srcMsg,
      content:   target.userMessageContent, // activate target content (string or array)
      threads:   newThreads,
      updatedAt: new Date().toISOString()
    };

    const newMessages = [
      ...msgs.slice(0, srcIdx),
      newSrcMsg,
      ...(target.messages || [])
    ];

    const newChatState = { ...cs.state, messages: newMessages };

    /* ── Strategy 1: React state dispatch ─────────────────────── */
    if (cs.dispatch) {
      try { cs.dispatch(newChatState); }
      catch (e) { console.warn('[TM Graph] dispatch error:', e.message); }
    }

    /* ── Strategy 2: IDB write (runs in parallel — also ensures
     *   persistence if page reloads, and serves as fallback data
     *   source if the dispatch doesn't update the visible state) ─ */
    persistMessages(cs.state.chatID, newMessages).catch(e =>
      console.warn('[TM Graph] IDB write failed:', e.message)
    );

    /* ── Verify React updated (180 ms grace) ──────────────────── */
    await new Promise(r => setTimeout(r, 180));

    const cs2        = getChatState();
    const curContent = extractText(
      cs2?.state?.messages?.find(m => m.uuid === node.sourceUUID)?.content || ''
    ).trim().slice(0, 40);
    const tgtContent = extractText(target.userMessageContent).trim().slice(0, 40);
    const switched   = tgtContent.length > 0 && curContent === tgtContent;

    if (switched) {
      showToast('Branch switched ✓');
      setTimeout(() => {
        closeOverlay();
        // Scroll to the branch-point message (now shows new content)
        setTimeout(() => scrollToMessage(node.sourceUUID), 200);
      }, 380);
    } else {
      /* ── Fallback: dispatch may not have flushed visually.
       *   IDB is already written. Force TM to re-read by
       *   programmatically clicking the selected chat sidebar item —
       *   TM re-initialises the chat component from IDB on navigation. */
      showToast('Applying via reload…', 'warn');
      setTimeout(() => {
        closeOverlay();
        // Click the already-selected chat to force re-read from IDB
        const sel = document.querySelector(
          '[data-element-id="selected-chat-item"],' +
          '[data-element-id="custom-chat-item"].selected,' +
          '[data-element-id="chat-item"][aria-selected="true"]'
        );
        if (sel) {
          sel.click();
          setTimeout(() => scrollToMessage(node.sourceUUID), 800);
        } else {
          // If sidebar item not findable, offer a page-reload prompt
          const ok = confirm('[TM Graph] Branch saved to storage. Reload page to see it?');
          if (ok) window.location.reload();
        }
      }, 420);
    }
  }

  /* ── OPEN GRAPH ──────────────────────────────────────────── */
  function openGraph() {
    if (overlay) { closeOverlay(); return; }

    const cs = getChatState();
    if (!cs) {
      alert('[TM Graph] Cannot find chat state. Open a conversation first.');
      return;
    }
    const root = buildTree(cs.state.messages);
    if (!root) { alert('[TM Graph] No messages found.'); return; }

    const { all, edges, bounds } = layout(root);

    /* ── Build DOM ────────────────────────────────────────────── */
    overlay = document.createElement('div');
    overlay.id = EXT + '-overlay';

    const topbar = document.createElement('div');
    topbar.id = EXT + '-topbar';
    topbar.innerHTML = `
      <div style="display:flex;align-items:center">
        <h2>Chat Branch Graph</h2>
        <span class="hint">Drag · Scroll/pinch to zoom · Tap/click node to navigate</span>
      </div>
      <button id="${EXT}-close" title="Close (Esc)">✕</button>`;

    const legend = document.createElement('div');
    legend.id = EXT + '-legend';
    legend.innerHTML = `
      <span><span class="${EXT}-ldot" style="background:#00a884"></span>Active path (tap = scroll to)</span>
      <span><span class="${EXT}-ldot" style="background:#1f2c34;border:1px solid #3b4a54"></span>Inactive branch (tap = switch to)</span>
      <span><span class="${EXT}-ldot" style="background:#f59e0b"></span>Branch point</span>`;

    const wrap    = document.createElement('div'); wrap.id = EXT + '-wrap';
    const canvas  = document.createElement('canvas'); canvas.id = EXT + '-cv';
    canvas.style.cursor = 'grab';
    toastEl = document.createElement('div'); toastEl.id = EXT + '-toast';

    wrap.appendChild(canvas);
    wrap.appendChild(toastEl);
    overlay.appendChild(topbar);
    overlay.appendChild(legend);
    overlay.appendChild(wrap);
    document.body.appendChild(overlay);

    topbar.querySelector('#' + EXT + '-close').onclick = closeOverlay;

    /* ── Canvas state ────────────────────────────────────────── */
    let tr = { tx: 0, ty: 0, s: 1 };
    let hoverId = null;

    function centre() {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W || !H) return;
      const cW = bounds.maxX - bounds.minX + 120;
      const cH = bounds.maxY - 60 + 120;     // content starts at y=60
      tr.s  = Math.max(0.2, Math.min(1.3, Math.min(W / cW, H / cH)));
      tr.tx = (W - cW * tr.s) / 2 - bounds.minX * tr.s + 60 * tr.s;
      tr.ty = (H - cH * tr.s) / 2 - 60 * tr.s + 60 * tr.s;  // ~vertically centred
    }

    const draw = () => doRender(canvas, all, edges, tr, hoverId);

    // Initial render
    requestAnimationFrame(() => { centre(); draw(); });

    // Keep centred on resize
    const ro = new ResizeObserver(() => requestAnimationFrame(() => { centre(); draw(); }));
    ro.observe(wrap);

    /* ── MOUSE — scroll-wheel zoom ───────────────────────────── */
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const d  = e.deltaY < 0 ? 1.09 : 0.92;
      tr.tx = mx - (mx - tr.tx) * d;
      tr.ty = my - (my - tr.ty) * d;
      tr.s  = Math.min(3.5, Math.max(0.12, tr.s * d));
      draw();
    }, { passive: false });

    /* ── MOUSE — drag pan ────────────────────────────────────── */
    let mdrag = null;
    canvas.addEventListener('mousedown', e => {
      mdrag = { sx: e.clientX - tr.tx, sy: e.clientY - tr.ty };
      canvas.classList.add('drag');
    });

    /* NOTE: mousemove/mouseup on WINDOW to handle fast drags that
     * exit the canvas boundary. Removed on overlay close. */
    function onMouseMove(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const hit = hitTest(all, mx, my, tr);
      const nid = hit?.id || null;
      if (nid !== hoverId) { hoverId = nid; draw(); }
      canvas.style.cursor =
        mdrag ? 'grabbing' : nid ? (hit.active ? 'default' : 'pointer') : 'grab';
      if (mdrag) { tr.tx = e.clientX - mdrag.sx; tr.ty = e.clientY - mdrag.sy; draw(); }
    }
    function onMouseUp() { mdrag = null; canvas.classList.remove('drag'); }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);

    /* ── MOUSE — click (desktop) ─────────────────────────────── */
    canvas.addEventListener('click', e => {
      if (mdrag) return; // was actually a drag-release
      const rect = canvas.getBoundingClientRect();
      const hit  = hitTest(all, e.clientX - rect.left, e.clientY - rect.top, tr);
      if (hit) navigateToNode(hit);
    });

    /* ── TOUCH — complete rewrite to fix Android PWA ─────────────
     *
     *  Problem in v1.0.0:
     *    touchstart called e.preventDefault() which suppresses the
     *    browser's synthetic 'click' event. On Android PWA (touch-
     *    only device), the click listener never fired, so node
     *    navigation was completely broken.
     *
     *  Fix:
     *    • Track touchStartInfo = { x, y, time } on touchstart.
     *    • Set a `panning` flag true only when movement exceeds 8 px.
     *    • In touchend: if NOT panning AND movement < 15 px AND
     *      duration < 350 ms AND ALL fingers lifted → it was a tap →
     *      hit test + navigate.
     *    • Update hoverId on touchstart for immediate visual feedback.
     * ─────────────────────────────────────────────────────────── */
    let lastTouches   = null;
    let touchStart    = null;   // { x, y, time }
    let panning       = false;

    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const ts = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
      lastTouches = ts;
      panning     = false;

      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };

        // Immediate hover feedback on touch
        const rect = canvas.getBoundingClientRect();
        const hit  = hitTest(all, t.clientX - rect.left, t.clientY - rect.top, tr);
        if ((hit?.id || null) !== hoverId) { hoverId = hit?.id || null; draw(); }
      } else {
        touchStart = null; // multi-finger: not going to be a tap
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const ts = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));

      // Mark as pan if finger moved > 8 px from start
      if (touchStart) {
        const t  = e.touches[0];
        const mv = Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y);
        if (mv > 8) panning = true;
      }

      if (ts.length === 1 && lastTouches?.length === 1) {
        // Single-finger pan
        tr.tx += ts[0].x - lastTouches[0].x;
        tr.ty += ts[0].y - lastTouches[0].y;

        // Update hover during drag
        const rect = canvas.getBoundingClientRect();
        const hit  = hitTest(all, ts[0].x - rect.left, ts[0].y - rect.top, tr);
        hoverId = hit?.id || null;
        draw();

      } else if (ts.length === 2 && lastTouches?.length === 2) {
        // Two-finger pinch-to-zoom
        const prevD = Math.hypot(
          lastTouches[1].x - lastTouches[0].x,
          lastTouches[1].y - lastTouches[0].y);
        const curD  = Math.hypot(ts[1].x - ts[0].x, ts[1].y - ts[0].y);
        if (prevD > 0) {
          const d    = curD / prevD;
          const rect = canvas.getBoundingClientRect();
          const mx   = (ts[0].x + ts[1].x) / 2 - rect.left;
          const my   = (ts[0].y + ts[1].y) / 2 - rect.top;
          tr.tx = mx - (mx - tr.tx) * d;
          tr.ty = my - (my - tr.ty) * d;
          tr.s  = Math.min(3.5, Math.max(0.12, tr.s * d));
          draw();
        }
      }
      lastTouches = ts;
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
      e.preventDefault();

      /* TAP detection rules:
       *   • All fingers must be lifted (e.touches.length === 0)
       *   • Only one finger was down when the tap started
       *   • Movement since touchstart < 15 px
       *   • Duration < 350 ms
       *   • We did NOT enter pan mode */
      if (touchStart                  &&
          !panning                    &&
          e.touches.length === 0      &&
          e.changedTouches.length === 1) {
        const t  = e.changedTouches[0];
        const mv = Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y);
        const dt = Date.now() - touchStart.time;

        if (mv < 15 && dt < 350) {
          // Valid tap — locate node and navigate
          const rect = canvas.getBoundingClientRect();
          const hit  = hitTest(all, t.clientX - rect.left, t.clientY - rect.top, tr);
          if (hit) {
            hoverId = hit.id; draw();            // small delay: let the hover highlight show first
            setTimeout(() => navigateToNode(hit), 60);
          }
        }
      }

      touchStart  = null;
      panning     = false;
      if (e.touches.length === 0) {
        lastTouches = null;
        hoverId     = null;
        draw();
      } else {
        lastTouches = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
      }
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => {
      lastTouches = null; touchStart = null; panning = false;
      hoverId = null; draw();
    }, { passive: false });

    /* ── Keyboard: Escape to close ───────────────────────────── */
    const onKey = e => {
      if (e.key === 'Escape') {
        closeOverlay();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup',   onMouseUp);
      }
    };
    window.addEventListener('keydown', onKey);

    // Also clean up listeners when overlay is removed externally
    const origClose = closeOverlay;
    overlay._cleanup = () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }

  /* ── PATCHED closeOverlay (runs cleanup) ─────────────────── */
  const _closeOverlay = closeOverlay;
  function closeOverlay() {
    overlay?._cleanup?.();
    _closeOverlay();
  }

  /* ── BUTTON INJECTION (mirrors ping_server.js pattern) ───── */
  const TOOLBAR = '[data-element-id="chat-input-actions"]';

  function tryInject() {
    const bar = document.querySelector(TOOLBAR);
    if (!bar || bar.querySelector('#' + EXT + '-btn')) return;
    const btn = document.createElement('button');
    btn.id    = EXT + '-btn';
    btn.title = 'Chat Branch Graph';
    btn.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="4" cy="4" r="2.2"/><circle cx="16" cy="4" r="2.2"/>
        <circle cx="4" cy="16" r="2.2"/><circle cx="16" cy="16" r="2.2"/>
        <circle cx="10" cy="10" r="2.2"/>
        <line x1="4" y1="4" x2="10" y2="10"/>
        <line x1="16" y1="4" x2="10" y2="10"/>
        <line x1="10" y1="10" x2="4" y2="16"/>
        <line x1="10" y1="10" x2="16" y2="16"/>
      </svg>`;
    btn.addEventListener('click', openGraph);
    bar.appendChild(btn);
  }

  /* ── BOOTSTRAP ───────────────────────────────────────────── */
  function init() {
    injectStyles();
    tryInject();
    let r = 10;
    const retry = () => {
      if (document.querySelector('#' + EXT + '-btn')) return;
      tryInject();
      if (--r > 0) setTimeout(retry, 650);
    };
    setTimeout(retry, 400);
    new MutationObserver(tryInject)
      .observe(document.body, { childList: true, subtree: true });
    console.log('[TM Chat Graph] ✅ v1.1.0');
  }

  init();
})();
