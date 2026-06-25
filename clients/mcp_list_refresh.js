/**
 * TypingMind — MCP Hard Refresh Extension
 * v3.0 — Server-side restart approach (replaces the stop-server UI hack)
 *
 * WHAT CHANGED (v3.0):
 *   TypingMind's MCP UI changed: there are no per-server "Stop Server"
 *   buttons anymore, so the old client-side phantom-removal flow is dead.
 *   Instead, this version signals the REMOTE MCP connector server to
 *   restart all its connectors in place, then triggers a normal
 *   client-side refresh so TypingMind re-fetches the (now fresh) tool
 *   lists. This is reliable across all devices (Mac, Android TWA, iPad).
 *
 *   Requires the matching server-side endpoint (POST /restart-all),
 *   which was added to the llm-plugins-server in commit b6a4eca (self/dev).
 *
 * FLOW (on click):
 *   1. Discover connector base URL + Bearer auth token
 *      (auto from DOM + localStorage; one-time manual fallback)
 *   2. POST {baseURL}/restart-all  with Authorization: Bearer <token>
 *   3. Wait for connectors to come back online (server restarts them)
 *   4. Click TypingMind's native "Refresh" button → client re-fetches tools
 *   5. Show success toast
 *
 * ZERO HARDCODED SECRETS: URL & token are discovered at runtime from the
 * page's own state. Nothing sensitive is written into this file.
 *
 * INSTALL:
 *   Host this file at a public HTTPS URL (JS mime), then
 *   TypingMind → Settings → Extensions → paste URL → Install → Reload
 */
(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════════
     CONSTANTS
  ════════════════════════════════════════════════════════════════ */

  const EXT      = 'tm-mcp-hr';
  const TAG      = '[MCP Hard Refresh]';
  const CFG_KEY  = `typingMind.extension.${EXT}.config`;   // our own localStorage
  const RESTART_PATH = '/restart-all';

  const MS = {
    poll        :   500,   // SPA watcher fallback poll
    debounce    :   200,   // MutationObserver debounce
    serverWait  :  6000,   // wait after /restart-all for connectors to come back
    refreshWait :  3000,   // wait after clicking native Refresh
    toast       :  7000,   // toast auto-dismiss
    fetchTimeout: 20000,   // fetch abort for /restart-all (slow restarts)
  };


  /* ════════════════════════════════════════════════════════════════
     UTILITIES
  ════════════════════════════════════════════════════════════════ */

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log   = (...a) => console.log(TAG,  ...a);
  const warn  = (...a) => console.warn(TAG, ...a);

  const findBtn = (text, root = document, exact = false) =>
    Array.from(root.querySelectorAll('button'))
      .find(b => exact
        ? b.textContent.trim() === text
        : b.textContent.trim().includes(text));


  /* ════════════════════════════════════════════════════════════════
     PAGE DETECTION (3 independent signals — any one is sufficient)
  ════════════════════════════════════════════════════════════════ */

  function onMCPPage() {
    if (findBtn('Edit Servers')) return true;
    if (Array.from(document.querySelectorAll('h1,h2,h3,h4,h5'))
        .some(el => el.textContent.trim() === 'Model Context Protocol')) return true;
    if (document.body.textContent.includes('MCP enables LLMs to access custom tools')) return true;
    return false;
  }

  function onMCPPageFast() {
    if (findBtn('Edit Servers')) return true;
    return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5'))
      .some(el => el.textContent.trim() === 'Model Context Protocol');
  }


  /* ════════════════════════════════════════════════════════════════
     CONNECTOR URL + AUTH TOKEN DISCOVERY
     The connector base URL is shown in the MCP page DOM as
     "Server: https://host.example". The Bearer token is stored in
     localStorage by TypingMind's "Setup Connector" flow. We scan for
     it without hardcoding anything; user can also paste it once.
  ════════════════════════════════════════════════════════════════ */

  /** Pull the connector base URL from the DOM "Server: <url>" text. */
  function discoverBaseUrl() {
    // The page renders the connector server URL as plain text.
    // Walk text nodes / elements that contain "Server:" followed by a URL.
    const all = Array.from(document.querySelectorAll('*'))
      .filter(el => el.children.length === 0);   // leaf elements only
    for (const el of all) {
      const t = (el.textContent || '').trim();
      const m = t.match(/^Server:\s*(https?:\/\/[^\s]+)/i);
      if (m) return m[1].replace(/\/+$/, '');      // strip trailing slash
    }
    // Fallback: any https URL on the page that looks like a connector host
    const bodyText = document.body.textContent || '';
    const m2 = bodyText.match(/https:\/\/[^\s"'<>]+/);
    return m2 ? m2[0].replace(/\/+$/, '') : null;
  }

  /**
   * Scan localStorage for a value that looks like the MCP Bearer token.
   * TypingMind stores the remote connector auth token somewhere; we look
   * for a reasonably long opaque string under an MCP-related key, without
   * ever writing or hardcoding the actual token in this file.
   */
  function discoverToken() {
    const candidates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const kl = k.toLowerCase();
      if (!(kl.includes('mcp') || kl.includes('connector') ||
            kl.includes('authtoken') || kl.includes('auth_token') ||
            kl.includes('mcpauthtoken') || kl.includes('server'))) continue;
      let v = '';
      try { v = localStorage.getItem(k) || ''; } catch { continue; }
      v = v.trim();
      // A bearer token: opaque, no spaces, 16–256 chars, not a JSON blob/url
      if (v.length >= 16 && v.length <= 256 &&
          !v.startsWith('{') && !v.startsWith('http') &&
          !/\s/.test(v) && !v.includes('"')) {
        candidates.push({ key: k, val: v });
      }
    }
    // Prefer the longest candidate (tokens tend to be longer than noise)
    candidates.sort((a, b) => b.val.length - a.val.length);
    return candidates[0]?.val || null;
  }

  /** Load/save our own persisted config (manual token entry fallback). */
  function loadSavedConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
  }


  /* ════════════════════════════════════════════════════════════════
     SERVER-SIDE RESTART CALL
  ════════════════════════════════════════════════════════════════ */

  async function restartAllConnectors(baseUrl, token) {
    const url = baseUrl + RESTART_PATH;
    log('POST', url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MS.fetchTimeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: controller.signal,
        // credentials: 'include'  // not needed; we send Bearer header
      });
      clearTimeout(timer);

      let body = null;
      const text = await res.text().catch(() => '');
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }

      if (res.status === 401) {
        throw new Error('Server rejected the auth token (401). Re-enter the token via the config button.');
      }
      if (!res.ok && res.status !== 207) {
        throw new Error(`Server returned ${res.status}: ${text.slice(0, 300)}`);
      }
      // 200 or 207 (partial) are both acceptable outcomes
      log('Restart response:', res.status, body);
      return body;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('Server did not respond within ' + (MS.fetchTimeout / 1000) + 's. It may still be restarting — try the native Refresh button.');
      }
      throw err;
    }
  }


  /* ════════════════════════════════════════════════════════════════
     NATIVE CLIENT-SIDE REFRESH
     After the server restarts connectors, click TypingMind's own
     "Refresh" button so the client re-fetches the fresh tool lists.
  ════════════════════════════════════════════════════════════════ */

  function clickNativeRefresh() {
    // TypingMind's MCP page has a "Refresh" button (circular-arrow icon).
    const btn = findBtn('Refresh');
    if (!btn) { warn('Native "Refresh" button not found — skipping client refresh'); return false; }
    btn.click();
    log('Clicked native "Refresh" button ✓');
    return true;
  }


  /* ════════════════════════════════════════════════════════════════
     CONFIG PANEL (manual token/URL entry — shown only if auto-discovery
     fails, or when the user clicks the gear button)
  ════════════════════════════════════════════════════════════════ */

  function openConfigPanel() {
    const id = `${EXT}-config`;
    document.getElementById(id)?.remove();

    const saved = loadSavedConfig();
    const autoUrl = discoverBaseUrl() || saved.baseUrl || '';
    const autoTok = discoverToken() || saved.token || '';

    const panel = document.createElement('div');
    panel.id = id;
    Object.assign(panel.style, {
      position: 'fixed', top: '60px', right: '16px', zIndex: '2147483647',
      background: '#1f2937', color: '#fff', padding: '16px', borderRadius: '12px',
      boxShadow: '0 8px 28px rgba(0,0,0,.4)', maxWidth: '360px', fontSize: '13px',
      fontFamily: 'system-ui, sans-serif', lineHeight: '1.5',
    });

    panel.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px">⚡ Hard Refresh — Config</div>
      <label style="display:block;margin-bottom:4px;font-size:12px;color:#cbd5e1">Connector Server URL</label>
      <input id="${id}-url" type="text" value="${autoUrl.replace(/"/g, '&quot;')}"
        placeholder="https://your-server.example"
        style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #475569;background:#0f172a;color:#fff;font-size:12px;margin-bottom:10px"/>
      <label style="display:block;margin-bottom:4px;font-size:12px;color:#cbd5e1">Bearer Auth Token</label>
      <input id="${id}-tok" type="password" value="${autoTok.replace(/"/g, '&quot;')}"
        placeholder="paste the MCP connector auth token"
        style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #475569;background:#0f172a;color:#fff;font-size:12px;margin-bottom:10px"/>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:10px">
        These are auto-discovered from the page. Edit only if auto-discovery fails.
        Stored locally in <code style="color:#e2e8f0">${CFG_KEY}</code>.
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="${id}-cancel" style="padding:6px 12px;border-radius:6px;border:none;background:#475569;color:#fff;cursor:pointer;font-size:12px">Cancel</button>
        <button id="${id}-save" style="padding:6px 12px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;font-weight:600">Save</button>
      </div>`;

    document.body.appendChild(panel);
    document.getElementById(`${id}-cancel`).onclick = () => panel.remove();
    document.getElementById(`${id}-save`).onclick = () => {
      const baseUrl = document.getElementById(`${id}-url`).value.trim().replace(/\/+$/, '');
      const token = document.getElementById(`${id}-tok`).value.trim();
      saveConfig({ baseUrl, token });
      panel.remove();
      showToast('Config saved ✓', 'success');
    };
  }


  /* ════════════════════════════════════════════════════════════════
     MAIN ORCHESTRATOR
  ════════════════════════════════════════════════════════════════ */

  async function run(btn) {
    btn.disabled = true;
    const origHTML = btn.innerHTML;
    const setLabel = html =>
      (btn.innerHTML = `<span style="font-size:11px;white-space:nowrap;letter-spacing:0">${html}</span>`);

    try {
      // ── Discover connector URL + token ───────────────────────────
      setLabel('🔎 Discovering…');
      log('══ Discovering connector URL + token ══');

      const saved = loadSavedConfig();
      let baseUrl = discoverBaseUrl() || saved.baseUrl;
      let token = discoverToken() || saved.token;

      if (!baseUrl || !token) {
        warn('Auto-discovery incomplete — opening config panel for manual entry');
        openConfigPanel();
        throw new Error('Connector URL or token not found. Enter them in the config panel, then click Hard Refresh again.');
      }

      log(`Base URL: ${baseUrl}`);
      log(`Token: ${'*'.repeat(token.length)}`);


      // ── Phase 1: signal server to restart all connectors ─────────
      setLabel('🔄 Restarting…');
      log('══ Phase 1: server-side /restart-all ══');

      const result = await restartAllConnectors(baseUrl, token);

      const restarted = result?.restarted?.length ?? (result?.restarted ? result.restarted.length : 0);
      const errors = result?.errors?.length ?? 0;
      log(`Server restarted ${restarted} connector(s)${errors ? `, ${errors} error(s)` : ''}`);


      // ── Phase 2: wait for connectors to come back online ─────────
      setLabel('⏳ Settling…');
      log(`Waiting ${MS.serverWait}ms for connectors to settle…`);
      await sleep(MS.serverWait);


      // ── Phase 3: native client-side refresh ──────────────────────
      setLabel('🔁 Refreshing…');
      log('══ Phase 2: native client Refresh ══');

      const refreshed = clickNativeRefresh();
      if (refreshed) {
        await sleep(MS.refreshWait);
      }


      // ── Done ─────────────────────────────────────────────────────
      log('✅ Hard Refresh complete');
      showToast(
        `✅ Hard Refresh complete!\n` +
        `Server restarted ${restarted} connector(s)${errors ? ` (${errors} error)` : ''}.\n` +
        (refreshed ? 'Client refreshed — tool lists updated.' : 'Click the page Refresh button to reload tools.'),
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


  /* ════════════════════════════════════════════════════════════════
     BUTTON CREATION + INJECTION (4 cascading strategies)
  ════════════════════════════════════════════════════════════════ */

  function makeBtn() {
    const ref = findBtn('Edit Servers')
             ?? Array.from(document.querySelectorAll('button'))
                  .find(b => b.textContent.trim() === 'Refresh');

    const btn = document.createElement('button');
    btn.id = `${EXT}-btn`;
    btn.type = 'button';
    btn.title = 'Hard Refresh — signals the remote MCP connector server to restart all connectors, then refreshes the client tool list.';
    if (ref) btn.className = ref.className;

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

    // Gear button next to it → opens manual config panel
    const gear = document.createElement('button');
    gear.id = `${EXT}-gear`;
    gear.type = 'button';
    gear.title = 'Hard Refresh — configure connector URL & token';
    gear.textContent = '⚙';
    if (ref) gear.className = ref.className;
    gear.style.cssText = `
      background-color : #475569 !important;
      color            : #ffffff !important;
      border           : 2px solid #334155 !important;
      cursor           : pointer;
      padding          : 0 10px !important;
    `;
    gear.addEventListener('click', openConfigPanel);

    return { btn, gear };
  }

  function injectButton() {
    if (document.getElementById(`${EXT}-btn`)) return;
    if (!onMCPPage()) return;

    const { btn, gear } = makeBtn();

    // Strategy A: before "Edit Servers"
    const editBtn = findBtn('Edit Servers');
    if (editBtn?.parentElement) {
      editBtn.parentElement.insertBefore(gear, editBtn);
      editBtn.parentElement.insertBefore(btn, gear);
      log('Injected A: before Edit Servers ✓');
      return;
    }

    // Strategy B: after "Refresh"
    const refreshBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Refresh');
    if (refreshBtn?.parentElement) {
      refreshBtn.after(gear);
      gear.after(btn);
      log('Injected B: after Refresh ✓');
      return;
    }

    // Strategy C: inline after the MCP heading
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5'))
      .find(el => el.textContent.trim() === 'Model Context Protocol');
    if (heading) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:8px;margin:8px 0;';
      wrap.appendChild(btn); wrap.appendChild(gear);
      heading.insertAdjacentElement('afterend', wrap);
      log('Injected C: after MCP heading ✓');
      return;
    }

    // Strategy D: floating pill (mobile last resort — always visible)
    btn.style.cssText += `
      position      : fixed      !important;
      bottom        : 72px       !important;
      right         : 60px       !important;
      z-index       : 2147483646 !important;
      border-radius : 999px      !important;
      box-shadow    : 0 4px 20px rgba(0,0,0,0.35) !important;
      padding       : 12px 20px  !important;
    `;
    gear.style.cssText += `
      position      : fixed      !important;
      bottom        : 72px       !important;
      right         : 12px       !important;
      z-index       : 2147483646 !important;
      border-radius : 999px      !important;
      box-shadow    : 0 4px 20px rgba(0,0,0,0.35) !important;
      padding       : 12px 12px  !important;
    `;
    document.body.appendChild(btn);
    document.body.appendChild(gear);
    log('Injected D: floating (mobile fallback) ✓');
  }


  /* ════════════════════════════════════════════════════════════════
     TOAST
  ════════════════════════════════════════════════════════════════ */

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


  /* ════════════════════════════════════════════════════════════════
     SPA-AWARE WATCHER
  ════════════════════════════════════════════════════════════════ */

  function tick(useFast = false) {
    const existing = document.getElementById(`${EXT}-btn`);
    const onPage = useFast ? onMCPPageFast() : onMCPPage();
    if (onPage) {
      if (!existing) injectButton();
    } else {
      existing?.remove();
      document.getElementById(`${EXT}-gear`)?.remove();
    }
  }

  function startWatcher() {
    tick();
    let debounceTimer;
    new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => tick(true), MS.debounce);
    }).observe(document.body, { childList: true, subtree: true });

    window.addEventListener('hashchange', () => tick());
    window.addEventListener('popstate',   () => tick());
    setInterval(() => tick(), MS.poll);

    log('Extension active — watching for MCP settings page ✓');
  }

  // Expose a diagnostic helper for console debugging
  window.mcpHardRefreshDiag = function () {
    console.group(`${TAG} Diagnostics`);
    console.log('On MCP page?    ', onMCPPage());
    console.log('Discovered URL: ', discoverBaseUrl());
    console.log('Discovered token:', discoverToken() ? '***' + '('.repeat(0) + 'found' : '(none)');
    console.log('Saved config:   ', loadSavedConfig());
    console.log('Hard Refresh btn:', document.getElementById(`${EXT}-btn`));
    console.groupEnd();
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', startWatcher)
    : startWatcher();

})();
