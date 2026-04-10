/**
 * TypingMind — MCP Hard Refresh Extension
 * v2.1 — Fixed: localStorage double-encoding unwrapped correctly
 *
 * Root cause of v2.0 bug:
 *   TM_useDraftMCPServersJSON stores the config as JSON.stringify(configString),
 *   so localStorage.getItem() returns a JSON-encoded string like:
 *     "{\n  \"mcpServers\": { ... }\n}"   ← has outer quotes + escaped chars
 *   One JSON.parse() unwraps it to the actual clean config:
 *     {                                   ← real newlines, real quotes
 *       "mcpServers": { ... }
 *     }
 *   The old code wrote the double-encoded version straight into the textarea =
 *   TypingMind received literal \n and \" characters = parse error.
 *
 * Confirmed element map (all from live DevTools investigation):
 *   localStorage key : TM_useDraftMCPServersJSON  (double-encoded JSON string)
 *   Edit Servers     : adds 1 <textarea> + "Setup Connector" / "Cancel" / "Save Changes"
 *   Save button      : "Save Changes"  (exact text, bg-blue-600)
 *   Cancel button    : "Cancel"        (exact text, bg-red-600)
 *   Clear signal     : set textarea to ""  →  click "Save Changes"
 *   Phantom state    : all "Stop Server" buttons become visible simultaneously
 *   Stop button      : "Stop Server"   (exact, no hover needed in phantom state)
 *   Confirm button   : "Sure?"         (same-position toggle after Stop Server click)
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     CONSTANTS
  ══════════════════════════════════════════════════════════════ */

  const EXT    = 'tm-mcp-hr';
  const LS_KEY = 'TM_useDraftMCPServersJSON';
  const TAG    = '[MCP Hard Refresh]';

  const MS = {
    poll        :  1200,   // SPA watcher fallback poll
    panelOpen   :  1000,   // after clicking Edit Servers, wait for textarea
    afterSave   :  2800,   // after saving "", wait for phantom state to settle
    stopTimeout :  5000,   // max extra wait for first Stop Server button to appear
    sureWait    :   450,   // between Stop Server click and Sure? appearing
    afterStop   :   650,   // after each confirmed Stop before the next
    toast       :  7000,   // toast auto-dismiss
  };


  /* ══════════════════════════════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════════════════════════════ */

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log   = (...a) => console.log(TAG,  ...a);
  const warn  = (...a) => console.warn(TAG, ...a);

  /** First <button> matching text (exact or contains) */
  const findBtn = (text, root = document, exact = false) =>
    Array.from(root.querySelectorAll('button'))
      .find(b => exact
        ? b.textContent.trim() === text
        : b.textContent.trim().includes(text));

  /**
   * Set value on a React-controlled <textarea> so React's synthetic
   * onChange fires and internal state updates properly.
   * Uses the native property setter (bypasses React's own descriptor),
   * then dispatches bubbling input + change events.
   */
  function reactSet(ta, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;
    setter ? setter.call(ta, value) : (ta.value = value);
    ta.dispatchEvent(new Event('input',  { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Poll until CSS selector resolves in DOM; returns element or null */
  async function waitFor(sel, ms, root = document) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const el = root.querySelector(sel);
      if (el) return el;
      await sleep(80);
    }
    return null;
  }

  /** Poll until predicate returns truthy; returns the truthy value or null */
  async function waitUntil(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    return null;
  }


  /* ══════════════════════════════════════════════════════════════
     PAGE DETECTION
  ══════════════════════════════════════════════════════════════ */

  const mcpH1     = () => Array.from(document.querySelectorAll('h1'))
    .find(h => h.textContent.trim() === 'Model Context Protocol');
  const onMCPPage = () => !!mcpH1();


  /* ══════════════════════════════════════════════════════════════
     BUTTON INJECTION
  ══════════════════════════════════════════════════════════════ */

  function injectButton() {
    if (document.getElementById(`${EXT}-btn`)) return;
    if (!onMCPPage()) return;

    const editBtn = findBtn('Edit Servers');
    if (!editBtn) return;

    const btn     = document.createElement('button');
    btn.id        = `${EXT}-btn`;
    btn.type      = 'button';
    btn.title     = 'Hard Refresh — clears phantom server connections then reloads config for a clean reconnect on any device';
    btn.className = editBtn.className;   // inherit sizing/rounding/font from Edit Servers
    btn.style.cssText = `
      background-color : #b45309 !important;
      color            : #ffffff !important;
      border           : 2px solid #92400e !important;
      cursor           : pointer;
    `;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
           aria-hidden="true" style="flex-shrink:0">
        <path d="M13 2L3 14h9l-1 8 10-12h-9z"/>
      </svg>
      Hard Refresh`;

    btn.addEventListener('click', () => run(btn));

    // Insert BEFORE Edit Servers → order: [Refresh] [⚡ Hard Refresh] [Edit Servers]
    editBtn.parentElement.insertBefore(btn, editBtn);
    log('Button injected ✓');
  }


  /* ══════════════════════════════════════════════════════════════
     PHASE 1 — READ CONFIG
  ══════════════════════════════════════════════════════════════ */

  /**
   * Returns the clean, properly-formatted MCP config JSON string.
   *
   * THE KEY FIX (v2.1):
   *   TM_useDraftMCPServersJSON stores the config via JSON.stringify(configString),
   *   creating DOUBLE encoding. localStorage.getItem() returns something like:
   *
   *     "{\n  \"mcpServers\": { ... }\n}"   ← JSON string with outer quotes + escapes
   *
   *   One JSON.parse() unwraps it to the actual clean config:
   *
   *     {
   *       "mcpServers": { ... }             ← real newlines, real quotes — textarea-ready
   *     }
   *
   * Fallback: open Edit Servers panel → read ta.value directly (never double-encoded).
   */
  async function readConfig() {
    const raw = localStorage.getItem(LS_KEY);

    if (raw && raw.trim()) {
      try {
        // Step 1: unwrap the outer JSON encoding
        const unwrapped = JSON.parse(raw);

        if (typeof unwrapped === 'string' && unwrapped.trim()) {
          // Normal case: double-encoded string → unwrapped is the real config text
          JSON.parse(unwrapped);   // validate the inner content is parseable JSON
          log(`Config from localStorage (${unwrapped.length} chars) ✓`);
          return unwrapped.trim();
        }

        if (unwrapped && typeof unwrapped === 'object') {
          // Edge case: somehow stored as a plain object already
          const str = JSON.stringify(unwrapped, null, 2);
          log(`Config from localStorage as object (${str.length} chars) ✓`);
          return str;
        }

      } catch {
        // Edge case: stored as plain JSON (not double-encoded) — try raw directly
        try {
          JSON.parse(raw);
          log(`Config from localStorage (direct, ${raw.length} chars) ✓`);
          return raw.trim();
        } catch {
          warn('localStorage value unparseable in all modes — falling back to panel UI');
        }
      }
    }

    // Fallback: open Edit Servers → read textarea (ta.value is NEVER double-encoded) → Cancel
    log('Reading config via Edit Servers panel (localStorage fallback)…');
    const ta = await openPanel();
    const val = ta.value.trim();
    findBtn('Cancel')?.click();
    await sleep(300);

    if (!val) throw new Error('Config is empty in localStorage and in the Edit Servers textarea.');
    JSON.parse(val);   // validate before returning
    return val;
  }


  /* ══════════════════════════════════════════════════════════════
     EDIT SERVERS PANEL HELPERS
  ══════════════════════════════════════════════════════════════ */

  /**
   * Click "Edit Servers" and return the newly-rendered <textarea>.
   * Confirmed: the panel adds exactly 1 new textarea when opened.
   */
  async function openPanel() {
    const editBtn = findBtn('Edit Servers');
    if (!editBtn) throw new Error('"Edit Servers" button not found');

    const before = new Set(document.querySelectorAll('textarea'));
    editBtn.click();
    await sleep(MS.panelOpen);

    let ta = Array.from(document.querySelectorAll('textarea')).find(t => !before.has(t));
    if (!ta) ta = await waitFor('textarea', 3000);
    if (!ta) throw new Error('JSON textarea not found — Edit Servers panel did not open');
    return ta;
  }

  /**
   * Find the "Save Changes" button in the open Edit Servers panel.
   * Confirmed exact text: "Save Changes" (bg-blue-600).
   */
  function findSaveBtn() {
    const ours = document.getElementById(`${EXT}-btn`);
    return (
      findBtn('Save Changes', document, true) ??
      findBtn('Save Changes') ??
      findBtn('Save') ??
      Array.from(document.querySelectorAll('button')).find(b =>
        b !== ours &&
        b.className.includes('bg-blue') &&
        b.textContent.trim().length > 0
      )
    );
  }


  /* ══════════════════════════════════════════════════════════════
     PHASE 2 — CLEAR CONFIG → PHANTOM STATE
     Confirmed: textarea = "" + "Save Changes" orphans all running
     connections and makes every "Stop Server" button visible.
  ══════════════════════════════════════════════════════════════ */

  async function clearConfig() {
    const ta = await openPanel();
    reactSet(ta, '');      // confirmed: empty string triggers phantom state
    await sleep(150);

    const sb = findSaveBtn();
    if (!sb) throw new Error('"Save Changes" not found in Edit Servers panel');
    log(`Clearing config via "${sb.textContent.trim()}"…`);
    sb.click();
    await sleep(300);
  }


  /* ══════════════════════════════════════════════════════════════
     PHASE 3 — STOP ALL PHANTOM SERVERS
     All Stop Server buttons visible simultaneously in phantom state.
     Loop re-queries the DOM each cycle — the list shrinks as rows
     are removed after each confirmed Stop + Sure?.
  ══════════════════════════════════════════════════════════════ */

  async function stopAllPhantomServers() {
    log('Waiting for "Stop Server" buttons to appear…');
    await waitUntil(
      () => Array.from(document.querySelectorAll('button'))
               .find(b => b.textContent.trim() === 'Stop Server'),
      MS.stopTimeout
    );

    const MAX = 60;
    let n = 0;

    for (let i = 0; i < MAX; i++) {
      const stopBtn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Stop Server');

      if (!stopBtn) { log(`No more "Stop Server" buttons — ${n} stopped ✓`); break; }

      const row  = stopBtn.closest('div.p-4.border.border-slate-300.rounded-lg.bg-slate-100');
      const name = row?.querySelector('span')?.textContent?.trim() ?? `#${n + 1}`;
      log(`→ Stopping "${name}"…`);

      stopBtn.click();
      await sleep(MS.sureWait);

      // "Sure?" appears at same position (confirmed same-spot toggle)
      const sureBtn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Sure?');

      if (sureBtn) {
        sureBtn.click();
        log(`  ✓ "${name}" confirmed and removed`);
      } else {
        warn(`  ⚠ "Sure?" not found for "${name}"`);
      }

      n++;
      await sleep(MS.afterStop);
    }

    return n;
  }


  /* ══════════════════════════════════════════════════════════════
     PHASE 4 — RESTORE CONFIG
     configJSON is already the clean, properly-formatted JSON string
     (real newlines, real quotes) — safe to write straight to textarea.
  ══════════════════════════════════════════════════════════════ */

  async function restoreConfig(configJSON) {
    const ta = await openPanel();
    reactSet(ta, configJSON);    // writes clean JSON — no escaping issues
    await sleep(150);

    const sb = findSaveBtn();
    if (!sb) throw new Error('"Save Changes" not found during config restore');
    log(`Restoring via "${sb.textContent.trim()}" (${configJSON.length} chars)…`);
    sb.click();
    await sleep(400);
  }


  /* ══════════════════════════════════════════════════════════════
     MAIN ORCHESTRATOR
  ══════════════════════════════════════════════════════════════ */

  async function run(btn) {
    btn.disabled   = true;
    const origHTML = btn.innerHTML;
    const setLabel = html =>
      (btn.innerHTML = `<span style="font-size:11px;white-space:nowrap;letter-spacing:0">${html}</span>`);

    try {

      /* PHASE 1 ── read config ──────────────────────────────────── */
      setLabel('📋 Reading…');
      log('══ PHASE 1: read config ══');

      const configJSON = await readConfig();   // clean, unwrapped JSON string

      // Final validation before we touch anything
      let parsed;
      try   { parsed = JSON.parse(configJSON); }
      catch { throw new Error('Config is not valid JSON — fix it in Edit Servers first.'); }

      const count = Object.keys(parsed.mcpServers ?? {}).length;
      log(`Config valid — ${count} server(s) ✓`);


      /* PHASE 2 ── clear → phantom ─────────────────────────────── */
      setLabel('🧹 Clearing…');
      log('══ PHASE 2: clear config → phantom state ══');

      await clearConfig();

      setLabel('⏳ Waiting…');
      log(`Waiting ${MS.afterSave}ms for phantom state to settle…`);
      await sleep(MS.afterSave);


      /* PHASE 3 ── stop all phantom servers ────────────────────── */
      setLabel('🛑 Stopping…');
      log('══ PHASE 3: stop all phantom servers ══');

      const stopped = await stopAllPhantomServers();
      log(`Phase 3 complete — ${stopped} server(s) stopped ✓`);
      await sleep(400);


      /* PHASE 4 ── restore ─────────────────────────────────────── */
      setLabel('💉 Restoring…');
      log('══ PHASE 4: restore original config ══');

      await restoreConfig(configJSON);
      log('Config restored ✓');


      /* DONE ───────────────────────────────────────────────────── */
      log(`✅ Hard Refresh complete — ${count} server(s) reconnecting`);
      showToast(
        `✅ Hard Refresh complete!\n` +
        `${count} server(s) reconnecting on this device.\n` +
        `Mac-only tools → 0 tools on non-Mac = expected & clean.`,
        'success'
      );

    } catch (err) {
      warn('FAILED:', err);
      showToast(`❌ Hard Refresh failed:\n${err.message}`, 'error');
    } finally {
      btn.disabled  = false;
      btn.innerHTML = origHTML;
    }
  }


  /* ══════════════════════════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════════════════════════ */

  function showToast(msg, type = 'info') {
    document.getElementById(`${EXT}-toast`)?.remove();
    const bg = { success: '#15803d', error: '#b91c1c', info: '#1d4ed8' }[type] ?? '#1d4ed8';
    const el = Object.assign(document.createElement('div'), {
      id: `${EXT}-toast`, textContent: msg,
    });
    Object.assign(el.style, {
      position: 'fixed', top: '20px', right: '20px', zIndex: '2147483647',
      padding: '14px 18px', borderRadius: '12px', background: bg,
      color: '#fff', fontWeight: '600', fontSize: '13px',
      lineHeight: '1.6', whiteSpace: 'pre-line', maxWidth: '380px',
      boxShadow: '0 8px 28px rgba(0,0,0,.28)', cursor: 'pointer',
      transition: 'opacity .4s ease',
    });
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, MS.toast);
  }


  /* ══════════════════════════════════════════════════════════════
     SPA-AWARE WATCHER
  ══════════════════════════════════════════════════════════════ */

  function startWatcher() {
    injectButton();
    new MutationObserver(() => {
      if (!document.getElementById(`${EXT}-btn`) && onMCPPage()) injectButton();
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(() => {
      if (!document.getElementById(`${EXT}-btn`) && onMCPPage()) injectButton();
    }, MS.poll);
    log('Extension active — watching for MCP settings page ✓');
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', startWatcher)
    : startWatcher();

})();
