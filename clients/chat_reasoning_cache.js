// Previous replaced: https://cdn.jsdelivr.net/gh/codeViser/typingmind-reasoning-support@main/script.js

// ══════════════════════════════════════════════════════════════════════════════
//  TypingMind Reasoning Continuity Extension  ·  v3.2
// ══════════════════════════════════════════════════════════════════════════════
//
//  v3.2 change: strips reasoning_details from TypingMind's view of each
//  response before TM can persist them as local UUID attachment files.
//  TM receives plain `reasoning` text (for thinking bubble display) instead.
//  The full reasoning_details are saved to Pi and injected on outbound calls.
//  This eliminates the "Unable to access attachment reasoning_details_*.txt"
//  error that occurs when importing chats across devices.
//
//  No credentials. No server addresses. Self-configuring.
//  Gist is safe to host publicly.
//
//  RUNTIME COMMANDS:
//    window.RCE.debug(true)   — verbose logs
//    window.RCE.stats()       — server detection + cache status
//    window.RCE.clear()       — wipe reasoning cache (Pi + local)
//    window.RCE.reset()       — forget captured URL+token
//
// ══════════════════════════════════════════════════════════════════════════════

(async () => {
  'use strict';

  const RC_PATH_SUFFIX   = '/reasoning-cache';
  const LS_KEY_BASE      = '_rce_b';
  const LS_KEY_TOKEN     = '_rce_t';
  const MCP_DETECT_PATHS = ['/start', '/ping', '/clients/'];

  const CFG = {
    piBase:      '',
    piUrl:       '',
    piApiKey:    '',
    piTimeoutMs: 5000,
    localTtlMs:  7 * 24 * 60 * 60 * 1000,
    endpoints: [
      'https://openrouter.ai/api/v1/chat/completions',
      'https://api.minimax.chat/v1/text/chatcompletion',
      'https://llm.chutes.ai/v1/chat/completions',
      'https://nano-gpt.com/api/v1/chat/completions',
      'https://nano-gpt.com/api/v1legacy/chat/completions',
    ],
    dbName:     'TM_RCE_v3',
    storeName:  'rc',
    dbVersion:  1,
    maxEntries: 200,
    debug:      false,
  };

  try {
    const b = localStorage.getItem(LS_KEY_BASE);
    const t = localStorage.getItem(LS_KEY_TOKEN);
    if (b && t) { CFG.piBase = b; CFG.piApiKey = t; CFG.piUrl = b + RC_PATH_SUFFIX; }
  } catch { /* private browsing */ }

  const log  = (...a) => CFG.debug && console.log('%c[RCEv3]', 'color:#7c3aed;font-weight:600', ...a);
  const warn = (...a) => CFG.debug && console.warn('%c[RCEv3]', 'color:#d97706;font-weight:600', ...a);

  // ── Token + URL auto-detection ────────────────────────────────────────────

  function readBearerToken(headers) {
    if (!headers) return null;
    const auth = typeof headers.get === 'function'
      ? (headers.get('Authorization') || headers.get('authorization'))
      : (headers['Authorization'] || headers['authorization'] || null);
    return (typeof auth === 'string' && auth.startsWith('Bearer ')) ? auth.slice(7) : null;
  }

  function tryDetect(urlStr, opts) {
    if (CFG.piBase && CFG.piApiKey) return;
    try {
      const u    = new URL(urlStr);
      const isMCP = u.pathname === '/start' || u.pathname === '/ping' || u.pathname.startsWith('/clients/');
      if (!isMCP) return;
      const token = readBearerToken(opts?.headers);
      if (!token) return;
      CFG.piBase   = `${u.protocol}//${u.host}`;
      CFG.piApiKey = token;
      CFG.piUrl    = CFG.piBase + RC_PATH_SUFFIX;
      try { localStorage.setItem(LS_KEY_BASE, CFG.piBase); localStorage.setItem(LS_KEY_TOKEN, CFG.piApiKey); } catch {}
      pi.available = true;
      log('🔑 Server auto-detected from MCP traffic');
    } catch {}
  }

  // ── Pi backend ────────────────────────────────────────────────────────────

  const pi = {
    available: true,
    _retryTimer: null,
    _ready()    { return !!(this.available && CFG.piUrl && CFG.piApiKey); },
    _headers()  { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CFG.piApiKey}` }; },

    async get(hash) {
      if (!this._ready()) return null;
      try {
        const r = await withTimeout(fetch(`${CFG.piUrl}/${hash}`, { headers: this._headers() }), CFG.piTimeoutMs);
        if (r.status === 401) { warn('Pi 401'); return null; }
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json())?.responseObject?.data ?? null;
      } catch (e) { warn('Pi GET:', e.message); this._goOffline(); return null; }
    },

    async set(hash, value) {
      if (!this._ready()) return false;
      try {
        const r = await withTimeout(
          fetch(`${CFG.piUrl}/${hash}`, { method: 'POST', headers: this._headers(), body: JSON.stringify({ data: value }) }),
          CFG.piTimeoutMs);
        if (r.status === 401) { warn('Pi POST 401'); return false; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return true;
      } catch (e) { warn('Pi SET:', e.message); this._goOffline(); return false; }
    },

    async stats() {
      if (!CFG.piUrl || !CFG.piApiKey) return null;
      try {
        const r = await withTimeout(fetch(`${CFG.piUrl}/stats`, { headers: this._headers() }), CFG.piTimeoutMs);
        return r.ok ? (await r.json())?.responseObject ?? null : null;
      } catch { return null; }
    },

    async prune(days) {
      if (!CFG.piUrl || !CFG.piApiKey) return;
      try { await withTimeout(fetch(`${CFG.piUrl}/prune?days=${days}`, { method: 'DELETE', headers: this._headers() }), CFG.piTimeoutMs); }
      catch { /* non-critical */ }
    },

    _goOffline() {
      if (!this.available) return;
      this.available = false;
      warn('Pi offline — local fallback. Retry in 60s.');
      clearTimeout(this._retryTimer);
      this._retryTimer = setTimeout(async () => {
        try {
          if (!CFG.piUrl || !CFG.piApiKey) { this._goOffline(); return; }
          const r = await fetch(`${CFG.piUrl}/stats`, { headers: this._headers() });
          if (r.ok) { this.available = true; log('Pi back online.'); } else this._goOffline();
        } catch { this._goOffline(); }
      }, 60_000);
    },
  };

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  }

  // ── IndexedDB fallback ────────────────────────────────────────────────────

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
        const os = rw => db.transaction(CFG.storeName, rw).objectStore(CFG.storeName);
        resolve({
          name:  'IndexedDB',
          get:   k        => new Promise((rs, rj) => { const r = os('readonly').get(k); r.onsuccess = () => rs(r.result ?? null); r.onerror = () => rj(r.error); }),
          set:   (k,v,ts) => new Promise((rs, rj) => { const r = os('readwrite').put({ k, v, ts }); r.onsuccess = rs; r.onerror = () => rj(r.error); }),
          prune: cut      => new Promise(rs => { const tx = db.transaction(CFG.storeName,'readwrite'); const rq = tx.objectStore(CFG.storeName).index('ts').openCursor(IDBKeyRange.upperBound(cut)); rq.onsuccess = ({target:{result:c}}) => { if(c){c.delete();c.continue();} }; tx.oncomplete=rs; }),
          count: ()       => new Promise(rs => { const r = os('readonly').count(); r.onsuccess = () => rs(r.result); }),
          evict: n        => new Promise(rs => { const tx = db.transaction(CFG.storeName,'readwrite'); let d=0; const r = tx.objectStore(CFG.storeName).index('ts').openCursor(); r.onsuccess=({target:{result:c}})=>{if(c&&d<n){c.delete();d++;c.continue();}}; tx.oncomplete=rs; }),
        });
      };
    });
  }

  const mem = (() => {
    const m = new Map();
    return {
      name:  'Memory (volatile)',
      get:   async k        => m.get(k) ?? null,
      set:   async (k,v,ts) => m.set(k,{v,ts}),
      prune: async cut      => { for(const [k,e] of m) if((e.ts??0)<cut) m.delete(k); },
      count: async ()       => m.size,
      evict: async n        => { [...m.entries()].sort((a,b)=>(a[1].ts??0)-(b[1].ts??0)).slice(0,n).forEach(([k])=>m.delete(k)); },
    };
  })();

  let local = null;

  // ── Unified cache ─────────────────────────────────────────────────────────

  async function cacheGet(hash) {
    const v = await pi.get(hash);
    if (v !== null) { log('💡 Pi HIT', hash.slice(0,10)); return v; }
    try {
      const rec = await local.get(hash);
      if (rec && Date.now() - (rec.ts??0) <= CFG.localTtlMs) { log('💡 Local HIT', hash.slice(0,10)); return rec.v; }
    } catch {}
    log('❌ Miss', hash.slice(0,10));
    return null;
  }

  async function cachePut(hash, value) {
    const ok = await pi.set(hash, value);
    log(ok ? '💾 Pi saved' : '⚠️ Pi unavailable, local only', hash.slice(0,10));
    try {
      const n = await local.count();
      if (n >= CFG.maxEntries) await local.evict(Math.ceil(CFG.maxEntries * 0.1));
      await local.set(hash, value, Date.now());
    } catch {}
  }

  // ── Hashing ───────────────────────────────────────────────────────────────

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function msgKey(msg) {
    const c = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
    const t = (msg.tool_calls ?? []).map(x => x.id ?? '').join('|');
    return sha256(c + '\x00' + t);
  }

  // ── Field helpers (v3.2: scoped strictly to reasoning_details array) ──────

  const BASE = new Set(['role', 'content', 'tool_calls', 'tool_call_id', 'name']);

  // v3.2: only true when reasoning_details is a non-empty array.
  // Plain `reasoning` text stored by TM for display does NOT count —
  // those messages still need reasoning_details injected from Pi.
  const hasReasoning = m => Array.isArray(m.reasoning_details) && m.reasoning_details.length > 0;

  // v3.2: only save if reasoning_details is present (not plain display text).
  const hasExtra     = m => Array.isArray(m.reasoning_details) && m.reasoning_details.length > 0;

  // v3.2: save only reasoning_details, not the plain reasoning display text.
  const getExtra     = m => hasExtra(m) ? { reasoning_details: m.reasoning_details } : null;

  // Extract human-readable text from reasoning_details for TM's thinking bubble.
  function rdText(details) {
    return (details ?? []).map(rd => rd.text || rd.summary || '').join('');
  }

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
      if (hasReasoning(msg)) { log('⏭ skip (already has reasoning_details)'); continue; }
      // v3.2: messages with only `reasoning` text (TM local display) are NOT skipped —
      // they still receive reasoning_details injection from Pi.
      const v = await cacheGet(await msgKey(msg));
      if (!v) continue;
      Object.assign(msg, v);
      hits++;
    }
    return hits;
  }

  // ── Stream accumulator ────────────────────────────────────────────────────

  function makeAcc() {
    const msg={}, tcs=new Map(), rds=new Map();

    function applyDelta(d) {
      for (const [f,v] of Object.entries(d)) {
        if (f==='tool_calls')        { accTC(v); continue; }
        if (f==='reasoning_details') { accRD(v); continue; }
        if      (msg[f]===undefined)                              msg[f] =v;
        else if (typeof msg[f]==='string'&&typeof v==='string')  msg[f]+=v;
        else                                                      msg[f] =v;
      }
    }

    function accTC(ds) {
      for (const d of ds??[]) {
        const b = tcs.get(d.index)??{index:d.index,id:'',type:'',fn:{name:'',args:''}};
        if(d.id)                     b.id      +=d.id;
        if(d.type&&!b.type)          b.type     =d.type;
        if(d.function?.name&&!b.fn.name) b.fn.name=d.function.name;
        if(d.function?.arguments)    b.fn.args +=d.function.arguments;
        tcs.set(d.index,b);
      }
    }

    function accRD(ds) {
      for (const d of ds??[]) {
        const idx=d.index??0;
        const b=rds.get(idx)??{type:d.type,id:d.id,format:d.format,index:idx};
        if(d.text)      b.text   =(b.text   ??'')+d.text;
        if(d.data)      b.data   =(b.data   ??'')+d.data;
        if(d.summary)   b.summary=(b.summary??'')+d.summary;
        if(d.signature) b.signature=d.signature;
        rds.set(idx,b);
      }
    }

    function finalise() {
      if(tcs.size) msg.tool_calls=
        [...tcs.values()].sort((a,b)=>a.index-b.index)
          .map(b=>({id:b.id,type:b.type||'function',function:{name:b.fn.name,arguments:b.fn.args}}));
      if(rds.size) msg.reasoning_details=
        [...rds.values()].sort((a,b)=>(a.index??0)-(b.index??0));
      return msg;
    }

    return { applyDelta, finalise };
  }

  // ── Response handlers (v3.2: strip reasoning_details before TM sees them) ─

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
              // Non-data lines (comments, empty): forward unchanged
              if (!chunk.startsWith('data:')) {
                ctrl.enqueue(enc.encode(chunk + '\n\n'));
                continue;
              }

              const raw = chunk.slice(chunk.indexOf(':') + 1).trim();

              // [DONE] sentinel: forward unchanged
              if (raw === '[DONE]') {
                ctrl.enqueue(enc.encode(chunk + '\n\n'));
                continue;
              }

              try {
                const parsed = JSON.parse(raw);
                const delta  = parsed.choices?.[0]?.delta;

                if (!delta) {
                  ctrl.enqueue(enc.encode(chunk + '\n\n'));
                  continue;
                }

                // Always accumulate the FULL delta (with reasoning_details) for Pi
                acc.applyDelta(delta);

                // v3.2: build TM-safe delta — strip reasoning_details, add reasoning text
                if (delta.reasoning_details?.length) {
                  const text = rdText(delta.reasoning_details);
                  const safeDelta = { ...delta };
                  delete safeDelta.reasoning_details;
                  // Append extracted text to reasoning field for TM's thinking bubble
                  if (text) safeDelta.reasoning = (safeDelta.reasoning ?? '') + text;

                  const safeChunk = { ...parsed };
                  safeChunk.choices = [{ ...parsed.choices[0], delta: safeDelta }];
                  ctrl.enqueue(enc.encode('data: ' + JSON.stringify(safeChunk) + '\n\n'));
                } else {
                  // No reasoning_details in this chunk — forward as-is
                  ctrl.enqueue(enc.encode(chunk + '\n\n'));
                }
              } catch {
                // Malformed JSON — forward raw and continue
                ctrl.enqueue(enc.encode(chunk + '\n\n'));
              }
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

  // v3.2: for non-streaming responses, strip reasoning_details before returning to TM
  async function handleNonStream(resp) {
    try {
      const body = await resp.json();
      const msg  = body?.choices?.[0]?.message;

      if (msg && hasExtra(msg)) {
        // Save full reasoning_details to Pi
        await saveMsg(msg);

        // Strip from TM's copy; add extracted text so thinking display still works
        const text = rdText(msg.reasoning_details);
        delete msg.reasoning_details;
        if (text && !msg.reasoning) msg.reasoning = text;
      }

      const headers = new Headers(resp.headers);
      headers.delete('content-length');    // length changes after stripping
      return new Response(JSON.stringify(body), { status: resp.status, statusText: resp.statusText, headers });
    } catch {
      return resp;   // parse error — return original unchanged
    }
  }

  // ── Fetch interceptor ─────────────────────────────────────────────────────

  if (window.__rce_active) window.fetch = window.__rce_orig ?? window.fetch;
  const _orig = window.__rce_orig = window.fetch;
  window.__rce_active = true;

  window.fetch = async function (...args) {
    let [url, opts] = args;
    const urlStr    = String(url);

    // 1. Passively capture Pi server URL + token from MCP traffic
    tryDetect(urlStr, opts);

    // 2. Inject reasoning_details into outbound LLM requests
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

    // 3. Capture reasoning from LLM response; strip from TM's view (v3.2)
    const ct = resp.headers.get('content-type') ?? '';
    if (ct.includes('event-stream'))   return handleStream(resp);
    if (ct.includes('application/json')) return handleNonStream(resp);
    return resp;
  };

  // ── Public API ────────────────────────────────────────────────────────────

  window.RCE = {
    debug: v => { CFG.debug = !!v; console.log(`[RCEv3] debug ${CFG.debug?'ON':'OFF'}`); },

    stats: async () => {
      const piS  = await pi.stats();
      const locN = await local?.count().catch(()=>'?') ?? '?';
      console.group('[RCEv3] Status (v3.2)');
      console.log('Server detected:', !!(CFG.piBase&&CFG.piApiKey) ? 'YES' : 'NO — waiting for first MCP call');
      console.log('Pi:', pi.available?'online':'offline', '|', piS??'n/a');
      console.log('Local fallback:', local?.name??'—', `(${locN} entries)`);
      console.groupEnd();
    },

    clear: async () => {
      await pi.prune(0).catch(()=>{});
      await local?.prune(Infinity).catch(()=>{});
      console.log('[RCEv3] Cache cleared.');
    },

    reset: () => {
      CFG.piBase = CFG.piUrl = CFG.piApiKey = '';
      try { localStorage.removeItem(LS_KEY_BASE); localStorage.removeItem(LS_KEY_TOKEN); } catch {}
      console.log('[RCEv3] Detection reset.');
    },
  };

  Object.defineProperty(window, 'debugReasoning', {
    get: ()  => CFG.debug,
    set: v   => window.RCE.debug(v),
    configurable: true,
  });

  // ── Init ──────────────────────────────────────────────────────────────────

  try { local = await buildIDB(); await local.prune(Date.now() - CFG.localTtlMs); }
  catch { local = mem; }

  const ready = CFG.piBase
    ? `Pi loaded from localStorage | local: ${local?.name}`
    : `Waiting for first MCP call to detect server | local: ${local?.name}`;

  console.log(`%c✅ RCEv3.2 ready — ${ready}`, 'color:#7c3aed;font-weight:600');

})();

