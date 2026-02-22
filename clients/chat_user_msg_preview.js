// ============================================================
//  TypingMind — User Message Markdown + Math Renderer
//  Version : 1.3.0
//
//  Changelog vs 1.2.0:
//  ✦ Critical: table horizontal scroll via wrapper div
//  ✦ Critical: images — max-width, lazy, error fade
//  ✦ del/s strikethrough CSS added
//  ✦ External links → new tab (rel="noopener noreferrer")
//  ✦ Nested blockquotes — per-level opacity cascade
//  ✦ Task lists — checkbox style + bullet removal
//  ✦ h4/h5/h6 individual sizing
//  ✦ thead visual differentiation + zebra-stripe rows
//  ✦ sup/sub, kbd, mark, abbr, dl/dt/dd CSS
//  ✦ katex-display gets overflow-x:auto
//  ✦ wrapper.hidden fixes Tailwind space-y-2 margin conflict
//  ✦ margin-top:0 guard on view div
//  ✦ Inline code uses :not(pre)>code for precision
//
//  Confirmed selector: [data-element-id="user-message"]
//  Compatible: Chromium web + Android PWA
// ============================================================

(() => {
  'use strict';

  // ─────────────────────────────────────────────────────────
  //  CONFIGURATION
  // ─────────────────────────────────────────────────────────
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
      raw  : 'data-umr-raw',
      view : 'data-umr-view',
    },
    // Matches the $$/$$ convention required by the system prompt
    mathDelimiters: [
      { left: '$$', right: '$$', display: true  },
      { left: '$',  right: '$',  display: false  },
    ],
  };

  const { done: A_DONE, raw: A_RAW, view: A_VIEW } = CFG.attr;

  // ─────────────────────────────────────────────────────────
  //  STYLES
  // ─────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('umr-styles')) return;

    const DONE     = `[data-element-id="user-message"][${A_DONE}]`;
    const VIEW     = `[${A_VIEW}]`;
    const MSG_VIEW = `${DONE} > ${VIEW}`;

    const s = document.createElement('style');
    s.id = 'umr-styles';
    s.textContent = `

      /* ══ Container: state when rendered ═══════════════════ */

      /* Override the whitespace-pre-wrap Tailwind class baked
         into TM's user-message div via a higher-priority rule. */
      ${DONE} {
        white-space : normal !important;
      }

      /* Hide everything that isn't our rendered view.
         Covers: original children restored by React during
         reconciliation (anti-flash guard).                     */
      ${DONE} > *:not(${VIEW}) {
        display : none !important;
      }

      /* Neutralise Tailwind space-y-2's "> :not([hidden]) ~"
         sibling combinator that would add margin-top.
         The wrapper uses the HTML `hidden` attr so it is
         already excluded; this is a belt-and-braces guard.    */
      ${MSG_VIEW} {
        margin-top : 0 !important;
      }


      /* ══ View: base layout ═════════════════════════════════ */

      ${VIEW} {
        white-space  : normal;
        word-break   : break-word;
        overflow-wrap: break-word;
        line-height  : 1.62;
      }
      ${VIEW} > *:first-child { margin-top:    0 !important; }
      ${VIEW} > *:last-child  { margin-bottom: 0 !important; }


      /* ══ Paragraphs ════════════════════════════════════════ */
      ${VIEW} p { margin: 0.38em 0; }


      /* ══ Headings ══════════════════════════════════════════ */
      ${VIEW} h1, ${VIEW} h2, ${VIEW} h3,
      ${VIEW} h4, ${VIEW} h5, ${VIEW} h6 {
        font-weight : 700;
        line-height : 1.25;
        margin      : 0.6em 0 0.25em;
      }
      ${VIEW} h1 { font-size: 1.50em; }
      ${VIEW} h2 { font-size: 1.30em; }
      ${VIEW} h3 { font-size: 1.14em; }
      ${VIEW} h4 { font-size: 1.02em; }
      ${VIEW} h5 { font-size: 0.92em; }
      ${VIEW} h6 { font-size: 0.86em; opacity: 0.82; }


      /* ══ Inline text formatting ════════════════════════════ */
      ${VIEW} strong, ${VIEW} b   { font-weight: 700; }
      ${VIEW} em,     ${VIEW} i   { font-style: italic; }
      ${VIEW} del,    ${VIEW} s   { text-decoration: line-through; }
      ${VIEW} u                   { text-decoration: underline; }
      ${VIEW} sup { vertical-align: super; font-size: 0.74em; line-height: 1; }
      ${VIEW} sub { vertical-align: sub;   font-size: 0.74em; line-height: 1; }

      ${VIEW} mark {
        background    : rgba(255, 230, 0, 0.32);
        color         : inherit;
        padding       : 0.05em 0.22em;
        border-radius : 2px;
      }
      ${VIEW} abbr[title] {
        text-decoration : underline dotted;
        cursor          : help;
      }


      /* ══ Links ═════════════════════════════════════════════ */
      /* external links get target="_blank" via postProcessDom */
      ${VIEW} a       { text-decoration: underline; opacity: 0.90; }
      ${VIEW} a:hover { opacity: 1; }


      /* ══ Code — inline ═════════════════════════════════════ */
      /* :not(pre)>code targets only inline code, not the
         code element that lives inside a <pre> block.         */
      ${VIEW} :not(pre) > code, ${VIEW} kbd {
        font-family   : ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
        font-size     : 0.85em;
        padding       : 0.1em 0.38em;
        border-radius : 3px;
        /* User bubbles = white text on blue/dark bg;
           semi-transparent white gives a frosted-glass feel. */
        background    : rgba(255, 255, 255, 0.18);
        word-break    : break-all;
      }
      ${VIEW} kbd {
        border     : 1px solid rgba(255, 255, 255, 0.35);
        padding    : 0.05em 0.42em;
        box-shadow : 0 1px 0 rgba(255, 255, 255, 0.22);
      }


      /* ══ Code — block ══════════════════════════════════════ */
      ${VIEW} pre {
        margin        : 0.48em 0;
        padding       : 0.72em 0.95em;
        border-radius : 6px;
        overflow-x    : auto;
        -webkit-overflow-scrolling: touch;
        background    : rgba(255, 255, 255, 0.10);
        font-size     : 0.9em;        /* governs the pre's own sizing  */
      }
      ${VIEW} pre code {
        /* Reset the inline-code overrides that would piggyback. */
        background : none    !important;
        padding    : 0       !important;
        font-size  : 1em     !important;  /* now relative to pre's 0.9em  */
        word-break : normal;
      }


      /* ══ Blockquotes — nested levels ═══════════════════════ */
      ${VIEW} blockquote {
        margin       : 0.48em 0;
        padding      : 0.08em 0 0.08em 0.78em;
        border-left  : 3px solid rgba(255, 255, 255, 0.44);
        opacity      : 0.90;
      }
      ${VIEW} blockquote blockquote {
        /* 2nd level: slightly fainter border */
        margin-left  : 0;
        border-left-color : rgba(255, 255, 255, 0.28);
      }
      ${VIEW} blockquote blockquote blockquote {
        /* 3rd level: even fainter */
        border-left-color : rgba(255, 255, 255, 0.16);
      }


      /* ══ Lists ══════════════════════════════════════════════ */
      ${VIEW} ul, ${VIEW} ol {
        padding-left : 1.5em;
        margin       : 0.38em 0;
      }
      ${VIEW} li             { margin: 0.18em 0; }
      /* Tighten nested list spacing */
      ${VIEW} li > ul,
      ${VIEW} li > ol        { margin: 0.12em 0; }

      /* Task-list items — remove bullet and style checkbox */
      ${VIEW} li:has(> input[type="checkbox"]) {
        list-style   : none;
        margin-left  : -1.5em;   /* un-indent the de-bulleted item */
        padding-left : 0;
      }
      ${VIEW} input[type="checkbox"] {
        margin        : 0 0.42em 0.1em 0;
        vertical-align: middle;
        cursor        : default;
        accent-color  : rgba(255, 255, 255, 0.80);
      }


      /* ══ Tables ═════════════════════════════════════════════ */
      /* postProcessDom wraps every <table> in:
           <div class="umr-table-wrap">...</div>
         so overflow-x is handled on the wrapper, not the
         table element itself (avoids display:block hacks that
         distort td width calculations in some browsers).       */
      .umr-table-wrap {
        overflow-x                : auto;
        -webkit-overflow-scrolling: touch;
        margin                    : 0.48em 0;
        border-radius             : 4px;
      }
      ${VIEW} table {
        border-collapse : collapse;
        min-width       : 100%;
        margin          : 0;          /* wrapper provides the margin  */
      }
      ${VIEW} th,
      ${VIEW} td {
        border     : 1px solid rgba(255, 255, 255, 0.26);
        padding    : 0.30em 0.62em;
        text-align : left;
        /* All inline formatting (bold, code, math, links, images)
           inside cells is handled automatically — our [VIEW] X
           descendant selectors cascade into <td>/<th> at any
           nesting depth without any extra rules.                */
      }
      ${VIEW} thead th {
        font-weight       : 700;
        background        : rgba(255, 255, 255, 0.09);
        border-bottom-width: 2px;         /* accent the header row   */
      }
      ${VIEW} tbody tr:nth-child(even) {
        background : rgba(255, 255, 255, 0.04); /* subtle zebra stripe */
      }


      /* ══ Images ═════════════════════════════════════════════ */
      ${VIEW} img {
        max-width      : 100%;
        height         : auto;
        border-radius  : 4px;
        display        : inline-block;
        vertical-align : middle;
        margin         : 0.22em 0;
        transition     : opacity 0.2s;
      }


      /* ══ Horizontal rule ════════════════════════════════════ */
      ${VIEW} hr {
        border     : 0;
        border-top : 1px solid rgba(255, 255, 255, 0.26);
        margin     : 0.65em 0;
      }


      /* ══ Definition lists ══════════════════════════════════ */
      ${VIEW} dl { margin: 0.38em 0; }
      ${VIEW} dt { font-weight: 700; margin-top: 0.38em; }
      ${VIEW} dd { margin-left: 1.5em; margin-bottom: 0.2em; }


      /* ══ KaTeX math ═════════════════════════════════════════ */
      /* KaTeX inherits the parent's colour (text-white) and
         font automatically. Only layout tweaks are needed.     */
      ${VIEW} .katex-display {
        margin                    : 0.58em 0;
        overflow-x                : auto;   /* wide equations scroll  */
        overflow-y                : hidden;
        -webkit-overflow-scrolling: touch;
      }
      ${VIEW} .katex { font-size: 1.06em; }
    `;
    document.head.appendChild(s);
  }


  // ─────────────────────────────────────────────────────────
  //  KATEX CSS (non-blocking link tag)
  // ─────────────────────────────────────────────────────────
  function injectKatexCss() {
    if (document.getElementById('umr-katex-css')) return;
    const link  = document.createElement('link');
    link.id     = 'umr-katex-css';
    link.rel    = 'stylesheet';
    link.href   = CFG.cdn.katexCss;
    document.head.appendChild(link);
  }


  // ─────────────────────────────────────────────────────────
  //  SCRIPT LOADER
  //  Reuses the library if TypingMind already loaded it
  //  (e.g. KaTeX for AI-response math rendering).
  // ─────────────────────────────────────────────────────────
  function loadScript(src, globalKey) {
    return new Promise((resolve, reject) => {
      if (globalKey && window[globalKey]) { resolve(window[globalKey]); return; }
      const s  = document.createElement('script');
      s.src    = src;
      s.onload = () => resolve(globalKey ? window[globalKey] : true);
      s.onerror= () => reject(new Error(`[TM-UserMD] Failed to load: ${src}`));
      document.head.appendChild(s);
    });
  }


  // ─────────────────────────────────────────────────────────
  //  LIBRARY LOADING
  //  marked.js and KaTeX load in parallel; auto-render
  //  waits on KaTeX JS (hard dependency).
  // ─────────────────────────────────────────────────────────
  async function loadLibraries() {
    injectKatexCss();

    const [marked] = await Promise.all([
      loadScript(CFG.cdn.marked,      'marked'),
      loadScript(CFG.cdn.katexJs,     'katex')
        .then(() => loadScript(CFG.cdn.katexRender, 'renderMathInElement')),
    ]);

    marked.use({ breaks: true, gfm: true });

    return {
      marked,
      renderMathInElement: window.renderMathInElement,
    };
  }


  // ─────────────────────────────────────────────────────────
  //  DOM POST-PROCESSOR
  //  Runs on the temp node after marked.parse(), before KaTeX.
  //  Handles everything that requires DOM traversal rather
  //  than CSS alone.
  // ─────────────────────────────────────────────────────────
  function postProcessDom(root) {

    // ── 1. Wrap tables in a scrollable container ───────────
    // Using a wrapper div keeps <table> as display:table so
    // browser td-width calculations remain correct, while
    // the wrapper provides overflow-x: auto via CSS.
    root.querySelectorAll('table').forEach(table => {
      const wrap = document.createElement('div');
      wrap.className = 'umr-table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });

    // ── 2. External links → open in new tab safely ─────────
    root.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel',    'noopener noreferrer');
      }
    });

    // ── 3. Images → responsive + lazy loading ──────────────
    // The onerror attribute survives innerHTML serialisation
    // (unlike addEventListener). It fades broken images to
    // 30% opacity instead of showing the browser's broken-
    // image icon.
    root.querySelectorAll('img').forEach(img => {
      img.setAttribute('loading', 'lazy');
      img.setAttribute('onerror', "this.style.opacity='0.3'");
    });
  }


  // ─────────────────────────────────────────────────────────
  //  PARSE FUNCTION
  //  Pipeline (all on a detached temp node, never touching
  //  the live DOM until the final innerHTML is returned):
  //
  //  rawText
  //    → marked.parse()           markdown → HTML
  //    → postProcessDom()         tables/links/images
  //    → renderMathInElement()    $$/$$ → KaTeX spans
  //    → .innerHTML               final HTML string
  // ─────────────────────────────────────────────────────────
  function makeParser(marked, renderMathInElement) {
    return function parse(rawText) {
      const tmp = document.createElement('div');
      tmp.innerHTML = marked.parse(rawText);

      postProcessDom(tmp);

      // KaTeX auto-render natively skips <code> and <pre>
      // content, so math delimiters inside code blocks are
      // left as literal text — correct behaviour.
      renderMathInElement(tmp, {
        delimiters   : CFG.mathDelimiters,
        throwOnError : false,
      });

      return tmp.innerHTML;
    };
  }


  // ─────────────────────────────────────────────────────────
  //  EDIT-MODE DETECTION
  //  From the diagnostic: edit-message-button is a sibling
  //  of user-message inside response-block, not a child.
  //  TM likely mounts the edit textarea at the response-block
  //  level. Checking both locations for forwards-compat.
  // ─────────────────────────────────────────────────────────
  function isEditing(msgEl) {
    if (msgEl.querySelector('textarea')) return true;
    const rb = msgEl.closest(CFG.sel.responseBlk);
    return rb ? rb.querySelector('textarea') !== null : false;
  }


  // ─────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────
  function render(msgEl, parseFn) {
    if (isEditing(msgEl)) { unrender(msgEl); return; }

    // View missing despite done-flag = React reconciliation
    // removed our injected children. Reset and re-render.
    if (msgEl.hasAttribute(A_DONE)) {
      if (!msgEl.querySelector(`[${A_VIEW}]`)) {
        msgEl.removeAttribute(A_DONE);
      } else {
        return; // correctly rendered, nothing to do
      }
    }

    const rawText = msgEl.textContent.trim();
    if (!rawText) return;

    // Move ALL existing child nodes (including raw text nodes
    // that aren't wrapped in elements) into a hidden wrapper.
    // Using the HTML `hidden` attribute (not style="display:none")
    // so Tailwind's space-y-2 "> :not([hidden]) ~" combinator
    // correctly excludes this wrapper from its margin-top rule.
    const wrapper = document.createElement('span');
    wrapper.setAttribute(A_RAW, '1');
    wrapper.hidden = true;
    Array.from(msgEl.childNodes).forEach(n => wrapper.appendChild(n));

    // Build the rendered view
    const view = document.createElement('div');
    view.setAttribute(A_VIEW, '1');
    view.innerHTML = parseFn(rawText);

    // Attach error listeners to images now, while they are
    // DOM nodes (before innerHTML-serialisation would lose them).
    // These fire if the image URL is broken after insertion.
    view.querySelectorAll('img').forEach(img => {
      img.addEventListener('error', () => {
        img.style.opacity = '0.3';
      }, { once: true });
    });

    msgEl.appendChild(wrapper);
    msgEl.appendChild(view);
    msgEl.setAttribute(A_DONE, '1');
  }


  // ─────────────────────────────────────────────────────────
  //  UNRENDER  (Edit mode: restore raw text)
  // ─────────────────────────────────────────────────────────
  function unrender(msgEl) {
    if (!msgEl.hasAttribute(A_DONE)) return;

    const wrapper = msgEl.querySelector(`[${A_RAW}]`);
    const view    = msgEl.querySelector(`[${A_VIEW}]`);

    if (wrapper) {
      // Move original child nodes back in their original order
      Array.from(wrapper.childNodes).forEach(n =>
        msgEl.insertBefore(n, wrapper)
      );
      wrapper.remove();
    }
    if (view) view.remove();

    // Removing A_DONE also deactivates all CSS overrides;
    // whitespace-pre-wrap on the parent class becomes active
    // again automatically.
    msgEl.removeAttribute(A_DONE);
  }


  // ─────────────────────────────────────────────────────────
  //  PROCESS  (all user messages in the chat area)
  // ─────────────────────────────────────────────────────────
  function processAll(chatArea, parseFn) {
    chatArea
      .querySelectorAll(CFG.sel.userMsg)
      .forEach(msg => render(msg, parseFn));
  }


  // ─────────────────────────────────────────────────────────
  //  OBSERVER  (rAF-debounced MutationObserver)
  // ─────────────────────────────────────────────────────────
  const _observed = new WeakSet();

  function observe(chatArea, parseFn) {
    if (_observed.has(chatArea)) return;
    _observed.add(chatArea);

    let rafId = null;
    new MutationObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        processAll(chatArea, parseFn);
      });
    }).observe(chatArea, { childList: true, subtree: true });
  }


  // ─────────────────────────────────────────────────────────
  //  ATTACH  (handles SPA navigation + PWA foreground resume)
  // ─────────────────────────────────────────────────────────
  function attach(parseFn) {
    const chatArea = document.querySelector(CFG.sel.chatArea);
    if (!chatArea) return;
    processAll(chatArea, parseFn);
    observe(chatArea, parseFn);
  }


  // ─────────────────────────────────────────────────────────
  //  BOOTSTRAP
  // ─────────────────────────────────────────────────────────
  async function boot() {
    injectStyles();

    let libs;
    try {
      libs = await loadLibraries();
    } catch (err) {
      console.error('[TM-UserMD]', err.message);
      return;
    }

    const parseFn = makeParser(libs.marked, libs.renderMathInElement);

    attach(parseFn);
    new MutationObserver(() => attach(parseFn))
      .observe(document.body, { childList: true });

    console.info('[TM-UserMD] ✅ v1.3.0 active — Markdown + Math + full element support');
  }

  boot();
})();
