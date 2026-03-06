// ================================================================
//  TypingMind — Compact Context Extension                v1.1.0
// ================================================================
//
//  FIXES vs v1.0.0:
//  • No longer injects hardcoded temperature — was causing 400
//    on reasoning models (OpenAI gpt-5.x, o-series, Anthropic
//    extended-thinking) that reject temperature or require 1.0
//  • Now captures and replays reasoning_effort, thinking, and ALL
//    other model-specific params from TM's own request body
//  • Removed if(!API_CFG) gate — updates on every request so
//    per-chat model switches are always reflected
//  • Stores config per-chatID so the right model+params are used
//    regardless of which chat was last active
//
//  INSTALL: Preferences → Advanced Settings → Extensions → URL
//  FIRST RUN: Send any message; then click 🗜 or press ⌘⌥K
// ================================================================

(() => {
  'use strict';

  /* ── IDENTITY ──────────────────────────────────────────────── */
  const ID      = 'tm-ctx-compact';
  const VERSION = '1.1.0';
  const ATTR    = `data-${ID}`;
  const MAX_CHARS = 80_000;

  /* ── PROMPT ────────────────────────────────────────────────── */
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
   *
   *  Design goals:
   *   1. Save _origFetch BEFORE installing any hook so our own
   *      summarisation calls always bypass every interceptor.
   *   2. Always update on every chat API call (no one-shot gate)
   *      so model changes are reflected immediately.
   *   3. Capture the FULL request body params — not just model/key.
   *      This is the fix for the 400: reasoning_effort, thinking,
   *      temperature (or the absence of it), max_completion_tokens
   *      etc. are stored and replayed verbatim.
   *   4. Store both a global "latest" and a per-chatID record so
   *      compaction always uses the right model for *this* chat.
   * ══════════════════════════════════════════════════════════════ */

  // Saved BEFORE we install our hook — used for our OWN API calls
  // so they never re-enter the interceptor.
  const _RAW_FETCH = window.fetch.bind(window);

  // Global: endpoint + auth (provider-level; same across chats of same provider)
  let _BASE = null;   // { url, hdrs }

  // Per-chat: model name + model-specific body params
  // Key: chatID string  (matches cs.s.chatID and URL hash value)
  // Value: { model, params, ts }
  let _CHAT_CFGS = {};

  // ── Restore persisted data across page reloads ──
  try {
    const b = localStorage.getItem(`${ID}_base`);
    if (b) _BASE = JSON.parse(b);
    const c = localStorage.getItem(`${ID}_chats`);
    if (c) _CHAT_CFGS = JSON.parse(c);
  } catch (_) {}

  /**
   * Installs the fetch wrapper.  Must be called early so it
   * catches TM's very first chat request.
   */
  function _hookFetch() {
    const _prev = window.fetch;   // chain through any earlier wrappers
    window.fetch = function (url, opts = {}) {
      if (opts?.method === 'POST') {
        const u = String(url);
        // Match all common LLM completion endpoints
        if (/\/(chat\/completions|messages|responses)([?#]|$)/.test(u)) {
          try {
            const body = JSON.parse(
              typeof opts.body === 'string' ? opts.body : '{}'
            );
            const hdrs = opts.headers ?? {};
            const auth = (hdrs.Authorization ?? hdrs.authorization ?? '')
                           .replace(/^Bearer\s+/i, '').trim();

            if (body.model && auth) {
              // ── Update provider-level config ──────────────────
              _BASE = { url: u, hdrs: _safeHdrs(hdrs) };
              localStorage.setItem(`${ID}_base`, JSON.stringify(_BASE));

              // ── Capture chatID from URL hash ──────────────────
              // URL hash is #chat=<id> while a chat is open
              const chatID = (location.hash.match(/#chat=([^&]+)/) || [])[1]
                             || '_latest';

              // ── Store per-chat model + ALL model-specific params ─
              const entry = {
                model  : body.model,
                params : _pickParams(body),  // ← the critical fix
                ts     : Date.now(),
              };
              _CHAT_CFGS[chatID]    = entry;
              _CHAT_CFGS['_latest'] = entry;  // always keep a fallback

              // Prune to 40 entries to avoid storage bloat
              const sorted = Object.entries(_CHAT_CFGS)
                .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
              if (sorted.length > 40) {
                _CHAT_CFGS = Object.fromEntries(sorted.slice(0, 40));
              }
              localStorage.setItem(`${ID}_chats`, JSON.stringify(_CHAT_CFGS));

              _log(`Captured: model=${body.model} chatID=${chatID}`,
                   `params=${JSON.stringify(entry.params)}`);
            }
          } catch (_) { /* never throw from interceptor */ }
        }
      }
      return _prev.apply(this, arguments);
    };
  }

  /**
   * Extract every model-specific parameter TM sends that we must
   * replay to avoid 400 errors.
   *
   *   reasoning_effort  – OpenAI o-series + gpt-5.x "heavy/xhigh/etc."
   *   thinking          – Anthropic extended thinking object
   *   temperature       – only present when the model supports it;
   *                       ABSENCE is intentional (reasoning models)
   *   max_completion_tokens / max_tokens  – provider-specific key
   *
   * Deliberately EXCLUDED (would conflict with summarisation):
   *   messages, stream, n, stop, seed, logit_bias, logprobs,
   *   response_format (we need markdown, not JSON mode)
   */
  function _pickParams(body) {
    const CARRY = [
      // Sampling — only present when the model accepts them
      'temperature', 'top_p', 'top_k',
      'frequency_penalty', 'presence_penalty',
      // Reasoning controls — CRITICAL for reasoning models
      'reasoning_effort',  // OpenAI / OpenRouter
      'thinking',          // Anthropic extended thinking
      // Token limits — need the right key for the right provider
      'max_tokens',
      'max_completion_tokens',
      // Provider-specific extras TM may set
      'tool_choice', 'parallel_tool_calls',
      'user',
    ];
    const out = {};
    for (const k of CARRY) {
      if (body[k] !== undefined) out[k] = body[k];
    }
    return out;
  }

  function _safeHdrs(h) {
    const KEEP = new Set([
      'authorization', 'x-api-key',
      'http-referer', 'x-title',
      'anthropic-version',
      'x-goog-api-key',
      'openai-organization',
      'x-openrouter-meta',
    ]);
    return Object.fromEntries(
      Object.entries(h).filter(([k]) => KEEP.has(k.toLowerCase()))
    );
  }

  /* ══════════════════════════════════════════════════════════════
   *  REACT FIBER  (identical to chat_user_msg_preview.js)
   * ══════════════════════════════════════════════════════════════ */
  function _chatState() {
    const el = document.querySelector(
      '[data-element-id="chat-space-middle-part"]'
    );
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
   *  INDEXEDDB
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
   * ══════════════════════════════════════════════════════════════ */
  function _toText(c) {
    if (!c)                    return '';
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(b => {
      if (typeof b === 'string')       return b;
      if (b?.type === 'text')          return b.text ?? '';
      if (b?.type === 'tool_use')      return `[Tool: ${b.name}(${JSON.stringify(b.input ?? {})})]`;
      if (b?.type === 'tool_result')   return `[Result: ${JSON.stringify(b.content ?? '')}]`;
      if (b?.type === 'image_url')     return '[image]';
      if (b?.type === 'image')         return '[image]';
      if (b?.type === 'thinking')      return `[Thinking: ${(b.thinking ?? '').slice(0, 400)}…]`;
      return b?.text ?? b?.content ?? '';
    }).join('\n');
    if (typeof c === 'object') return c.text ?? c.content ?? JSON.stringify(c);
    return String(c);
  }

  function _buildTranscript(messages, rec) {
    const lines = [
      '===== CONVERSATION TRANSCRIPT =====',
      `Title : ${rec?.chatTitle ?? '(untitled)'}`,
      `Model : ${rec?.model ?? '(unknown)'}`,
      `Messages: ${messages.filter(m => m.role).length}`,
    ];
    const sys = rec?.chatParams?.systemMessage;
    if (sys) lines.push(`\n[SYSTEM INSTRUCTION]\n${sys}`);

    let n = 0;
    for (const m of messages) {
      if (m.type === 'clear-context') {
        lines.push('\n── [CONTEXT CLEARED HERE] ──\n');
        continue;
      }
      const r = (m.role ?? '').toLowerCase();
      if (!r) continue;

      const label =
        r === 'user'      ? '👤 USER'        :
        r === 'assistant' ? '🤖 ASSISTANT'   :
        r === 'tool'      ? '🔧 TOOL RESULT' :
        r === 'system'    ? '⚙️  SYSTEM'      : r.toUpperCase();

      let body = _toText(m.content);
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        m.tool_calls.forEach(tc => {
          const nm = tc.function?.name ?? tc.name ?? '?';
          const ar = tc.function?.arguments ?? tc.arguments ?? '{}';
          body += `\n[Tool Call: ${nm}(${typeof ar === 'string' ? ar : JSON.stringify(ar)})]`;
        });
      }
      if (!body.trim()) continue;
      lines.push(`\n[${++n}] ${label}:\n${body}`);
    }
    lines.push(`\n===== END (${n} messages) =====`);
    return lines.join('\n');
  }

  /* ══════════════════════════════════════════════════════════════
   *  API CALL
   *
   *  Core fix: build request body by starting from the CAPTURED
   *  per-chat params and only overriding three things:
   *    1. stream  → false        (we need a single JSON response)
   *    2. messages → our content (the summarisation job)
   *    3. token limit → at least 8192 (ensure adequate output)
   *
   *  Everything else — reasoning_effort, thinking, temperature (or
   *  its absence for reasoning models) — comes straight from what
   *  TM itself sends for this model/chat.
   * ══════════════════════════════════════════════════════════════ */
  async function _callLLM(transcript, chatID) {
    if (!_BASE) {
      throw new Error(
        'No API config yet — send one message in this chat first, then retry.'
      );
    }

    // Look up per-chat config — fall back to globally latest
    const cfg = _CHAT_CFGS[chatID] ?? _CHAT_CFGS['_latest'] ?? null;
    if (!cfg?.model) {
      throw new Error(
        'No model captured for this chat. Send one message first, then retry.'
      );
    }

    const { model, params } = cfg;

    // ── Token limit handling ──────────────────────────────────
    // Carry the key TM uses (max_tokens OR max_completion_tokens);
    // ensure our minimum of 8192 for a complete summary.
    const base = { ...params };   // copy so we can mutate safely
    const usesCompletionKey = base.max_completion_tokens !== undefined;
    const tokenKey = usesCompletionKey ? 'max_completion_tokens' : 'max_tokens';
    const tokenVal = Math.max(base[tokenKey] ?? 0, 8192);
    delete base.max_tokens;
    delete base.max_completion_tokens;

    // ── Assemble request body ─────────────────────────────────
    // IMPORTANT: no hardcoded temperature, no hardcoded n, nothing
    // extra that the model hasn't already accepted from TM.
    const reqBody = {
      ...base,              // reasoning_effort, thinking, temperature (if any), etc.
      model,
      stream     : false,
      [tokenKey] : tokenVal,
      messages   : [
        { role: 'system', content: PROMPT },
        {
          role    : 'user',
          content :
            '[CONVERSATION_CONTEXT_LIMIT_REACHED]\n\n'              +
            'Summarise the following conversation strictly per your '  +
            'system instructions above.\n\n'                          +
            transcript,
        },
      ],
    };

    _log('→ API call', model, JSON.stringify(base));

    const res = await _RAW_FETCH(_BASE.url, {
      method  : 'POST',
      headers : { ..._BASE.hdrs, 'Content-Type': 'application/json' },
      body    : JSON.stringify(reqBody),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      // Log full request body to console to help diagnose future issues
      _errLog(
        `400 Body sent:\n${JSON.stringify(reqBody, null, 2)}\n` +
        `Response: ${detail.slice(0, 600)}`
      );
      throw new Error(`API ${res.status} — ${detail.slice(0, 200)}`);
    }

    const data = await res.json();

    const text =
      // OpenAI / OpenRouter
      data?.choices?.[0]?.message?.content
      // Anthropic
      ?? Array.isArray(data?.content)
        ? data.content.find(b => b?.type === 'text')?.text
        : null
      // Gemini
      ?? data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text?.trim()) {
      throw new Error(
        'LLM returned empty content. Raw: ' + JSON.stringify(data).slice(0, 300)
      );
    }
    return text;
  }

  /* ══════════════════════════════════════════════════════════════
   *  STATE MUTATION
   *  Inserts clear-context marker + summary via React dispatch
   *  and IDB — no UI clicks involved.
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
      `> All prior messages summarised and cleared from the active context.\n` +
      `> This summary is the new starting point. Continue your conversation.\n\n` +
      `---\n\n`;

    const updated = [
      ...s.messages,
      // clear-context marker ← tells TM to exclude all prior messages
      { uuid: _uid(), type: 'clear-context', createdAt: now },
      // summary as assistant message ← visible and in active context
      {
        uuid                 : _uid(),
        role                 : 'assistant',
        content              : header + rawSummary,
        createdAt            : now,
        [`${ID}_compaction`] : true,
      },
    ];

    // 1. Update live React state (re-renders chat immediately)
    try { d?.({ ...s, messages: updated, updatedAt: now }); }
    catch (e) { _warnLog('dispatch failed (IDB will still persist):', e.message); }

    // 2. Persist to IDB (survives page reload)
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

    _btnState(btn, true);
    try {

      _toast('📖 Reading conversation…', 'info');
      const rec = await _getChat(cs.s.chatID);

      let tx = _buildTranscript(msgs, rec);
      if (tx.length > MAX_CHARS) {
        const cut = tx.length - MAX_CHARS;
        tx =
          `[…${cut.toLocaleString()} chars of earlier history omitted]\n\n` +
          tx.slice(-MAX_CHARS);
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
      _btnState(btn, false);
    }
  }

  /* ══════════════════════════════════════════════════════════════
   *  BUTTON
   * ══════════════════════════════════════════════════════════════ */

  // Text-lines-→-arrow icon; 18×18 viewport matches TM's own icons
  const ICON = `<svg class="w-[18px] h-[18px]" viewBox="0 0 18 18"
    fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg">
    <line x1="2"  y1="4.5"  x2="10" y2="4.5"/>
    <line x1="2"  y1="7.5"  x2="8"  y2="7.5"/>
    <line x1="2"  y1="10.5" x2="10" y2="10.5"/>
    <line x1="2"  y1="13.5" x2="8"  y2="13.5"/>
    <polyline points="12.5,6 15.5,9 12.5,12"/>
    <line x1="15.5" y1="9" x2="11" y2="9"/>
  </svg>`;

  const SPIN = `<svg class="w-[16px] h-[16px] animate-spin"
    viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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

  function _btnState(btn, loading) {
    if (loading) {
      btn.disabled  = true;
      btn._orig     = btn.innerHTML;
      btn.innerHTML = SPIN;
    } else {
      btn.disabled  = false;
      if (btn._orig) { btn.innerHTML = btn._orig; delete btn._orig; }
    }
  }

  function _injectBtn() {
    if (document.querySelector(`[${ATTR}]`)) return true;

    const header = document.querySelector(
      '[data-element-id="chat-space-beginning-part"]'
    );
    if (!header) return false;

    // The "⋯ More actions" trigger sits inside a headlessui wrapper div.
    // We insert our button before that wrapper so it slots neatly into
    // the flex row alongside TM's own header buttons.
    const trigger = header.querySelector('[data-tooltip-content="More actions"]');
    if (!trigger) return false;

    const wrapper = trigger.closest('[data-headlessui-state]') ?? trigger;

    const btn = document.createElement('button');
    btn.setAttribute(ATTR, '1');
    btn.setAttribute('data-tooltip-id', 'global');
    btn.setAttribute(
      'data-tooltip-content',
      'Compact Context — Summarise & Reset (⌘⌥K)'
    );
    btn.className = BTN_CLS;
    btn.innerHTML = ICON;
    btn.addEventListener('click', () => _doCompact(btn));

    wrapper.parentNode.insertBefore(btn, wrapper);
    return true;
  }

  /* ── Keyboard shortcut  ⌘⌥K / Ctrl+Alt+K ──────────────────── */
  document.addEventListener('keydown', e => {
    const mac = /Mac/i.test(navigator.platform ?? navigator.userAgent ?? '');
    const hit = mac
      ? e.metaKey && e.altKey && e.key.toLowerCase() === 'k'
      : e.ctrlKey && e.altKey && e.key.toLowerCase() === 'k';
    if (!hit) return;
    e.preventDefault();
    document.querySelector(`[${ATTR}]`)?.click();
  });

  /* ══════════════════════════════════════════════════════════════
   *  TOAST
   * ══════════════════════════════════════════════════════════════ */
  const COLORS = {
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
    el.style.background = COLORS[type] ?? COLORS.info;
    el.textContent      = msg;
    el.style.opacity    = '1';
    clearTimeout(_tid);
    _tid = setTimeout(() => { el.style.opacity = '0'; }, ms);
  }

  /* ══════════════════════════════════════════════════════════════
   *  LOGGING  (prefixed for easy DevTools filtering)
   * ══════════════════════════════════════════════════════════════ */
  const P = `[${ID} v${VERSION}]`;
  const _log    = (...a) => console.info(P,  ...a);
  const _warnLog = (...a) => console.warn(P, ...a);
  const _errLog  = (...a) => console.error(P, ...a);

  /* ══════════════════════════════════════════════════════════════
   *  DEBUG HELPER  (call from DevTools console if needed)
   *  window.__tmcc_debug()  — prints what the extension has captured
   * ══════════════════════════════════════════════════════════════ */
  window.__tmcc_debug = () => {
    console.group(`${P} Debug`);
    console.log('_BASE   :', _BASE);
    console.log('_CHAT_CFGS:', _CHAT_CFGS);
    const cs = _chatState();
    console.log('chatState chatID:', cs?.s?.chatID);
    console.log('current chat cfg:', _CHAT_CFGS[cs?.s?.chatID] ?? '(none yet)');
    console.groupEnd();
  };

  /* ══════════════════════════════════════════════════════════════
   *  BOOT
   * ══════════════════════════════════════════════════════════════ */
  function _boot() {
    _hookFetch();   // must be first — hooks window.fetch before TM fires

    if (!_injectBtn()) {
      const obs = new MutationObserver(() => { if (_injectBtn()) obs.disconnect(); });
      obs.observe(document.body, { childList: true, subtree: true });
    }
    // Re-inject on chat navigation (header is torn down and rebuilt)
    new MutationObserver(() => {
      if (!document.querySelector(`[${ATTR}]`)) _injectBtn();
    }).observe(document.body, { childList: true, subtree: true });

    _log(`Loaded — send any message to initialise per-chat API capture.`);
  }

  _boot();
})();
