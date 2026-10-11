/**
 * TypingMind extension (optional): exposes last deferred catalog hash for debugging.
 * NO SECRETS. Install via Settings → Extensions → HTTPS URL (jsDelivr after push).
 */
(function () {
  'use strict';
  const TAG = '[DeferredSnapshotHelper]';
  const KEY = 'typingMind.extension.deferred_snapshot_helper.v1';

  function readCatalogCount() {
    try {
      const raw = localStorage.getItem('TM_useEnabledPluginsMap');
      if (!raw) return { enabled_plugins: 0 };
      const map = JSON.parse(raw);
      return { enabled_plugins: Object.keys(map).filter((k) => map[k]).length };
    } catch (e) {
      return { error: String(e) };
    }
  }

  const snap = { at: new Date().toISOString(), ...readCatalogCount() };
  localStorage.setItem(KEY, JSON.stringify(snap));
  console.log(TAG, 'snapshot meta stored', snap);
})();
