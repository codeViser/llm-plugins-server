// ================================================================
//  TypingMind — Compact Context Extension                v1.5.0
// ================================================================
//
//  ROOT CAUSE (confirmed by G3 debug data):
//  TM's native Clear Context correctly excludes pre-clear messages
//  from API calls in-session (G3: only 2 messages sent). But on
//  reload, TM rebuilds state from IDB without re-deriving the
//  context-start index from the {clear-context} marker. Filtering
//  resets to "include everything."
//
//  THE FIX: A fetch interceptor filter that reads LIVE React state
//  on every outgoing API call, finds the last {type:'clear-context'}
//  marker, and trims the messages array to only include post-clear
//  content. This runs on every call, every page load, independently
//  of TM's internal session state.
//
//  KEY PROPERTY: if nonSystem.length <= keepCount+1 (TM already
//  filtered correctly in-session), the filter is a no-op. It only
//  acts when TM sends more messages than it should on reload.
//
// ================================================================

(() => {
  'use strict';

  const ID      = 'tm-ctx-compact';
  const VERSION = '1.5.0';
  const ATTR    = `data-${ID}`;

  const MAX_CHARS  = 80_000;
  const TOOL_MAX   = 1_500;
  const CLEAR_POLL = 80;      // ms between polls after triggering Clear Context
  const CLEAR_WAIT = 4_000;   // max ms to wait

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
   *  FETCH HOOK  —  config capture  +  reload context filter
   * ══════════════════════════════════════════════════════════════ */
  const _RAW = window.fetch.bind(window);

  let _BASE      = null;
  let _CHAT_CFGS = {};

  try {
    const b = localStorage.getItem(`${ID}_base`);  if (b) _BASE      = JSON.parse(b);
    const c = localStorage.getItem(`${ID}_chats`); if (c) _CHAT_CFGS = JSON.parse(c);
  } catch (_) {}

  /* ──────────────────────────────────────────────────────────────
   *  _applyReloadFilter
   *
   *  Called on every outgoing API call. Uses live React state to:
   *  1. Find the last {type:'clear-context'} marker in the current
   *     chat's message array.
   *  2. Count how many post-clear messages exist in React state
   *     (the "keepCount" — summary + any subsequent exchanges).
   *  3. If the outgoing API body has MORE non-system messages than
   *     keepCount+1, trim back to the last keepCount+1.
   *     (keepCount from React state + 1 for the current user msg)
   *
   *  The guard condition `nonSystem.length <= keepCount + 1` ensures
   *  this is a no-op when TM already filtered correctly in-session.
   *  It only activates when TM sends more than it should (reload).
   *
   *  This approach is self-calibrating: as the user adds more
   *  messages post-compaction, keepCount grows automatically because
   *  React state always reflects the current message array.
   * ────────────────────────────────────────────────────────────── */
  function _applyReloadFilter(reqBody) {
    const msgs = reqBody?.messages;
    if (!Array.isArray(msgs) || msgs.length === 0) return reqBody;

    // Read live React state — the ground truth for current messages
    const cs = _chatState();
    const liveMsgs = cs?.s?.messages;
    if (!Array.isArray(liveMsgs) || liveMsgs.length === 0) return reqBody;

    // Find the last clear-context marker (most recent compaction point)
    let lastClearIdx = -1;
    for (let i = liveMsgs.length - 1; i >= 0; i--) {
      if (liveMsgs[i].type === 'clear-context') { lastClearIdx = i; break; }
    }
    if (lastClearIdx < 0) return reqBody; // No compaction in this chat — pass through

    // Count post-clear messages that have a role (= valid chat turns)
    const keepCount = liveMsgs.slice(lastClearIdx + 1).filter(m => m.role).length;

    // Split incoming API messages
    const sysMsgs   = msgs.filter(m => m.role === 'system');
    const nonSystem = msgs.filter(m => m.role !== 'system');

    // keepCount (post-clear in IDB/state) + 1 (current outgoing user message)
    const keepTotal = keepCount + 1;

    // Guard: if TM already sent the right amount (in-session correct state),
    // nonSystem.length === keepTotal. Don't touch it.
    if (nonSystem.length <= keepTotal) return reqBody;

    // Reload case: TM sent too many (all pre-clear messages included).
    // Trim to the last keepTotal non-system messages.
    const filtered = [...sysMsgs, ...nonSystem.slice(-keepTotal)];
    _log(`↩ Filter: ${nonSystem.length} → ${filtered.length - sysMsgs.length} non-sys msgs`
        + ` (keepCount=${keepCount}, chatID=${cs.s.chatID})`);
    return { ...reqBody, messages: filtered };
  }

  function _hookFetch() {
    const _prev = window.fetch;
    window.fetch = function (url, opts = {}) {
      if (opts?.method === 'POST') {
        const u = String(url);
        if (/\/(chat\/completions|messages|responses)([?#]|$)/.test(u)) {
          try {
            let body = JSON.parse(typeof opts.body === 'string' ? opts.body : '{}');
            const hdrs = opts.headers ?? {};
            const auth = (hdrs.Authorization ?? hdrs.authorization ?? '')
                           .replace(/^Bearer\s+/i, '').trim();

            // ── Capture API config ──────────────────────────────
            if (body.model && auth) {
              _BASE = { url: u, hdrs: _safeHdrs(hdrs) };
              localStorage.setItem(`${ID}_base`, JSON.stringify(_BASE));
              const chatID = (location.hash.match(/#chat=([^&]+)/) || [])[1] || '_latest';
              const entry  = { model: body.model, params: _pickParams(body), ts: Date.now() };
              _CHAT_CFGS[chatID]    = entry;
              _CHAT_CFGS['_latest'] = entry;
              const sorted = Object.entries(_CHAT_CFGS)
                .sort((a, b) => (b[1].ts||0) - (a[1].ts||0));
              if (sorted.length > 40) _CHAT_CFGS = Object.fromEntries(sorted.slice(0,40));
              localStorage.setItem(`${ID}_chats`, JSON.stringify(_CHAT_CFGS));
              _log(`Captured: model=${body.model} chatID=${chatID}`);
            }

            // ── Apply reload context filter ─────────────────────
            // This is the core fix: ensures pre-clear messages are
            // never sent to the API, even after a page reload.
            const filtered = _applyReloadFilter(body);
            if (filtered !== body) {
              return _prev.call(this, url, { ...opts, body: JSON.stringify(filtered) });
            }
          } catch (_) {}
        }
      }
      return _prev.apply(this, arguments);
    };
  }

  function _pickParams(body) {
    const KEEP = ['temperature','top_p','top_k','frequency_penalty','presence_penalty',
                  'reasoning_effort','thinking','max_tokens','max_completion_tokens','user'];
    const out = {};
    for (const k of KEEP) if (body[k] !== undefined) out[k] = body[k];
    return out;
  }

  function _safeHdrs(h) {
    const K = new Set(['authorization','x-api-key','http-referer','x-title',
                       'anthropic-version','x-goog-api-key','openai-organization']);
    return Object.fromEntries(Object.entries(h).filter(([k]) => K.has(k.toLowerCase())));
  }

  /* ══════════════════════════════════════════════════════════════
   *  BOOTSTRAP FROM LOCALSTORAGE  (no dummy message needed)
   * ══════════════════════════════════════════════════════════════ */
  async function _tryBootstrap(chatRecord) {
    const chatID = chatRecord?.chatID ?? chatRecord?.id;
    if (_BASE && (_CHAT_CFGS[chatID] ?? _CHAT_CFGS['_latest'])) return;
    try {
      const customs = JSON.parse(localStorage.getItem('TM_useCustomModels') || '[]');
      if (!customs.length) return;
      const uuid   = chatRecord?.model;
      const chatCM = uuid ? customs.find(c => c.id === uuid) : null;
      const anyCM  = chatCM || customs.find(c => c.modelID?.includes('/')) || customs[0];
      if (!anyCM) return;
      let apiUrl = anyCM.endpoint || null, apiKey = null;
      for (const row of (anyCM.bodyRows || [])) {
        const k = (row.key ?? row.header ?? row.name ?? '').toLowerCase();
        const v = String(row.value ?? row.val ?? '');
        if (!apiKey && (k === 'authorization' || k === 'x-api-key'))
          apiKey = v.replace(/^Bearer\s+/i, '').trim();
        if (!apiUrl && (k === 'baseurl' || k === 'endpoint' || k === 'base_url'))
          apiUrl = v.trim();
      }
      if (!apiUrl && anyCM.modelID?.includes('/'))
        apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
      if (!apiUrl || !apiKey) return;
      if (!apiUrl.includes('completions'))
        apiUrl = apiUrl.replace(/\/+$/, '') + '/chat/completions';
      if (!_BASE) {
        _BASE = { url: apiUrl,
                  hdrs: { 'Authorization': `Bearer ${apiKey}`,
                          'X-Title': 'TypingMind.com',
                          'HTTP-Referer': 'https://www.typingmind.com' } };
        localStorage.setItem(`${ID}_base`, JSON.stringify(_BASE));
        _log('Bootstrapped BASE from localStorage');
      }
      const chatP = chatRecord?.chatParams ?? {};
      const defP  = JSON.parse(localStorage.getItem('TM_useDefaultModelParameters') || '{}');
      const defRE = JSON.parse(localStorage.getItem('TM_useDefaultReasoningEffort') || '"medium"');
      const params = {};
      const temp = chatP.temperature ?? defP.temperature;
      if (temp != null) params.temperature = temp;
      const topP = chatP.topP ?? defP.topP;
      if (topP != null) params.top_p = topP;
      params.reasoning_effort      = defRE;
      params.max_completion_tokens = parseInt(chatP.maxTokens ?? defP.maxTokens ?? '100000') || 100000;
      params.frequency_penalty     = chatP.frequencyPenalty ?? defP.frequencyPenalty ?? 0;
      params.presence_penalty      = chatP.presencePenalty  ?? defP.presencePenalty  ?? 0;
      const model = (chatCM || anyCM).modelID;
      if (model && chatID && !_CHAT_CFGS[chatID]) {
        const entry = { model, params, ts: Date.now() };
        _CHAT_CFGS[chatID]    = entry;
        _CHAT_CFGS['_latest'] = entry;
        localStorage.setItem(`${ID}_chats`, JSON.stringify(_CHAT_CFGS));
        _log('Bootstrapped per-chat model:', model);
      }
    } catch (e) { _warnLog('Bootstrap failed:', e.message); }
  }

  /* ══════════════════════════════════════════════════════════════
   *  REACT FIBER
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
        if (v && typeof v === 'object' && !Array.isArray(v) &&
            Array.isArray(v.messages) && v.chatID)
          return { s: v, d: hs.queue?.dispatch };
      }
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════
   *  IDB
   * ══════════════════════════════════════════════════════════════ */
  const _idb = () => new Promise((ok,no) => {
    const r = indexedDB.open('keyval-store');
    r.onsuccess = e => ok(e.target.result); r.onerror = () => no(r.error);
  });

  async function _getChat(chatID) {
    const db = await _idb();
    return new Promise((ok,no) => {
      const req = db.transaction('keyval','readonly').objectStore('keyval').get(`CHAT_${chatID}`);
      req.onsuccess = () => { db.close(); ok(req.result ?? null); };
      req.onerror   = () => { db.close(); no(req.error); };
    });
  }

  async function _putChat(chatID, messages) {
    const db = await _idb();
    return new Promise((ok,no) => {
      const st  = db.transaction('keyval','readwrite').objectStore('keyval');
      const key = `CHAT_${chatID}`;
      const g   = st.get(key);
      g.onsuccess = () => {
        if (!g.result) { db.close(); ok(); return; }
        const w = st.put({ ...g.result, messages, updatedAt: new Date().toISOString() }, key);
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
    if (c === null || c === undefined) return '';
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(b => {
      if (typeof b === 'string')     return b;
      if (b?.type === 'text')        return b.text ?? '';
      if (b?.type === 'tool_use')    return `[Tool: ${b.name}(${JSON.stringify(b.input??{})})]`;
      if (b?.type === 'tool_result') return `[Result: ${JSON.stringify(b.content??'')}]`;
      if (b?.type === 'thinking')    return '';
      if (b?.type === 'image_url' || b?.type === 'image') return '[image]';
      return b?.text ?? b?.content ?? '';
    }).join('\n').trim();
    if (typeof c === 'object') return c.text ?? c.content ?? JSON.stringify(c);
    return String(c);
  }

  function _buildTranscript(messages, rec) {
    const lines = [
      '===== CONVERSATION TRANSCRIPT =====',
      `Title   : ${rec?.chatTitle ?? '(untitled)'}`,
      `Messages: ${messages.filter(m => m.role || m.type === 'clear-context').length}`,
    ];
    const sys = rec?.chatParams?.systemMessage;
    if (sys) lines.push(`\n[SYSTEM INSTRUCTION]\n${sys.slice(0,800)}${sys.length>800?'…':''}`);
    let n = 0;
    for (const m of messages) {
      if (m.type === 'clear-context') {
        lines.push('\n── [CONTEXT CLEARED HERE] ──\n'); continue;
      }
      const role = (m.role ?? '').toLowerCase();
      if (!role) continue;
      const label =
        role === 'user'      ? '👤 USER'        :
        role === 'assistant' ? '🤖 ASSISTANT'   :
        role === 'tool'      ? '🔧 TOOL RESULT' :
        role === 'system'    ? '⚙️  SYSTEM'      : role.toUpperCase();
      let body = _toText(m.content);
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        m.tool_calls.forEach(tc => {
          const nm = tc.function?.name ?? tc.name ?? '?';
          const ar = tc.function?.arguments ?? tc.arguments ?? '{}';
          body += `\n[→ Tool: ${nm}(${typeof ar==='string'?ar:JSON.stringify(ar)})]`;
        });
      }
      if (role === 'tool' && body.length > TOOL_MAX)
        body = body.slice(0,TOOL_MAX) + `\n[…${(body.length-TOOL_MAX).toLocaleString()} chars omitted]`;
      if (!body.trim()) continue;
      lines.push(`\n[${++n}] ${label}:\n${body}`);
    }
    lines.push(`\n===== END (${n} messages) =====`);
    return lines.join('\n');
  }

  /* ══════════════════════════════════════════════════════════════
   *  LLM CALL  (all v1.2.0 fixes retained)
   * ══════════════════════════════════════════════════════════════ */
  async function _callLLM(transcript, chatID) {
    if (!_BASE) throw new Error('No API config. Send one message first, then retry.');
    const cfg = _CHAT_CFGS[chatID] ?? _CHAT_CFGS['_latest'] ?? null;
    if (!cfg?.model) throw new Error('No model config. Send one message first, then retry.');
    const { model, params } = cfg;
    const base = { ...params };
    delete base.tool_choice; delete base.parallel_tool_calls;
    const usesCompletion = base.max_completion_tokens !== undefined;
    const tokenKey = usesCompletion ? 'max_completion_tokens' : 'max_tokens';
    const tokenVal = Math.max(base[tokenKey] ?? 0, 8192);
    delete base.max_tokens; delete base.max_completion_tokens;
    const reqBody = {
      ...base, model, stream: false, [tokenKey]: tokenVal,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user',
          content: '[CONVERSATION_CONTEXT_LIMIT_REACHED]\n\nSummarise the following ' +
                   'conversation strictly per your system instructions.\n\n' + transcript },
      ],
    };
    _log('→ API:', model, JSON.stringify(base));
    const res = await _RAW(_BASE.url, {
      method: 'POST', headers: { ..._BASE.hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) {
      let d = ''; try { d = await res.text(); } catch(_) {}
      _errLog('Failed body:\n', JSON.stringify(reqBody,null,2));
      throw new Error(`API ${res.status} — ${d.slice(0,250)}`);
    }
    const data = await res.json();
    // v1.2.0 paren fix
    const text =
        data?.choices?.[0]?.message?.content
     ?? (Array.isArray(data?.content) ? data.content.find(b => b?.type==='text')?.text : null)
     ?? data?.candidates?.[0]?.content?.parts?.[0]?.text
     ?? null;
    if (!text?.trim()) throw new Error('LLM returned empty. Raw: ' + JSON.stringify(data).slice(0,300));
    return text;
  }

  /* ══════════════════════════════════════════════════════════════
   *  NATIVE CLEAR CONTEXT
   *  Triggers TM's own Clear Context (keyboard shortcut, then
   *  click fallback) for the visual grey-out effect. Polls React
   *  state for confirmation that TM inserted its marker.
   * ══════════════════════════════════════════════════════════════ */
  async function _nativeClearContext(msgCountBefore) {
    const shortcuts = JSON.parse(localStorage.getItem('TM_useKeyboardShortcuts') ?? '{}');
    const clearKey  = shortcuts.clearContext || 'J';
    const isMac     = /Mac/i.test(navigator.platform ?? navigator.userAgent ?? '');

    // Primary: keyboard shortcut
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: clearKey.toLowerCase(), code: `Key${clearKey.toUpperCase()}`,
      metaKey: isMac, ctrlKey: !isMac, altKey: true, bubbles: true, cancelable: true,
    }));

    const afterKbd = await _pollClear(msgCountBefore);
    if (afterKbd) { _log('Clear Context confirmed via keyboard'); return afterKbd; }

    // Fallback: click via dropdown
    _warnLog('Keyboard shortcut did not fire — trying click fallback');
    const moreTrigger = document.querySelector('[data-tooltip-content="More actions"]');
    if (moreTrigger) {
      moreTrigger.click();
      await new Promise(r => setTimeout(r, 200));
      const clearBtn = document.querySelector('[data-element-id="clear-context-button"]');
      if (clearBtn) {
        clearBtn.click();
        await new Promise(r => setTimeout(r, 150));
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    }

    const afterClick = await _pollClear(msgCountBefore);
    if (afterClick) { _log('Clear Context confirmed via click'); return afterClick; }

    _warnLog('Clear Context confirmation timed out — proceeding with current state');
    return _chatState();
  }

  async function _pollClear(msgCountBefore) {
    const deadline = Date.now() + CLEAR_WAIT;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, CLEAR_POLL));
      const cs   = _chatState();
      const msgs = cs?.s?.messages ?? [];
      if (msgs.length > msgCountBefore && msgs[msgs.length-1]?.type === 'clear-context')
        return cs;
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════
   *  APPEND SUMMARY
   *  TM has already inserted {type:'clear-context'} via _nativeClearContext.
   *  We append only the summary message. IDB write includes the
   *  clear-context marker (already in freshCs.s.messages).
   *
   *  We wait briefly before the IDB read to ensure TM's own
   *  saveMessages has had time to write (avoids race condition
   *  where g.result misses TM's updated fields).
   * ══════════════════════════════════════════════════════════════ */
  const _uid = () =>
    crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random()*16|0; return (c==='x'?r:r&3|8).toString(16); });

  async function _appendSummary(cs, rawSummary) {
    if (!cs?.s) { _warnLog('No fresh state after clear'); return; }
    const { s, d } = cs;
    const now = new Date().toISOString();
    const ts  = new Date().toLocaleString();

    const summaryMsg = {
      uuid      : _uid(),
      role      : 'assistant',
      content   :
        `**[🗜️ Context Compaction]** · *${ts}*\n\n` +
        `> Prior context cleared. This summary is now the active context.\n\n` +
        `---\n\n` +
        rawSummary,
      createdAt : now,
    };

    // s.messages already contains [...oldMsgs, {type:'clear-context'}]
    // (confirmed by poll in _nativeClearContext returning only when marker is present)
    const updated = [...s.messages, summaryMsg];

    // Wait 400ms for TM's own saveMessages to finish writing to IDB,
    // so our g.result read picks up any fields TM set during clearContext.
    await new Promise(r => setTimeout(r, 400));

    // IDB write — source of truth for reload and sync
    await _putChat(s.chatID, updated);

    // React dispatch — immediate visual update
    try { d?.({ ...s, messages: updated, updatedAt: now }); }
    catch (e) { _warnLog('dispatch failed:', e.message); }
  }

  /* ══════════════════════════════════════════════════════════════
   *  MAIN ACTION
   * ══════════════════════════════════════════════════════════════ */
  async function _doCompact(btn) {
    const cs = _chatState();
    if (!cs?.s) { _toast('⚠️ No active chat.', 'warn'); return; }

    if (document.querySelector(
        '[data-element-id="stop-generation-button"],[aria-label="Stop generating"]')) {
      _toast('⚠️ Wait for the AI to finish first.', 'warn'); return;
    }

    const msgs     = cs.s.messages;
    const realMsgs = msgs.filter(m => m.role && !m.type);
    if (realMsgs.length < 2) { _toast('ℹ️ Not enough messages.', 'info'); return; }

    if (!_BASE || !(_CHAT_CFGS[cs.s.chatID] ?? _CHAT_CFGS['_latest'])) {
      _toast('⏳ Resolving config…', 'info');
      const rec = await _getChat(cs.s.chatID).catch(() => null);
      await _tryBootstrap(rec ?? { chatID: cs.s.chatID, model: cs.s.model });
    }
    if (!_BASE) {
      _toast('⚠️ No API config — send one message first, then retry.', 'warn', 7000);
      return;
    }

    _btnLoading(btn, true);
    try {
      _toast('📖 Reading conversation…', 'info');
      const rec = await _getChat(cs.s.chatID).catch(() => null);

      let tx = _buildTranscript(msgs, rec);
      if (tx.length > MAX_CHARS) {
        tx = `[…${(tx.length-MAX_CHARS).toLocaleString()} chars omitted]\n\n` + tx.slice(-MAX_CHARS);
        _warnLog('Transcript truncated.');
      }

      _toast('🧠 Generating summary… (10–40 s)', 'info', 60_000);
      const summary = await _callLLM(tx, cs.s.chatID);

      // Trigger TM's native Clear Context for the in-session visual grey-out.
      // The fetch interceptor (_applyReloadFilter) handles context filtering
      // on reload independently of TM's session state.
      _toast('🧹 Clearing context…', 'info');
      const freshCs = await _nativeClearContext(msgs.length);

      _toast('✅ Injecting summary…', 'info');
      await _appendSummary(freshCs, summary);

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

  const SPIN = `<svg class="w-[16px] h-[16px] animate-spin" viewBox="0 0 24 24" fill="none">
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
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
    if (on)  { btn.disabled=true;  btn._h=btn.innerHTML; btn.innerHTML=SPIN; }
    else     { btn.disabled=false; if(btn._h){btn.innerHTML=btn._h; delete btn._h;} }
  }

  function _injectBtn() {
    if (document.querySelector(`[${ATTR}]`)) return true;
    const header = document.querySelector('[data-element-id="chat-space-beginning-part"]');
    if (!header) return false;
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

  document.addEventListener('keydown', e => {
    const mac = /Mac/i.test(navigator.platform ?? navigator.userAgent ?? '');
    if ((mac ? e.metaKey : e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.querySelector(`[${ATTR}]`)?.click();
    }
  });

  /* ══════════════════════════════════════════════════════════════
   *  TOAST + LOGGING
   * ══════════════════════════════════════════════════════════════ */
  const _PAL = { info:'rgba(59,130,246,.93)', success:'rgba(22,163,74,.93)',
                 warn:'rgba(202,138,4,.93)',  error:'rgba(220,38,38,.93)' };
  let _tid = null;
  function _toast(msg, type='info', ms=3400) {
    let el = document.getElementById(`${ID}-toast`);
    if (!el) {
      el = document.createElement('div'); el.id = `${ID}-toast`;
      el.style.cssText = 'position:fixed;bottom:76px;left:50%;transform:translateX(-50%);' +
        'z-index:99999;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:500;' +
        'pointer-events:none;transition:opacity .3s;max-width:90vw;color:#fff;' +
        'white-space:nowrap;text-align:center;opacity:0;box-shadow:0 4px 16px rgba(0,0,0,.35);';
      document.body.appendChild(el);
    }
    el.style.background = _PAL[type]??_PAL.info;
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(_tid); _tid = setTimeout(() => { el.style.opacity='0'; }, ms);
  }

  const P = `[${ID} v${VERSION}]`;
  const _log    = (...a) => console.info(P,  ...a);
  const _warnLog = (...a) => console.warn(P, ...a);
  const _errLog  = (...a) => console.error(P, ...a);

  window.__tmcc_debug = () => {
    const cs = _chatState();
    const msgs = cs?.s?.messages ?? [];
    let lastClear = -1;
    for (let i = msgs.length-1; i>=0; i--) { if (msgs[i].type==='clear-context') { lastClear=i; break; } }
    const keepCount = lastClear >= 0 ? msgs.slice(lastClear+1).filter(m=>m.role).length : null;
    console.group(P + ' Debug');
    console.log('_BASE           :', _BASE);
    console.log('_CHAT_CFGS      :', JSON.parse(JSON.stringify(_CHAT_CFGS)));
    console.log('chatID (fiber)  :', cs?.s?.chatID);
    console.log('msg count       :', msgs.length);
    console.log('lastClearIdx    :', lastClear, lastClear>=0 ? '✅ filter active' : '(none)');
    console.log('filter keepCount:', keepCount, keepCount!=null ? `→ next API will keep ${keepCount+1} non-sys msgs` : '');
    console.groupEnd();
  };

  /* ══════════════════════════════════════════════════════════════
   *  BOOT
   * ══════════════════════════════════════════════════════════════ */
  function _boot() {
    _hookFetch();   // must be FIRST
    if (!_injectBtn()) {
      const obs = new MutationObserver(() => { if (_injectBtn()) obs.disconnect(); });
      obs.observe(document.body, { childList: true, subtree: true });
    }
    new MutationObserver(() => {
      if (!document.querySelector(`[${ATTR}]`)) _injectBtn();
    }).observe(document.body, { childList: true, subtree: true });
    _log('Loaded. run window.__tmcc_debug() to inspect state.');
  }

  _boot();
})();
