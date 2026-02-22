// ================================================================
//  TypingMind — Chat Branch Graph  v2.3.0
//
//  Changes vs v2.2.1:
//
//  1. SCROLL (Go to Message):
//     Root cause identified: TM's focus-restoration handler fires
//     after overlay.remove() and resets scroll position.
//     Fix: multi-strategy fire sequence —
//       • Promise.resolve() microtask (before TM focus handler)
//       • double-rAF (after browser paint)
//       • t+300ms, t+800ms (after TM focus events settle)
//     Both scrollIntoView and explicit scrollTop are applied each
//     time for maximum platform coverage.
//     Honest limitation: if TM's focus handler fires repeatedly
//     on each of our scrolls, reliable scroll cannot be guaranteed
//     without modifying TM's source code.
//
//  2. COLOR CODING:
//     User inactive: toned-down GREEN (was blue-gray — now matches
//     the green family like AI inactive matches blue family).
//     Tool active: "passive-active" gray (identifiable as part of
//     chain but clearly de-emphasized).
//     Tool inactive: very quiet gray.
//     Full three-tier consistency across active/inactive states.
//
//  3. PREVIEW PANEL LAYOUT:
//     Status badge: pill-shaped indicator with state-appropriate
//     color (green=active, amber=inactive with step count).
//     "MESSAGE CONTENT" section rule: horizontal divider line with
//     label clearly separates UI instructions from actual content.
//     Rendered content area has no visual ambiguity with the UI
//     chrome above it.
// ================================================================
(() => {
  'use strict';
  const EXT        = 'tmChatGraph';
  const SCROLL_KEY = 'tmg_scroll_uuid';

  function checkScrollAfterReload() {
    const uuid = sessionStorage.getItem(SCROLL_KEY);
    if (!uuid) return;
    sessionStorage.removeItem(SCROLL_KEY);
    scrollAfterReload(uuid);
  }

  /* ── HIGHLIGHT PULSE ─────────────────────────────────────────── */
  function highlightBlock(block) {
    if (!block) return;
    block.style.animation = '';
    void block.offsetWidth;
    block.style.borderRadius = '8px';
    block.style.animation    = 'tmg-pulse 0.8s ease-out 2';
    const cleanup = () => { block.style.animation = ''; block.style.borderRadius = ''; };
    block.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 2000);
  }

  /* ── CORE SCROLL PRIMITIVE ───────────────────────────────────────
   *
   *  Applies scroll using BOTH methods simultaneously:
   *
   *  A. scrollIntoView({block:'center', behavior:'instant'})
   *     − Browser's native scroll; handles nested containers.
   *     − block:'center' is non-skipping (always scrolls to center).
   *
   *  B. Explicit scrollTop via ancestor walk-up
   *     − Directly targets the confirmed scroller from diagnostic.
   *     − Independent of scrollIntoView optimisations.
   *
   *  Returns false only if the element is not in the DOM.
   * ─────────────────────────────────────────────────────────────── */
  function scrollToMessage(uuid, doHighlight) {
    if (!uuid || uuid.includes('__t')) return false;

    const tsBtn = document.getElementById(`message-timestamp-${uuid}`);
    if (!tsBtn) return false;

    const block = tsBtn.closest('[data-element-id="response-block"]') || tsBtn.parentElement;
    if (!block) return false;

    // Method A — browser native
    try { block.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (_) {}

    // Method B — explicit scrollTop (belt-and-suspenders)
    let el = block.parentElement;
    while (el && el !== document.documentElement) {
      const oy = window.getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
           el.scrollHeight > el.clientHeight + 1) {
        const sr     = el.getBoundingClientRect();
        const br     = block.getBoundingClientRect();
        const target = el.scrollTop + (br.top - sr.top) - el.clientHeight / 2 + br.height / 2;
        el.scrollTop = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight));
        break;
      }
      el = el.parentElement;
    }

    if (doHighlight) highlightBlock(block);
    return true;
  }

  /* ── SCROLL: after overlay close (active node — no reload) ───────
   *
   *  Fire sequence (see v2.3.0 header for root-cause analysis):
   *
   *  • Microtask (Promise.resolve): fires in microtask queue,
   *    BEFORE TM's focus-restoration event handler (a macrotask).
   *    Most likely to succeed. If TM hasn't focused the chat area
   *    yet, our scroll lands first.
   *
   *  • double-rAF: fires after one complete browser paint cycle.
   *    Catches cases where the microtask fired against stale layout.
   *
   *  • +300ms: fires after TM's focus handler has settled.
   *
   *  • +800ms (with highlight): final authoritative scroll.
   *    By this point all competing events have long since fired.
   *
   *  Limitation: if TM's handler fires ON EACH of our scrolls
   *  (rather than just once on focus return), this cannot be fixed
   *  without modifying TM's source code.
   * ─────────────────────────────────────────────────────────────── */
  function scrollAfterClose(uuid) {
    if (!uuid || uuid.includes('__t')) return;

    // Fire 1: microtask — before TM's macrotask focus handler
    Promise.resolve().then(() => scrollToMessage(uuid, false));

    // Fire 2+: after paint, then at increasing delays
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToMessage(uuid, false);
        setTimeout(() => scrollToMessage(uuid, false), 300);
        setTimeout(() => scrollToMessage(uuid, true),  800); // highlight on final
      });
    });
  }

  /* ── SCROLL: after Apply Changes + reload ────────────────────── */
  function scrollAfterReload(uuid) {
    if (!uuid || uuid.includes('__t')) return;
    let attempts = 0;
    function tryOnce() {
      if (scrollToMessage(uuid, false)) {
        setTimeout(() => scrollToMessage(uuid, false), 1200);
        setTimeout(() => scrollToMessage(uuid, true),  2800);
        return;
      }
      if (++attempts < 30) setTimeout(tryOnce, 400);
    }
    setTimeout(tryOnce, 1500);
  }

  /* ── STYLES ─────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById(EXT + '-css')) return;
    const s = document.createElement('style');
    s.id = EXT + '-css';
    s.textContent = `
      @keyframes tmg-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(0,168,132,.6); }
        70%  { box-shadow: 0 0 0 12px rgba(0,168,132,0); }
        100% { box-shadow: 0 0 0 0 rgba(0,168,132,0); }
      }
      #${EXT}-btn {
        display:flex;align-items:center;justify-content:center;
        width:36px;height:36px;border-radius:8px;border:none;
        background:transparent;cursor:pointer;color:inherit;transition:background .15s;
      }
      #${EXT}-btn:hover { background:rgba(255,255,255,.12); }
      #${EXT}-btn svg { width:18px;height:18px; }
      #${EXT}-ov {
        position:fixed;inset:0;z-index:2147483647;background:rgba(11,20,26,.96);
        display:flex;flex-direction:column;font-family:system-ui,-apple-system,sans-serif;color:#e9edef;
      }
      #${EXT}-bar {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;
      }
      #${EXT}-bar h2 { margin:0;font-size:13px;font-weight:700; }
      #${EXT}-bar .hint { font-size:11px;color:#8696a0;margin-left:10px; }
      #${EXT}-xbtn {
        background:none;border:none;cursor:pointer;color:#8696a0;font-size:20px;
        line-height:1;padding:4px 8px;border-radius:6px;transition:background .15s,color .15s;
      }
      #${EXT}-xbtn:hover { background:rgba(255,255,255,.12);color:#e9edef; }
      #${EXT}-leg {
        display:flex;gap:14px;padding:5px 16px;flex-shrink:0;flex-wrap:wrap;
        border-bottom:1px solid rgba(255,255,255,.06);font-size:10px;color:#8696a0;
      }
      #${EXT}-leg span { display:flex;align-items:center;gap:4px; }
      .${EXT}-dot { width:9px;height:9px;border-radius:50%;display:inline-block; }
      #${EXT}-main { flex:1;display:flex;flex-direction:row;overflow:hidden;min-height:0; }
      #${EXT}-wrap { flex:1;overflow:hidden;position:relative;touch-action:none;min-width:0; }
      #${EXT}-cv   { display:block;width:100%;height:100%;cursor:grab;touch-action:none; }
      #${EXT}-cv.drag { cursor:grabbing!important; }
      #${EXT}-panel {
        width:0;overflow:hidden;display:flex;flex-direction:column;flex-shrink:0;
        background:#111b21;border-left:1px solid rgba(255,255,255,.08);transition:width .22s ease;
      }
      #${EXT}-panel.open { width:min(340px,44vw); }
      .${EXT}-phead {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;gap:8px;
      }
      .${EXT}-pbody {
        flex:1;overflow-y:auto;padding:12px 12px 6px;font-size:13px;line-height:1.65;
        color:#e9edef;-webkit-overflow-scrolling:touch;min-height:0;
      }
      /* Status badge */
      .${EXT}-sbadge {
        display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;
        padding:4px 10px;border-radius:20px;border:1px solid;
      }
      .${EXT}-sbadge.active {
        color:#00a884;background:rgba(0,168,132,.1);border-color:rgba(0,168,132,.3);
      }
      .${EXT}-sbadge.inactive {
        color:#f59e0b;background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.3);
      }
      /* Divider between status and content */
      .${EXT}-divider {
        display:flex;align-items:center;gap:8px;margin:12px 0 10px;
      }
      .${EXT}-divider::before, .${EXT}-divider::after {
        content:'';flex:1;height:1px;background:rgba(255,255,255,.12);
      }
      .${EXT}-divider-label {
        font-size:8.5px;font-weight:700;color:rgba(255,255,255,.3);
        letter-spacing:1.3px;text-transform:uppercase;white-space:nowrap;
      }
      /* Content area within preview */
      .${EXT}-content p  { margin:.3em 0; }
      .${EXT}-content h1,.${EXT}-content h2,.${EXT}-content h3 { font-weight:700;margin:.5em 0 .2em; }
      .${EXT}-content h1 { font-size:1.3em; }
      .${EXT}-content h2 { font-size:1.15em; }
      .${EXT}-content h3 { font-size:1.03em; }
      .${EXT}-content strong { font-weight:700; }
      .${EXT}-content em { font-style:italic; }
      .${EXT}-content code { background:rgba(255,255,255,.13);padding:.1em .32em;border-radius:3px;font-size:.88em; }
      .${EXT}-content pre { background:rgba(255,255,255,.08);padding:.6em .8em;border-radius:6px;overflow-x:auto;margin:.45em 0;font-size:.86em; }
      .${EXT}-content pre code { background:none;padding:0;font-size:1em; }
      .${EXT}-content blockquote { border-left:3px solid rgba(255,255,255,.3);padding-left:.75em;margin:.4em 0;opacity:.85; }
      .${EXT}-content ul,.${EXT}-content ol { padding-left:1.4em;margin:.3em 0; }
      .${EXT}-content li { margin:.15em 0; }
      .${EXT}-content table { border-collapse:collapse;font-size:.9em;width:100%; }
      .${EXT}-content th,.${EXT}-content td { border:1px solid rgba(255,255,255,.18);padding:.25em .5em;text-align:left; }
      .${EXT}-content thead th { background:rgba(255,255,255,.08);font-weight:700; }
      .${EXT}-pfoot {
        padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);
        display:flex;flex-direction:column;gap:7px;flex-shrink:0;
      }
      .${EXT}-pbtn { padding:8px 12px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:600;width:100%;transition:opacity .15s; }
      .${EXT}-pbtn:hover  { opacity:.82; }
      .${EXT}-pbtn.primary { background:#00a884;color:#0b141a; }
      .${EXT}-pbtn.apply   { background:#f59e0b;color:#0b141a; }
      .${EXT}-pbtn.muted   { background:transparent;border:1px solid rgba(255,255,255,.18);color:#8696a0; }
      #${EXT}-toast {
        position:absolute;bottom:20px;left:50%;transform:translateX(-50%) translateY(60px);
        padding:7px 18px;border-radius:20px;font-size:12px;font-weight:700;
        transition:transform .22s;pointer-events:none;white-space:nowrap;z-index:10;
      }
      #${EXT}-toast.ok   { background:#00a884;color:#0b141a;transform:translateX(-50%) translateY(0); }
      #${EXT}-toast.warn { background:#f59e0b;color:#0b141a;transform:translateX(-50%) translateY(0); }
      #${EXT}-toast.err  { background:#ef4444;color:#fff;   transform:translateX(-50%) translateY(0); }
      @media (max-width:680px) {
        #${EXT}-main  { flex-direction:column; }
        #${EXT}-panel { width:100%!important;max-height:0;border-left:none;border-top:1px solid rgba(255,255,255,.1);transition:max-height .25s ease; }
        #${EXT}-panel.open { max-height:58vh;width:100%!important; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ── REACT FIBER ─────────────────────────────────────────────── */
  function getFiber(el) { const k = Object.keys(el).find(k => k.startsWith('__reactFiber')); return k ? el[k] : null; }
  function getChatState() {
    const el = document.querySelector('[data-element-id="chat-space-middle-part"]');
    if (!el) return null;
    let f = getFiber(el);
    for (let d = 0; f && d < 80; f = f.return, d++) {
      let hs = f.memoizedState, hi = 0;
      for (; hs && hi < 6; hs = hs.next, hi++) {
        const v = hs.memoizedState;
        if (v && !Array.isArray(v) && typeof v === 'object' && Array.isArray(v.messages) && v.chatID)
          return { state: v };
      }
    }
    return null;
  }

  /* ── IDB ─────────────────────────────────────────────────────── */
  const openIDB = () => new Promise((res, rej) => { const r = indexedDB.open('keyval-store'); r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error); });
  async function persistMessages(chatID, msgs) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('keyval', 'readwrite'), st = tx.objectStore('keyval'), key = `CHAT_${chatID}`, g = st.get(key);
      g.onsuccess = () => {
        const prev = g.result; if (!prev) { db.close(); res(); return; }
        const p = st.put({ ...prev, messages: msgs, updatedAt: new Date() }, key);
        p.onsuccess = () => { db.close(); res(); }; p.onerror = () => { db.close(); rej(p.error); };
      };
      g.onerror = () => { db.close(); rej(g.error); };
    });
  }

  /* ── TEXT ─────────────────────────────────────────────────────── */
  const extractText = c => !c ? '' : typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x?.text ?? x?.content ?? '').join(' ') : '';
  function renderForPreview(content) {
    const text = extractText(content);
    if (!text.trim()) return '<em style="opacity:.45">(empty)</em>';
    if (typeof window.marked !== 'undefined') { try { return window.marked.parse(text); } catch (_) {} }
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`)
      .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
  }

  /* ── CLASSIFY ────────────────────────────────────────────────── */
  function classifyMsg(m) {
    if (m.role === 'user') return 'user';
    if (m.role === 'tool') return 'tool';
    if (m.role === 'assistant') return (m.tool_calls?.length > 0) ? 'tool' : 'ai';
    return 'tool';
  }

  /* ── TREE BUILDER ────────────────────────────────────────────── */
  function buildChain(msgs, start, isActive, sp) {
    if (!msgs || start >= msgs.length) return [];
    const m = msgs[start], cls = classifyMsg(m);
    const node = {
      id: m.uuid, role: cls,
      label: extractText(m.content).replace(/\s+/g, ' ').slice(0, 82),
      rawContent: m.content, active: isActive,
      switchPath: isActive ? [] : sp,
      sourceUUID: sp.length > 0 ? sp[sp.length-1].sourceUUID : m.uuid,
      branchIdx:  sp.length > 0 ? sp[sp.length-1].branchIdx  : null,
      x:0, y:0, w:0, h:0, children:[], variants:[]
    };
    if (m.role === 'user' && m.threads?.length > 0) {
      node.variants = m.threads.map((thread, ti) => {
        const vp = [...(isActive ? [] : sp), { sourceUUID: m.uuid, branchIdx: ti }];
        const hd = { id: `${m.uuid}__t${ti}`, role: 'user',
          label: extractText(thread.userMessageContent).replace(/\s+/g,' ').slice(0,82),
          rawContent: thread.userMessageContent, active: false, switchPath: vp,
          sourceUUID: vp[vp.length-1].sourceUUID, branchIdx: vp[vp.length-1].branchIdx,
          x:0, y:0, w:0, h:0, children:[], variants:[] };
        hd.children = buildChain(thread.messages || [], 0, false, vp);
        return hd;
      });
      node.children = isActive ? buildChain(msgs, start+1, true, []) : buildChain(msgs, start+1, false, sp);
      return [node];
    }
    node.children = buildChain(msgs, start+1, isActive, sp);
    return [node];
  }

  /* ── LAYOUT ──────────────────────────────────────────────────── */
  const NW=200, NH=56, VGAP=34, slotW=226;
  const colsPx = n => n * slotW - 26;
  function treeCols(n) { if(!n)return 1; if(n.variants.length>0)return treeCols(n.children[0]||null)+n.variants.reduce((s,v)=>s+treeCols(v),0); return n.children.length?treeCols(n.children[0]):1; }
  function placeNode(node, cx, cy, all, edges) {
    if (!node) return;
    node.x=cx-NW/2; node.y=cy; node.w=NW; node.h=NH; all.push(node);
    const ny = cy+NH+VGAP;
    if (node.variants.length > 0) {
      const ac=treeCols(node.children[0]||null), vcs=node.variants.map(v=>treeCols(v));
      const tc=ac+vcs.reduce((s,c)=>s+c,0); let sx=cx-colsPx(tc)/2;
      if (node.children[0]) { const aCx=sx+colsPx(ac)/2; edges.push({fx:cx,fy:cy+NH,tx:aCx,ty:ny,active:true}); placeNode(node.children[0],aCx,ny,all,edges); sx+=ac*slotW; }
      node.variants.forEach((v,vi)=>{ const vCx=sx+colsPx(vcs[vi])/2; edges.push({fx:cx,fy:cy+NH,tx:vCx,ty:ny,active:false}); placeNode(v,vCx,ny,all,edges); sx+=vcs[vi]*slotW; });
    } else if (node.children[0]) {
      edges.push({fx:cx,fy:cy+NH,tx:cx,ty:ny,active:node.active});
      placeNode(node.children[0],cx,ny,all,edges);
    }
  }
  function doLayout(root) {
    const all=[], edges=[];
    placeNode(root, colsPx(treeCols(root))/2+60, 60, all, edges);
    let minX=Infinity, maxX=-Infinity, maxY=-Infinity;
    all.forEach(n=>{minX=Math.min(minX,n.x);maxX=Math.max(maxX,n.x+n.w);maxY=Math.max(maxY,n.y+n.h);});
    return { all, edges, bounds:{minX,maxX,maxY} };
  }

  /* ── CANVAS COLORS ───────────────────────────────────────────────
   *
   *  Three-tier with consistent active/inactive pairing:
   *
   *  User  active:   rich green bg + #00a884 border
   *  User  inactive: toned-down GREEN bg (not blue-gray) — v2.3.0 fix
   *  AI    active:   rich teal-blue bg + #1ea4d4 border
   *  AI    inactive: toned-down blue
   *  Tool  active:   "passive-active" mid-gray (in chain, but passive)
   *  Tool  inactive: very quiet dark gray
   * ─────────────────────────────────────────────────────────────── */
  const C = {
    uA:'#004d3a',   uAb:'#00a884',   // user active
    uI:'#1a2e23',   uIb:'#2a4532',   // user inactive — TONED DOWN GREEN
    aiA:'#0d3b4f',  aiAb:'#1ea4d4',  // ai active
    aiI:'#152530',  aiIb:'#1d3a4d',  // ai inactive
    tA:'#222c34',   tAb:'#3c4e5a',   // tool active  (passive-active gray)
    tI:'#141c22',   tIb:'#1e2831',   // tool inactive (very quiet)
    eA:'#00a884', eI:'rgba(40,60,70,.55)',
    txA:'#e9edef', txI:'#3a5262',
    hov:'#f59e0b', dot:'#f59e0b', sel:'#3b82f6'
  };

  function getBg(r,a)  { return r==='user'?a?C.uA:C.uI:r==='ai'?a?C.aiA:C.aiI:a?C.tA:C.tI; }
  function getBdr(r,a) { return r==='user'?a?C.uAb:C.uIb:r==='ai'?a?C.aiAb:C.aiIb:a?C.tAb:C.tIb; }
  function getBbg(r,a) { return r==='user'?a?'rgba(0,168,132,.28)':'rgba(42,100,70,.35)':r==='ai'?a?'rgba(30,164,212,.2)':'rgba(29,58,77,.45)':'rgba(255,255,255,.05)'; }
  function getBc(r,a)  { return r==='user'?a?'#00a884':'#3a7a56':r==='ai'?a?'#1ea4d4':'#2a5a70':a?'#5a6a76':'#284050'; }
  function getBt(r)    { return r==='user'?'USER':r==='ai'?'AI':'TOOL'; }

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
      const m=(e.fy+e.ty)/2; ctx.bezierCurveTo(e.fx,m,e.tx,m,e.tx,e.ty);
      ctx.strokeStyle=e.active?C.eA:C.eI; ctx.lineWidth=e.active?2.2:1.5;
      ctx.setLineDash(e.active?[]:[6,4]); ctx.stroke(); ctx.setLineDash([]);
    });

    const sorted=[...all].sort((a,b)=>a.active===b.active?0:a.active?-1:1);
    sorted.forEach(n=>{
      const ia=n.active, isSel=n.id===selectedId, isHov=n.id===hoverId&&!isSel;
      const bg=getBg(n.role,ia), bdr=isSel?C.sel:isHov?C.hov:getBdr(n.role,ia);
      ctx.shadowColor='rgba(0,0,0,.35)'; ctx.shadowBlur=isSel?22:isHov?14:ia?6:3; ctx.shadowOffsetY=isSel?5:2;
      rr(ctx,n.x,n.y,n.w,n.h,10); ctx.fillStyle=bg; ctx.fill();
      ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
      rr(ctx,n.x,n.y,n.w,n.h,10); ctx.strokeStyle=bdr; ctx.lineWidth=(isSel||isHov)?2.5:(ia?1.5:1); ctx.stroke();
      const bW=n.role==='user'?34:n.role==='ai'?20:32;
      ctx.fillStyle=getBbg(n.role,ia);
      if(ctx.roundRect){ctx.beginPath();ctx.roundRect(n.x+7,n.y+7,bW,14,3);ctx.fill();}
      ctx.fillStyle=getBc(n.role,ia); ctx.font='bold 7.5px system-ui'; ctx.textAlign='left';
      ctx.fillText(getBt(n.role),n.x+11,n.y+16.5);
      ctx.fillStyle=ia?C.txA:C.txI; ctx.font=`${ia?500:400} 10px system-ui`;
      let lbl=n.label||'(empty)', maxW=n.w-16;
      while(ctx.measureText(lbl).width>maxW&&lbl.length>6) lbl=lbl.slice(0,-4)+'…';
      ctx.fillText(lbl,n.x+8,n.y+38);
      if(n.variants?.length){ctx.fillStyle=C.dot;ctx.beginPath();ctx.arc(n.x+n.w-8,n.y+8,4,0,Math.PI*2);ctx.fill();}
      if(!ia&&n.switchPath?.length>1){ctx.fillStyle='rgba(245,158,11,.7)';ctx.font='bold 8px system-ui';ctx.textAlign='right';ctx.fillText(`${n.switchPath.length}↓`,n.x+n.w-5,n.y+n.h-6);}
    });
    ctx.restore();
  }

  /* ── HIT TEST ────────────────────────────────────────────────── */
  function hitTest(all,mx,my,tr){const wx=(mx-tr.tx)/tr.s,wy=(my-tr.ty)/tr.s;return all.find(n=>wx>=n.x&&wx<=n.x+n.w&&wy>=n.y&&wy<=n.y+n.h)||null;}

  /* ── MODULE STATE / CLOSE / TOAST ────────────────────────────── */
  let graphCtx=null, overlay=null, toastEl=null, toastTmr=null;
  function closeOverlay(){if(!overlay)return;graphCtx?.ro?.disconnect();graphCtx?.ac?.abort();overlay.remove();overlay=null;toastEl=null;graphCtx=null;clearTimeout(toastTmr);}
  function showToast(msg,type='ok'){if(!toastEl)return;clearTimeout(toastTmr);toastEl.textContent=msg;toastEl.className=type;toastTmr=setTimeout(()=>{if(toastEl)toastEl.className='';},3500);}

  /* ── PREVIEW PANEL ─────────────────────────────────────────────
   *
   *  Layout after v2.3.0 refactor:
   *
   *    ┌────────────────────────────────┐
   *    │ [Role badge]  [state badge]  ✕ │  ← phead (exists in panel HTML)
   *    ├────────────────────────────────┤
   *    │ ✓ Active branch               │  ← status pill (green / amber)
   *    │                               │
   *    │ ─────── MESSAGE CONTENT ───── │  ← section divider (not system text)
   *    │                               │
   *    │ <rendered markdown content>   │  ← actual message
   *    │ ...                           │
   *    ├────────────────────────────────┤
   *    │ [Go to Message / Apply]       │  ← pfoot buttons
   *    │ [Close Preview]               │
   *    └────────────────────────────────┘
   * ─────────────────────────────────────────────────────────────── */
  function openPreview(node, panelEl) {
    if (!node || !panelEl) return;
    if (graphCtx) { graphCtx.selectedId = node.id; graphCtx.draw(); }

    const ia = node.active, steps = node.switchPath?.length || 0;
    const roleNames = { user:'USER', ai:'AI Response', tool:'Tool Call' };
    const dotColors = {
      user: ia ? '#00a884' : '#3a7a56',
      ai:   ia ? '#1ea4d4' : '#2a5a70',
      tool: ia ? '#5a6a76' : '#2a3a46'
    };

    // Head: role indicator + X
    const phead = panelEl.querySelector('.phead');
    phead.innerHTML = `
      <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1">
        <span style="width:8px;height:8px;border-radius:50%;background:${dotColors[node.role]||'#444'};flex-shrink:0"></span>
        <span style="font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${roleNames[node.role]||'?'}
        </span>
      </div>
      <button class="pclose-btn" title="Close preview (Esc)"
        style="background:none;border:none;cursor:pointer;color:#8696a0;font-size:16px;
               line-height:1;padding:2px 6px;border-radius:4px;flex-shrink:0">✕</button>`;
    phead.querySelector('.pclose-btn').onclick = () => closePreview(panelEl);

    // Status badge text
    const badgeClass = ia ? 'active' : 'inactive';
    const badgeText  = ia
      ? '✓ Currently active in chat'
      : (steps === 1 ? '⚑ 1 switch to activate' : `⚡ ${steps} switches to activate`);

    // Body: status pill → divider → content
    panelEl.querySelector('.pbody').innerHTML = `
      <div style="margin-bottom:2px">
        <span class="${EXT}-sbadge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="${EXT}-divider">
        <span class="${EXT}-divider-label">Message Content</span>
      </div>
      <div class="${EXT}-content">${renderForPreview(node.rawContent)}</div>`;

    // Footer buttons
    const pfoot = panelEl.querySelector('.pfoot'); pfoot.innerHTML = '';
    if (ia) {
      const b = document.createElement('button'); b.className = EXT + '-pbtn primary';
      b.textContent = '↓ Go to This Message';
      b.onclick = () => {
        const uuid = node.id.includes('__t') ? null : node.id;
        closePreview(panelEl); closeOverlay();
        if (uuid) scrollAfterClose(uuid);
      };
      pfoot.appendChild(b);
    } else {
      const b = document.createElement('button'); b.className = EXT + '-pbtn apply';
      b.textContent = steps > 1 ? `⚡ Apply Changes (${steps} steps)` : '⚑ Apply Changes';
      b.onclick = () => applyAndReload(node); pfoot.appendChild(b);
    }
    const cb = document.createElement('button'); cb.className = EXT + '-pbtn muted';
    cb.textContent = 'Close Preview'; cb.onclick = () => closePreview(panelEl); pfoot.appendChild(cb);
    panelEl.classList.add('open');
  }

  function closePreview(panelEl) {
    if (graphCtx) { graphCtx.selectedId = null; graphCtx.draw(); }
    panelEl?.classList.remove('open');
  }

  /* ── PURE SWITCH / APPLY ─────────────────────────────────────── */
  function computeSingleSwitch(msgs,srcUUID,bi){
    const si=msgs.findIndex(m=>m.uuid===srcUUID); if(si<0)throw new Error(`UUID ${srcUUID} not found`);
    const sm=msgs[si],tgt=sm.threads?.[bi]; if(!tgt)throw new Error(`threads[${bi}] missing`);
    return[...msgs.slice(0,si),{...sm,content:tgt.userMessageContent,
      threads:[...sm.threads.filter((_,i)=>i!==bi),{userMessageContent:sm.content,messages:msgs.slice(si+1),createdAt:new Date().toISOString()}],
      updatedAt:new Date().toISOString()},...(tgt.messages||[])];
  }
  async function applyAndReload(node){
    if(!node||!node.switchPath?.length||node.active)return;
    const cs=getChatState(); if(!cs?.state?.chatID){showToast('Cannot read chat state','err');return;}
    showToast('Applying…','warn');
    try{
      let msgs=cs.state.messages;
      for(const step of node.switchPath) msgs=computeSingleSwitch(msgs,step.sourceUUID,step.branchIdx);
      await persistMessages(cs.state.chatID,msgs);
      sessionStorage.setItem(SCROLL_KEY,node.switchPath[0].sourceUUID);
      closeOverlay(); window.location.reload();
    }catch(err){console.warn('[TM Graph]',err.message);showToast('Error: '+err.message.slice(0,55),'err');}
  }

  /* ── OPEN GRAPH ──────────────────────────────────────────────── */
  function openGraph() {
    if (overlay) { closeOverlay(); return; }
    const cs = getChatState(); if(!cs){alert('[TM Graph] No active conversation.');return;}
    const root = buildChain(cs.state.messages,0,true,[])[0]; if(!root){alert('[TM Graph] No messages found.');return;}
    const {all,edges,bounds} = doLayout(root);

    overlay = document.createElement('div'); overlay.id = EXT+'-ov';
    const bar = document.createElement('div'); bar.id = EXT+'-bar';
    bar.innerHTML=`
      <div style="display:flex;align-items:center">
        <h2>Chat Branch Graph</h2>
        <span class="hint">Tap to preview · Drag to pan · Scroll/pinch to zoom</span>
      </div>
      <button id="${EXT}-xbtn" title="Close — no changes (Esc)">✕</button>`;
    const leg = document.createElement('div'); leg.id = EXT+'-leg';
    leg.innerHTML=`
      <span><span class="${EXT}-dot" style="background:#00a884"></span>User</span>
      <span><span class="${EXT}-dot" style="background:#1ea4d4"></span>AI Response</span>
      <span><span class="${EXT}-dot" style="background:#3c4e5a"></span>Tool Call</span>
      <span><span class="${EXT}-dot" style="background:#f59e0b"></span>Branch</span>
      <span><span class="${EXT}-dot" style="background:#3b82f6"></span>Preview · Enter=confirm</span>`;
    const main = document.createElement('div'); main.id = EXT+'-main';
    const wrap = document.createElement('div'); wrap.id = EXT+'-wrap';
    const canvas = document.createElement('canvas'); canvas.id = EXT+'-cv';
    toastEl = document.createElement('div'); toastEl.id = EXT+'-toast';
    wrap.appendChild(canvas); wrap.appendChild(toastEl);
    const panel = document.createElement('div'); panel.id = EXT+'-panel';
    panel.innerHTML=`
      <div class="${EXT}-phead phead" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;gap:8px"></div>
      <div class="${EXT}-pbody pbody" style="flex:1;overflow-y:auto;padding:12px 12px 6px;font-size:13px;line-height:1.65;color:#e9edef;-webkit-overflow-scrolling:touch;min-height:0"></div>
      <div class="${EXT}-pfoot pfoot" style="padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:7px;flex-shrink:0"></div>`;
    main.appendChild(wrap); main.appendChild(panel);
    overlay.appendChild(bar); overlay.appendChild(leg); overlay.appendChild(main);
    document.body.appendChild(overlay);

    const ac = new AbortController(), sig = ac.signal;
    const ro = new ResizeObserver(() => requestAnimationFrame(() => { graphCtx?.centre(); graphCtx?.draw(); }));
    ro.observe(wrap);

    graphCtx = {
      all, edges, bounds, ac, ro, tr:{tx:0,ty:0,s:1}, hoverId:null, selectedId:null,
      centre() {
        const W=canvas.clientWidth, H=canvas.clientHeight; if(!W||!H)return;
        const cW=this.bounds.maxX-this.bounds.minX+120, cH=this.bounds.maxY-60+120;
        this.tr.s=Math.max(0.2,Math.min(1.3,Math.min(W/cW,H/cH)));
        this.tr.tx=(W-cW*this.tr.s)/2-this.bounds.minX*this.tr.s+60*this.tr.s;
        this.tr.ty=(H-cH*this.tr.s)/2-60*this.tr.s+60*this.tr.s;
      },
      draw() { doRender(canvas,this.all,this.edges,this.tr,this.hoverId,this.selectedId); }
    };
    requestAnimationFrame(()=>{graphCtx.centre();graphCtx.draw();});

    bar.querySelector('#'+EXT+'-xbtn').addEventListener('click',closeOverlay,{signal:sig});
    window.addEventListener('keydown', e => {
      if (e.key==='Escape'){if(panel.classList.contains('open'))closePreview(panel);else closeOverlay();}
      else if(e.key==='Enter'&&graphCtx?.selectedId){
        const nd=graphCtx.all.find(n=>n.id===graphCtx.selectedId);
        if(nd?.active){const uuid=nd.id.includes('__t')?null:nd.id;closePreview(panel);closeOverlay();if(uuid)scrollAfterClose(uuid);}
      }
    },{signal:sig});

    canvas.addEventListener('wheel',e=>{e.preventDefault();const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,d=e.deltaY<0?1.09:0.92;graphCtx.tr.tx=mx-(mx-graphCtx.tr.tx)*d;graphCtx.tr.ty=my-(my-graphCtx.tr.ty)*d;graphCtx.tr.s=Math.min(3.5,Math.max(0.12,graphCtx.tr.s*d));graphCtx.draw();},{passive:false,signal:sig});

    let mdrag=null, dragDist=0;
    canvas.addEventListener('mousedown',e=>{mdrag={sx:e.clientX-graphCtx.tr.tx,sy:e.clientY-graphCtx.tr.ty};dragDist=0;canvas.classList.add('drag');},{signal:sig});
    window.addEventListener('mousemove',e=>{if(!graphCtx)return;const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,hit=hitTest(graphCtx.all,mx,my,graphCtx.tr),nid=hit?.id||null;if(nid!==graphCtx.hoverId){graphCtx.hoverId=nid;graphCtx.draw();}canvas.style.cursor=mdrag?'grabbing':nid?'pointer':'grab';if(mdrag){dragDist+=Math.hypot(e.movementX||0,e.movementY||0);graphCtx.tr.tx=e.clientX-mdrag.sx;graphCtx.tr.ty=e.clientY-mdrag.sy;graphCtx.draw();}},{signal:sig});
    window.addEventListener('mouseup',()=>{mdrag=null;canvas.classList.remove('drag');},{signal:sig});
    canvas.addEventListener('click',e=>{if(dragDist>5){dragDist=0;return;}dragDist=0;const rect=canvas.getBoundingClientRect(),hit=hitTest(graphCtx.all,e.clientX-rect.left,e.clientY-rect.top,graphCtx.tr);if(hit)openPreview(hit,panel);else closePreview(panel);},{signal:sig});

    let lastTouches=null, touchStart=null, panning=false;
    canvas.addEventListener('touchstart',e=>{e.preventDefault();const ts=[...e.touches].map(t=>({x:t.clientX,y:t.clientY}));lastTouches=ts;panning=false;if(e.touches.length===1){const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY,time:Date.now()};const rect=canvas.getBoundingClientRect(),hit=hitTest(graphCtx.all,t.clientX-rect.left,t.clientY-rect.top,graphCtx.tr);if((hit?.id||null)!==graphCtx.hoverId){graphCtx.hoverId=hit?.id||null;graphCtx.draw();}}else touchStart=null;},{passive:false,signal:sig});
    canvas.addEventListener('touchmove',e=>{e.preventDefault();const ts=[...e.touches].map(t=>({x:t.clientX,y:t.clientY}));if(touchStart){const mv=Math.hypot(ts[0].x-touchStart.x,ts[0].y-touchStart.y);if(mv>8)panning=true;}if(ts.length===1&&lastTouches?.length===1){graphCtx.tr.tx+=ts[0].x-lastTouches[0].x;graphCtx.tr.ty+=ts[0].y-lastTouches[0].y;const rect=canvas.getBoundingClientRect();graphCtx.hoverId=hitTest(graphCtx.all,ts[0].x-rect.left,ts[0].y-rect.top,graphCtx.tr)?.id||null;graphCtx.draw();}else if(ts.length===2&&lastTouches?.length===2){const pd=Math.hypot(lastTouches[1].x-lastTouches[0].x,lastTouches[1].y-lastTouches[0].y),cd=Math.hypot(ts[1].x-ts[0].x,ts[1].y-ts[0].y);if(pd>0){const d=cd/pd,rect=canvas.getBoundingClientRect(),mx=(ts[0].x+ts[1].x)/2-rect.left,my=(ts[0].y+ts[1].y)/2-rect.top;graphCtx.tr.tx=mx-(mx-graphCtx.tr.tx)*d;graphCtx.tr.ty=my-(my-graphCtx.tr.ty)*d;graphCtx.tr.s=Math.min(3.5,Math.max(0.12,graphCtx.tr.s*d));graphCtx.draw();}}lastTouches=ts;},{passive:false,signal:sig});
    canvas.addEventListener('touchend',e=>{e.preventDefault();if(touchStart&&!panning&&e.touches.length===0&&e.changedTouches.length===1){const t=e.changedTouches[0],mv=Math.hypot(t.clientX-touchStart.x,t.clientY-touchStart.y),dt=Date.now()-touchStart.time;if(mv<15&&dt<350){const rect=canvas.getBoundingClientRect(),hit=hitTest(graphCtx.all,t.clientX-rect.left,t.clientY-rect.top,graphCtx.tr);if(hit){graphCtx.hoverId=hit.id;graphCtx.draw();setTimeout(()=>openPreview(hit,panel),60);}else closePreview(panel);}}touchStart=null;panning=false;if(e.touches.length===0){lastTouches=null;graphCtx.hoverId=null;graphCtx.draw();}else lastTouches=[...e.touches].map(t=>({x:t.clientX,y:t.clientY}));},{passive:false,signal:sig});
    canvas.addEventListener('touchcancel',()=>{lastTouches=null;touchStart=null;panning=false;if(graphCtx){graphCtx.hoverId=null;graphCtx.draw();}},{passive:false,signal:sig});
  }

  /* ── BUTTON / BOOTSTRAP ──────────────────────────────────────── */
  const TOOLBAR='[data-element-id="chat-input-actions"]';
  function tryInject(){const bar=document.querySelector(TOOLBAR);if(!bar||bar.querySelector('#'+EXT+'-btn'))return;const btn=document.createElement('button');btn.id=EXT+'-btn';btn.title='Chat Branch Graph';btn.innerHTML=`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2.2"/><circle cx="16" cy="4" r="2.2"/><circle cx="4" cy="16" r="2.2"/><circle cx="16" cy="16" r="2.2"/><circle cx="10" cy="10" r="2.2"/><line x1="4" y1="4" x2="10" y2="10"/><line x1="16" y1="4" x2="10" y2="10"/><line x1="10" y1="10" x2="4" y2="16"/><line x1="10" y1="10" x2="16" y2="16"/></svg>`;btn.addEventListener('click',openGraph);bar.appendChild(btn);}
  function init(){checkScrollAfterReload();injectStyles();tryInject();let r=10;const retry=()=>{if(document.querySelector('#'+EXT+'-btn'))return;tryInject();if(--r>0)setTimeout(retry,650);};setTimeout(retry,400);new MutationObserver(tryInject).observe(document.body,{childList:true,subtree:true});console.log('[TM Chat Graph] ✅ v2.3.0');}
  init();
})();
