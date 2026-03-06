// ================================================================
//  TypingMind — Compact Context Extension                v1.0.0
// ================================================================
//
//  INSTALL: Preferences → Advanced Settings → Extensions → paste URL
//
//  FIRST RUN: Send any message once to let the extension capture
//  your API config automatically. The button then works forever.
//
//  TRIGGER: Click the 🗜 button in the chat header, or press
//           ⌘⌥K  (Mac)  /  Ctrl+Alt+K  (Windows / Android)
//
//  HOW IT WORKS (no UI automation — all programmatic):
//   1. Reads full active conversation via React fiber + IndexedDB
//   2. Calls the currently active model using your captured API
//      credentials and the embedded structured compaction prompt
//   3. Inserts a clear-context marker + the generated summary
//      directly into the message array via React dispatch + IDB
//   4. Conversation continues with a fresh token budget
//
//  COMPATIBLE WITH: chat_user_msg_preview.js (no conflicts)
// ================================================================

(() => {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
   *  CONSTANTS
   * ───────────────────────────────────────────────────────────── */
  const ID      = 'tm-ctx-compact';
  const VERSION = '1.0.0';
  const ATTR    = `data-${ID}`;

  // Transcript cap — ~55k tokens; enough for all major models.
  // Very long chats are tail-truncated (most recent content kept).
  const MAX_CHARS = 80_000;

  /* ─────────────────────────────────────────────────────────────
   *  EMBEDDED SUMMARISATION PROMPT
   *  (verbatim from user specification — injected as system role)
   * ───────────────────────────────────────────────────────────── */
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

  /* ─────────────────────────────────────────────────────────────
   *  FETCH INTERCEPTOR
   *  Passively captures API endpoint + key from TM's own calls.
   *  We save a reference to the current fetch BEFORE hooking so
   *  our own summarisation calls bypass the interceptor entirely.
   * ───────────────────────────────────────────────────────────── */
  const _origFetch = window.fetch.bind(window); // true original (pre-us)
  let   API_CFG    = null;                       // { url, key, model, hdrs }

  // Restore cached config across page reloads
  try {
    const saved = localStorage.getItem(`${ID}_cfg`);
    if (saved) API_CFG = JSON.parse(saved);
  } catch (_) {}

  function hookFetch() {
    const prev = window.fetch; // chain through any earlier wrappers
    window.fetch = function (url, opts = {}) {
      if (!API_CFG && opts?.method === 'POST') {
        const u = String(url);
        // Match OpenAI / Anthropic / Gemini / generic chat endpoints
        if (/\/(chat\/completions|messages|responses)(\?|$)/.test(u)) {
          try {
            const body = JSON.parse(typeof opts.body === 'string' ? opts.body : '{}');
            const hdrs = opts.headers ?? {};
            const key  = (hdrs.Authorization ?? hdrs.authorization ?? '')
                           .replace(/^Bearer\s+/i, '').trim();
            if (body.model && key) {
              API_CFG = {
                url   : u,
                key   : key,
                model : body.model,   // last-known model as fallback
                hdrs  : _safeHeaders(hdrs),
              };
              localStorage.setItem(`${ID}_cfg`, JSON.stringify(API_CFG));
              _log('✅ API config captured →', u, '/ model:', body.model);
            }
          } catch (_) {}
        }
      }
      return prev.apply(this, arguments);
    };
  }

  /**
   * Keep only headers that are safe to replay; drop Content-Length etc.
   */
  function _safeHeaders(h) {
    const KEEP = new Set([
      'authorization', 'x-api-key', 'http-referer', 'x-title',
      'anthropic-version', 'x-goog-api-key', 'x-openrouter-meta',
    ]);
    return Object.fromEntries(
      Object.entries(h).filter(([k]) => KEEP.has(k.toLowerCase()))
    );
  }

  /* ─────────────────────────────────────────────────────────────
   *  REACT FIBER  (identical pattern to chat_user_msg_preview.js)
   *  Returns { s: chatState, d: dispatchFn } or null.
   * ───────────────────────────────────────────────────────────── */
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
        ) {
          return { s: v, d: hs.queue?.dispatch };
        }
      }
    }
    return null;
  }

  /* ─────────────────────────────────────────────────────────────
   *  INDEXEDDB  (keyval-store > keyval > CHAT_{id})
   * ───────────────────────────────────────────────────────────── */
  const _openIDB = () => new Promise((ok, no) => {
    const r = indexedDB.open('keyval-store');
    r.onsuccess = e => ok(e.target.result);
    r.onerror   = () => no(r.error);
  });

  async function _getChat(chatID) {
    const db = await _openIDB();
    return new Promise((ok, no) => {
      const req = db.transaction('keyval', 'readonly')
                    .objectStore('keyval').get(`CHAT_${chatID}`);
      req.onsuccess = () => { db.close(); ok(req.result ?? null); };
      req.onerror   = () => { db.close(); no(req.error); };
    });
  }

  async function _putChat(chatID, messages) {
    const db = await _openIDB();
    return new Promise((ok, no) => {
      const st  = db.transaction('keyval', 'readwrite').objectStore('keyval');
      const key = `CHAT_${chatID}`;
      const g   = st.get(key);
      g.onsuccess = () => {
        if (!g.result) { db.close(); ok(); return; }
        const put = st.put(
          { ...g.result, messages, updatedAt: new Date().toISOString() },
          key
        );
        put.onsuccess = () => { db.close(); ok(); };
        put.onerror   = () => { db.close(); no(put.error); };
      };
      g.onerror = () => { db.close(); no(g.error); };
    });
  }

  /* ─────────────────────────────────────────────────────────────
   *  TRANSCRIPT BUILDER
   *  Builds a human-readable conversation string from the active
   *  message array.  Handles tool calls, tool results, images,
   *  multi-part content blocks, and prior clear-context markers.
   * ───────────────────────────────────────────────────────────── */

  /** Flatten any content shape into a plain string */
  function _contentToText(c) {
    if (!c)                      return '';
    if (typeof c === 'string')   return c;
    if (Array.isArray(c)) {
      return c.map(b => {
        if (typeof b === 'string')       return b;
        if (b?.type === 'text')          return b.text ?? '';
        if (b?.type === 'tool_use')      return `[Tool: ${b.name}(${JSON.stringify(b.input ?? {})})]`;
        if (b?.type === 'tool_result')   return `[Result: ${JSON.stringify(b.content ?? '')}]`;
        if (b?.type === 'image_url')     return '[image attachment]';
        if (b?.type === 'image')         return '[image attachment]';
        if (b?.type === 'document')      return `[document: ${b.title ?? '(untitled)'}]`;
        if (b?.type === 'thinking')      return `[Reasoning: ${(b.thinking ?? '').slice(0, 500)}…]`;
        return b?.text ?? b?.content ?? '';
      }).join('\n');
    }
    if (typeof c === 'object') return c.text ?? c.content ?? JSON.stringify(c);
    return String(c);
  }

  /**
   * Build the full conversation transcript as a readable string.
   * The active messages array IS the current linear branch
   * (root → tip) — no extra traversal needed.
   */
  function _buildTranscript(messages, chatRecord) {
    const lines = [
      '====== CONVERSATION TRANSCRIPT ======',
      `Chat: ${chatRecord?.chatTitle ?? '(untitled)'}`,
      `Total messages: ${messages.length}`,
    ];

    const sys = chatRecord?.chatParams?.systemMessage;
    if (sys) lines.push(`\n[SYSTEM INSTRUCTION]\n${sys}`);

    let n = 0;
    for (const msg of messages) {
      // Visual marker for previous context-clear events
      if (msg.type === 'clear-context') {
        lines.push(
          '\n── [CONTEXT CLEARED HERE — all prior messages were excluded' +
          ' from the AI context beyond this point] ──\n'
        );
        continue;
      }

      const role = (msg.role ?? '').toLowerCase();
      if (!role) continue;

      const label =
        role === 'user'      ? '👤 USER'       :
        role === 'assistant' ? '🤖 ASSISTANT'  :
        role === 'tool'      ? '🔧 TOOL RESULT':
        role === 'system'    ? '⚙️  SYSTEM'     :
        role.toUpperCase();

      // Build content body (text + any tool calls)
      let body = _contentToText(msg.content);
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        msg.tool_calls.forEach(tc => {
          const name = tc.function?.name ?? tc.name ?? '?';
          const args = tc.function?.arguments ?? tc.arguments ?? '{}';
          body += `\n[Tool Call: ${name}(${
            typeof args === 'string' ? args : JSON.stringify(args)
          })]`;
        });
      }

      if (!body.trim()) continue;
      lines.push(`\n[${++n}] ${label}:\n${body}`);
    }

    lines.push(`\n====== END OF TRANSCRIPT (${n} messages) ======`);
    return lines.join('\n');
  }

  /* ─────────────────────────────────────────────────────────────
   *  API CALL
   *  Uses _origFetch (pre-hook) so the call doesn't re-trigger
   *  our own interceptor.  Supports OpenAI, Anthropic, and Gemini
   *  response shapes.
   * ───────────────────────────────────────────────────────────── */
  async function _callLLM(transcript, model) {
    const reqBody = {
      model,
      stream      : false,
      max_tokens  : 8192,
      temperature : 0.15,
      messages: [
        { role: 'system', content: PROMPT },
        {
          role    : 'user',
          content :
            '[CONVERSATION_CONTEXT_LIMIT_REACHED]\n\n' +
            'Summarise the following conversation strictly according to ' +
            'your system instructions above.\n\n' +
            transcript,
        },
      ],
    };

    const res = await _origFetch(API_CFG.url, {
      method  : 'POST',
      headers : { ...API_CFG.hdrs, 'Content-Type': 'application/json' },
      body    : JSON.stringify(reqBody),
    });

    if (!res.ok) {
      let msg = '';
      try { msg = (await res.text()).slice(0, 400); } catch (_) {}
      throw new Error(`API ${res.status}${msg ? ': ' + msg : ''}`);
    }

    const data = await res.json();

    // OpenAI / OpenRouter / Azure format
    const oai = data?.choices?.[0]?.message?.content;
    if (typeof oai === 'string') return oai;

    // Anthropic format
    const anth = Array.isArray(data?.content)
      ? data.content.find(b => b?.type === 'text')?.text
      : null;
    if (typeof anth === 'string') return anth;

    // Gemini format
    const gem = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof gem === 'string') return gem;

    throw new Error(
      'Could not parse summary from API response. ' +
      'Raw: ' + JSON.stringify(data).slice(0, 300)
    );
  }

  /* ─────────────────────────────────────────────────────────────
   *  STATE MUTATION
   *  Injects (1) a clear-context marker and (2) the summary as an
   *  assistant message into the live React state and persists to
   *  IDB.  No UI clicks.  No page reload needed.
   * ───────────────────────────────────────────────────────────── */
  const _uuid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 3) | 8).toString(16);
        });

  async function _applyCompaction(cs, rawSummary) {
    const { s, d }   = cs;
    const now         = new Date().toISOString();
    const displayTime = new Date().toLocaleString();

    // Prepend a visual header so the user can see what happened
    const summaryContent =
      `**[🗜️ Context Compaction]** · *${displayTime}*\n\n` +
      `> All prior messages have been summarised and cleared from context.\n` +
      `> Continue your conversation directly from this summary.\n\n` +
      `---\n\n` +
      rawSummary;

    const updatedMessages = [
      ...s.messages,
      // 1. Clear-context marker — makes TM exclude all prior messages
      //    from subsequent API calls (same mechanism as ⌘⌥J)
      {
        uuid      : _uuid(),
        type      : 'clear-context',
        createdAt : now,
      },
      // 2. Summary injected as an assistant message so it appears
      //    in the active context window going forward
      {
        uuid                    : _uuid(),
        role                    : 'assistant',
        content                 : summaryContent,
        createdAt               : now,
        [`${ID}_compaction`]    : true,  // marker for future tooling
      },
    ];

    const nextState = { ...s, messages: updatedMessages, updatedAt: now };

    // Update live React UI (identical pattern to reference extension)
    try {
      d?.(nextState);
    } catch (e) {
      _warn('dispatch failed (IDB will still persist):', e.message);
    }

    // Persist to IndexedDB (survives page reload)
    await _putChat(s.chatID, updatedMessages);
  }

  /* ─────────────────────────────────────────────────────────────
   *  MAIN ACTION  — called on every button click / keyboard trigger
   * ───────────────────────────────────────────────────────────── */
  async function _doCompact(btn) {

    // ── Guard: chat must be open ──────────────────────────
    const cs = _chatState();
    if (!cs?.s) {
      _toast('⚠️ No active chat detected. Open a chat and try again.', 'warn');
      return;
    }

    // ── Guard: wait for any active stream ─────────────────
    const streaming = !!document.querySelector(
      '[data-element-id="stop-generation-button"], [aria-label="Stop generating"]'
    );
    if (streaming) {
      _toast('⚠️ Wait for the AI to finish responding first.', 'warn');
      return;
    }

    // ── Guard: enough content to summarise ────────────────
    const msgs = cs.s.messages;
    const realMsgs = msgs.filter(m => m.role && !m.type);
    if (realMsgs.length < 2) {
      _toast('ℹ️ Not enough messages to compact (need ≥ 2).', 'info');
      return;
    }

    // ── Guard: API config must be captured ────────────────
    if (!API_CFG) {
      _toast(
        '⚠️ API not yet initialised — send one regular message first, then retry.',
        'warn', 6000
      );
      return;
    }

    // ── Begin work ────────────────────────────────────────
    _setBtnLoading(btn, true);
    try {

      _toast('📖 Reading conversation…', 'info');
      const chatRecord = await _getChat(cs.s.chatID);

      // Prefer the per-chat model stored in IDB; fall back to captured model
      const model = chatRecord?.model ?? API_CFG.model ?? 'unknown';
      _log('Using model:', model);

      // Build transcript, tail-truncating if necessary
      let tx = _buildTranscript(msgs, chatRecord);
      if (tx.length > MAX_CHARS) {
        const cut = tx.length - MAX_CHARS;
        tx =
          `[…${cut.toLocaleString()} characters of earlier transcript omitted` +
          ` — most recent ${MAX_CHARS.toLocaleString()} chars preserved…]\n\n` +
          tx.slice(-MAX_CHARS);
        _warn('Transcript truncated — conversation very long.');
      }

      _toast('🧠 Generating summary… (may take 10–30 s)', 'info', 30_000);
      const summary = await _callLLM(tx, model);
      if (!summary?.trim()) throw new Error('Model returned an empty summary.');

      _toast('✅ Injecting summary and clearing context…', 'info');
      await _applyCompaction(cs, summary);

      _toast('✅ Context compacted! Continue your conversation.', 'success', 5000);

    } catch (err) {
      _error(err);
      _toast(`❌ ${err.message}`, 'error', 8000);
    } finally {
      _setBtnLoading(btn, false);
    }
  }

  /* ─────────────────────────────────────────────────────────────
   *  BUTTON INJECTION
   *  Placed immediately before the "More actions" (⋯) dropdown
   *  inside [data-element-id="chat-space-beginning-part"].
   *  Uses the same classes as TM's own header buttons for visual
   *  consistency across light/dark themes.
   * ───────────────────────────────────────────────────────────── */

  // Lines icon (text being compressed rightward) — 18×18, matches TM style
  const _ICON = `<svg class="w-[18px] h-[18px]" viewBox="0 0 18 18"
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

  // Tailwind spinner — animate-spin is available in TM's stylesheet
  const _SPIN = `<svg class="w-[16px] h-[16px] animate-spin"
    viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle class="opacity-25" cx="12" cy="12" r="10"
      stroke="currentColor" stroke-width="4"/>
    <path class="opacity-75" fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>`;

  const _BTN_CLASS = [
    'w-9 justify-center',
    'dark:hover:bg-white/20 dark:active:bg-white/25 dark:disabled:text-neutral-500',
    'hover:bg-slate-900/20 active:bg-slate-900/25 disabled:text-neutral-400',
    'focus-visible:outline-offset-2 focus-visible:outline-slate-500',
    'text-slate-900 dark:text-white',
    'inline-flex items-center rounded-lg h-9 transition-all font-semibold text-xs',
  ].join(' ');

  function _setBtnLoading(btn, loading) {
    if (loading) {
      btn.disabled   = true;
      btn._origHTML  = btn.innerHTML;
      btn.innerHTML  = _SPIN;
    } else {
      btn.disabled   = false;
      if (btn._origHTML) { btn.innerHTML = btn._origHTML; delete btn._origHTML; }
    }
  }

  function _injectButton() {
    if (document.querySelector(`[${ATTR}]`)) return true;

    const header = document.querySelector('[data-element-id="chat-space-beginning-part"]');
    if (!header) return false;

    // The "More actions" chevron sits inside a <div data-headlessui-state>
    // wrapper. We insert our button before that wrapper so it appears
    // cleanly to its left in the flex row.
    const moreTrigger = header.querySelector('[data-tooltip-content="More actions"]');
    if (!moreTrigger) return false;

    const insertBefore =
      moreTrigger.closest('[data-headlessui-state]') ?? moreTrigger;

    const btn = document.createElement('button');
    btn.setAttribute(ATTR, '1');
    btn.setAttribute('data-tooltip-id', 'global');
    btn.setAttribute('data-tooltip-content', 'Compact Context — Summarise & Reset (⌘⌥K)');
    btn.className = _BTN_CLASS;
    btn.innerHTML = _ICON;
    btn.addEventListener('click', () => _doCompact(btn));

    insertBefore.parentNode.insertBefore(btn, insertBefore);
    _log('Button injected.');
    return true;
  }

  /* ─────────────────────────────────────────────────────────────
   *  KEYBOARD SHORTCUT   ⌘⌥K  (Mac)  |  Ctrl+Alt+K  (others)
   * ───────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    const mac = /Mac/i.test(navigator.platform ?? navigator.userAgent ?? '');
    const hit  = mac
      ? e.metaKey && e.altKey && e.key.toLowerCase() === 'k'
      : e.ctrlKey && e.altKey && e.key.toLowerCase() === 'k';
    if (!hit) return;
    e.preventDefault();
    const btn = document.querySelector(`[${ATTR}]`);
    if (btn && !btn.disabled) btn.click();
  });

  /* ─────────────────────────────────────────────────────────────
   *  TOAST NOTIFICATION  (bottom-centre, auto-dismiss)
   * ───────────────────────────────────────────────────────────── */
  const _COLORS = {
    info   : 'rgba(59,130,246,.93)',
    success: 'rgba(22,163,74,.93)',
    warn   : 'rgba(202,138,4,.93)',
    error  : 'rgba(220,38,38,.93)',
  };
  let _toastTimer = null;

  function _toast(msg, type = 'info', ms = 3400) {
    let el = document.getElementById(`${ID}-toast`);
    if (!el) {
      el = document.createElement('div');
      el.id = `${ID}-toast`;
      el.style.cssText =
        'position:fixed;bottom:76px;left:50%;transform:translateX(-50%);' +
        'z-index:99999;padding:8px 20px;border-radius:8px;' +
        'font-size:13px;font-weight:500;pointer-events:none;' +
        'transition:opacity .3s ease;max-width:90vw;color:#fff;' +
        'white-space:nowrap;text-align:center;opacity:0;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.35);';
      document.body.appendChild(el);
    }
    el.style.background = _COLORS[type] ?? _COLORS.info;
    el.textContent      = msg;
    el.style.opacity    = '1';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, ms);
  }

  /* ─────────────────────────────────────────────────────────────
   *  LOGGING
   * ───────────────────────────────────────────────────────────── */
  const _tag   = `[${ID} v${VERSION}]`;
  const _log   = (...a) => console.info(_tag,  ...a);
  const _warn  = (...a) => console.warn(_tag,  ...a);
  const _error = (...a) => console.error(_tag, ...a);

  /* ─────────────────────────────────────────────────────────────
   *  BOOT
   * ───────────────────────────────────────────────────────────── */
  function _boot() {
    // Install fetch hook (before any TM requests fire)
    hookFetch();

    // Inject button immediately or wait for chat header to appear
    if (!_injectButton()) {
      const waitObs = new MutationObserver(() => {
        if (_injectButton()) waitObs.disconnect();
      });
      waitObs.observe(document.body, { childList: true, subtree: true });
    }

    // Re-inject after chat navigation (header gets torn down & rebuilt)
    new MutationObserver(() => {
      if (!document.querySelector(`[${ATTR}]`)) _injectButton();
    }).observe(document.body, { childList: true, subtree: true });

    _log('Loaded — ready. Send one message to initialise API capture.');
  }

  _boot();
})();
