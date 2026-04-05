// Previous replaced: https://cdn.jsdelivr.net/gh/codeViser/typingmind-reasoning-support@main/script.js

// ══════════════════════════════════════════════════════════════════════════════
//  TypingMind Reasoning Continuity Extension  ·  v3.1
// ══════════════════════════════════════════════════════════════════════════════
//
//  This file contains NO credentials and NO server addresses.
//  Safe to host publicly. Nothing sensitive is ever written here.
//
//  SELF-CONFIGURING:
//  The plugin server URL and auth token are automatically captured from
//  TypingMind's own outgoing MCP requests (POST /start, POST /clients/*/call_tools).
//  Both are persisted to localStorage on each device and survive page reloads.
//
//  NOTHING TO CONFIGURE. Install and it works.
//
//  RUNTIME COMMANDS (browser console):
//    window.RCE.debug(true)   — verbose logs
//    window.RCE.stats()       — capture state + cache status
//    window.RCE.clear()       — wipe cached reasoning (Pi + local)
//    window.RCE.reset()       — forget captured URL+token (force re-detection)
//
// ══════════════════════════════════════════════════════════════════════════════

(async () => {
  'use strict';

  // ── Internal constants (not sensitive — patterns, not addresses) ───────────

  // Path appended to the auto-detected server base URL to reach the RC endpoint
  const RC_PATH_SUFFIX  = '/reasoning-cache';

  // localStorage keys for persisting what was auto-detected
  const LS_KEY_BASE  = '_rce_b';   // server base URL
  const LS_KEY_TOKEN = '_rce_t';   // auth token

  // Paths that distinctively identify our plugin server in TypingMind's traffic.
  // These are standard typingmind-proxy endpoint shapes — not secret by themselves.
  const MCP_DETECT_PATHS = ['/start', '/ping', '/clients/'];

  // ── Runtime config — populated entirely at runtime, never hardcoded ────────
  const CFG = {
    piBase:   '',    // auto-detected: e.g. 'https://<hash>.example.com'
    piUrl:    '',    // auto-set: piBase + RC_PATH_SUFFIX
    piApiKey: '',    // auto-detected: Bearer token from TypingMind's MCP requests

    // Timeouts and local fallback TTL
    piTimeoutMs: 5000,
    localTtlMs:  7 * 24 * 60 * 60 * 1000,   // 7 days for IndexedDB fallback

    // LLM endpoints whose requests carry reasoning_details
    endpoints: [
      'https://openrouter.ai/api/v1/chat/completions',
      'https://api.minimax.chat/v1/text/chatcompletion',
      'https://llm.chutes.ai/v1/chat/completions',
      'https://nano-gpt.com/api/v1/chat/completions',
      'https://nano-gpt.com/api/v1legacy/chat/completions',
    ],

    // Local IndexedDB fallback settings
    dbName:     'TM_RCE_v3',
    storeName:  'rc',
    dbVersion:  1,
    maxEntries: 200,

    debug: false,
  };

  // Pre-load persisted detection from this device's localStorage if available
  (() => {
    try {
      const b = localStorage.getItem(LS_KEY_BASE);
      const t = localStorage.getItem(LS_KEY_TOKEN);
      if (b && t) {
        CFG.piBase   = b;
        CFG.piApiKey = t;
        CFG.piUrl    = b + RC_PATH_SUFFIX;
      }
    } catch { /* private browsing or storage blocked — detection will happen at runtime */ }
  })();

  // ── Logging ───────────────────────────────────────────────────────────────
  const log  = (...a) => CFG.debug && console.log('%c[RCEv3]', 'color:#7c3aed;font-weight:600', ...a);
  const warn = (...a) => CFG.debug && console.warn('%c[RCEv3]', 'color:#d97706;font-weight:600', ...a);

  // ── Auto-detection: learn URL + token from TypingMind's own MCP traffic ───

  function readBearerToken(headers) {
    if (!headers) return null;
    // Handle both plain-object headers and Headers instances
    const auth = typeof headers.get === 'function'
      ? (headers.get('Authorization') || headers.get('authorization'))
      : (headers['Authorization']     || headers['authorization'] || null);
    return (typeof auth === 'string' && auth.startsWith('Bearer '))
      ? auth.slice(7)
      : null;
  }

  function tryDetect(urlStr, opts) {
    // Skip if already fully configured
    if (CFG.piBase && CFG.piApiKey) return;

    try {
      const u = new URL(urlStr);

      // Only consider requests whose path matches distinctive plugin-server endpoints
      const isMCPPath = u.pathname === '/start'
                     || u.pathname === '/ping'
                     || u.pathname.startsWith('/clients/');
      if (!isMCPPath) return;

      // Must carry a Bearer token — unauthenticated requests are ignored
      const token = readBearerToken(opts?.headers);
      if (!token) return;

      // Capture and persist both pieces — neither is in this file
      CFG.piBase   = `${u.protocol}//${u.host}`;
      CFG.piApiKey = token;
      CFG.piUrl    = CFG.piBase + RC_PATH_SUFFIX;

      try {
        localStorage.setItem(LS_KEY_BASE,  CFG.piBase);
        localStorage.setItem(LS_KEY_TOKEN, CFG.piApiKey);
      } catch { /* storage blocked — will re-detect next session */ }

      // Re-enable Pi backend if it was suppressed before detection
      pi.available = true;
      log('🔑 Server auto-detected from MCP traffic — Pi backend active');
    } catch { /* malformed URL or other error — ignore */ }
  }

  // ── Pi backend ────────────────────────────────────────────────────────────

  const pi = {
    available: true,
    _retryTimer: null,

    _ready() { return !!(this.available && CFG.piUrl && CFG.piApiKey); },

    _headers() {
      return {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${CFG.piApiKey}`,
      };
    },

    async get(hash) {
      if (!this._ready()) return null;
      try {
        const r = await withTimeout(
          fetch(`${CFG.piUrl}/${hash}`, { headers: this._headers() }),
          CFG.piTimeoutMs
        );
        if (r.status === 401) { warn('Pi 401 — token may have changed; will re-detect'); return null; }
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        return body?.responseObject?.data ?? null;
      } catch (e) { warn('Pi GET err:', e.message); this._goOffline(); return null; }
    },

    async set(hash, value) {
      if (!this._ready()) return false;
      try {
        const r = await withTimeout(
          fetch(`${CFG.piUrl}/${hash}`, {
            method:  'POST',
            headers: this._headers(),
            body:    JSON.stringify({ data: value }),
          }),
          CFG.piTimeoutMs
        );
        if (r.status === 401) { warn('Pi 401 — token may have changed; will re-detect'); return false; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return true;
      } catch (e) { warn('Pi SET err:', e.message); this._goOffline(); return false; }
    },

    async stats() {
      if (!CFG.piUrl || !CFG.piApiKey) return null;
      try {
        const r = await withTimeout(
          fetch(`${CFG.piUrl}/stats`, { headers: this._headers() }),
          CFG.piTimeoutMs
        );
        return r.ok ? (await r.json())?.responseObject ?? null : null;
      } catch { return null; }
    },

    async prune(days) {
      if (!CFG.piUrl || !CFG.piApiKey) return;
      try {
        await withTimeout(
          fetch(`${CFG.piUrl}/prune?days=${days}`, { method: 'DELETE', headers: this._headers() }),
          CFG.piTimeoutMs
        );
      } catch { /* non-critical */ }
    },

    _goOffline() {
      if (!this.available) return;
      this.available = false;
      warn('Pi unreachable — using local fallback. Will retry in 60s.');
      clearTimeout(this._retryTimer);
      this._retryTimer = setTimeout(async () => {
        if (!CFG.piUrl || !CFG.piApiKey) { this._goOffline(); return; }
        try {
          const r = await fetch(`${CFG.piUrl}/stats`, { headers: this._headers() });
          if (r.ok) { this.available = true; log('Pi back online.'); }
          else this._goOffline();
        } catch { this._goOffline(); }
      }, 60_000);
    },
  };

  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms)),
    ]);
  }

  // ── IndexedDB backend (local fallback) ────────────────────────────────────

  async function buildIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CFG.dbName, CFG.dbVersion);
      req.onupgradeneeded = ({ target: { result: d } }) => {
        if (!d.objectStoreNames.contains(CFG.storeName)) {
          d.createObjectStore(CFG.storeName, { keyPath: 'k' }).createIndex('ts', 'ts');
        }
      };
      req.onerror  = () => reject(req.error);
      req.onsuccess = ({ target: { result: db } }) => {
        const os  = (rw) => db.transaction(CFG.storeName, rw).objectStore(CFG.storeName);
        resolve({
          name:  'IndexedDB',
          get:   (k)        => new Promise((rs, rj) => { const r = os('readonly').get(k); r.onsuccess = () => rs(r.result ?? null); r.onerror = () => rj(r.error); }),
          set:   (k, v, ts) => new Promise((rs, rj) => { const r = os('readwrite').put({ k, v, ts }); r.onsuccess = rs; r.onerror = () => rj(r.error); }),
          prune: (cut)      => new Promise(rs => { const tx = db.transaction(CFG.storeName, 'readwrite'); const rq = tx.objectStore(CFG.storeName).index('ts').openCursor(IDBKeyRange.upperBound(cut)); rq.onsuccess = ({ target: { result: c } }) => { if (c) { c.delete(); c.continue(); } }; tx.oncomplete = rs; }),
          count: ()         => new Promise(rs => { const r = os('readonly').count(); r.onsuccess = () => rs(r.result); }),
          evict: (n)        => new Promise(rs => { const tx = db.transaction(CFG.storeName, 'readwrite'); let d = 0; const r = tx.objectStore(CFG.storeName).index('ts').openCursor(); r.onsuccess = ({ target: { result: c } }) => { if (c && d < n) { c.delete(); d++; c.continue(); } }; tx.oncomplete = rs; }),
        });
      };
    });
  }

  // ── Memory backend (last resort) ──────────────────────────────────────────

  const mem = (() => {
    const m = new Map();
    return {
      name:  'Memory (volatile)',
      get:   async (k)        => m.get(k) ?? null,
      set:   async (k, v, ts) => m.set(k, { v, ts }),
      prune: async (cut)      => { for (const [k, e] of m) if ((e.ts ?? 0) < cut) m.delete(k); },
      count: async ()         => m.size,
      evict: async (n)        => { [...m.entries()].sort((a, b) => (a[1].ts ?? 0) - (b[1].ts ?? 0)).slice(0, n).forEach(([k]) => m.delete(k)); },
    };
  })();

  let local = null;

  // ── Unified cache ops ─────────────────────────────────────────────────────

  async function cacheGet(hash) {
    const piVal = await pi.get(hash);
    if (piVal !== null) { log('💡 Pi HIT', hash.slice(0, 10)); return piVal; }
    try {
      const rec = await local.get(hash);
      if (rec && Date.now() - (rec.ts ?? 0) <= CFG.localTtlMs) { log('💡 Local HIT', hash.slice(0, 10)); return rec.v; }
    } catch { /* ignore */ }
    log('❌ Miss', hash.slice(0, 10));
    return null;
  }

  async function cachePut(hash, value) {
    const ok = await pi.set(hash, value);
    log(ok ? '💾 Pi saved' : '⚠️ Pi unavailable — local only', hash.slice(0, 10));
    try {
      const n = await local.count();
      if (n >= CFG.maxEntries) await local.evict(Math.ceil(CFG.maxEntries * 0.1));
      await local.set(hash, value, Date.now());
    } catch { /* ignore */ }
  }

  // ── Hashing ───────────────────────────────────────────────────────────────

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function msgKey(msg) {
    const c = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
    const t = (msg.tool_calls ?? []).map(x => x.id ?? '').join('|');
    return sha256(c + '\x00' + t);
  }

  // ── Field helpers ─────────────────────────────────────────────────────────

  const BASE        = new Set(['role', 'content', 'tool_calls', 'tool_call_id', 'name']);
  const hasExtra    = m => Object.keys(m).some(k => !BASE.has(k));
  const hasReasoning= m => m.reasoning_details != null || m.reasoning != null || m.reasoning_content != null;
  const getExtra    = m => { const { role, content, tool_calls, tool_call_id, name, ...x } = m; return Object.keys(x).length ? x : null; };

  // ── Save + inject ─────────────────────────────────────────────────────────

  async function saveMsg(msg) {
    const extra = getExtra(msg);
    if (!extra) return;
    await cachePut(await msgKey(msg), extra);
  }

  async function injectMsgs(messages) {
    let hits = 0;
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      if (hasReasoning(msg)) { log('⏭ skip (already has reasoning)'); continue; }
      const v = await cacheGet(await msgKey(msg));
      if (!v) continue;
      Object.assign(msg, v);
      hits++;
    }
    return hits;
  }

  // ── Stream accumulator ────────────────────────────────────────────────────

  function makeAcc() {
    const msg = {}, tcs = new Map(), rds = new Map();

    function applyDelta(d) {
      for (const [f, v] of Object.entries(d)) {
        if (f === 'tool_calls')        { accTC(v); continue; }
        if (f === 'reasoning_details') { accRD(v); continue; }
        if      (msg[f] === undefined)                               msg[f]  = v;
        else if (typeof msg[f] === 'string' && typeof v === 'string') msg[f] += v;
        else                                                          msg[f]  = v;
      }
    }

    function accTC(ds) {
      for (const d of (ds ?? [])) {
        const b = tcs.get(d.index) ?? { index: d.index, id: '', type: '', fn: { name: '', args: '' } };
        if (d.id)                       b.id           += d.id;
        if (d.type     && !b.type)      b.type          = d.type;
        if (d.function?.name && !b.fn.name) b.fn.name   = d.function.name;
        if (d.function?.arguments)      b.fn.args      += d.function.arguments;
        tcs.set(d.index, b);
      }
    }

    function accRD(ds) {
      for (const d of (ds ?? [])) {
        const idx = d.index ?? 0;
        const b   = rds.get(idx) ?? { type: d.type, id: d.id, format: d.format, index: idx };
        if (d.text)      b.text    = (b.text    ?? '') + d.text;
        if (d.data)      b.data    = (b.data    ?? '') + d.data;
        if (d.summary)   b.summary = (b.summary ?? '') + d.summary;
        if (d.signature) b.signature = d.signature;
        rds.set(idx, b);
      }
    }

    function finalise() {
      if (tcs.size) msg.tool_calls = [...tcs.values()].sort((a, b) => a.index - b.index).map(b => ({ id: b.id, type: b.type || 'function', function: { name: b.fn.name, arguments: b.fn.args } }));
      if (rds.size) msg.reasoning_details = [...rds.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return msg;
    }

    return { applyDelta, finalise };
  }

  // ── Response handlers ─────────────────────────────────────────────────────

  async function handleStream(resp) {
    const reader = resp.body.getReader();
    const enc    = new TextEncoder();
    const acc    = makeAcc();
    const stream = new ReadableStream({
      async start(ctrl) {
        const dec = new TextDecoder();
        let buf = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() ?? '';
            for (const chunk of parts) {
              ctrl.enqueue(enc.encode(chunk + '\n\n'));
              if (!chunk.startsWith('data:')) continue;
              const raw = chunk.slice(chunk.indexOf(':') + 1).trim();
              if (raw === '[DONE]') continue;
              try { const j = JSON.parse(raw); const d = j.choices?.[0]?.delta; if (d) acc.applyDelta(d); } catch { /* ignore */ }
            }
          }
        } catch (e) { warn('stream err:', e); }
        const full = acc.finalise();
        if (hasExtra(full)) await saveMsg(full);
        ctrl.close();
      },
    });
    return new Response(stream, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
  }

  async function handleJSON(cloned) {
    try {
      const j = await cloned.json();
      const m = j?.choices?.[0]?.message;
      if (m && hasExtra(m)) await saveMsg(m);
    } catch { /* ignore */ }
  }

  // ── Fetch interceptor ─────────────────────────────────────────────────────

  // Tear down any prior installation
  if (window.__rce_active) window.fetch = window.__rce_orig ?? window.fetch;
  const _orig = window.__rce_orig = window.fetch;
  window.__rce_active = true;

  window.fetch = async function (...args) {
    let [url, opts] = args;
    const urlStr = String(url);

    // ── STEP 1: passively detect Pi server URL + token from MCP traffic ───
    tryDetect(urlStr, opts);

    // ── STEP 2: inject cached reasoning into outbound LLM requests ─────────
    const isLLM = CFG.endpoints.some(ep => urlStr.includes(ep));
    if (isLLM && opts?.body) {
      try {
        const body = JSON.parse(opts.body);
        if (Array.isArray(body?.messages)) {
          const n = await injectMsgs(body.messages);
          if (n > 0) { opts = { ...opts, body: JSON.stringify(body) }; log(`📤 injected reasoning into ${n} msg(s)`); }
        }
      } catch (e) { warn('inject err:', e); }
    }

    const resp = await _orig.call(this, url, opts);
    if (!isLLM) return resp;

    // ── STEP 3: capture reasoning from LLM response ────────────────────────
    const ct = resp.headers.get('content-type') ?? '';
    return ct.includes('event-stream') ? handleStream(resp) : (handleJSON(resp.clone()), resp);
  };

  // ── Public API ────────────────────────────────────────────────────────────

  window.RCE = {
    debug: (v) => { CFG.debug = !!v; console.log(`[RCEv3] debug ${CFG.debug ? 'ON' : 'OFF'}`); },

    stats: async () => {
      const detected = !!(CFG.piBase && CFG.piApiKey);
      const piStats  = detected ? await pi.stats() : null;
      const locN     = await local?.count().catch(() => '?') ?? '?';
      console.group('[RCEv3] Status');
      console.log('Server detected:', detected ? 'YES' : 'NO — waiting for first MCP call');
      console.log('Pi backend:', pi.available ? 'online' : 'offline', '|', piStats ?? 'n/a');
      console.log('Local fallback:', local?.name ?? '—', `(${locN} entries)`);
      console.groupEnd();
    },

    clear: async () => {
      await pi.prune(0).catch(() => {});
      await local?.prune(Infinity).catch(() => {});
      console.log('[RCEv3] Reasoning cache cleared. Server detection preserved.');
    },

    reset: () => {
      CFG.piBase = CFG.piUrl = CFG.piApiKey = '';
      try { localStorage.removeItem(LS_KEY_BASE); localStorage.removeItem(LS_KEY_TOKEN); } catch { /* ignore */ }
      console.log('[RCEv3] Detection reset. Will re-detect on next MCP call from TypingMind.');
    },
  };

  Object.defineProperty(window, 'debugReasoning', {
    get: () => CFG.debug, set: v => window.RCE.debug(v), configurable: true,
  });

  // ── Init ──────────────────────────────────────────────────────────────────

  try {
    local = await buildIDB();
    await local.prune(Date.now() - CFG.localTtlMs);
  } catch {
    local = mem;
  }

  const readyMsg = CFG.piBase
    ? `Pi auto-loaded from localStorage | local: ${local?.name}`
    : `Waiting for first MCP call to detect server | local: ${local?.name}`;

  console.log(`%c✅ RCEv3 ready — ${readyMsg}`, 'color:#7c3aed;font-weight:600');

})();

