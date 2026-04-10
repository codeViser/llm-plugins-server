/**
 * TypingMind — MCP Hard Refresh Extension
 * v2.2 — Cross-device: Mac browser + Android TWA + iPad + any device
 *
 * v2.2 changes:
 *   DETECTION:  3 independent signals for onMCPPage() — any one is sufficient
 *               1. "Edit Servers" button exists (unique to MCP page, fastest)
 *               2. h1/h2/h3/h4 with exact text "Model Context Protocol"
 *               3. MCP subtitle text present in DOM (ultimate fallback)
 *
 *   INJECTION:  4 cascading strategies — never gives up:
 *               A. Before "Edit Servers" (desktop/primary layout)
 *               B. After "Refresh" button (if Edit Servers not in DOM yet)
 *               C. Inline after the MCP heading element
 *               D. Fixed floating button bottom-right (mobile last resort —
 *                  always visible on the MCP page regardless of layout)
 *
 *   CLEANUP:    Floating button auto-removes when navigating away from MCP page
 *
 *   WATCHER:    hashchange + popstate events added for SPA navigation detection
 *               Poll interval reduced 1200ms → 500ms for faster mobile detection
 *               MutationObserver debounced to avoid expensive calls on every paint
 *
 *   BUG FIX:    localStorage double-encoding unwrap (v2.1) retained
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════════════════════════ */

  const EXT    = 'tm-mcp-hr';
  const LS_KEY = 'TM_useDraftMCPServersJSON';   // confirmed from DevTools
  const TAG    = '[MCP Hard Refresh]';

  const MS = {
    poll        :   500,   // ↓ from 1200 — faster detection on mobile
    debounce    :   200,   // MutationObserver debounce — avoids thrashing
    panelOpen   :  1000,   // wait after clicking Edit Servers
    afterSave   :  2800,   // wait after saving "" for phantom state
    stopTimeout :  5000,   // max wait for first Stop Server button
    sureWait    :   450,   // between Stop Server click and Sure?
    afterStop   :   650,   // after each confirmed Stop
    toast       :  7000,   // toast auto-dismiss
  };


  /* ═══════════════════════════════════════════════════════════════
     UTILITIES
  ═══════════════════════════════════════════════════════════════ */

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log   = (...a) => console.log(TAG,  ...a);
  const warn  = (...a) => console.warn(TAG, ...a);

  const findBtn = (text, root = document, exact = false) =>
    Array.from(root.querySelectorAll('button'))
      .find(b => exact
        ? b.textContent.trim() === text
        : b.textContent.trim().includes(text));

  function reactSet(ta, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;
    setter ? setter.call(ta, value) : (ta.value = value);
    ta.dispatchEvent(new Event('input',  { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitFor(sel, ms, root = document) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const el = root.querySelector(sel);
      if (el) return el;
      await sleep(80);
    }
    return null;
  }

  async function waitUntil(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    return null;
  }


  /* ═══════════════════════════════════════════════════════════════
     PAGE DETECTION — 3 independent signals, any one sufficient
  ═══════════════════════════════════════════════════════════════ */

  function onMCPPage() {
    // Signal 1 (fastest): "Edit Servers" button — only exists on MCP settings page
    if (findBtn('Edit Servers')) return true;

    // Signal 2: heading element with exact text (covers h1–h5 and mobile variants)
    if (Array.from(document.querySelectorAll('h1,h2,h3,h4,h5'))
        .some(el => el.textContent.trim() === 'Model Context Protocol')) return true;

    // Signal 3 (slowest but most resilient): unique MCP subtitle text
    // Only evaluated if faster checks failed — text search is opt-in here
    if (document.body.textContent.includes('MCP enables LLMs to access custom tools')) return true;

    return false;
  }

  // Lightweight version for the high-frequency MutationObserver path
  // Avoids the expensive textContent scan on every DOM mutation
  function onMCPPageFast() {
    if (findBtn('Edit Servers')) return true;
    return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5'))
      .some(el => el.textContent.trim() === 'Model Context Protocol');
  }


  /* ═══════════════════════════════════════════════════════════════
     BUTTON CREATION
  ═══════════════════════════════════════════════════════════════ */

  function makeBtn() {
    // Inherit class from "Edit Servers" or "Refresh" for consistent native look
    const ref = findBtn('Edit Servers')
             ?? Array.from(document.querySelectorAll('button'))
                  .find(b => b.textContent.trim() === 'Refresh');

    const btn   = document.createElement('button');
    btn.id      = `${EXT}-btn`;
    btn.type    = 'button';
    btn.title   = 'Hard Refresh — clears phantom connections and reloads MCP config for a clean reconnect on any device';

    if (ref) btn.className = ref.className;   // consistent sizing/font/radius with existing buttons

    // Amber colour — clearly distinct from the existing dark/blue/red buttons
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
    return btn;
  }


  /* ═══════════════════════════════════════════════════════════════
     INJECTION — 4 strategies, cascading
  ═══════════════════════════════════════════════════════════════ */

  function injectButton() {
    if (document.getElementById(`${EXT}-btn`)) return;
    if (!onMCPPage()) return;

    const btn = makeBtn();

    /* ── Strategy A: before "Edit Servers" (desktop, primary) ────── */
    const editBtn = findBtn('Edit Servers');
    if (editBtn?.parentElement) {
      editBtn.parentElement.insertBefore(btn, editBtn);
      log('Injected A: before Edit Servers ✓');
      return;
    }

    /* ── Strategy B: after "Refresh" button ──────────────────────── */
    const refreshBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Refresh');
    if (refreshBtn?.parentElement) {
      refreshBtn.after(btn);
      log('Injected B: after Refresh ✓');
      return;
    }

    /* ── Strategy C: inline after the MCP heading ────────────────── */
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5'))
      .find(el => el.textContent.trim() === 'Model Context Protocol');
    if (heading) {
      heading.insertAdjacentElement('afterend', btn);
      btn.style.display      = 'block';
      btn.style.marginTop    = '8px';
      btn.style.marginBottom = '8px';
      log('Injected C: after MCP heading ✓');
      return;
    }

    /* ── Strategy D: floating pill button fixed to bottom-right ───── */
    // This ALWAYS works regardless of page layout.
    // bottom: 72px clears the Android bottom nav bar.
    // Removed when navigating away from the MCP page (see tick() below).
    btn.style.cssText += `
      position      : fixed      !important;
      bottom        : 72px       !important;
      right         : 16px       !important;
      z-index       : 2147483646 !important;
      border-radius : 999px      !important;
      box-shadow    : 0 4px 20px rgba(0,0,0,0.35) !important;
      padding       : 12px 20px  !important;
      font-size     : 14px       !important;
      line-height   : 1          !important;
    `;
    document.body.appendChild(btn);
    log('Injected D: floating button (mobile fallback) ✓');
  }


  /* ═══════════════════════════════════════════════════════════════
     PHASE 1 — READ CONFIG
     Primary path: localStorage with double-encoding unwrap (v2.1 fix)
     Fallback path: open Edit Servers panel, read textarea directly
  ═══════════════════════════════════════════════════════════════ */

  async function readConfig() {
    const raw = localStorage.getItem(LS_KEY);

    if (raw && raw.trim()) {
      try {
        // TM stores config as JSON.stringify(configString) — must unwrap once
        const unwrapped = JSON.parse(raw);

        if (typeof unwrapped === 'string' && unwrapped.trim()) {
          JSON.parse(unwrapped);   // validate inner JSON (throws if corrupt)
          log(`Config from localStorage (${unwrapped.length} chars) ✓`);
          return unwrapped.trim();
        }

        if (unwrapped && typeof unwrapped === 'object') {
          const str = JSON.stringify(unwrapped, null, 2);
          log(`Config from localStorage as object (${str.length} chars) ✓`);
          return str;
        }

      } catch {
        // Edge case: stored as plain JSON (not double-encoded)
        try {
          JSON.parse(raw);
          log(`Config from localStorage direct (${raw.length} chars) ✓`);
          return raw.trim();
        } catch {
          warn('localStorage unparseable — falling back to panel UI');
        }
      }
    }

    // Fallback: open Edit Servers → ta.value is never double-encoded → Cancel
    log('Reading config from Edit Servers panel (localStorage fallback)…');
    const ta = await openPanel();
    const val = ta.value.trim();
    findBtn('Cancel')?.click();
    await sleep(300);

    if (!val) throw new Error('Config is empty in localStorage and in Edit Servers.');
    JSON.parse(val);   // validate
    return val;
  }


  /* ═══════════════════════════════════════════════════════════════
     PANEL HELPERS
  ═══════════════════════════════════════════════════════════════ */

  async function openPanel() {
    const editBtn = findBtn('Edit Servers');
    if (!editBtn) throw new Error('"Edit Servers" button not found');
    const before = new Set(document.querySelectorAll('textarea'));
    editBtn.click();
    await sleep(MS.panelOpen);
    let ta = Array.from(document.querySelectorAll('textarea')).find(t => !before.has(t));
    if (!ta) ta = await waitFor('textarea', 3000);
    if (!ta) throw new Error('JSON textarea not found — did the panel open?');
    return ta;
  }

  function findSaveBtn() {
    const ours = document.getElementById(`${EXT}-btn`);
    return (
      findBtn('Save Changes', document, true) ??          // confirmed exact text
      findBtn('Save Changes') ??
      findBtn('Save') ??
      Array.from(document.querySelectorAll('button')).find(b =>
        b !== ours &&
        (b.className ?? '').includes('bg-blue') &&
        b.textContent.trim().length > 0
      )
    );
  }


  /* ═══════════════════════════════════════════════════════════════
     PHASE 2 — CLEAR CONFIG → PHANTOM STATE
  ═══════════════════════════════════════════════════════════════ */

  async function clearConfig() {
    const ta = await openPanel();
    reactSet(ta, '');      // empty string — confirmed trigger for phantom state
    await sleep(150);
    const sb = findSaveBtn();
    if (!sb) throw new Error('"Save Changes" not found in Edit Servers panel');
    log(`Clearing via "${sb.textContent.trim()}"…`);
    sb.click();
    await sleep(300);
  }


  /* ═══════════════════════════════════════════════════════════════
     PHASE 3 — STOP ALL PHANTOM SERVERS
     All Stop Server buttons become visible simultaneously after
     clearing config — no hover-reveal needed.
  ═══════════════════════════════════════════════════════════════ */

  async function stopAllPhantomServers() {
    log('Waiting for "Stop Server" buttons…');
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
      if (!stopBtn) { log(`No more Stop buttons — ${n} stopped ✓`); break; }

      const row  = stopBtn.closest('div.p-4.border.border-slate-300.rounded-lg.bg-slate-100');
      const name = row?.querySelector('span')?.textContent?.trim() ?? `#${n + 1}`;
      log(`→ Stopping "${name}"…`);

      stopBtn.click();
      await sleep(MS.sureWait);

      const sureBtn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Sure?');
      if (sureBtn) { sureBtn.click(); log(`  ✓ "${name}" removed`); }
      else         { warn(`  ⚠ "Sure?" not found for "${name}"`); }

      n++;
      await sleep(MS.afterStop);
    }
    return n;
  }


  /* ═══════════════════════════════════════════════════════════════
     PHASE 4 — RESTORE CONFIG
  ═══════════════════════════════════════════════════════════════ */

  async function restoreConfig(configJSON) {
    const ta = await openPanel();
    reactSet(ta, configJSON);   // clean JSON string — no escaping issues
    await sleep(150);
    const sb = findSaveBtn();
    if (!sb) throw new Error('"Save Changes" not found during restore');
    log(`Restoring ${configJSON.length} chars via "${sb.textContent.trim()}"…`);
    sb.click();
    await sleep(400);
  }


  /* ═══════════════════════════════════════════════════════════════
     MAIN ORCHESTRATOR
  ═══════════════════════════════════════════════════════════════ */

  async function run(btn) {
    btn.disabled   = true;
    const origHTML = btn.innerHTML;
    const setLabel = html =>
      (btn.innerHTML = `<span style="font-size:11px;white-space:nowrap;letter-spacing:0">${html}</span>`);

    try {
      setLabel('📋 Reading…');
      log('══ PHASE 1: read config ══');
      const configJSON = await readConfig();
      if (!configJSON) throw new Error('Config is empty.');

      let parsed;
      try   { parsed = JSON.parse(configJSON); }
      catch { throw new Error('Config is not valid JSON — fix it in Edit Servers first.'); }

      const count = Object.keys(parsed.mcpServers ?? {}).length;
      log(`Config valid — ${count} server(s) ✓`);

      setLabel('🧹 Clearing…');
      log('══ PHASE 2: clear config → phantom state ══');
      await clearConfig();

      setLabel('⏳ Waiting…');
      log(`Waiting ${MS.afterSave}ms for phantom state to settle…`);
      await sleep(MS.afterSave);

      setLabel('🛑 Stopping…');
      log('══ PHASE 3: stop all phantom servers ══');
      const stopped = await stopAllPhantomServers();
      log(`${stopped} server(s) stopped ✓`);
      await sleep(400);

      setLabel('💉 Restoring…');
      log('══ PHASE 4: restore config ══');
      await restoreConfig(configJSON);
      log('Restored ✓');

      log(`✅ Done — ${count} server(s) reconnecting`);
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


  /* ═══════════════════════════════════════════════════════════════
     TOAST
  ═══════════════════════════════════════════════════════════════ */

  function showToast(msg, type = 'info') {
    document.getElementById(`${EXT}-toast`)?.remove();
    const bg = { success: '#15803d', error: '#b91c1c', info: '#1d4ed8' }[type] ?? '#1d4ed8';
    const el = Object.assign(document.createElement('div'), {
      id: `${EXT}-toast`, textContent: msg,
    });
    Object.assign(el.style, {
      position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647',
      padding: '14px 18px', borderRadius: '12px', background: bg,
      color: '#fff', fontWeight: '600', fontSize: '13px',
      lineHeight: '1.6', whiteSpace: 'pre-line', maxWidth: '340px',
      boxShadow: '0 8px 28px rgba(0,0,0,.30)', cursor: 'pointer',
      transition: 'opacity .4s ease',
    });
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, MS.toast);
  }


  /* ═══════════════════════════════════════════════════════════════
     SPA-AWARE WATCHER
  ═══════════════════════════════════════════════════════════════ */

  function tick(useFastDetection = false) {
    const existing = document.getElementById(`${EXT}-btn`);
    const onPage   = useFastDetection ? onMCPPageFast() : onMCPPage();

    if (onPage) {
      if (!existing) injectButton();
    } else {
      // Remove the button (especially the floating variant) when leaving MCP page
      existing?.remove();
    }
  }

  function startWatcher() {
    tick();   // immediate check on load

    // Debounced MutationObserver: catches React re-renders without thrashing
    // Uses fast detection (no textContent scan) because it fires very frequently
    let debounceTimer;
    new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => tick(true), MS.debounce);
    }).observe(document.body, { childList: true, subtree: true });

    // SPA navigation events (React Router hash changes, back/forward)
    window.addEventListener('hashchange', () => tick());
    window.addEventListener('popstate',   () => tick());

    // Fallback poll — catches anything the observer/events miss
    // Also uses full onMCPPage() including the textContent fallback signal
    setInterval(() => tick(), MS.poll);

    log('Extension active — watching for MCP settings page ✓');
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', startWatcher)
    : startWatcher();

})();
