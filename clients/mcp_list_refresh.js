/**
 * TypingMind — MCP Hard Refresh Extension
 * v2.0 — All selectors confirmed via DevTools investigation
 *
 * Confirmed element map:
 *   localStorage key : TM_useDraftMCPServersJSON
 *   Edit Servers     : adds 1 <textarea> + 3 buttons on open
 *   Save button      : "Save Changes"  (bg-blue-600)
 *   Cancel button    : "Cancel"        (bg-red-600)
 *   Clear signal     : textarea = ""  + click "Save Changes"
 *   Phantom trigger  : empty save makes ALL "Stop Server" buttons visible
 *   Stop button      : "Stop Server"  (exact, visible on all phantom rows)
 *   Confirm button   : "Sure?"        (same-position toggle after Stop Server)
 *
 * Flow:
 *   1. Read config from localStorage (fast, no UI) — textarea fallback if needed
 *   2. Open Edit Servers → set textarea to "" → click "Save Changes"  →  phantom state
 *   3. Poll until "Stop Server" appears, then loop: Stop → Sure? × N until list empty
 *   4. Open Edit Servers → set textarea to original JSON → click "Save Changes"
 *
 * Install:
 *   Host this file at a public HTTPS URL with JS mime type, then:
 *   TypingMind → Settings → Extensions → paste URL → Install → Reload app
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     CONSTANTS
  ══════════════════════════════════════════════════════════════════ */

  const EXT    = 'tm-mcp-hr';
  const LS_KEY = 'TM_useDraftMCPServersJSON';  // confirmed from console warning
  const TAG    = '[MCP Hard Refresh]';

  const MS = {
    poll        :  1200,  // SPA-watcher fallback poll interval
    panelOpen   :  1000,  // wait after clicking "Edit Servers" for textarea to render
    afterSave   :  2800,  // wait after saving "" before Stop Server buttons appear
    stopTimeout :  5000,  // extra wait budget for first "Stop Server" button
    sureWait    :   450,  // wait after clicking "Stop Server" for "Sure?" to appear
    afterStop   :   650,  // wait after each confirmed Stop before the next
    toast       :  7000,  // toast auto-dismiss
  };


  /* ══════════════════════════════════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════════════════════════════════ */

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log   = (...a) => console.log(TAG,  ...a);
  const warn  = (...a) => console.warn(TAG, ...a);

  /** First <button> whose trimmed text equals or contains `text` */
  const findBtn = (text, root = document, exact = false) =>
    Array.from(root.querySelectorAll('button'))
      .find(b => exact
        ? b.textContent.trim() === text
        : b.textContent.trim().includes(text));

  /**
   * Set value on a React-controlled <textarea> so that React's synthetic
   * onChange fires and internal state updates.
   * We bypass React's own property with the native HTMLTextAreaElement setter,
   * then fire bubbling input/change events so React picks up the change.
   */
  function reactSet(ta, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;
    setter ? setter.call(ta, value) : (ta.value = value);
    ta.dispatchEvent(new Event('input',  { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Poll until CSS selector resolves; returns element or null */
  async function waitFor(sel, ms, root = document) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const el = root.querySelector(sel);
      if (el) return el;
      await sleep(80);
    }
    return null;
  }

  /** Poll until predicate fn() returns truthy; returns that value or null */
  async function waitUntil(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    return null;
  }


  /* ══════════════════════════════════════════════════════════════════
     PAGE DETECTION
  ══════════════════════════════════════════════════════════════════ */

  const mcpH1     = () => Array.from(document.querySelectorAll('h1'))
    .find(h => h.textContent.trim() === 'Model Context Protocol');
  const onMCPPage = () => !!mcpH1();


  /* ══════════════════════════════════════════════════════════════════
     BUTTON INJECTION
  ══════════════════════════════════════════════════════════════════ */

  function injectButton() {
    if (document.getElementById(`${EXT}-btn`)) return;
    if (!onMCPPage()) return;

    const editBtn = findBtn('Edit Servers');
    if (!editBtn) return;

    const btn     = document.createElement('button');
    btn.id        = `${EXT}-btn`;
    btn.type      = 'button';
    btn.title     = 'Hard Refresh — clears phantom connections and reloads config for a clean reconnect on any device';
    btn.className = editBtn.className;    // inherit all sizing/rounding/font from "Edit Servers"
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

    // Place BEFORE "Edit Servers" → toolbar reads: [Refresh] [⚡ Hard Refresh] [Edit Servers]
    editBtn.parentElement.insertBefore(btn, editBtn);
    log('Button injected ✓');
  }


  /* ══════════════════════════════════════════════════════════════════
     PHASE 1 — READ CONFIG
     Primary: localStorage (no UI round-trip needed).
     Fallback: open Edit Servers panel, read textarea, then Cancel.
  ══════════════════════════════════════════════════════════════════ */

  async function readConfig() {
    // ── Primary: localStorage (confirmed key: TM_useDraftMCPServersJSON) ──
    const lsVal = localStorage.getItem(LS_KEY);
    if (lsVal && lsVal.trim()) {
      try {
        JSON.parse(lsVal);   // validate — throws if corrupt
        log(`Config read from localStorage (${lsVal.length} chars) ✓`);
        return lsVal.trim();
      } catch {
        warn('localStorage value is not valid JSON — falling back to Edit Servers panel');
      }
    }

    // ── Fallback: open the panel, read, then cancel ──
    log('Reading config via Edit Servers panel (localStorage fallback)…');
    const ta = await openPanel();
    const val = ta.value.trim();
    findBtn('Cancel')?.click();   // close without saving
    await sleep(300);
    if (!val) throw new Error('Config is empty in both localStorage and the Edit Servers textarea.');
    return val;
  }


  /* ══════════════════════════════════════════════════════════════════
     SHARED PANEL HELPERS
  ══════════════════════════════════════════════════════════════════ */

  /**
   * Click "Edit Servers" and return the newly-rendered <textarea>.
   * Confirmed: opening the panel adds exactly 1 new textarea.
   */
  async function openPanel() {
    const editBtn = findBtn('Edit Servers');
    if (!editBtn) throw new Error('"Edit Servers" button not found');

    const before = new Set(document.querySelectorAll('textarea'));
    editBtn.click();
    await sleep(MS.panelOpen);

    // Find the ONE new textarea that appeared
    let ta = Array.from(document.querySelectorAll('textarea')).find(t => !before.has(t));
    if (!ta) ta = await waitFor('textarea', 3000);
    if (!ta) throw new Error('JSON textarea not found — Edit Servers panel did not open');
    return ta;
  }

  /**
   * Find the "Save Changes" button inside the open Edit Servers panel.
   * Confirmed exact text: "Save Changes" (bg-blue-600).
   * Falls back to colour-class match in case text ever changes.
   */
  function findSaveChangesBtn() {
    const ours = document.getElementById(`${EXT}-btn`);
    return findBtn('Save Changes', document, true)       // confirmed exact match
        ?? findBtn('Save Changes')                        // loose match
        ?? findBtn('Save')                                // generic fallback
        ?? Array.from(document.querySelectorAll('button')).find(b =>
             b !== ours &&
             b.className.includes('bg-blue') &&
             b.textContent.trim().length > 0
           );
  }


  /* ══════════════════════════════════════════════════════════════════
     PHASE 2 — CLEAR CONFIG → PHANTOM STATE
     Confirmed: setting textarea to "" (empty string) and clicking
     "Save Changes" orphans all running connections and makes every
     "Stop Server" button visible simultaneously.
  ══════════════════════════════════════════════════════════════════ */

  async function clearConfig() {
    const ta = await openPanel();
    reactSet(ta, '');            // confirmed: empty string (NOT "{}") triggers phantom
    await sleep(150);

    const sb = findSaveChangesBtn();
    if (!sb) throw new Error('"Save Changes" button not found in Edit Servers panel');
    log(`Saving empty config via "${sb.textContent.trim()}"…`);
    sb.click();
    await sleep(300);
  }


  /* ══════════════════════════════════════════════════════════════════
     PHASE 3 — STOP ALL PHANTOM SERVERS
     After clearing config, ALL "Stop Server" buttons become visible
     at once — no hover-reveal needed.
     Each click: "Stop Server" → React toggles button text → "Sure?"
     Each confirmed Stop+Sure? removes one entry from the DOM.
     Loop re-queries the DOM each cycle (list shrinks as rows are removed).
  ══════════════════════════════════════════════════════════════════ */

  async function stopAllPhantomServers() {
    // Wait for phantom state to surface at least the first "Stop Server" button
    log('Waiting for "Stop Server" buttons to become visible…');
    const appeared = await waitUntil(
      () => Array.from(document.querySelectorAll('button'))
               .find(b => b.textContent.trim() === 'Stop Server'),
      MS.stopTimeout
    );
    if (!appeared) warn('"Stop Server" buttons not detected within timeout — attempting anyway');

    const MAX = 60;   // safety cap (handles up to 60 servers)
    let n = 0;

    for (let i = 0; i < MAX; i++) {

      // Re-query every iteration: DOM shrinks as rows are removed
      const stopBtn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Stop Server');

      if (!stopBtn) { log(`No more "Stop Server" buttons — ${n} server(s) stopped ✓`); break; }

      // Name the server being stopped (for logging)
      const row  = stopBtn.closest('div.p-4.border.border-slate-300.rounded-lg.bg-slate-100');
      const name = row?.querySelector('span')?.textContent?.trim() ?? `server #${n + 1}`;
      log(`→ Stopping "${name}"…`);

      stopBtn.click();
      await sleep(MS.sureWait);

      // "Sure?" appears at the same position (confirmed toggle on same button element)
      const sureBtn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Sure?');

      if (sureBtn) {
        sureBtn.click();
        log(`  ✓ "${name}" confirmed and removed`);
      } else {
        warn(`  ⚠ "Sure?" not found for "${name}" — moving on`);
      }

      n++;
      await sleep(MS.afterStop);
    }

    return n;
  }


  /* ══════════════════════════════════════════════════════════════════
     PHASE 4 — RESTORE ORIGINAL CONFIG
  ══════════════════════════════════════════════════════════════════ */

  async function restoreConfig(json) {
    const ta = await openPanel();
    reactSet(ta, json);
    await sleep(150);

    const sb = findSaveChangesBtn();
    if (!sb) throw new Error('"Save Changes" button not found during config restore');
    log(`Restoring ${json.length} chars via "${sb.textContent.trim()}"…`);
    sb.click();
    await sleep(400);
  }


  /* ══════════════════════════════════════════════════════════════════
     MAIN ORCHESTRATOR
  ══════════════════════════════════════════════════════════════════ */

  async function run(btn) {
    btn.disabled    = true;
    const origHTML  = btn.innerHTML;

    // Live label updates so user sees progress without needing DevTools
    const setLabel = html =>
      (btn.innerHTML = `<span style="font-size:11px;white-space:nowrap;letter-spacing:0">${html}</span>`);

    try {

      /* ── PHASE 1: Read ──────────────────────────────────────────── */
      setLabel('📋 Reading…');
      log('══ PHASE 1: read current config ══');

      const originalJSON = await readConfig();
      if (!originalJSON) throw new Error('Config is empty — nothing to refresh.');

      let parsed;
      try   { parsed = JSON.parse(originalJSON); }
      catch { throw new Error('Stored config is not valid JSON — fix it in Edit Servers first.'); }

      const serverCount = Object.keys(parsed.mcpServers ?? parsed).length;
      log(`Config valid — ${serverCount} server(s) defined ✓`);


      /* ── PHASE 2: Clear → phantom state ─────────────────────────── */
      setLabel('🧹 Clearing…');
      log('══ PHASE 2: clear config → phantom state ══');

      await clearConfig();

      setLabel('⏳ Waiting…');
      log(`Waiting ${MS.afterSave}ms for phantom state to settle…`);
      await sleep(MS.afterSave);


      /* ── PHASE 3: Stop all phantom servers ──────────────────────── */
      setLabel('🛑 Stopping…');
      log('══ PHASE 3: stop all phantom servers ══');

      const stopped = await stopAllPhantomServers();
      log(`Phase 3 complete — ${stopped} server(s) stopped ✓`);
      await sleep(400);


      /* ── PHASE 4: Restore ───────────────────────────────────────── */
      setLabel('💉 Restoring…');
      log('══ PHASE 4: restore original config ══');

      await restoreConfig(originalJSON);
      log('Config restored ✓');


      /* ── Done ───────────────────────────────────────────────────── */
      log(`✅ Hard Refresh complete — ${serverCount} server(s) reconnecting`);
      showToast(
        `✅ Hard Refresh complete!\n` +
        `${serverCount} server(s) reconnecting on this device.\n` +
        `Mac-only tools will show 0 tools on non-Mac — that's correct & clean.`,
        'success'
      );

    } catch (err) {
      warn('FAILED:', err);
      showToast(`❌ Hard Refresh failed:\n${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHTML;
    }
  }


  /* ══════════════════════════════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════════════════════════════ */

  function showToast(msg, type = 'info') {
    document.getElementById(`${EXT}-toast`)?.remove();

    const bg   = { success: '#15803d', error: '#b91c1c', info: '#1d4ed8' }[type] ?? '#1d4ed8';
    const el   = document.createElement('div');
    el.id      = `${EXT}-toast`;
    el.textContent = msg;

    Object.assign(el.style, {
      position     : 'fixed',
      top          : '20px',
      right        : '20px',
      zIndex       : '2147483647',
      padding      : '14px 18px',
      borderRadius : '12px',
      background   : bg,
      color        : '#fff',
      fontWeight   : '600',
      fontSize     : '13px',
      lineHeight   : '1.6',
      whiteSpace   : 'pre-line',
      maxWidth     : '380px',
      boxShadow    : '0 8px 28px rgba(0,0,0,.28)',
      cursor       : 'pointer',
      transition   : 'opacity .4s ease',
    });

    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, MS.toast);
  }


  /* ══════════════════════════════════════════════════════════════════
     SPA-AWARE WATCHER
     MutationObserver catches React re-renders and route changes.
     setInterval is a belt-and-suspenders fallback.
  ══════════════════════════════════════════════════════════════════ */

  function startWatcher() {
    injectButton();   // immediate attempt on load

    new MutationObserver(() => {
      if (!document.getElementById(`${EXT}-btn`) && onMCPPage()) injectButton();
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
      if (!document.getElementById(`${EXT}-btn`) && onMCPPage()) injectButton();
    }, MS.poll);

    log('Extension active — watching for MCP settings page ✓');
  }

  // Bootstrap
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', startWatcher)
    : startWatcher();

})();
