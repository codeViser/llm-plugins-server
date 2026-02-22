// ============================================================
//  TypingMind — User Message Markdown + Math Renderer
//  Version : 2.0.0
//
//  ROOT CAUSE OF v1.3.0 COMPLETE FAILURE (fixed here):
//  ┌──────────────────────────────────────────────────────┐
//  │  render() moved child nodes to a wrapper BEFORE      │
//  │  calling parseFn(). If parseFn threw (KaTeX missing  │
//  │  → "renderMathInElement is not a function"), the     │
//  │  children were stranded in a detached node.          │
//  │  msgEl.textContent became "" permanently.            │
//  │  Observer re-fired → rawText empty → abort loop.    │
//  └──────────────────────────────────────────────────────┘
//
//  ARCHITECTURAL CHANGES IN v2.0.0:
//  1. parseFn is called FIRST — DOM is never touched if it throws
//  2. Children are NEVER moved — CSS hides originals, view overlays
//  3. KaTeX is a soft dependency — two-phase boot:
//       Phase 1: marked.js (required) → markdown renders immediately
//       Phase 2: KaTeX (optional) → upgrades math in background
//  4. Removed :has() CSS — use marked's .task-list-item class instead
//  5. A_DONE set BEFORE appendChild(view) → atomic hide+show
//
//  Confirmed selector: [data-element-id="user-message"]
//  Compatible: Chromium web + Android PWA
// ============================================================

(() => {
  'use strict';

  // ── Configuration ─────────────────────────────────────────
  const CFG = {
    cdn: {
      marked      : 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js',
      katexCss    : 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
      katexJs     : 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
      katexRender : 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js',
    },
    sel: {
      chatArea    : '[data-element-id="chat-space-middle-part"]',
      userMsg     : '[data-element-id="user-message"]',
      responseBlk : '[data-element-id="response-block"]',
    },
    attr: {
      done : 'data-umr-done',
      view : 'data-umr-view',
    },
    mathDelimiters: [
      { left: '$$', right: '$$', display: true  },
      { left: '$',  right: '$',  display: false  },
    ],
  };

  const { done: A_DONE, view: A_VIEW } = CFG.attr;

  // Mutable parser — null until marked loads, upgraded when KaTeX loads
  const parser = { fn: null };


  // ── CSS ────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('umr-styles')) return;

    const UM   = `[data-element-id="user-message"]`;  // TM's confirmed selector
    const DONE = `${UM}[${A_DONE}]`;                  // when we've rendered it
    const VIEW = `[${A_VIEW}]`;                        // our injected view div

    const s    = document.createElement('style');
    s.id       = 'umr-styles';
    s.textContent = `

      /* ═══════════════════════════════════════════════════════
         CONTAINER STATE — active while [A_DONE] is set
         ═══════════════════════════════════════════════════════
         Two problems to solve:
         a) TM's whitespace-pre-wrap class would make rendered
            HTML display literally — override with normal.
         b) Original child ELEMENTS need hiding (display:none).
            Original bare TEXT NODES can't be targeted by CSS
            selectors, so we hide them via color:transparent.
            (Layout is preserved; only colour changes.)         */
      ${DONE} {
        white-space : normal      !important;
        color       : transparent !important;
      }
      /* Hide every direct element child except our view div   */
      ${DONE} > *:not(${VIEW}) {
        display : none !important;
      }

      /* ═══════════════════════════════════════════════════════
         VIEW BASE
         user-message always uses text-white (confirmed from
         the live DOM diagnostic). Restore colour here so all
         descendants inside the view inherit white correctly.   */
      ${DONE} > ${VIEW} {
        color       : white  !important;
        font-size   : 0.9375rem;
        line-height : 1.62;
        white-space : normal !important;
      }
      /* Layout properties for the view itself                  */
      ${VIEW} {
        word-break   : break-word;
        overflow-wrap: break-word;
      }
      ${VIEW} > *:first-child { margin-top:    0 !important; }
      ${VIEW} > *:last-child  { margin-bottom: 0 !important; }

      /* ── Paragraphs ─────────────────────────────────────── */
      ${VIEW} p { margin: 0.4em 0; }

      /* ── Headings ───────────────────────────────────────── */
      ${VIEW} h1,${VIEW} h2,${VIEW} h3,
      ${VIEW} h4,${VIEW} h5,${VIEW} h6 {
        font-weight : 700;
        line-height : 1.25;
        margin      : 0.6em 0 0.25em;
      }
      ${VIEW} h1 { font-size: 1.50em;  }
      ${VIEW} h2 { font-size: 1.30em;  }
      ${VIEW} h3 { font-size: 1.13em;  }
      ${VIEW} h4 { font-size: 1.02em;  }
      ${VIEW} h5 { font-size: 0.92em;  }
      ${VIEW} h6 { font-size: 0.86em;  opacity: 0.82; }

      /* ── Inline text formatting ─────────────────────────── */
      ${VIEW} strong, ${VIEW} b   { font-weight: 700; }
      ${VIEW} em,     ${VIEW} i   { font-style: italic; }
      ${VIEW} del,    ${VIEW} s   { text-decoration: line-through; }
      ${VIEW} u                   { text-decoration: underline; }
      ${VIEW} sup { vertical-align: super; font-size: 0.75em; line-height: 1; }
      ${VIEW} sub { vertical-align: sub;   font-size: 0.75em; line-height: 1; }
      ${VIEW} mark {
        background   : rgba(255,230,0,0.35);
        color        : inherit;
        padding      : 0.05em 0.22em;
        border-radius: 2px;
      }
      ${VIEW} abbr[title] { text-decoration: underline dotted; cursor: help; }

      /* ── Links ──────────────────────────────────────────── */
      /* External links → target="_blank" via postProcessDom   */
      ${VIEW} a       { text-decoration: underline; opacity: 0.9; }
      ${VIEW} a:hover { opacity: 1; }

      /* ── Inline code and keyboard keys ─────────────────── */
      /* :not(pre)>code targets ONLY inline code.
         Code inside <pre> blocks is deliberately excluded and
         reset further below to prevent double-styling.        */
      ${VIEW} :not(pre) > code,
      ${VIEW} kbd {
        font-family  : ui-monospace,'Cascadia Code','Fira Code',monospace;
        font-size    : 0.85em;
        padding      : 0.1em 0.38em;
        border-radius: 3px;
        background   : rgba(255,255,255,0.18);
        word-break   : break-all;
      }
      ${VIEW} kbd {
        border    : 1px solid rgba(255,255,255,0.35);
        padding   : 0.05em 0.42em;
        box-shadow: 0 1px 0 rgba(255,255,255,0.22);
      }

      /* ── Code blocks ────────────────────────────────────── */
      ${VIEW} pre {
        margin       : 0.5em 0;
        padding      : 0.72em 0.95em;
        border-radius: 6px;
        overflow-x   : auto;
        -webkit-overflow-scrolling: touch;
        background   : rgba(255,255,255,0.10);
        font-size    : 0.9em;
        /* white-space intentionally NOT set here; <pre> uses
           the browser UA value (pre/pre-wrap) which is correct
           for code blocks. Descendants do not inherit the
           normal value from our view since UA rules win.      */
      }
      ${VIEW} pre code {
        /* Reset the inline-code overrides so code blocks
           render cleanly without double backgrounds/padding.  */
        background : none   !important;
        padding    : 0      !important;
        font-size  : 1em    !important;
        word-break : normal;
      }

      /* ── Blockquotes (3 nesting levels) ─────────────────── */
      ${VIEW} blockquote {
        margin     : 0.48em 0;
        padding    : 0.1em 0 0.1em 0.8em;
        border-left: 3px solid rgba(255,255,255,0.44);
      }
      ${VIEW} blockquote blockquote {
        margin-left      : 0;
        border-left-color: rgba(255,255,255,0.28);
      }
      ${VIEW} blockquote blockquote blockquote {
        border-left-color: rgba(255,255,255,0.16);
      }

      /* ── Lists ──────────────────────────────────────────── */
      ${VIEW} ul, ${VIEW} ol { padding-left: 1.5em; margin: 0.38em 0; }
      ${VIEW} li             { margin: 0.18em 0; }
      ${VIEW} li > ul,
      ${VIEW} li > ol        { margin: 0.1em 0; }

      /* Task lists — marked.js adds class="task-list-item"
         on each task-list <li>.  No :has() required;
         works in all current browsers.                        */
      ${VIEW} li.task-list-item {
        list-style  : none;
        margin-left : -1.5em;
        padding-left: 0;
      }
      ${VIEW} input[type="checkbox"] {
        margin        : 0 0.42em 0.1em 0;
        vertical-align: middle;
        cursor        : default;
        accent-color  : rgba(255,255,255,0.8);
      }

      /* ── Tables ─────────────────────────────────────────── */
      /* postProcessDom wraps each <table> in:
           <div class="umr-table-wrap">…</div>
         The wrapper carries overflow-x:auto so the table
         element keeps display:table — TD widths stay correct  */
      .umr-table-wrap {
        overflow-x : auto;
        -webkit-overflow-scrolling: touch;
        margin     : 0.5em 0;
        border-radius: 4px;
      }
      ${VIEW} table {
        border-collapse: collapse;
        min-width      : 100%;
        margin         : 0;
      }
      ${VIEW} th,
      ${VIEW} td {
        border    : 1px solid rgba(255,255,255,0.26);
        padding   : 0.3em 0.62em;
        text-align: left;
        /* All inline formatting (bold, italic, code, links,
           images, math) inside cells is handled automatically
           — our [VIEW] X descendant selectors reach any
           nesting depth without needing extra rules.          */
      }
      ${VIEW} thead th {
        font-weight        : 700;
        background         : rgba(255,255,255,0.09);
        border-bottom-width: 2px;
      }
      ${VIEW} tbody tr:nth-child(even) {
        background: rgba(255,255,255,0.04);
      }

      /* ── Images ─────────────────────────────────────────── */
      ${VIEW} img {
        max-width     : 100%;
        height        : auto;
        border-radius : 4px;
        display       : inline-block;
        vertical-align: middle;
        margin        : 0.2em 0;
      }

      /* ── Horizontal rule ────────────────────────────────── */
      ${VIEW} hr {
        border    : 0;
        border-top: 1px solid rgba(255,255,255,0.26);
        margin    : 0.65em 0;
      }

      /* ── Definition lists ───────────────────────────────── */
      ${VIEW} dl { margin: 0.38em 0; }
      ${VIEW} dt { font-weight: 700; margin-top: 0.38em; }
      ${VIEW} dd { margin-left: 1.5em; margin-bottom: 0.2em; }

      /* ── KaTeX math ─────────────────────────────────────── */
      /* KaTeX inherits white colour from the view container.
         Only layout overrides are needed.                     */
      ${VIEW} .katex-display {
        margin    : 0.58em 0;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
      }
      ${VIEW} .katex { font-size: 1.06em; }
    `;
    document.head.appendChild(s);
  }


  // ── Script / CSS loaders ───────────────────────────────────
  function injectKatexCss() {
    if (document.getElementById('umr-katex-css')) return;
    const l = document.createElement('link');
    l.id    = 'umr-katex-css';
    l.rel   = 'stylesheet';
    l.href  = CFG.cdn.katexCss;
    document.head.appendChild(l);
  }

  function loadScript(src, globalKey) {
    return new Promise((res, rej) => {
      // Reuse if TM already loaded this library (e.g. KaTeX for AI responses)
      if (globalKey && window[globalKey]) { res(window[globalKey]); return; }
      const s   = document.createElement('script');
      s.src     = src;
      s.onload  = () => res(globalKey ? window[globalKey] : true);
      s.onerror = () => rej(new Error('[TM-UserMD] Failed: ' + src));
      document.head.appendChild(s);
    });
  }


  // ── DOM post-processor ─────────────────────────────────────
  // Runs on a DETACHED temp node (never touches the live DOM).
  // Called inside parseFn after marked.parse().
  function postProcessDom(root) {
    // 1. Wrap every <table> in a horizontally scrollable div.
    //    Keep display:table so browser TD-width calc stays correct.
    root.querySelectorAll('table').forEach(tbl => {
      const wrap     = document.createElement('div');
      wrap.className = 'umr-table-wrap';
      tbl.parentNode.insertBefore(wrap, tbl);
      wrap.appendChild(tbl);
    });

    // 2. External links → open in new tab safely
    root.querySelectorAll('a[href]').forEach(a => {
      if (/^https?:\/\//i.test(a.getAttribute('href') || '')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel',    'noopener noreferrer');
      }
    });

    // 3. Images → lazy loading
    //    Error fade is handled via addEventListener in render()
    //    (not onerror attribute, which some CSPs block as unsafe-inline)
    root.querySelectorAll('img').forEach(img =>
      img.setAttribute('loading', 'lazy')
    );
  }


  // ── Edit mode detection ────────────────────────────────────
  // From the diagnostic: edit buttons are siblings of user-message
  // inside response-block, so TM likely mounts the textarea there.
  // We check both locations for forward-compatibility.
  function isEditing(msgEl) {
    if (msgEl.querySelector('textarea')) return true;
    const rb = msgEl.closest(CFG.sel.responseBlk);
    return rb ? !!rb.querySelector('textarea') : false;
  }


  // ── Render ─────────────────────────────────────────────────
  function render(msgEl) {
    if (!parser.fn) return;                              // marked not loaded yet
    if (isEditing(msgEl)) { unrender(msgEl); return; }

    if (msgEl.hasAttribute(A_DONE)) {
      // View exists → already correctly rendered
      if (msgEl.querySelector('[' + A_VIEW + ']')) return;
      // View missing → React reconciliation removed our injection → re-render
      msgEl.removeAttribute(A_DONE);
    }

    const rawText = msgEl.textContent.trim();
    if (!rawText) return;

    // ── PARSE FIRST — before any DOM mutation ──────────────
    // v1.3.0 was broken here: DOM was mutated (children moved
    // to wrapper) BEFORE parseFn was called. If parseFn threw,
    // the children were stranded in a detached span, making the
    // message permanently empty. This ordering prevents that.
    let html;
    try {
      html = parser.fn(rawText);
    } catch (err) {
      console.warn('[TM-UserMD] Parse error (DOM untouched):', err.message);
      return;                                            // DOM is unchanged
    }

    // ── Build the view div ───────────────────────────────────
    const view = document.createElement('div');
    view.setAttribute(A_VIEW, '1');
    view.innerHTML = html;

    // img error handlers: these survive DOM insertion but NOT
    // innerHTML serialisation. CSP-safe alternative to onerror=""
    view.querySelectorAll('img').forEach(img =>
      img.addEventListener('error', () => { img.style.opacity = '0.3'; }, { once: true })
    );

    // ── Inject atomically ───────────────────────────────────
    // Set A_DONE *before* appendChild so both operations land
    // in the same browser rendering frame (JS is synchronous):
    //   setAttribute → CSS fires → original children hidden via
    //                  color:transparent + display:none
    //   appendChild  → view becomes the sole visible child
    // The browser only paints once, after both lines complete.
    msgEl.setAttribute(A_DONE, '1');
    msgEl.appendChild(view);
  }


  // ── Unrender ───────────────────────────────────────────────
  function unrender(msgEl) {
    if (!msgEl.hasAttribute(A_DONE)) return;
    const view = msgEl.querySelector('[' + A_VIEW + ']');
    if (view) view.remove();
    msgEl.removeAttribute(A_DONE);
    // Removing A_DONE instantly deactivates every CSS override:
    // • color:transparent gone → TM's text-white restores white text
    // • white-space:normal gone → TM's whitespace-pre-wrap restores
    // • display:none on siblings gone → original children visible
    // Nothing was ever moved, so there is nothing to restore.
  }


  // ── Process all / observe / attach ────────────────────────
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
    }).observe(chatArea, { childList: true, subtree: true });
  }

  function attach() {
    const ca = document.querySelector(CFG.sel.chatArea);
    if (!ca) return;
    processAll(ca);
    observe(ca);
  }

  // Force re-render all already-rendered messages
  // (called after KaTeX loads to add math to existing renders)
  function reRenderAll() {
    document.querySelectorAll(`${CFG.sel.userMsg}[${A_DONE}]`)
      .forEach(msg => { unrender(msg); render(msg); });
  }


  // ── Bootstrap — two-phase ──────────────────────────────────
  async function boot() {
    injectStyles();

    // ─ Phase 1: marked.js (REQUIRED) ──────────────────────
    // Markdown renders as soon as this loads.
    // Extension is fully functional at this point.
    let marked;
    try {
      marked = await loadScript(CFG.cdn.marked, 'marked');
      marked.use({ breaks: true, gfm: true });
    } catch (e) {
      console.error('[TM-UserMD] marked.js load failed —', e.message);
      return;
    }

    parser.fn = text => {
      const tmp = document.createElement('div');
      tmp.innerHTML = marked.parse(text);
      postProcessDom(tmp);
      return tmp.innerHTML;
    };

    attach();
    new MutationObserver(() => attach()).observe(document.body, { childList: true });
    console.info('[TM-UserMD] ✅ v2.0 — Markdown ON');

    // ─ Phase 2: KaTeX (OPTIONAL, loads in background) ─────
    // If this phase fails for any reason (CDN unavailable,
    // network blocked, etc.) the extension continues working
    // with pure markdown — it does NOT abort like v1.3.0 did.
    injectKatexCss();
    try {
      await loadScript(CFG.cdn.katexJs,     'katex');
      await loadScript(CFG.cdn.katexRender, 'renderMathInElement');

      const rme = window.renderMathInElement;

      // Upgrade to markdown + math
      parser.fn = text => {
        const tmp = document.createElement('div');
        tmp.innerHTML = marked.parse(text);
        postProcessDom(tmp);
        // auto-render natively skips <code>/<pre> content ✓
        rme(tmp, { delimiters: CFG.mathDelimiters, throwOnError: false });
        return tmp.innerHTML;
      };

      reRenderAll();   // upgrade already-rendered messages
      console.info('[TM-UserMD] ✅ v2.0 — Math (KaTeX) ON');
    } catch (e) {
      console.warn('[TM-UserMD] KaTeX not loaded — math disabled:', e.message);
    }
  }

  boot();
})();
