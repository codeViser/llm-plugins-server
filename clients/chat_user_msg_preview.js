// ============================================================
//  TypingMind — User Message Markdown Renderer
//  Version : 1.1.0
//  Selector confirmed from live DOM diagnostic:
//    [data-element-id="user-message"]
//  Compatible: Chromium web + Android PWA
// ============================================================

(() => {
  'use strict';

  // ── Configuration ─────────────────────────────────────────
  const CFG = {
    // Pinned marked.js release for stability
    markedSrc : 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js',

    sel : {
      chatArea    : '[data-element-id="chat-space-middle-part"]',
      userMsg     : '[data-element-id="user-message"]',
      responseBlk : '[data-element-id="response-block"]',
    },

    // Namespaced attributes — will not collide with TypingMind's own attrs
    attr : {
      done : 'data-umr-done',   // set on user-message when rendered
      raw  : 'data-umr-raw',    // set on hidden wrapper holding original children
      view : 'data-umr-view',   // set on our injected rendered div
    },
  };

  const { done: A_DONE, raw: A_RAW, view: A_VIEW } = CFG.attr;

  // ── CSS ────────────────────────────────────────────────────
  // Keyed on the confirmed data-element-id and our custom attributes.
  // Using CSS (not classList) for React resilience — React preserves
  // data-* attributes across reconciliation while it resets className.
  function injectStyles() {
    if (document.getElementById('umr-styles')) return;

    // Shorthand selectors used in the template
    const DONE = `[data-element-id="user-message"][${A_DONE}]`;
    const VIEW = `[${A_VIEW}]`;

    const s = document.createElement('style');
    s.id = 'umr-styles';
    s.textContent = `

      /* ─── Container overrides when rendered ─────────────── */

      /* Override whitespace-pre-wrap which is baked into user-message's
         Tailwind class. Without this, markdown HTML would render literally. */
      ${DONE} {
        white-space : normal !important;
      }

      /* Hide ALL direct-child elements that are NOT our view.
         This covers React reconciliation flashes where React briefly
         restores the original children between our Observer cycles.   */
      ${DONE} > *:not(${VIEW}) {
        display : none !important;
      }

      /* ─── Rendered view base ─────────────────────────────── */

      /* The view div sits inside user-message which already has
         px-2.5 py-* padding and text-white. We only reset
         what whitespace-pre-wrap would otherwise break.            */
      ${VIEW} {
        white-space : normal;
        word-break  : break-word;
        line-height : 1.55;
      }

      /* Collapse outer margins on first/last block elements
         so the bubble padding is the only spacing.                */
      ${VIEW} > *:first-child { margin-top    : 0 !important; }
      ${VIEW} > *:last-child  { margin-bottom : 0 !important; }

      /* ─── Typography ─────────────────────────────────────── */
      ${VIEW} p               { margin: 0.35em 0; }
      ${VIEW} ul, ${VIEW} ol  { padding-left: 1.5em; margin: 0.3em 0; }
      ${VIEW} li              { margin: 0.15em 0; }
      ${VIEW} strong          { font-weight: 700; }
      ${VIEW} em              { font-style: italic; }
      ${VIEW} a               { text-decoration: underline; opacity: 0.85; }
      ${VIEW} a:hover         { opacity: 1; }

      /* ─── Headings ──────────────────────────────────────── */
      ${VIEW} h1, ${VIEW} h2,
      ${VIEW} h3, ${VIEW} h4,
      ${VIEW} h5, ${VIEW} h6  {
        font-weight  : 700;
        line-height  : 1.25;
        margin       : 0.5em 0 0.2em;
      }
      ${VIEW} h1 { font-size: 1.4em;  }
      ${VIEW} h2 { font-size: 1.25em; }
      ${VIEW} h3 { font-size: 1.1em;  }

      /* ─── Code & Pre ─────────────────────────────────────── */
      /* User bubbles use white text on a blue/dark background.
         Semi-transparent white gives a "frosted" inset effect.  */
      ${VIEW} code {
        font-family : ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
        font-size   : 0.85em;
        padding     : 0.1em 0.35em;
        border-radius : 3px;
        background  : rgba(255, 255, 255, 0.20);
      }
      ${VIEW} pre {
        margin        : 0.4em 0;
        padding       : 0.65em 0.9em;
        border-radius : 6px;
        overflow-x    : auto;
        background    : rgba(255, 255, 255, 0.12);
      }
      /* Reset inline code style inside pre blocks */
      ${VIEW} pre code {
        background  : none !important;
        padding     : 0;
        font-size   : 1em;
      }

      /* ─── Blockquotes ─────────────────────────────────────  */
      ${VIEW} blockquote {
        margin      : 0.4em 0;
        padding-left: 0.75em;
        border-left : 3px solid rgba(255, 255, 255, 0.45);
        opacity     : 0.88;
      }

      /* ─── Tables ─────────────────────────────────────────── */
      ${VIEW} table {
        border-collapse : collapse;
        margin          : 0.4em 0;
        width           : 100%;
      }
      ${VIEW} th, ${VIEW} td {
        border   : 1px solid rgba(255, 255, 255, 0.30);
        padding  : 0.28em 0.55em;
        text-align: left;
      }
      ${VIEW} th { font-weight: 700; }

      /* ─── Horizontal rule ─────────────────────────────────  */
      ${VIEW} hr {
        border     : 0;
        border-top : 1px solid rgba(255, 255, 255, 0.30);
        margin     : 0.5em 0;
      }
    `;
    document.head.appendChild(s);
  }

  // ── marked.js loader ──────────────────────────────────────
  function loadMarked() {
    return new Promise((resolve, reject) => {
      if (window.marked) { resolve(window.marked); return; }
      const s    = document.createElement('script');
      s.src      = CFG.markedSrc;
      s.onload   = () => {
        // GFM tables, autolinks, etc. + newline → <br>
        window.marked.use({ breaks: true, gfm: true });
        resolve(window.marked);
      };
      s.onerror  = () => reject(new Error('[TM-UserMD] Failed to load marked.js from CDN'));
      document.head.appendChild(s);
    });
  }

  // ── Edit-mode detection ───────────────────────────────────
  // TypingMind mounts the edit textarea at the response-block level
  // (edit-message-button is a sibling of user-message, not a child).
  // We check both locations for forward compatibility.
  function isEditing(msgEl) {
    if (msgEl.querySelector('textarea')) return true;
    const rb = msgEl.closest(CFG.sel.responseBlk);
    return rb ? rb.querySelector('textarea') !== null : false;
  }

  // ── Render ────────────────────────────────────────────────
  function render(msgEl, parseFn) {
    // Never render while the user is actively editing this message
    if (isEditing(msgEl)) { unrender(msgEl); return; }

    // If A_DONE is set but our view was removed (React reconciliation
    // during an upstream re-render), reset the flag and re-render cleanly.
    if (msgEl.hasAttribute(A_DONE)) {
      if (!msgEl.querySelector(`[${A_VIEW}]`)) {
        msgEl.removeAttribute(A_DONE);
      } else {
        return; // Already correctly rendered — nothing to do
      }
    }

    // Capture the raw markdown text from current DOM state
    const rawText = msgEl.textContent.trim();
    if (!rawText) return;

    // ── Step 1: Wrap ALL existing child nodes (incl. text nodes) ──
    // Moving them into a hidden <span> keeps React's DOM nodes intact
    // while letting us replace the visual output.
    const wrapper = document.createElement('span');
    wrapper.setAttribute(A_RAW, '1');
    wrapper.style.display = 'none';   // hidden; CSS [A_DONE] > *:not([A_VIEW]) is the backup

    // childNodes is live — iterate via Array.from to avoid index drift
    Array.from(msgEl.childNodes).forEach(node => wrapper.appendChild(node));

    // ── Step 2: Build the rendered view ───────────────────────────
    const view = document.createElement('div');
    view.setAttribute(A_VIEW, '1');
    // Do NOT copy the parent's class list — user-message has
    // whitespace-pre-wrap, w-fit, px-2.5 etc. which are for the
    // bubble container, not for rendered prose content.
    view.innerHTML = parseFn(rawText);

    // ── Step 3: Inject into the bubble ────────────────────────────
    msgEl.appendChild(wrapper);
    msgEl.appendChild(view);

    // Mark as done — this attribute drives the CSS overrides above.
    // React preserves extra data-* attributes across reconciliation.
    msgEl.setAttribute(A_DONE, '1');
  }

  // ── Unrender (restores raw text for Edit mode) ────────────
  function unrender(msgEl) {
    if (!msgEl.hasAttribute(A_DONE)) return;

    const wrapper = msgEl.querySelector(`[${A_RAW}]`);
    const view    = msgEl.querySelector(`[${A_VIEW}]`);

    // Move original child nodes back to user-message in correct order
    if (wrapper) {
      Array.from(wrapper.childNodes).forEach(node =>
        msgEl.insertBefore(node, wrapper)
      );
      wrapper.remove();
    }
    if (view) view.remove();

    // Removing A_DONE also removes all CSS overrides (whitespace-pre-wrap
    // becomes active again automatically via the class that was always there)
    msgEl.removeAttribute(A_DONE);
  }

  // ── Process all user messages in the chat area ────────────
  function processAll(chatArea, parseFn) {
    chatArea
      .querySelectorAll(CFG.sel.userMsg)
      .forEach(msg => render(msg, parseFn));
  }

  // ── MutationObserver setup ────────────────────────────────
  // rAF debounce: batches rapid DOM mutations (e.g. streaming AI
  // tokens causing layout thrash) into one scan per animation frame.
  const _observed = new WeakSet(); // avoids attaching multiple observers

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

  // ── Chat area attachment ──────────────────────────────────
  // Called on boot AND whenever the body changes (SPA navigation
  // between chats, new chat creation, PWA foreground resume).
  function attach(parseFn) {
    const chatArea = document.querySelector(CFG.sel.chatArea);
    if (!chatArea) return;
    processAll(chatArea, parseFn);
    observe(chatArea, parseFn);
  }

  function watchBody(parseFn) {
    // Shallow body watch (childList only, no subtree) — low overhead,
    // sufficient to detect the chat area being mounted/replaced.
    new MutationObserver(() => attach(parseFn))
      .observe(document.body, { childList: true });
  }

  // ── Bootstrap ─────────────────────────────────────────────
  async function boot() {
    injectStyles();

    let marked;
    try {
      marked = await loadMarked();
    } catch (err) {
      console.error(err.message);
      return;
    }

    const parseFn = text => marked.parse(text);

    attach(parseFn);       // immediate pass on existing chat
    watchBody(parseFn);    // handle SPA navigation / PWA chat switches

    console.info(
      '[TM-UserMD] ✅ Active | selector:', CFG.sel.userMsg,
      '| marked.js v12'
    );
  }

  boot();
})();
