// ============================================================
//  TypingMind — Chat Branch Graph
//  Version : 1.0.0
//
//  Data model (confirmed from live IDB/fiber probe):
//    messages[]  = flat active path
//    msg.threads = [{userMessageContent, messages, createdAt}]
//                  one entry per previous edit on that user turn
//
//  Navigation: find React state dispatcher at fiber depth ~14
//  (component "o", hook 0 = full chat object with messages[])
//  Dispatch is called with the modified chat object to switch
//  paths — no DOM simulation, no page reload needed.
//
//  Button injection: same pattern as ping_server.js
//  Target: [data-element-id="chat-input-actions"]
// ============================================================

(() => {
  'use strict';

  const EXT_ID = 'tmChatGraph';

  // ─────────────────────────────────────────────────────────
  //  STYLES
  // ─────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById(EXT_ID + '-css')) return;
    const s = document.createElement('style');
    s.id = EXT_ID + '-css';
    s.textContent = `
      #${EXT_ID}-btn {
        display: flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; border-radius: 8px; border: none;
        background: transparent; cursor: pointer; color: inherit;
        transition: background 0.15s;
      }
      #${EXT_ID}-btn:hover { background: rgba(255,255,255,0.12); }
      #${EXT_ID}-btn svg   { width: 18px; height: 18px; }

      #${EXT_ID}-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(11,20,26,0.97);
        display: flex; flex-direction: column;
        font-family: system-ui, -apple-system, sans-serif;
      }
      #${EXT_ID}-topbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.1);
        flex-shrink: 0;
      }
      #${EXT_ID}-topbar h2 {
        margin: 0; font-size: 14px; font-weight: 700;
        color: #e9edef; letter-spacing: 0.3px;
      }
      #${EXT_ID}-topbar .hint {
        font-size: 11px; color: #8696a0; margin-left: 10px;
      }
      #${EXT_ID}-close {
        background: none; border: none; cursor: pointer;
        color: #8696a0; font-size: 20px; line-height: 1;
        padding: 4px 8px; border-radius: 6px;
        transition: background 0.15s, color 0.15s;
      }
      #${EXT_ID}-close:hover { background: rgba(255,255,255,0.1); color: #e9edef; }
      #${EXT_ID}-canvas-wrap { flex: 1; overflow: hidden; position: relative; }
      #${EXT_ID}-canvas      { display: block; cursor: grab; }
      #${EXT_ID}-canvas.dragging { cursor: grabbing; }
      #${EXT_ID}-toast {
        position: absolute; bottom: 16px; left: 50%;
        transform: translateX(-50%) translateY(60px);
        background: #00a884; color: #0b141a;
        padding: 7px 16px; border-radius: 20px;
        font-size: 12px; font-weight: 700;
        transition: transform 0.25s;
        pointer-events: none; white-space: nowrap;
      }
      #${EXT_ID}-toast.show { transform: translateX(-50%) translateY(0); }
    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────
  //  REACT FIBER ACCESS
  // ─────────────────────────────────────────────────────────
  function getFiber(el) {
    const k = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    return k ? el[k] : null;
  }

  /** Find the chat state {state, dispatch} from React fiber tree */
  function getChatState() {
    const chatArea = document.querySelector('[data-element-id="chat-space-middle-part"]');
    if (!chatArea) return null;
    const root = getFiber(chatArea);
    if (!root) return null;

    let f = root;
    let depth = 0;
    while (f && depth < 70) {
      let hs = f.memoizedState;
      let hi = 0;
      while (hs && hi < 5) {
        const v = hs.memoizedState;
        if (v && typeof v === 'object' && !Array.isArray(v) &&
            v.messages && Array.isArray(v.messages) &&
            v.chatID) {
          return { state: v, dispatch: hs.queue?.dispatch, hookNode: hs };
        }
        hs = hs.next;
        hi++;
      }
      f = f.return;
      depth++;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────
  //  TREE BUILDER
  //  Converts TM's flat messages[] + threads into a proper
  //  tree of GraphNode objects.
  // ─────────────────────────────────────────────────────────

  /**
   * GraphNode {
   *   id:       string        — UUID of the message
   *   role:     'user'|'asst' — shortened role
   *   label:    string        — first 90 chars of text content
   *   active:   boolean       — true = on the currently visible path
   *   branchOf: string|null   — parent UUID (for non-active branches)
   *   children: GraphNode[]   — sequential children (next message in same path)
   *   variants: GraphNode[][] — parallel alternative branches (from threads)
   * }
   */

  function extractText(content) {
    if (!content) return '';
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content.map(c => (typeof c === 'object' ? c.text || '' : String(c))).join(' ').trim();
    }
    return String(content);
  }

  /**
   * Build a linear chain of GraphNodes from a messages slice.
   * Recursively handles threads (branches) on user messages.
   *
   * @param  {object[]} msgs    — messages array
   * @param  {number}   start   — starting index
   * @param  {boolean}  isActive — are these on the live path?
   * @returns GraphNode[]  — array of nodes (linear chain, first = head)
   */
  function buildChain(msgs, start, isActive) {
    const nodes = [];
    for (let i = start; i < msgs.length; i++) {
      const m = msgs[i];
      const node = {
        id:       m.uuid,
        role:     m.role === 'user' ? 'user' : 'asst',
        label:    extractText(m.content).slice(0, 90),
        active:   isActive,
        // layout fields (set later)
        x: 0, y: 0, w: 0, h: 0,
        children:  [],
        variants:  [],          // alternative branches at this node
        branchIdx: null,        // which threads[] index leads here (if inactive)
        sourceUUID: m.uuid,     // the user-msg UUID that owns the threads
        rawMsg:   m            // keep reference for navigation
      };

      // If user message has old branches in threads[], build them as variants
      if (m.role === 'user' && m.threads && m.threads.length > 0) {
        m.threads.forEach((thread, ti) => {
          const altContent = extractText(thread.userMessageContent);
          // Head node for the alternative version
          const altHead = {
            id:        `${m.uuid}__thread${ti}`,
            role:      'user',
            label:     altContent.slice(0, 90),
            active:    false,
            x: 0, y: 0, w: 0, h: 0,
            children:  [],
            variants:  [],
            branchIdx: ti,
            sourceUUID: m.uuid,
            threadMessages: thread.messages
          };
          // Build continuation chain for this alternative
          altHead.children = buildChain(thread.messages || [], 0, false);
          node.variants.push(altHead);
        });
      }

      nodes.push(node);

      // If this node has variants, the REST of msgs[] (i+1…) is the
      // continuation of the ACTIVE branch, attached to this node itself
      if (node.variants.length > 0) {
        node.children = buildChain(msgs, i + 1, isActive);
        break; // handled rest of chain via recursion
      }
      // Otherwise: next msg is sequential child
      if (i + 1 < msgs.length) {
        // will be added as next element in `nodes`, then linked below
      }
    }

    // Link sequential chain: each node.children = [next node]
    for (let i = 0; i < nodes.length - 1; i++) {
      if (nodes[i].children.length === 0) {
        nodes[i].children = [nodes[i + 1]];
      }
    }

    return nodes.length > 0 ? [nodes[0]] : [];
  }

  function buildTree(messages) {
    if (!messages || !messages.length) return null;
    const roots = buildChain(messages, 0, true);
    return roots[0] || null;
  }

  // ─────────────────────────────────────────────────────────
  //  LAYOUT
  //  Assigns x, y, w, h to every node in the tree.
  //  Strategy:
  //    - Top-down; sequential nodes stack vertically
  //    - At branch points: active branch stays in column,
  //      inactive variants spread left/right
  // ─────────────────────────────────────────────────────────

  const NODE_W  = 200;
  const NODE_H  = 56;
  const V_GAP   = 40;   // vertical gap between rows
  const H_GAP   = 30;   // horizontal gap between sibling branches

  /** Count total columns needed for a subtree rooted at node */
  function countColumns(node) {
    if (!node) return 1;
    const variantCols = node.variants.reduce((s, v) => s + countColumns(v), 0);
    const activeCols  = node.children.length > 0
      ? countColumns(node.children[0])
      : 1;
    return Math.max(activeCols, variantCols > 0 ? variantCols + activeCols : 1);
  }

  /**
   * Assign positions.
   * @param node    node to position
   * @param cx      horizontal centre (pixels)
   * @param top     top y (pixels)
   * @param allNodes accumulator to collect flat list
   */
  function layoutNode(node, cx, top, allNodes, edges) {
    if (!node) return;
    node.x = cx - NODE_W / 2;
    node.y = top;
    node.w = NODE_W;
    node.h = NODE_H;
    allNodes.push(node);

    const nextY = top + NODE_H + V_GAP;

    // If there are variants: spread them horizontally
    if (node.variants.length > 0) {
      // All branches (including active continuation) side by side
      const allBranches = [
        // Represent the active continuation as a pseudo-group
        { isActive: true,  node: node.children[0], colW: countColumns(node.children[0]) },
        // Inactive alternatives
        ...node.variants.map(v => ({ isActive: false, node: v, colW: countColumns(v) }))
      ].filter(b => b.node);

      const totalCols = allBranches.reduce((s, b) => s + b.colW, 0);
      const totalW    = totalCols * (NODE_W + H_GAP) - H_GAP;
      let   cx0       = cx - totalW / 2;

      allBranches.forEach(b => {
        const bW     = b.colW * (NODE_W + H_GAP) - H_GAP;
        const branchCx = cx0 + bW / 2;
        edges.push({ from: node, toX: branchCx + NODE_W / 2, toY: nextY,
                     active: b.isActive });
        layoutNode(b.node, branchCx + NODE_W / 2, nextY, allNodes, edges);
        cx0 += bW + H_GAP;
      });

    } else if (node.children.length > 0) {
      edges.push({ from: node, toX: cx, toY: nextY, active: node.children[0].active });
      layoutNode(node.children[0], cx, nextY, allNodes, edges);
    }
  }

  function layout(root) {
    const allNodes = [], edges = [];
    const cx = Math.max(500, countColumns(root) * (NODE_W + H_GAP) / 2);
    layoutNode(root, cx, 60, allNodes, edges);
    // Compute bounding box
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    allNodes.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    });
    return { allNodes, edges, bounds: { minX, maxX, maxY } };
  }

  // ─────────────────────────────────────────────────────────
  //  CANVAS RENDERER
  // ─────────────────────────────────────────────────────────

  const COL = {
    user_active:  '#005c4b',
    user_bg_a:    '#00a884',  // active user border
    user_border:  '#00a884',
    user_inactive:'#2a3942',
    user_b_inact: '#3b4a54',
    asst_active:  '#202c33',
    asst_border:  '#3b4a54',
    asst_inactive:'#111b21',
    edge_active:  '#00a884',
    edge_inactive:'#3b4a54',
    text_active:  '#e9edef',
    text_inactive:'#8696a0',
    hover_ring:   '#f59e0b',
  };

  function drawRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function render(canvas, allNodes, edges, transform, hoverId) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(transform.tx, transform.ty);
    ctx.scale(transform.scale, transform.scale);

    // Draw edges
    edges.forEach(e => {
      const fx = e.from.x + e.from.w / 2;
      const fy = e.from.y + e.from.h;
      const tx = e.toX;
      const ty = e.toY;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.bezierCurveTo(fx, fy + (ty - fy) * 0.5, tx, ty - (ty - fy) * 0.5, tx, ty);
      ctx.strokeStyle = e.active ? COL.edge_active : COL.edge_inactive;
      ctx.lineWidth   = e.active ? 2 : 1.5;
      ctx.setLineDash(e.active ? [] : [5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw nodes
    allNodes.forEach(n => {
      const isUser  = n.role === 'user';
      const isActive = n.active;
      const isHover = n.id === hoverId;
      const bg     = isUser
        ? (isActive ? COL.user_active  : COL.user_inactive)
        : (isActive ? COL.asst_active  : COL.asst_inactive);
      const border = isUser
        ? (isActive ? COL.user_border  : COL.user_b_inact)
        : COL.asst_border;

      // Shadow
      ctx.shadowColor   = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur    = isHover ? 14 : 6;
      ctx.shadowOffsetY = 2;

      drawRoundRect(ctx, n.x, n.y, n.w, n.h, 10);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;

      // Border
      drawRoundRect(ctx, n.x, n.y, n.w, n.h, 10);
      ctx.strokeStyle = isHover ? COL.hover_ring : border;
      ctx.lineWidth   = isHover ? 2.5 : 1.5;
      ctx.stroke();

      // Role badge
      const badgeW = isUser ? 36 : 34;
      const badgeX = n.x + 8;
      const badgeY = n.y + 8;
      ctx.fillStyle = isUser ? (isActive ? 'rgba(0,168,132,0.35)' : 'rgba(59,74,84,0.5)')
                             : 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.roundRect?.(badgeX, badgeY, badgeW, 16, 4);
      ctx.fill();
      ctx.fillStyle = isUser
        ? (isActive ? '#00a884' : '#8696a0')
        : (isActive ? '#8696a0' : '#4a5568');
      ctx.font = 'bold 9px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(isUser ? 'YOU' : 'AI', badgeX + 5, badgeY + 11);

      // Label text
      ctx.fillStyle = isActive ? COL.text_active : COL.text_inactive;
      ctx.font = `${isActive ? 600 : 400} 11px system-ui`;
      ctx.textAlign = 'left';
      const maxTextW = n.w - 20;
      let label = n.label || '(empty)';
      // Truncate to fit
      while (ctx.measureText(label).width > maxTextW && label.length > 10) {
        label = label.slice(0, -4) + '…';
      }
      ctx.fillText(label, n.x + 10, n.y + 38);

      // Variant indicator dot on branch nodes
      if (n.variants && n.variants.length > 0) {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(n.x + n.w - 10, n.y + 10, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────
  //  HIT TEST
  // ─────────────────────────────────────────────────────────
  function hitTest(allNodes, tx, ty, transform) {
    const wx = (tx - transform.tx) / transform.scale;
    const wy = (ty - transform.ty) / transform.scale;
    return allNodes.find(n =>
      wx >= n.x && wx <= n.x + n.w &&
      wy >= n.y && wy <= n.y + n.h
    ) || null;
  }

  // ─────────────────────────────────────────────────────────
  //  NAVIGATION
  //  Reconstruct the messages[] array to make the clicked
  //  branch the active path, then dispatch to React state.
  // ─────────────────────────────────────────────────────────

  function navigateToNode(node) {
    // node.branchIdx is set iff the node is an INACTIVE variant
    if (node.active) return;  // already on active path, nothing to do

    const cs = getChatState();
    if (!cs || !cs.dispatch) {
      showToast('Cannot access TM state – please try again');
      return;
    }

    const msgs   = cs.state.messages;
    const srcUUID = node.sourceUUID;
    const srcIdx  = msgs.findIndex(m => m.uuid === srcUUID);
    if (srcIdx < 0) { showToast('Message not found in state'); return; }

    const srcMsg = msgs[srcIdx];
    const ti     = node.branchIdx;  // index into threads[]
    const target = srcMsg.threads?.[ti];
    if (!target) { showToast('Thread not found'); return; }

    // Build: keep messages before branch point, replace branch message content,
    // remove thread[ti] and add current state as a new thread, append target continuation
    const currentContinuation = msgs.slice(srcIdx + 1);
    const newThreads = srcMsg.threads.filter((_, i) => i !== ti);
    newThreads.push({
      userMessageContent: srcMsg.content,
      messages:           currentContinuation,
      createdAt:          new Date().toISOString()
    });

    const newSrcMsg = {
      ...srcMsg,
      content:   target.userMessageContent,
      threads:   newThreads,
      updatedAt: new Date().toISOString()
    };

    const newMessages = [
      ...msgs.slice(0, srcIdx),
      newSrcMsg,
      ...(target.messages || [])
    ];

    cs.dispatch({ ...cs.state, messages: newMessages });
    showToast('Switched to branch ✓');
    // Close overlay after brief pause so user sees confirmation
    setTimeout(closeOverlay, 700);
  }

  // ─────────────────────────────────────────────────────────
  //  OVERLAY
  // ─────────────────────────────────────────────────────────
  let overlay = null;
  let toastEl = null;

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl?.classList.remove('show'), 2000);
  }

  function closeOverlay() {
    overlay?.remove();
    overlay = null;
    toastEl = null;
  }

  function openGraph() {
    if (overlay) { closeOverlay(); return; }

    const cs = getChatState();
    if (!cs) {
      alert('[TM Graph] Cannot find chat state — ensure you are in an active conversation.');
      return;
    }

    const root = buildTree(cs.state.messages);
    if (!root) { alert('[TM Graph] No messages found.'); return; }

    const { allNodes, edges, bounds } = layout(root);

    // ── Build overlay DOM ──────────────────────────────────
    overlay = document.createElement('div');
    overlay.id = EXT_ID + '-overlay';

    const topbar = document.createElement('div');
    topbar.id = EXT_ID + '-topbar';
    topbar.innerHTML = `
      <div style="display:flex;align-items:center">
        <h2>Chat Branch Graph</h2>
        <span class="hint">Scroll to zoom · Drag to pan · Click inactive node to switch branch</span>
      </div>
      <button id="${EXT_ID}-close" title="Close">✕</button>
    `;

    const wrap = document.createElement('div');
    wrap.id = EXT_ID + '-canvas-wrap';

    const canvas = document.createElement('canvas');
    canvas.id = EXT_ID + '-canvas';
    canvas.style.width  = '100%';
    canvas.style.height = '100%';

    toastEl = document.createElement('div');
    toastEl.id = EXT_ID + '-toast';

    wrap.appendChild(canvas);
    wrap.appendChild(toastEl);
    overlay.appendChild(topbar);
    overlay.appendChild(wrap);
    document.body.appendChild(overlay);

    topbar.querySelector('#' + EXT_ID + '-close').onclick = closeOverlay;

    // ── Canvas state ───────────────────────────────────────
    let transform = { tx: 0, ty: 0, scale: 1 };
    let hoverId   = null;

    // Centre view on content
    function centreView() {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const cW = bounds.maxX - bounds.minX + 60;
      const cH = bounds.maxY + 80;
      const sc  = Math.min(1, W / cW, H / cH, 1.4);
      transform.scale = sc;
      transform.tx = (W - cW * sc) / 2 - bounds.minX * sc + 30 * sc;
      transform.ty = 30 * sc;
    }

    function redraw() { render(canvas, allNodes, edges, transform, hoverId); }

    // Defer until canvas has actual dimensions
    requestAnimationFrame(() => {
      centreView();
      redraw();
    });

    // ── Resize ─────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => { centreView(); redraw(); });
    });
    ro.observe(wrap);

    // ── Mouse zoom (scroll wheel) ──────────────────────────
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect  = canvas.getBoundingClientRect();
      const mx    = e.clientX - rect.left;
      const my    = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1.08 : 0.93;
      transform.tx = mx - (mx - transform.tx) * delta;
      transform.ty = my - (my - transform.ty) * delta;
      transform.scale = Math.min(3, Math.max(0.2, transform.scale * delta));
      redraw();
    }, { passive: false });

    // ── Mouse pan ──────────────────────────────────────────
    let drag = null;
    canvas.addEventListener('mousedown', e => {
      drag = { sx: e.clientX - transform.tx, sy: e.clientY - transform.ty };
      canvas.classList.add('dragging');
    });
    window.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const hit = hitTest(allNodes, mx, my, transform);
      const newHoverId = hit?.id || null;
      if (newHoverId !== hoverId) { hoverId = newHoverId; redraw(); }
      canvas.style.cursor = hoverId
        ? (allNodes.find(n => n.id === hoverId)?.active ? 'default' : 'pointer')
        : (drag ? 'grabbing' : 'grab');
      if (drag) {
        transform.tx = e.clientX - drag.sx;
        transform.ty = e.clientY - drag.sy;
        redraw();
      }
    });
    window.addEventListener('mouseup', () => {
      drag = null; canvas.classList.remove('dragging');
    });

    // ── Click a node ───────────────────────────────────────
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      const hit  = hitTest(allNodes, e.clientX - rect.left, e.clientY - rect.top, transform);
      if (hit) navigateToNode(hit);
    });

    // ── Touch: pinch-to-zoom + pan ─────────────────────────
    let lastTouches = null;
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      lastTouches = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
    }, { passive: false });
    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const touches = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
      if (touches.length === 1 && lastTouches?.length === 1) {
        transform.tx += touches[0].x - lastTouches[0].x;
        transform.ty += touches[0].y - lastTouches[0].y;
        redraw();
      } else if (touches.length === 2 && lastTouches?.length === 2) {
        const prevDist = Math.hypot(
          lastTouches[1].x - lastTouches[0].x,
          lastTouches[1].y - lastTouches[0].y);
        const curDist  = Math.hypot(
          touches[1].x - touches[0].x,
          touches[1].y - touches[0].y);
        const midX = (touches[0].x + touches[1].x) / 2;
        const midY = (touches[0].y + touches[1].y) / 2;
        const delta = curDist / prevDist;
        const rect  = canvas.getBoundingClientRect();
        const mx = midX - rect.left, my = midY - rect.top;
        transform.tx = mx - (mx - transform.tx) * delta;
        transform.ty = my - (my - transform.ty) * delta;
        transform.scale = Math.min(3, Math.max(0.2, transform.scale * delta));
        redraw();
      }
      lastTouches = touches;
    }, { passive: false });
    canvas.addEventListener('touchend', () => { lastTouches = null; });

    // Escape to close
    const onKey = e => { if (e.key === 'Escape') { closeOverlay(); window.removeEventListener('keydown', onKey); } };
    window.addEventListener('keydown', onKey);
  }

  // ─────────────────────────────────────────────────────────
  //  BUTTON INJECTION
  //  Mirror of ping_server.js pattern:
  //  Target [data-element-id="chat-input-actions"]
  // ─────────────────────────────────────────────────────────

  const TOOLBAR_SEL = '[data-element-id="chat-input-actions"]';
  let   injectedToolbar = null;

  function injectButton(toolbar) {
    if (toolbar.querySelector('#' + EXT_ID + '-btn')) return; // already there
    const btn = document.createElement('button');
    btn.id    = EXT_ID + '-btn';
    btn.title = 'Chat Branch Graph';
    btn.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
           stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="4"  cy="4"  r="2.2"/>
        <circle cx="16" cy="4"  r="2.2"/>
        <circle cx="4"  cy="16" r="2.2"/>
        <circle cx="16" cy="16" r="2.2"/>
        <circle cx="10" cy="10" r="2.2"/>
        <line x1="4"  y1="4"  x2="10" y2="10"/>
        <line x1="16" y1="4"  x2="10" y2="10"/>
        <line x1="10" y1="10" x2="4"  y2="16"/>
        <line x1="10" y1="10" x2="16" y2="16"/>
      </svg>`;
    btn.addEventListener('click', openGraph);
    toolbar.appendChild(btn);
    injectedToolbar = toolbar;
  }

  function tryInject() {
    const toolbar = document.querySelector(TOOLBAR_SEL);
    if (toolbar) {
      injectButton(toolbar);
    } else if (injectedToolbar && !document.contains(injectedToolbar.querySelector('#' + EXT_ID + '-btn'))) {
      injectedToolbar = null;
    }
  }

  // ─────────────────────────────────────────────────────────
  //  BOOTSTRAP
  // ─────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    tryInject();

    // Retry with backoff for initial load
    let retries = 8;
    const retry = () => {
      if (document.querySelector('#' + EXT_ID + '-btn')) return;
      tryInject();
      if (--retries > 0) setTimeout(retry, 600);
    };
    setTimeout(retry, 400);

    // MutationObserver keeps button alive across SPA navigation
    new MutationObserver(tryInject)
      .observe(document.body, { childList: true, subtree: true });

    console.log('[TM Chat Graph] ✅ v1.0 loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
