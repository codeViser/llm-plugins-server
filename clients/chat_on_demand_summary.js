// ================================================================
//  TypingMind — Compact Context Extension                v1.2.0
// ================================================================
//
//  INSTALL: Preferences → Advanced Settings → Extensions → URL
//  TRIGGER: 🗜 button in chat header, or ⌘⌥K / Ctrl+Alt+K
//  FIRST RUN: Send any message once to capture API config.
//
//  FIXES vs v1.1.0 (confirmed via live debug data):
//
//  1. "Cannot read 'find' of undefined"
//     JS operator precedence bug: `a ?? b ? c : d` parses as
//     `(a ?? b) ? c : d`. When `choices[0].message.content` was a
//     non-null string, it became the ternary condition, then called
//     `.find()` on `data.content` which is undefined in the
//     OpenRouter/OpenAI response format.
//     FIX: wrap the Anthropic branch in explicit parens.
//
//  2. Wrong model sent to API
//     IDB `chat.model` = `3dad2089-3310-472e-a13d-f3e78973c70e`
//     (TM's internal UUID), NOT the OpenRouter model string.
//     FIX: always use model from _CHAT_CFGS (captured from fetch).
//
//  3. tool_choice / parallel_tool_calls sent with no tools
//     TM sends these for normal chat (46 plugin tools). Our
//     summarisation call has no tools — stripped before sending.
//
// ================================================================

(() => {
  'use strict';

  const ID        = 'tm-ctx-compact';
  const VERSION   = '1.2.0';
  const ATTR      = `data-${ID}`;
  const MAX_CHARS = 80_000;           // tail-truncate very long transcripts
  const TOOL_MAX  = 1_500;            // per-tool-result character cap in transcript

  /* ── PROMPT ─────────────────────────────────────────────────── */
  const PROMPT = `You are resuming an active session that has hit the context window limit. Produce a structured compaction summary that enables a new AI instance to continue this work with minimal information loss.

Write in structured, telegraphic form. This is not a narrative retelling — every token must earn its place.

━━━ PRESERVATION TIERS ━━━

TIER 1 — VERBATIM
All code snippets, exact values, formulas, specific strings, configuration parameters, and any content flagged as exact or critical. Reproduce character-for-character. Never paraphrase, abbreviate, or reformat.

TIER 2 — DENSE SUMMARY
Technical decisions, research findings, reasoning chains, and process evolution. Use structured entries, not prose paragraphs. Target: 1–3 lines per item.

TIER 3 — MINIMAL
User communication preferences and personal context only. Maximum 5 bullets. Omit this tier entirely if the session was purely technical.

━━━ FORBIDDEN ━━━

✗ "User said X / Assistant said Y" chronological replay format
✗ Narrative paragraphs or essay-style summaries
✗ Pleasantries, greetings, and meta-commentary
✗ Paraphrasing or summarizing any Tier 1 content
✗ More than 2 lines per reference catalog entry
✗ Inferring or fabricating content not present in the conversation

━━━ CORE DECISION RULE ━━━

Include content if it directly affects what the AI would do next.
Omit content that only describes what already happened with no forward operational value.

━━━━━━━━━━━━━━━━━━━━━━━━━━

Produce your output in 6 sections using the structure below, wrapped in <CONVERSATION_SUMMARY> tags.

---

## 1. Session Identity

Write as a single compact block — no bullets. State:
(a) The overarching project or goal of this session in 1 sentence.
(b) Domain and subject area.
(c) Current phase: [Exploration | Research | Decision-Making | Execution | Review | Near-Completion]
(d) Hard constraints, declared requirements, or non-negotiables that frame the entire session.

---

## 2. Verbatim Artifact Registry

Reproduce all Tier 1 content here exactly. Include: code snippets, configuration values, exact parameter values, formulas, critical strings, and key excerpts from any documents or file attachments that were integral to the session.

For each artifact, use this format:

[ARTIFACT-n] | TYPE: {code / value / formula / string / document-excerpt / other} | PURPOSE: {1-line description}
\`\`\`
{Reproduce the exact content here, enclosed in a code fence}
\`\`\`

For attached documents or files: log the filename and type, then reproduce only the passages or values that remain operationally relevant to the continuation.

If no Tier 1 content exists: write [NONE]

---

## 3. Reference Catalog

One entry per URL, paper, document, or named external resource referenced during the session. Maximum 2 lines per entry.

[REF-n] {URL or title} — {what it is}: {key actionable finding or reason it was referenced}

Group entries thematically where relevant (e.g., ## Documentation, ## Research Sources, ## Tools).

If no references exist: write [NONE]

---

## 4. Technical State & Decision Log

### 4a. Current Technical State
What is the exact current status of the work? What has been produced, concluded, or left incomplete? Be specific — name the component, function, file, output, draft, or finding in question.

### 4b. Decision & Reasoning Log
Each significant decision or conclusion reached during the session, in chronological order:

→ [DECISION]: {what was decided or concluded} | Rationale: {why} | Rejected: {alternatives considered, if any}

Include decisions that were reversed or updated — these are critical for preventing repeated detours.

### 4c. Process & Stance Evolution
How did the session's direction evolve? Capture:
— User's side: how requirements, goals, or scope shifted, expanded, constrained, or reprioritized
— Model's side: what approaches were abandoned, what methods were adopted, what pivots occurred and why
— Net result: why the session stands where it does rather than somewhere else

---

## 5. Open Threads & Continuation Points

Priority-ordered list of what the new instance must pick up:
- Unanswered questions from the user
- Tasks that were in progress at the moment of context reset
- Explicit commitments made during the session (e.g., "I'll look into X", "we'll revisit Y")
- Natural next steps the conversation was clearly heading toward
- Unresolved contradictions or ambiguities that still require resolution

Mark the single most critical item with ⚡

---

## 6. User & Session Profile

Maximum 5 bullets. Omit this section entirely if no aspect is likely to affect the continuation.

Include only what directly affects how to respond going forward: communication depth preference, domain expertise level observed, environment or tooling constraints, and any sensitive context requiring careful handling.`;

  /* ══════════════════════════════════════════════════════════════
   *  FETCH INTERCEPT
   *  Saves the real fetch BEFORE hooking so our own API calls
   *  bypass every interceptor.  Updates on every API call so
   *  per-chat model changes are always reflected.
   * ══════════════════════════════════════════════════════════════ */
  const _RAW = window.fetch.bind(window);   // true original — used for summarisation

  let _BASE       = null;    // { url, hdrs }  — provider endpoint + auth
  let _CHAT_CFGS  = {};      // chatID → { model, params, ts }

  // Restore persisted config from previous page loads
  try {
    const b = localStorage.getItem(`${ID}_base`);
    if (b) _BASE = JSON.parse(b);
    const c = localStorage.getItem(`${ID}_chats`);
    if (c) _CHAT_CFGS = JSON.parse(c);
  } catch (_) {}

  function _hookFetch() {
    const _prev = window.fetch;
    window.fetch = function (url, opts = {}) {
      if (opts?.method === 'POST') {
        const u = String(url);
        if (/\/(chat\/completions|messages|responses)([?#]|$)/.test(u)) {
          try {
            const body = JSON.parse(typeof opts.body === 'string' ? opts.body : '{}');
            const hdrs = opts.headers ?? {};
            const auth = (hdrs.Authorization ?? hdrs.authorization ?? '')
                           .replace(/^Bearer\s+/i, '').trim();

            if (body.model && auth) {
              // ── Update provider-level config ─────────────────
              _BASE = { url: u, hdrs: _safeHdrs(hdrs) };
              localStorage.setItem(`${ID}_base`, JSON.stringify(_BASE));

              // ── Per-chat config, keyed by chatID from URL hash
              const chatID = (location.hash.match(/#chat=([^&]+)/) || [])[1]
                             || '_latest';

              const entry = {
                model  : body.model,          // 'google/gemini-3-flash-preview' etc.
                params : _pickParams(body),   // reasoning_effort, temperature, etc.
                ts     : Date.now(),
              };
              _CHAT_CFGS[chatID]    = entry;
              _CHAT_CFGS['_latest'] = entry;  // always keep a fallback

              // Prune to latest 40 chats
              const sorted = Object.entries(_CHAT_CFGS)
                .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
              if (sorted.length > 40) _CHAT_CFGS = Object.fromEntries(sorted.slice(0, 40));
              localStorage.setItem(`${ID}_chats`, JSON.stringify(_CHAT_CFGS));

              _log(`Captured: model=${body.model} chatID=${chatID}`,
                   `params=${JSON.stringify(entry.params)}`);
            }
          } catch (_) {}
        }
      }
      return _prev.apply(this, arguments);
    };
  }

  /**
   * Params to replay verbatim from TM's call.
   *
   * EXCLUDED intentionally:
   *   tools, tool_choice, parallel_tool_calls  — our call has no tools
   *   messages, stream, n, stop, seed          — we override these
   *   response_format                           — we need plain markdown
   */
  function _pickParams(body) {
    const KEEP = [
      'temperature',              // required at 1.0 for some Anthropic models
      'top_p', 'top_k',
      'frequency_penalty', 'presence_penalty',
      'reasoning_effort',         // OpenAI / OpenRouter reasoning models (critical)
      'thinking',                 // Anthropic extended thinking
      'max_tokens',               // anthropic / fallback
      'max_completion_tokens',    // OpenAI newer models
      'user',
    ];
    const out = {};
    for (const k of KEEP) {
      if (body[k] !== undefined) out[k] = body[k];
    }
    return out;
  }

  function _safeHdrs(h) {
    const KEEP = new Set([
      'authorization', 'x-api-key',
      'http-referer', 'x-title',
      'anthropic-version', 'x-goog-api-key', 'openai-organization',
    ]);
    return Object.fromEntries(
      Object.entries(h).filter(([k]) => KEEP.has(k.toLowerCase()))
    );
  }

  /* ══════════════════════════════════════════════════════════════
   *  REACT FIBER  (identical to chat_user_msg_preview.js pattern)
   *  Confirmed working via Script A debug output.
   * ══════════════════════════════════════════════════════════════ */
  function _chatState() {
    const el = document.querySelector('[data-element-id="chat-space-middle-part"]');
    if (!el) return null;
    const fk = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    if (!fk) return null;
    let f = el[fk];
    for (let d = 0; f && d < 80; f = f.return, d++) {
      let hs = f.memoizedState, i = 0;
      for (; hs && i < 6; hs = hs.next, i++) {
        const v = hs.memoizedState;
        if (
          v && typeof v === 'object' && !Array.isArray(v) &&
          Array.isArray(v.messages) && v.chatID
        ) return { s: v, d: hs.queue?.dispatch };
      }
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════
   *  IDB  (confirmed: db='keyval-store', store='keyval', key=`CHAT_${id}`)
   * ══════════════════════════════════════════════════════════════ */
  const _idb = () => new Promise((ok, no) => {
    const r = indexedDB.open('keyval-store');
    r.onsuccess = e => ok(e.target.result);
    r.onerror   = () => no(r.error);
  });

  async function _getChat(chatID) {
    const db = await _idb();
    return new Promise((ok, no) => {
      const req = db.transaction('keyval', 'readonly')
                    .objectStore('keyval').get(`CHAT_${chatID}`);
      req.onsuccess = () => { db.close(); ok(req.result ?? null); };
      req.onerror   = () => { db.close(); no(req.error); };
    });
  }

  async function _putChat(chatID, messages) {
    const db = await _idb();
    return new Promise((ok, no) => {
      const st  = db.transaction('keyval', 'readwrite').objectStore('keyval');
      const key = `CHAT_${chatID}`;
      const g   = st.get(key);
      g.onsuccess = () => {
        if (!g.result) { db.close(); ok(); return; }
        const w = st.put(
          { ...g.result, messages, updatedAt: new Date().toISOString() },
          key
        );
        w.onsuccess = () => { db.close(); ok(); };
        w.onerror   = () => { db.close(); no(w.error); };
      };
      g.onerror = () => { db.close(); no(g.error); };
    });
  }

  /* ══════════════════════════════════════════════════════════════
   *  TRANSCRIPT BUILDER
   *
   *  Confirmed TM internal message structures (from debug):
   *
   *  User message:
   *    { role:'user', uuid, content: [{type:'text',text:'...'},...], createdAt }
   *
   *  Assistant (final text response):
   *    { role:'assistant', uuid, model, content: string, tool_calls:[], ... }
   *
   *  Assistant (tool-calling turn):
   *    { role:'assistant', uuid, model, content: null, tool_calls:[...],
   *      reasoning, reasoning_details, ... }
   *
   *  Tool response:
   *    { role:'tool', type:'tool-response', uuid, name, content: [{type:'text',text:'...'}],
   *      tool_call_id, pluginResponse, ... }
   *
   *  Clear-context marker:
   *    { type:'clear-context', uuid, createdAt }
   * ══════════════════════════════════════════════════════════════ */

  /** Flatten any content shape to a plain string */
  function _toText(c) {
    if (c === null || c === undefined) return '';
    if (typeof c === 'string')         return c;
    if (Array.isArray(c)) {
      return c.map(b => {
        if (typeof b === 'string')       return b;
        if (b?.type === 'text')          return b.text ?? '';
        if (b?.type === 'tool_use')      return `[Tool: ${b.name}(${JSON.stringify(b.input ?? {})})]`;
        if (b?.type === 'tool_result')   return `[Result: ${JSON.stringify(b.content ?? '')}]`;
        if (b?.type === 'image_url')     return '[image]';
        if (b?.type === 'image')         return '[image]';
        if (b?.type === 'thinking')      return '';  // skip internal thinking blocks
        return b?.text ?? b?.content ?? '';
      }).join('\n').trim();
    }
    if (typeof c === 'object') return c.text ?? c.content ?? JSON.stringify(c);
    return String(c);
  }

  function _buildTranscript(messages, rec) {
    const lines = [
      '===== CONVERSATION TRANSCRIPT =====',
      `Title  : ${rec?.chatTitle ?? '(untitled)'}`,
      `Messages: ${messages.filter(m => m.role || m.type === 'clear-context').length}`,
    ];

    // System message from chatParams (not in messages array - added by TM at call-time)
    const sys = rec?.chatParams?.systemMessage;
    if (sys) lines.push(`\n[CONFIGURED SYSTEM INSTRUCTION]\n${sys.slice(0, 800)}${sys.length > 800 ? '…' : ''}`);

    let n = 0;
    for (const m of messages) {

      // ── Clear-context markers (TM's own previous compactions) ─────────
      if (m.type === 'clear-context') {
        lines.push('\n── [CONTEXT CLEARED HERE — earlier messages no longer visible to AI] ──\n');
        continue;
      }

      const role = (m.role ?? '').toLowerCase();
      if (!role) continue;   // skip any unrecognised marker objects

      const label =
        role === 'user'      ? '👤 USER'         :
        role === 'assistant' ? '🤖 ASSISTANT'    :
        role === 'tool'      ? '🔧 TOOL RESULT'  :
        role === 'system'    ? '⚙️  SYSTEM'       :
        role.toUpperCase();

      // ── Extract message body ──────────────────────────────────────────
      let body = _toText(m.content);

      // Tool calls on assistant messages (content may be null for these)
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        m.tool_calls.forEach(tc => {
          const name = tc.function?.name ?? tc.name ?? '?';
          const args = tc.function?.arguments ?? tc.arguments ?? '{}';
          body += `\n[→ Tool Call: ${name}(${typeof args === 'string' ? args : JSON.stringify(args)})]`;
        });
      }

      // Tool results can be very long — cap per-result to keep transcript manageable
      if (role === 'tool' && body.length > TOOL_MAX) {
        body = body.slice(0, TOOL_MAX)
             + `\n[…result truncated, ${(body.length - TOOL_MAX).toLocaleString()} chars omitted]`;
      }

      if (!body.trim()) continue;   // skip truly empty messages
      lines.push(`\n[${++n}] ${label}:\n${body}`);
    }

    lines.push(`\n===== END OF TRANSCRIPT (${n} messages shown) =====`);
    return lines.join('\n');
  }

  /* ══════════════════════════════════════════════════════════════
   *  API CALL
   *
   *  KEY FIX v1.2.0:
   *  Response text extraction now uses explicit parens to prevent
   *  the operator-precedence bug that caused `.find on undefined`.
   *
   *  Previous (buggy):
   *    data?.choices?.[0]?.message?.content    ← if string, becomes
   *    ?? Array.isArray(...)                      the ternary condition!
   *        ? data.content.find(...)            ← data.content undefined
   *        : null
   *
   *  Fixed:
   *    data?.choices?.[0]?.message?.content
   *    ?? (Array.isArray(data?.content)        ← parens isolate branch
   *          ? data.content.find(...)
   *          : null)
   * ══════════════════════════════════════════════════════════════ */
  async function _callLLM(transcript, chatID) {
    if (!_BASE) {
      throw new Error('No API config captured yet. Send one message first, then retry.');
    }

    // Use per-chat config (model captured from actual fetch — NOT IDB UUID)
    const cfg = _CHAT_CFGS[chatID] ?? _CHAT_CFGS['_latest'] ?? null;
    if (!cfg?.model) {
      throw new Error('No model captured for this chat. Send one message first, then retry.');
    }

    const { model, params } = cfg;

    // ── Build base params from TM's own call ─────────────────────────
    const base = { ...params };

    // FIX: Strip tool-routing params — our call has no tools
    delete base.tool_choice;
    delete base.parallel_tool_calls;

    // ── Token limit — keep whichever key TM uses, minimum 8192 ───────
    const usesCompletion = base.max_completion_tokens !== undefined;
    const tokenKey = usesCompletion ? 'max_completion_tokens' : 'max_tokens';
    const tokenVal = Math.max(base[tokenKey] ?? 0, 8192);
    delete base.max_tokens;
    delete base.max_completion_tokens;

    // ── Final request body ─────────────────────────────────────────────
    const reqBody = {
      ...base,              // temperature, reasoning_effort, thinking, etc. — exact from TM
      model,
      stream     : false,
      [tokenKey] : tokenVal,
      messages   : [
        { role: 'system', content: PROMPT },
        {
          role    : 'user',
          content :
            '[CONVERSATION_CONTEXT_LIMIT_REACHED]\n\n' +
            'Summarise the following conversation strictly per your system instructions above.\n\n' +
            transcript,
        },
      ],
    };

    _log('→ API:', model, '| params:', JSON.stringify(base));

    const res = await _RAW(_BASE.url, {
      method  : 'POST',
      headers : { ..._BASE.hdrs, 'Content-Type': 'application/json' },
      body    : JSON.stringify(reqBody),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      _errLog('Request body that caused error:\n' + JSON.stringify(reqBody, null, 2));
      throw new Error(`API ${res.status} — ${detail.slice(0, 250)}`);
    }

    const data = await res.json();

    // ── Text extraction — FIX: explicit parens around Anthropic branch ─
    const text =
        data?.choices?.[0]?.message?.content           // OpenAI / OpenRouter ✓
     ?? (Array.isArray(data?.content)                   // Anthropic ✓ (parens fix)
           ? data.content.find(b => b?.type === 'text')?.text
           : null)
     ?? data?.candidates?.[0]?.content?.parts?.[0]?.text  // Gemini ✓
     ?? null;

    if (!text?.trim()) {
      throw new Error(
        'LLM returned empty content. Raw response: ' +
        JSON.stringify(data).slice(0, 300)
      );
    }
    return text;
  }

  /* ══════════════════════════════════════════════════════════════
   *  STATE MUTATION
   *  Inserts clear-context marker + summary via React dispatch
   *  (immediate UI update) and IDB (persists across reload).
   *
   *  Confirmed message structures from debug:
   *   clear-context: { uuid, type:'clear-context', createdAt }
   *   assistant:     { uuid, role:'assistant', content:string, createdAt }
   * ══════════════════════════════════════════════════════════════ */
  const _uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 3) | 8).toString(16);
        });

  async function _applyCompaction(cs, rawSummary) {
    const { s, d } = cs;
    const now = new Date().toISOString();
    const ts  = new Date().toLocaleString();

    const header =
      `**[🗜️ Context Compaction]** · *${ts}*\n\n` +
      `> All prior messages summarised and cleared from active context.\n` +
      `> This summary is now the starting point. Continue your conversation.\n\n` +
      `---\n\n`;

    const updated = [
      ...s.messages,
      // TM treats this as a context-reset boundary (same as ⌘⌥J)
      { uuid: _uid(), type: 'clear-context', createdAt: now },
      // Summary visible in chat and included in subsequent API calls
      { uuid: _uid(), role: 'assistant', content: header + rawSummary, createdAt: now },
    ];

    const nextState = { ...s, messages: updated, updatedAt: now };

    // 1. Update React UI immediately
    try { d?.(nextState); }
    catch (e) { _warnLog('dispatch failed (IDB will still persist):', e.message); }

    // 2. Persist to IDB (survives reload)
    await _putChat(s.chatID, updated);
  }

  /* ══════════════════════════════════════════════════════════════
   *  MAIN ACTION
   * ══════════════════════════════════════════════════════════════ */
  async function _doCompact(btn) {
    const cs = _chatState();
    if (!cs?.s) {
      _toast('⚠️ No active chat detected.', 'warn');
      return;
    }

    // Don't interrupt an active stream
    const streaming = !!document.querySelector(
      '[data-element-id="stop-generation-button"], [aria-label="Stop generating"]'
    );
    if (streaming) {
      _toast('⚠️ Wait for the AI to finish first.', 'warn');
      return;
    }

    const msgs = cs.s.messages;
    if (msgs.filter(m => m.role && !m.type).length < 2) {
      _toast('ℹ️ Not enough messages to compact.', 'info');
      return;
    }

    if (!_BASE) {
      _toast('⚠️ No API config yet — send one message first, then retry.', 'warn', 6000);
      return;
    }

    _btnLoading(btn, true);
    try {
      _toast('📖 Reading conversation…', 'info');
      const rec = await _getChat(cs.s.chatID);
      // NOTE: rec.model is TM's internal UUID — NOT used for the API call.
      // The actual model ID (e.g. 'google/gemini-3-flash-preview') comes
      // from _CHAT_CFGS which captures the real OpenRouter model from fetch.

      let tx = _buildTranscript(msgs, rec);
      if (tx.length > MAX_CHARS) {
        const cut = tx.length - MAX_CHARS;
        tx = `[…${cut.toLocaleString()} chars of earlier history omitted]\n\n` + tx.slice(-MAX_CHARS);
        _warnLog('Transcript truncated — conversation very long.');
      }

      _toast('🧠 Generating summary… (10–40 s)', 'info', 60_000);
      const summary = await _callLLM(tx, cs.s.chatID);

      _toast('✅ Injecting summary…', 'info');
      await _applyCompaction(cs, summary);

      _toast('✅ Context compacted! Continue your conversation.', 'success', 5000);

    } catch (err) {
      _errLog(err);
      _toast(`❌ ${err.message}`, 'error', 9000);
    } finally {
      _btnLoading(btn, false);
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  BUTTON
   *  Confirmed working from Script D — correct injection position.
   *  "More actions" button itself has data-headlessui-state,
   *  so closest() returns the button; its parentNode is the
   *  wrapper div where our button lives alongside it.
   * ══════════════════════════════════════════════════════════════ */
  const ICON = `<svg class="w-[18px] h-[18px]" viewBox="0 0 18 18"
    fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round">
    <line x1="2"  y1="4.5"  x2="10" y2="4.5"/>
    <line x1="2"  y1="7.5"  x2="8"  y2="7.5"/>
    <line x1="2"  y1="10.5" x2="10" y2="10.5"/>
    <line x1="2"  y1="13.5" x2="8"  y2="13.5"/>
    <polyline points="12.5,6 15.5,9 12.5,12"/>
    <line x1="15.5" y1="9" x2="11" y2="9"/>
  </svg>`;

  const SPIN = `<svg class="w-[16px] h-[16px] animate-spin"
    viewBox="0 0 24 24" fill="none">
    <circle class="opacity-25" cx="12" cy="12" r="10"
      stroke="currentColor" stroke-width="4"/>
    <path class="opacity-75" fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>`;

  const BTN_CLS = [
    'w-9 justify-center',
    'dark:hover:bg-white/20 dark:active:bg-white/25 dark:disabled:text-neutral-500',
    'hover:bg-slate-900/20 active:bg-slate-900/25 disabled:text-neutral-400',
    'focus-visible:outline-offset-2 focus-visible:outline-slate-500',
    'text-slate-900 dark:text-white',
    'inline-flex items-center rounded-lg h-9 transition-all font-semibold text-xs',
  ].join(' ');

  function _btnLoading(btn, on) {
    if (on)  { btn.disabled = true;  btn._h = btn.innerHTML; btn.innerHTML = SPIN; }
    else     { btn.disabled = false; if (btn._h) { btn.innerHTML = btn._h; delete btn._h; } }
  }

  function _injectBtn() {
    if (document.querySelector(`[${ATTR}]`)) return true;
    const header  = document.querySelector('[data-element-id="chat-space-beginning-part"]');
    if (!header)  return false;

    // The "More actions" button itself has data-headlessui-state (confirmed Script D).
    // closest() returns the button itself; insertBefore puts our button before it
    // inside its parent div — exactly where the DOM shows it working.
    const moreTrigger = header.querySelector('[data-tooltip-content="More actions"]');
    if (!moreTrigger) return false;

    const insertBefore = moreTrigger.closest('[data-headlessui-state]') ?? moreTrigger;

    const btn = document.createElement('button');
    btn.setAttribute(ATTR, '1');
    btn.setAttribute('data-tooltip-id', 'global');
    btn.setAttribute('data-tooltip-content', 'Compact Context — Summarise & Reset (⌘⌥K)');
    btn.className = BTN_CLS;
    btn.innerHTML = ICON;
    btn.addEventListener('click', () => _doCompact(btn));

    insertBefore.parentNode.insertBefore(btn, insertBefore);
    return true;
  }

  /* ── Keyboard shortcut: ⌘⌥K (Mac) / Ctrl+Alt+K ─────────────── */
  document.addEventListener('keydown', e => {
    const mac = /Mac/i.test(navigator.platform ?? navigator.userAgent ?? '');
    if ((mac ? e.metaKey : e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.querySelector(`[${ATTR}]`)?.click();
    }
  });

  /* ══════════════════════════════════════════════════════════════
   *  TOAST
   * ══════════════════════════════════════════════════════════════ */
  const _PAL = {
    info   : 'rgba(59,130,246,.93)',
    success: 'rgba(22,163,74,.93)',
    warn   : 'rgba(202,138,4,.93)',
    error  : 'rgba(220,38,38,.93)',
  };
  let _tid = null;
  function _toast(msg, type = 'info', ms = 3400) {
    let el = document.getElementById(`${ID}-toast`);
    if (!el) {
      el = document.createElement('div');
      el.id = `${ID}-toast`;
      el.style.cssText =
        'position:fixed;bottom:76px;left:50%;transform:translateX(-50%);' +
        'z-index:99999;padding:8px 20px;border-radius:8px;font-size:13px;' +
        'font-weight:500;pointer-events:none;transition:opacity .3s ease;' +
        'max-width:90vw;color:#fff;white-space:nowrap;text-align:center;' +
        'opacity:0;box-shadow:0 4px 16px rgba(0,0,0,.35);';
      document.body.appendChild(el);
    }
    el.style.background = _PAL[type] ?? _PAL.info;
    el.textContent      = msg;
    el.style.opacity    = '1';
    clearTimeout(_tid);
    _tid = setTimeout(() => { el.style.opacity = '0'; }, ms);
  }

  /* ══════════════════════════════════════════════════════════════
   *  LOGGING
   * ══════════════════════════════════════════════════════════════ */
  const _P    = `[${ID} v${VERSION}]`;
  const _log    = (...a) => console.info(_P,  ...a);
  const _warnLog = (...a) => console.warn(_P, ...a);
  const _errLog  = (...a) => console.error(_P, ...a);

  /* ══════════════════════════════════════════════════════════════
   *  DEBUG HELPER  (run window.__tmcc_debug() in console anytime)
   * ══════════════════════════════════════════════════════════════ */
  window.__tmcc_debug = () => {
    const cs = _chatState();
    console.group(_P + ' Debug');
    console.log('_BASE      :', _BASE);
    console.log('_CHAT_CFGS :', JSON.parse(JSON.stringify(_CHAT_CFGS)));
    console.log('chatID (fiber):', cs?.s?.chatID);
    console.log('chatID (hash) :', (location.hash.match(/#chat=([^&]+)/) || [])[1]);
    console.log('cfg for chat  :', _CHAT_CFGS[cs?.s?.chatID] ?? '(none captured yet)');
    console.log('msg count (fiber):', cs?.s?.messages?.length);
    console.groupEnd();
  };

  /* ══════════════════════════════════════════════════════════════
   *  BOOT
   * ══════════════════════════════════════════════════════════════ */
  function _boot() {
    _hookFetch();   // must be FIRST — before TM fires any requests

    if (!_injectBtn()) {
      const obs = new MutationObserver(() => { if (_injectBtn()) obs.disconnect(); });
      obs.observe(document.body, { childList: true, subtree: true });
    }

    // Re-inject after chat navigation (header rebuilt when switching chats)
    new MutationObserver(() => {
      if (!document.querySelector(`[${ATTR}]`)) _injectBtn();
    }).observe(document.body, { childList: true, subtree: true });

    _log(`Loaded — send any message to initialise API capture.`);
  }

  _boot();
})();
