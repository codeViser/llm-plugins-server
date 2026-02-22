// ============================================================
//  TypingMind — User Message Markdown + Math Renderer
//  Version : 2.1.0
//
//  What changed vs 2.0.0:
//  ─────────────────────────────────────────────────────────
//  The system prompt uses $$...$$ as a UNIVERSAL delimiter.
//  Display vs inline is determined by context alone:
//    $$...$$ on its own line  →  display (block)
//    $$...$$ within a line    →  inline
//
//  Fix: replaced KaTeX auto-render with parseMixedContent(),
//  a pre-processor that runs before marked.js:
//    1. Protect code blocks so $$ inside code stays literal
//    2. Standalone $$ lines → katex.renderToString(display:true)
//    3. Remaining $$ → katex.renderToString(display:false)
//    4. Run marked.parse() on Math-replaced text
//    5. Restore KaTeX HTML in result
//  auto-render.min.js is no longer loaded.
//
//  Root bug from v2.0.0 is preserved-fixed:
//    parseFn always called before DOM mutation.
//    KaTeX is a soft dependency — markdown works without it.
//
//  Confirmed selector: [data-element-id="user-message"]
//  Compatible: Chromium web + Android PWA
// ============================================================

(() => {
  'use strict';

  // ── Configuration ─────────────────────────────────────────
  const CFG = {
    cdn: {
      marked  : 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js',
      katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
      katexJs : 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
      // auto-render removed in v2.1.0 — no longer needed
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
  };

  const { done: A_DONE, view: A_VIEW } = CFG.attr;
  const parser = { fn: null };   // set after marked loads; upgraded after KaTeX


  // ── CSS ────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('umr-styles')) return;

    const UM   = `[data-element-id="user-message"]`;
    const DONE = `${UM}[${A_DONE}]`;
    const VIEW = `[${A_VIEW}]`;

    const s = document.createElement('style');
    s.id    = 'umr-styles';
    s.textContent = `

      /* ═══ Container when rendered ════════════════════════════
         white-space:normal  → overrides TM's whitespace-pre-wrap
         color:transparent   → hides bare text nodes (can't be
                               targeted by selectors; element
                               children use display:none below)  */
      ${DONE} {
        white-space : normal      !important;
        color       : transparent !important;
      }
      ${DONE} > *:not(${VIEW}) { display: none !important; }

      /* ═══ View: restore colour, set typography root ═════════
         user-message always uses text-white (confirmed).        */
      ${DONE} > ${VIEW} {
        color      : white  !important;
        font-size  : 0.9375rem;
        line-height: 1.62;
        white-space: normal !important;
      }
      ${VIEW} {
        word-break  : break-word;
        overflow-wrap: break-word;
      }
      ${VIEW} > *:first-child { margin-top:    0 !important; }
      ${VIEW} > *:last-child  { margin-bottom: 0 !important; }

      /* ── Paragraphs ─────────────────────────────────────── */
      ${VIEW} p { margin: 0.4em 0; }

      /* ── Headings ──────────────────────────────────────── */
      ${VIEW} h1,${VIEW} h2,${VIEW} h3,
      ${VIEW} h4,${VIEW} h5,${VIEW} h6 {
        font-weight: 700; line-height: 1.25; margin: 0.6em 0 0.25em;
      }
      ${VIEW} h1 { font-size: 1.50em;  }
      ${VIEW} h2 { font-size: 1.30em;  }
      ${VIEW} h3 { font-size: 1.13em;  }
      ${VIEW} h4 { font-size: 1.02em;  }
      ${VIEW} h5 { font-size: 0.92em;  }
      ${VIEW} h6 { font-size: 0.86em; opacity: 0.82; }

      /* ── Inline text ────────────────────────────────────── */
      ${VIEW} strong, ${VIEW} b  { font-weight: 700; }
      ${VIEW} em,     ${VIEW} i  { font-style: italic; }
      ${VIEW} del,    ${VIEW} s  { text-decoration: line-through; }
      ${VIEW} u                  { text-decoration: underline; }
      ${VIEW} sup { vertical-align: super; font-size: 0.75em; line-height: 1; }
      ${VIEW} sub { vertical-align: sub;   font-size: 0.75em; line-height: 1; }
      ${VIEW} mark {
        background: rgba(255,230,0,0.35); color: inherit;
        padding: 0.05em 0.22em; border-radius: 2px;
      }
      ${VIEW} abbr[title] { text-decoration: underline dotted; cursor: help; }

      /* ── Links ──────────────────────────────────────────── */
      ${VIEW} a       { text-decoration: underline; opacity: 0.9; }
      ${VIEW} a:hover { opacity: 1; }

      /* ── Inline code & kbd ──────────────────────────────── */
      /* :not(pre)>code targets only inline code, not pre>code */
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
        margin: 0.5em 0; padding: 0.72em 0.95em;
        border-radius: 6px; overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        background: rgba(255,255,255,0.10); font-size: 0.9em;
      }
      ${VIEW} pre code {
        background: none !important; padding: 0 !important;
        font-size: 1em !important; word-break: normal;
      }

      /* ── Blockquotes (3 levels) ─────────────────────────── */
      ${VIEW} blockquote {
        margin: 0.48em 0; padding: 0.1em 0 0.1em 0.8em;
        border-left: 3px solid rgba(255,255,255,0.44);
      }
      ${VIEW} blockquote blockquote {
        margin-left: 0; border-left-color: rgba(255,255,255,0.28);
      }
      ${VIEW} blockquote blockquote blockquote {
        border-left-color: rgba(255,255,255,0.16);
      }

      /* ── Lists ──────────────────────────────────────────── */
      ${VIEW} ul, ${VIEW} ol { padding-left: 1.5em; margin: 0.38em 0; }
      ${VIEW} li             { margin: 0.18em 0; }
      ${VIEW} li > ul,
      ${VIEW} li > ol        { margin: 0.1em 0; }
      /* Task lists: marked adds class="task-list-item" — no :has() needed */
      ${VIEW} li.task-list-item { list-style: none; margin-left: -1.5em; padding-left: 0; }
      ${VIEW} input[type="checkbox"] {
        margin: 0 0.42em 0.1em 0; vertical-align: middle;
        cursor: default; accent-color: rgba(255,255,255,0.8);
      }

      /* ── Tables (wrapper added by postProcessDom) ───────── */
      .umr-table-wrap {
        overflow-x: auto; -webkit-overflow-scrolling: touch;
        margin: 0.5em 0; border-radius: 4px;
      }
      ${VIEW} table { border-collapse: collapse; min-width: 100%; margin: 0; }
      ${VIEW} th,
      ${VIEW} td {
        border: 1px solid rgba(255,255,255,0.26);
        padding: 0.3em 0.62em; text-align: left;
      }
      ${VIEW} thead th {
        font-weight: 700; background: rgba(255,255,255,0.09);
        border-bottom-width: 2px;
      }
      ${VIEW} tbody tr:nth-child(even) { background: rgba(255,255,255,0.04); }

      /* ── Images ─────────────────────────────────────────── */
      ${VIEW} img {
        max-width: 100%; height: auto; border-radius: 4px;
        display: inline-block; vertical-align: middle; margin: 0.2em 0;
      }

      /* ── HR ─────────────────────────────────────────────── */
      ${VIEW} hr { border: 0; border-top: 1px solid rgba(255,255,255,0.26); margin: 0.65em 0; }

      /* ── Definition lists ───────────────────────────────── */
      ${VIEW} dl { margin: 0.38em 0; }
      ${VIEW} dt { font-weight: 700; margin-top: 0.38em; }
      ${VIEW} dd { margin-left: 1.5em; margin-bottom: 0.2em; }

      /* ── KaTeX ──────────────────────────────────────────── */
      /* KaTeX inherits white from the view — only layout needed */
      ${VIEW} .katex-display {
        margin: 0.6em 0; overflow-x: auto; overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
      }
      ${VIEW} .katex { font-size: 1.06em; }

      /* ── Math parse-error fallback ──────────────────────── */
      ${VIEW} .umr-math-err {
        opacity: 0.7; font-style: italic;
        border: 1px dashed rgba(255,255,255,0.4);
        padding: 0.1em 0.4em; border-radius: 3px;
      }
    `;
    document.head.appendChild(s);
  }


  // ── Loaders ────────────────────────────────────────────────
  function injectKatexCss() {
    if (document.getElementById('umr-katex-css')) return;
    const l = document.createElement('link');
    l.id = 'umr-katex-css'; l.rel = 'stylesheet'; l.href = CFG.cdn.katexCss;
    document.head.appendChild(l);
  }

  function loadScript(src, globalKey) {
    return new Promise((res, rej) => {
      if (globalKey && window[globalKey]) { res(window[globalKey]); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload  = () => res(globalKey ? window[globalKey] : true);
      s.onerror = () => rej(new Error('[TM-UserMD] Failed: ' + src));
      document.head.appendChild(s);
    });
  }


  // ── DOM post-processor ─────────────────────────────────────
  function postProcessDom(root) {
    // Wrap tables in scrollable containers
    root.querySelectorAll('table').forEach(tbl => {
      const w = document.createElement('div');
      w.className = 'umr-table-wrap';
      tbl.parentNode.insertBefore(w, tbl);
      w.appendChild(tbl);
    });
    // External links → new tab
    root.querySelectorAll('a[href]').forEach(a => {
      if (/^https?:\/\//i.test(a.getAttribute('href') || '')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
    // Images → lazy
    root.querySelectorAll('img').forEach(img => img.setAttribute('loading', 'lazy'));
  }


  // ── Context-aware math pre-processor ──────────────────────
  //
  //  Rule: $$...$$ is the only math delimiter.
  //  Whether it renders as display or inline depends on context:
  //
  //    DISPLAY  →  $$ is the first non-whitespace token on a line
  //                AND the last token (optionally with trailing spaces)
  //                before the newline or end of string.
  //
  //    INLINE   →  everything else (flanked by text on the same line)
  //
  //  Pipeline:
  //    rawText
  //      → protect code fences + inline code
  //      → replace display $$ with placeholder (render display KaTeX)
  //      → replace inline  $$ with placeholder (render inline KaTeX)
  //      → restore code blocks
  //      → marked.parse()
  //      → restore KaTeX HTML
  //        (strip <p> wrapper around display placeholders)

  function parseMixedContent(rawText, marked, katex) {
    // Unique tokens for this call — alphanumeric only, safe for RegExp
    const rnd      = Math.random().toString(36).slice(2, 10);
    const MTOK     = `UMRmath${rnd}`;  // e.g. UMRmathx7f3a2b1
    const CTOK     = `UMRcode${rnd}`;
    const mathStore = [];
    const codeStore = [];

    let t = rawText;

    // ── 0. Protect code blocks and inline code ──────────────
    // Must happen first — $$ inside code must stay literal.
    t = t
      // Fenced blocks: ```lang ... ``` or ~~~lang ... ~~~
      .replace(/(`{3,}|~{3,})([^\n]*\n[\s\S]*?)\1/g, m => {
        const i = codeStore.length;
        codeStore.push(m);
        return `${CTOK}${i}`;
      })
      // Inline code spans: `...`
      .replace(/`([^`\n]+)`/g, m => {
        const i = codeStore.length;
        codeStore.push(m);
        return `${CTOK}${i}`;
      });

    // ── 1. Display math ─────────────────────────────────────
    //
    // Matches $$...$$ when:
    //   • the $$ is preceded by line-start (or newline) with
    //     only whitespace / blockquote markers (>) before it
    //   • the closing $$ is followed by only trailing spaces/tabs
    //     and then a newline or end-of-string
    //
    // Content pattern (?:[^$]|\$(?!\$))*? matches any char except
    // bare $$, which prevents one outer match swallowing multiple
    // inner $$...$$ pairs.
    t = t.replace(
      /((?:^|\n)[ \t>]*)\$\$((?:[^$]|\$(?!\$))*?)\$\$([ \t]*(?=\n|$))/g,
      (match, before, formula, trailingSpace) => {
        const i = mathStore.length;
        mathStore.push(katexRender(katex, formula.trim(), true));
        return `${before}${MTOK}D${i}${trailingSpace}`;
      }
    );

    // ── 2. Inline math ──────────────────────────────────────
    // Any remaining $$...$$ that didn't qualify as display.
    t = t.replace(
      /\$\$((?:[^$]|\$(?!\$))*?)\$\$/g,
      (_, formula) => {
        const i = mathStore.length;
        mathStore.push(katexRender(katex, formula.trim(), false));
        return `${MTOK}I${i}`;
      }
    );

    // ── 3. Restore code blocks before markdown parse ────────
    t = t.replace(new RegExp(`${CTOK}(\\d+)`, 'g'),
      (_, i) => codeStore[parseInt(i)]
    );

    // ── 4. Markdown → HTML ──────────────────────────────────
    let html = marked.parse(t);

    // ── 5. Restore math HTML ─────────────────────────────────
    //
    // Display tokens: marked.js wraps a bare text line in
    // <p>…</p>. We strip that wrapper for display math so the
    // KaTeX <div class="katex-display"> sits directly in flow.
    //
    // Inline tokens sit inside <p>…</p> alongside other content;
    // we replace the token in-place without touching the <p>.
    const pWrapRE  = new RegExp(`<p>\\s*${MTOK}D(\\d+)\\s*</p>`, 'g');
    const anyTokRE = new RegExp(`${MTOK}[DI](\\d+)`, 'g');

    html = html
      .replace(pWrapRE,  (_, i) => mathStore[parseInt(i)])
      .replace(anyTokRE, (_, i) => mathStore[parseInt(i)]);

    return html;
  }

  /** Safe katex.renderToString wrapper — falls back to styled literal */
  function katexRender(katex, formula, displayMode) {
    try {
      return katex.renderToString(formula, {
        displayMode,
        throwOnError: false,
        // output defaults to 'htmlAndMathml' (best accessibility)
      });
    } catch (e) {
      const tag = displayMode ? 'div' : 'span';
      return `<${tag} class="umr-math-err">$$${formula}$$</${tag}>`;
    }
  }


  // ── Edit-mode detection ────────────────────────────────────
  function isEditing(msgEl) {
    if (msgEl.querySelector('textarea')) return true;
    const rb = msgEl.closest(CFG.sel.responseBlk);
    return rb ? !!rb.querySelector('textarea') : false;
  }


  // ── Render ─────────────────────────────────────────────────
  function render(msgEl) {
    if (!parser.fn) return;
    if (isEditing(msgEl)) { unrender(msgEl); return; }

    if (msgEl.hasAttribute(A_DONE)) {
      if (msgEl.querySelector('[' + A_VIEW + ']')) return;  // already correct
      msgEl.removeAttribute(A_DONE);                       // view gone → redo
    }

    const rawText = msgEl.textContent.trim();
    if (!rawText) return;

    // Parse FIRST — DOM is never touched if this throws
    let html;
    try {
      html = parser.fn(rawText);
    } catch (err) {
      console.warn('[TM-UserMD] parse error (DOM untouched):', err.message);
      return;
    }

    const view = document.createElement('div');
    view.setAttribute(A_VIEW, '1');
    view.innerHTML = html;

    // img error handling — addEventListener survives DOM insertion
    view.querySelectorAll('img').forEach(img =>
      img.addEventListener('error', () => { img.style.opacity = '0.3'; }, { once: true })
    );

    // Set A_DONE before appendChild so CSS fires atomically:
    // original children hidden → view appended and immediately visible
    // (single browser paint, no flash)
    msgEl.setAttribute(A_DONE, '1');
    msgEl.appendChild(view);
  }


  // ── Unrender ───────────────────────────────────────────────
  function unrender(msgEl) {
    if (!msgEl.hasAttribute(A_DONE)) return;
    const view = msgEl.querySelector('[' + A_VIEW + ']');
    if (view) view.remove();
    msgEl.removeAttribute(A_DONE);
    // Removing A_DONE deactivates all CSS overrides instantly:
    // • color:transparent gone → text-white class restores white
    // • white-space:normal gone → whitespace-pre-wrap restores
    // → original children visible again (never moved)
  }


  // ── Plumbing ───────────────────────────────────────────────
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

  function reRenderAll() {
    document.querySelectorAll(`${CFG.sel.userMsg}[${A_DONE}]`)
      .forEach(msg => { unrender(msg); render(msg); });
  }


  // ── Bootstrap — two-phase ──────────────────────────────────
  async function boot() {
    injectStyles();

    // Phase 1: marked.js (required) — markdown works immediately
    let marked;
    try {
      marked = await loadScript(CFG.cdn.marked, 'marked');
      marked.use({ breaks: true, gfm: true });
    } catch (e) {
      console.error('[TM-UserMD] marked.js failed —', e.message);
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
    console.info('[TM-UserMD] ✅ v2.1 — Markdown ON');

    // Phase 2: KaTeX (optional) — math added in background
    // Only katex.min.js needed — auto-render.min.js removed in v2.1.0
    injectKatexCss();
    try {
      await loadScript(CFG.cdn.katexJs, 'katex');
      const katex = window.katex;

      // Upgrade parser to context-aware markdown + math
      parser.fn = text => {
        const tmp = document.createElement('div');
        tmp.innerHTML = parseMixedContent(text, marked, katex);
        postProcessDom(tmp);
        return tmp.innerHTML;
      };

      reRenderAll();   // re-render already-visible messages with math
      console.info('[TM-UserMD] ✅ v2.1 — Context-aware $$ Math (KaTeX) ON');
    } catch (e) {
      console.warn('[TM-UserMD] KaTeX not loaded — math disabled:', e.message);
    }
  }

  boot();
})();
