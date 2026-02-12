// TypingMind: Selection Share Pill (Pinned, No-Heuristic)
// v1.0.0
// - Shows a small floating "Share" pill when text is selected inside the composer textarea.
// - On Android (and any platform that supports Web Share API), opens the native share sheet.
// - On desktop where Web Share is unavailable, falls back to copying the selected text.
// - Pinned to: textarea#chat-input-textbox[data-element-id="chat-input-textbox"]
// - SPA-safe: re-binds if TypingMind re-renders/replaces the textarea node.

(() => {
  const EXT = "tmSelectionSharePillPinned";
  if (window[EXT]) return;
  window[EXT] = true;

  // ---- Hard pinned selector (no heuristics) ----
  const COMPOSER_SELECTOR = 'textarea#chat-input-textbox[data-element-id="chat-input-textbox"]';

  // ---- IDs ----
  const STYLE_ID = `${EXT}-style`;
  const PILL_ID = `${EXT}-pill`;
  const TOAST_ID = `${EXT}-toast`;

  // ---- Theme ----
  const theme = {
    pillBg: "rgba(30,30,30,0.92)",
    pillText: "#F1F5F9",
    pillBorder: "rgba(255,255,255,0.14)",
    pillShadow: "0 10px 25px rgba(0,0,0,0.38)",
    toastBg: "rgba(15,15,15,0.95)",
    toastText: "#E2E8F0",
  };

  let composer = null;
  let abort = null;
  let pollId = null;

  function addStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      #${PILL_ID} {
        position: fixed;
        z-index: 2147483647;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid ${theme.pillBorder};
        background: ${theme.pillBg};
        color: ${theme.pillText};
        font: 700 12px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        box-shadow: ${theme.pillShadow};
        user-select: none;
        -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      #${PILL_ID}:active { transform: translateY(1px); }

      #${TOAST_ID} {
        position: fixed;
        z-index: 2147483647;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        display: none;
        padding: 10px 12px;
        border-radius: 10px;
        background: ${theme.toastBg};
        color: ${theme.toastText};
        font: 600 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        box-shadow: 0 12px 32px rgba(0,0,0,.45);
      }
    `;
    document.head.appendChild(s);
  }

  function ensurePill() {
    let pill = document.getElementById(PILL_ID);
    if (pill) return pill;

    pill = document.createElement("button");
    pill.id = PILL_ID;
    pill.type = "button";
    pill.textContent = "Share";
    pill.title = "Share selected text";
    pill.setAttribute("aria-label", "Share selected text");

    pill.addEventListener("click", onShareClick);
    document.documentElement.appendChild(pill);
    return pill;
  }

  function ensureToast() {
    let t = document.getElementById(TOAST_ID);
    if (t) return t;
    t = document.createElement("div");
    t.id = TOAST_ID;
    document.documentElement.appendChild(t);
    return t;
  }

  function showToast(msg, ms = 1400) {
    const t = ensureToast();
    t.textContent = msg;
    t.style.display = "block";
    setTimeout(() => (t.style.display = "none"), ms);
  }

  function hidePill() {
    const pill = document.getElementById(PILL_ID);
    if (pill) pill.style.display = "none";
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 10;
  }

  function getSelectedText() {
    if (!composer) return "";
    // Only care about selections in THIS textarea.
    // selectionStart/End works on both desktop and mobile for textarea.
    const start = composer.selectionStart ?? 0;
    const end = composer.selectionEnd ?? 0;
    if (end > start) return composer.value.slice(start, end);
    return "";
  }

  async function copyTextBestEffort(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    try {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      tmp.setAttribute("readonly", "");
      tmp.style.position = "fixed";
      tmp.style.left = "-9999px";
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      tmp.remove();
      return true;
    } catch (_) {}

    return false;
  }

  async function onShareClick() {
    const text = getSelectedText();
    if (!text) return;

    // Web Share API: requires user gesture/transient activation (we are in a click).
    // Ref: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
    if (navigator.share) {
      try {
        // Some implementations may reject very large payloads; keep it safe-ish.
        const safeText = text.length > 200000 ? text.slice(0, 200000) : text;
        await navigator.share({ text: safeText });
        hidePill();
        return;
      } catch (e) {
        // AbortError = user cancelled; others could be policy/unsupported/blocked.
        // Fall through to copy.
      }
    }

    const ok = await copyTextBestEffort(text);
    if (ok) showToast("Selection copied (share not available here)");
    else showToast("Could not share or copy selection");
  }

  function viewportBottom() {
    const vv = window.visualViewport;
    return vv ? (vv.offsetTop + vv.height) : window.innerHeight;
  }

  function positionPill() {
    const pill = ensurePill();
    if (!composer || !isVisible(composer)) return;

    // Ensure it can be measured
    pill.style.display = "flex";
    const pillW = pill.offsetWidth || 54;
    const pillH = pill.offsetHeight || 28;

    const r = composer.getBoundingClientRect();
    const bottom = viewportBottom();

    // Default: top-right above the textarea
    let x = r.right - pillW - 10;
    let y = r.top - pillH - 10;

    // If there's no room above, put it below
    if (y < 8) y = r.bottom + 10;

    // If below is behind the keyboard/viewport, place inside near top-right
    if (y + pillH > bottom - 8) {
      y = Math.min(bottom - pillH - 8, r.top + 8);
    }

    // Clamp
    x = Math.max(8, Math.min(window.innerWidth - pillW - 8, x));
    y = Math.max(8, Math.min(bottom - pillH - 8, y));

    pill.style.left = `${x}px`;
    pill.style.top = `${y}px`;
  }

  let raf = 0;
  function scheduleUpdate() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  }

  function update() {
    raf = 0;
    if (!composer || !document.body.contains(composer) || !isVisible(composer)) {
      hidePill();
      return;
    }

    // Show only when there is a real selection in THIS textarea
    const selected = getSelectedText();
    if (selected && selected.trim().length) positionPill();
    else hidePill();
  }

  function startPolling() {
    stopPolling();
    // Polling makes this robust on mobile selection-handle drags that sometimes
    // don't emit consistent events.
    pollId = setInterval(update, 250);
  }

  function stopPolling() {
    if (pollId) clearInterval(pollId);
    pollId = null;
  }

  function bindToComposer(node) {
    if (composer === node) return;

    // Cleanup previous bindings
    if (abort) abort.abort();
    abort = new AbortController();

    composer = node;

    addStylesOnce();
    ensurePill();
    ensureToast();

    const opts = { signal: abort.signal };

    // Update triggers across desktop+mobile
    composer.addEventListener("select", scheduleUpdate, opts);
    composer.addEventListener("keyup", scheduleUpdate, opts);
    composer.addEventListener("input", scheduleUpdate, opts);
    composer.addEventListener("mouseup", scheduleUpdate, opts);
    composer.addEventListener("touchend", scheduleUpdate, { ...opts, passive: true });
    composer.addEventListener("pointerup", scheduleUpdate, opts);

    composer.addEventListener("focus", () => { startPolling(); scheduleUpdate(); }, opts);
    composer.addEventListener("blur", () => { stopPolling(); setTimeout(scheduleUpdate, 0); }, opts);

    // Keep position correct when viewport shifts (mobile keyboard, resize, scroll)
    window.addEventListener("resize", scheduleUpdate, opts);
    window.addEventListener("scroll", scheduleUpdate, { ...opts, capture: true });
    window.visualViewport?.addEventListener("resize", scheduleUpdate, opts);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate, opts);

    // Hide pill if user taps elsewhere
    document.addEventListener("pointerdown", (e) => {
      const pill = document.getElementById(PILL_ID);
      if (!pill) return;
      if (pill.contains(e.target)) return;
      // If selection still exists we keep it, but most users expect it to disappear
      // when they interact elsewhere.
      hidePill();
    }, { ...opts, capture: true });

    startPolling();
    scheduleUpdate();

    console.log(`[${EXT}] Bound to composer:`, composer);
  }

  function boot() {
    const node = document.querySelector(COMPOSER_SELECTOR);
    if (node && node instanceof HTMLTextAreaElement) {
      bindToComposer(node);
    } else {
      // No heuristics: if the pinned selector doesn't exist, we do nothing.
      // MutationObserver below will catch it when it appears.
      hidePill();
    }
  }

  // Initial boot
  if (document.readyState === "complete" || document.readyState === "interactive") boot();
  else document.addEventListener("DOMContentLoaded", boot);

  // SPA resilience: re-bind only when the pinned node appears/changes
  const mo = new MutationObserver(() => boot());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  console.log(`[${EXT}] Initialized. Pinned selector: ${COMPOSER_SELECTOR}`);
})();
