// ══════════════════════════════════════════════════════════════════════════════
//  TypingMind Reasoning Continuity Extension  ·  v3.3
// ══════════════════════════════════════════════════════════════════════════════
//
//  Fixes in this version (all in the response-handling layer):
//
//  FIX 1 — handleNonStream: clone response before reading body
//    Was: resp.json() consumed resp.body; catch block returned broken resp to
//         TM; TM called resp.json() → "body stream already read" error.
//    Now: resp.clone() is read; original resp is untouched; catch returns it
//         safely so TM can read it normally.
//
//  FIX 2 — handleStream: error path uses ctrl.error() not ctrl.close()
//    Was: network interruption (app backgrounded on Android) caused reader to
//         throw; catch fell through to ctrl.close() which signals normal EOF;
//         TM tried to parse a truncated response as complete → catastrophic error.
//    Now: catch calls ctrl.error(e) and returns immediately; TM sees a proper
//         network error and offers retry, not a parse failure.
//
//  FIX 3 — handleStream: stream closes before Pi save (non-blocking)
//    Was: await saveMsg() blocked ctrl.close(); TM saw a stalled response
//         until the Pi round-trip completed after the model finished speaking.
//    Now: ctrl.close() fires immediately when the model finishes; Pi save runs
//         in the background without blocking TM's UI.
//
//  FIX 4 — handleStream: cancel() tears down the underlying reader
//    Was: if TM cancelled the stream (Stop button, navigation), our reader kept
//         running and consuming the original response body until exhaustion.
//    Now: ReadableStream cancel() cancels the original reader immediately.
//
//  FIX 5 — handleStream: reasoning saved only on clean completion
//    Was: interrupted streams could save partial/corrupt reasoning_details.
//    Now: save only fires when done === true (model finished cleanly).
//
// ══════════════════════════════════════════════════════════════════════════════

(async () => {
  'use strict';

  const RC_PATH_SUFFIX   = '/reasoning-cache';
  const LS_KEY_BASE      = '_rce_b';
  const LS_KEY_TOKEN     = '_rce_t';

  const CFG = {
    piBase: '', piUrl: '', piApiKey: '',
    piTimeoutMs: 5000,
    localTtlMs:  7 * 24 * 60 * 60 * 1000,
    endpoints: [
      'https://openrouter.ai/api/v1/chat/completions',
      'https://api.minimax.chat/v1/text/chatcompletion',
      'https://llm.chutes.ai/v1/chat/completions',
      'https://nano-gpt.com/api/v1/chat/completions',
      'https://nano-gpt.com/api/v1legacy/chat/completions',
    ],
    dbName: 'TM_RCE_v3', storeName: 'rc', dbVersion: 1,
    maxEntries: 200, debug: false,
  };

  try {
    const b = localStorage.getItem(LS_KEY_BASE);
    const t = localStorage.getItem(LS_KEY_TOKEN);
    if (b && t) { CFG.piBase = b; CFG.piApiKey = t; CFG.piUrl = b + RC_PATH_SUFFIX; }
  } catch {}

  const info = (emoji, ...a) => console.log(`%c[RCEv3] ${emoji}`, 'color:#7c3aed;font-weight:600', ...a);
  const log  = (...a) => CFG.debug && console.log('%c[RCEv3]', 'color:#7c3aed', ...a);
  const warn = (...a) => console.warn('%c[RCEv3]', 'color:#d97706;font-weight:600', ...a);

  // ── Auto-detect server URL + token from TypingMind MCP traffic ────────────

  function readBearerToken(h) {
    if (!h) return null;
    const a = typeof h.get === 'function'
      ? (h.get('Authorization') || h.get('authorization'))
      : (h['Authorization'] || h['authorization'] || null);
    return (typeof a === 'string' && a.startsWith('Bearer ')) ? a.slice(7) : null;
  }

  function tryDetect(urlStr, opts) {
    if (CFG.piBase && CFG.piApiKey) return;
    try {
      const u = new URL(urlStr);
      if (!(u.pathname === '/start' || u.pathname === '/ping' || u.pathname.startsWith('/clients/'))) return;
      const token = readBearerToken(opts?.headers);
      if (!token) return;
      CFG.piBase   = `${u.protocol}//${u.host}`;
      CFG.piApiKey = token;
      CFG.piUrl    = CFG.piBase + RC_PATH_SUFFIX;
      try { localStorage.setItem(LS_KEY_BASE, CFG.piBase); localStorage.setItem(LS_KEY_TOKEN, CFG.piApiKey); } catch {}
      pi.available = true;
      info('🔑', 'server detected');
    } catch {}
  }

  // ── Pi backend ────────────────────────────────────────────────────────────

  const pi = {
    available: true, _retryTimer: null,
    _ready()   { return !!(this.available && CFG.piUrl && CFG.piApiKey); },
    _headers() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CFG.piApiKey}` }; },

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
      catch {}
    },

    _goOffline() {
      if (!this.available) return;
      this.available = false;
      warn('⚠️ Pi offline — local fallback active. Retry in 60s.');
      clearTimeout(this._retryTimer);
      this._retryTimer = setTimeout(async () => {
        try {
          if (!CFG.piUrl || !CFG.piApiKey) { this._goOffline(); return; }
          const r = await fetch(`${CFG.piUrl}/stats`, { headers: this._headers() });
          if (r.ok) { this.available = true; info('✅', 'Pi back online'); } else this._goOffline();
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
        if (!d.objectStoreNames.contains(CFG.storeName))
          d.createObjectStore(CFG.storeName, { keyPath: 'k' }).createIndex('ts', 'ts');
      };
      req.onerror  = () => reject(req.error);
      req.onsuccess = ({ target: { result: db } }) => {
        const os = rw => db.transaction(CFG.storeName, rw).objectStore(CFG.storeName);
        resolve({
          name:  'IndexedDB',
          get:   k        => new Promise((rs,rj)=>{ const r=os('readonly').get(k); r.onsuccess=()=>rs(r.result??null); r.onerror=()=>rj(r.error); }),
          set:   (k,v,ts) => new Promise((rs,rj)=>{ const r=os('readwrite').put({k,v,ts}); r.onsuccess=rs; r.onerror=()=>rj(r.error); }),
          prune: cut      => new Promise(rs=>{ const tx=db.transaction(CFG.storeName,'readwrite'); const rq=tx.objectStore(CFG.storeName).index('ts').openCursor(IDBKeyRange.upperBound(cut)); rq.onsuccess=({target:{result:c}})=>{if(c){c.delete();c.continue();}}; tx.oncomplete=rs; }),
          count: ()       => new Promise(rs=>{ const r=os('readonly').count(); r.onsuccess=()=>rs(r.result); }),
          evict: n        => new Promise(rs=>{ const tx=db.transaction(CFG.storeName,'readwrite'); let d=0; const r=tx.objectStore(CFG.storeName).index('ts').openCursor(); r.onsuccess=({target:{result:c}})=>{if(c&&d<n){c.delete();d++;c.continue();}}; tx.oncomplete=rs; }),
        });
      };
    });
  }

  const mem = (() => {
    const m = new Map();
    return {
      name:  'Memory (volatile)',
      get:   async k        => m.get(k)??null,
      set:   async (k,v,ts) => m.set(k,{v,ts}),
      prune: async cut      => { for(const[k,e]of m)if((e.ts??0)<cut)m.delete(k); },
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
      if (rec && Date.now()-(rec.ts??0) <= CFG.localTtlMs) { log('💡 Local HIT', hash.slice(0,10)); return rec.v; }
    } catch {}
    log('❌ Miss', hash.slice(0,10)); return null;
  }

  async function cachePut(hash, value) {
    const ok = await pi.set(hash, value);
    if (!ok) log('⚠️ Pi write failed, local only');
    try {
      const n = await local.count();
      if (n >= CFG.maxEntries) await local.evict(Math.ceil(CFG.maxEntries * 0.1));
      await local.set(hash, value, Date.now());
    } catch {}
    return ok;
  }

  // ── Hashing ───────────────────────────────────────────────────────────────

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  async function msgKey(msg) {
    const c = typeof msg.content==='string' ? msg.content : JSON.stringify(msg.content??'');
    const t = (msg.tool_calls??[]).map(x=>x.id??'').join('|');
    return sha256(c+'\x00'+t);
  }

  // ── Field helpers ─────────────────────────────────────────────────────────

  const BASE         = new Set(['role','content','tool_calls','tool_call_id','name']);
  const hasExtra     = m => Object.keys(m).some(k => !BASE.has(k));
  const hasReasoning = m => Array.isArray(m.reasoning_details) && m.reasoning_details.length > 0;
  const getExtra     = m => { const{role,content,tool_calls,tool_call_id,name,...x}=m; return Object.keys(x).length?x:null; };
  const rdText       = d => (d??[]).map(r=>r.text||r.summary||'').join('');

  // ── Save + inject ─────────────────────────────────────────────────────────

  async function saveMsg(msg) {
    const extra = getExtra(msg);
    if (!extra) return false;
    return cachePut(await msgKey(msg), extra);
  }

  async function injectMsgs(messages) {
    let hits = 0, attempts = 0;
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      if (hasReasoning(msg)) { log('⏭ already has reasoning_details'); continue; }
      attempts++;
      const v = await cacheGet(await msgKey(msg));
      if (!v) continue;
      Object.assign(msg, v);
      hits++;
    }
    return { hits, attempts };
  }

  // ── Stream accumulator ────────────────────────────────────────────────────

  function makeAcc() {
    const msg={}, tcs=new Map(), rds=new Map();

    function applyDelta(d) {
      for(const[f,v]of Object.entries(d)){
        if(f==='tool_calls')        {accTC(v);continue;}
        if(f==='reasoning_details') {accRD(v);continue;}
        if     (msg[f]===undefined)                             msg[f] =v;
        else if(typeof msg[f]==='string'&&typeof v==='string') msg[f]+=v;
        else                                                    msg[f] =v;
      }
    }
    function accTC(ds){for(const d of ds??[]){const b=tcs.get(d.index)??{index:d.index,id:'',type:'',fn:{name:'',args:''}};if(d.id)b.id+=d.id;if(d.type&&!b.type)b.type=d.type;if(d.function?.name&&!b.fn.name)b.fn.name=d.function.name;if(d.function?.arguments)b.fn.args+=d.function.arguments;tcs.set(d.index,b);}}
    function accRD(ds){for(const d of ds??[]){const idx=d.index??0,b=rds.get(idx)??{type:d.type,id:d.id,format:d.format,index:idx};if(d.text)b.text=(b.text??'')+d.text;if(d.data)b.data=(b.data??'')+d.data;if(d.summary)b.summary=(b.summary??'')+d.summary;if(d.signature)b.signature=d.signature;rds.set(idx,b);}}

    function finalise(){
      if(tcs.size) msg.tool_calls=[...tcs.values()].sort((a,b)=>a.index-b.index).map(b=>({id:b.id,type:b.type||'function',function:{name:b.fn.name,arguments:b.fn.args}}));
      if(rds.size) msg.reasoning_details=[...rds.values()].sort((a,b)=>(a.index??0)-(b.index??0));
      return msg;
    }
    return {applyDelta, finalise};
  }

  // ── Response handlers ─────────────────────────────────────────────────────

  async function handleStream(resp) {
    // Guard: if body is already consumed (edge case), return as-is
    if (!resp.body || resp.bodyUsed) return resp;

    const reader = resp.body.getReader();
    const enc    = new TextEncoder();
    const acc    = makeAcc();
    let   completedCleanly = false;

    const stream = new ReadableStream({

      async start(ctrl) {
        const dec = new TextDecoder();
        let buf = '';

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              completedCleanly = true;
              break;
            }

            buf += dec.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() ?? '';

            for (const chunk of parts) {
              if (!chunk.startsWith('data:')) {
                ctrl.enqueue(enc.encode(chunk + '\n\n'));
                continue;
              }

              const raw = chunk.slice(chunk.indexOf(':') + 1).trim();

              if (raw === '[DONE]') {
                ctrl.enqueue(enc.encode(chunk + '\n\n'));
                continue;
              }

              try {
                const parsed = JSON.parse(raw);
                const delta  = parsed.choices?.[0]?.delta;

                if (!delta) { ctrl.enqueue(enc.encode(chunk + '\n\n')); continue; }

                acc.applyDelta(delta);

                if (delta.reasoning_details?.length) {
                  // Strip reasoning_details; convert to plain text for TM display.
                  // This prevents TM from writing local UUID attachment files
                  // which break cross-device chat import/export.
                  const text      = rdText(delta.reasoning_details);
                  const safeDelta = { ...delta };
                  delete safeDelta.reasoning_details;
                  if (text) safeDelta.reasoning = (safeDelta.reasoning ?? '') + text;
                  const safe = { ...parsed, choices: [{ ...parsed.choices[0], delta: safeDelta }] };
                  ctrl.enqueue(enc.encode('data: ' + JSON.stringify(safe) + '\n\n'));
                } else {
                  ctrl.enqueue(enc.encode(chunk + '\n\n'));
                }
              } catch {
                // Malformed SSE chunk — forward raw so TM still receives it
                ctrl.enqueue(enc.encode(chunk + '\n\n'));
              }
            }
          }
        } catch (e) {
          // FIX 2: network interruption / app backgrounded / reader aborted.
          // Signal a proper error to TM — NOT a normal close.
          // Before this fix: ctrl.close() was called, TM saw a truncated
          // response that looked complete, tried to parse it → catastrophic error.
          // Now: TM sees a stream error and handles it like a network failure
          // (offers retry rather than showing a parse-failure crash).
          warn('stream interrupted:', e.message ?? e);
          try { ctrl.error(e); } catch {}
          return; // exit start(); do NOT fall through to ctrl.close() below
        }

        // FIX 3: close the stream immediately so TM's UI updates without
        // waiting for the Pi round-trip.
        // FIX 5: only save reasoning when stream completed without interruption
        // (completedCleanly === true) to avoid persisting partial/corrupt data.
        ctrl.close();

        if (completedCleanly) {
          // Save runs after ctrl.close() — background, non-blocking for TM
          const full = acc.finalise();
          if (hasExtra(full)) {
            saveMsg(full)
              .then(ok => info('💾', `saved reasoning to ${ok ? 'Pi' : 'local'}`))
              .catch(e  => warn('save failed:', e.message));
          }
        }
      },

      // FIX 4: when TM cancels the stream (Stop button, navigation, app close),
      // cancel the underlying reader so we stop consuming the response body.
      // Before this fix: our reader kept running until it exhausted the body.
      cancel() {
        reader.cancel().catch(() => {});
      },

    });

    return new Response(stream, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
  }

  async function handleNonStream(resp) {
    // Guard: nothing to process on an already-used body
    if (resp.bodyUsed) return resp;

    // FIX 1: clone BEFORE reading. If clone.json() throws for any reason
    // (network interruption, JSON parse error, body in unexpected state),
    // the catch block returns the original unread resp safely.
    // Before this fix: resp.json() consumed resp.body; catch returned the
    // broken resp to TM; TM called resp.json() → "body stream already read".
    const clone = resp.clone();
    try {
      const body = await clone.json();
      const msg  = body?.choices?.[0]?.message;

      if (msg && hasExtra(msg)) {
        // Save to Pi (non-blocking — don't await)
        saveMsg(msg)
          .then(ok => info('💾', `saved reasoning to ${ok ? 'Pi' : 'local'} (non-stream)`))
          .catch(e  => warn('save failed:', e.message));

        // Strip reasoning_details from what TM sees (same as streaming path)
        if (msg.reasoning_details?.length) {
          const text = rdText(msg.reasoning_details);
          delete msg.reasoning_details;
          if (text && !msg.reasoning) msg.reasoning = text;
        }
      }

      const headers = new Headers(resp.headers);
      headers.delete('content-length'); // length changed after stripping
      return new Response(JSON.stringify(body), { status: resp.status, statusText: resp.statusText, headers });
    } catch {
      // clone.json() failed — resp.body is still unread, return it safely
      return resp;
    }
  }

  // ── Fetch interceptor ─────────────────────────────────────────────────────

  if (window.__rce_active) window.fetch = window.__rce_orig ?? window.fetch;
  const _orig = window.__rce_orig = window.fetch;
  window.__rce_active = true;

  window.fetch = async function (...args) {
    let [url, opts] = args;
    const urlStr = String(url);

    tryDetect(urlStr, opts);

    const isLLM = CFG.endpoints.some(ep => urlStr.includes(ep));
    if (isLLM && opts?.body) {
      try {
        const body = JSON.parse(opts.body);
        if (Array.isArray(body?.messages)) {
          const { hits, attempts } = await injectMsgs(body.messages);
          if (hits > 0) {
            opts = { ...opts, body: JSON.stringify(body) };
            info('📤', `injected reasoning into ${hits}/${attempts} assistant messages`);
          } else if (attempts > 0) {
            log(`${attempts} messages checked, no cached reasoning`);
          }
        }
      } catch (e) { warn('inject error:', e); }
    }

    const resp = await _orig.call(this, url, opts);
    if (!isLLM) return resp;

    const ct = resp.headers.get('content-type') ?? '';
    if (ct.includes('event-stream'))     return handleStream(resp);
    if (ct.includes('application/json')) return handleNonStream(resp);
    return resp;
  };

  // ── Public API ────────────────────────────────────────────────────────────

  window.RCE = {
    debug: v => { CFG.debug = !!v; console.log(`[RCEv3] debug ${CFG.debug ? 'ON' : 'OFF'}`); },
    stats: async () => {
      const piS  = await pi.stats();
      const locN = await local?.count().catch(() => '?') ?? '?';
      console.group('[RCEv3] Status');
      console.log('Server:', CFG.piBase ? `${CFG.piBase} (${pi.available ? 'online' : 'OFFLINE'})` : 'not yet detected');
      console.log('Pi cache:', piS ? `${piS.entries} entries · ${piS.total_mb}MB · newest ${piS.newest}` : 'n/a');
      console.log('Local fallback:', local?.name ?? '—', `(${locN} entries)`);
      console.groupEnd();
    },
    clear: async () => {
      await pi.prune(0).catch(() => {});
      await local?.prune(Infinity).catch(() => {});
      info('🗑️', 'cache cleared');
    },
    reset: () => {
      CFG.piBase = CFG.piUrl = CFG.piApiKey = '';
      try { localStorage.removeItem(LS_KEY_BASE); localStorage.removeItem(LS_KEY_TOKEN); } catch {}
      info('⟳', 'detection reset');
    },
  };

  Object.defineProperty(window, 'debugReasoning', {
    get: () => CFG.debug, set: v => window.RCE.debug(v), configurable: true,
  });

  // ── Init ──────────────────────────────────────────────────────────────────

  try { local = await buildIDB(); await local.prune(Date.now() - CFG.localTtlMs); }
  catch { local = mem; }

  info('✅', `ready — ${CFG.piBase ? 'Pi loaded from localStorage' : 'waiting for first MCP call'} | local: ${local?.name}`);

})();
