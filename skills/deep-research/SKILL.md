---
name: deep-research
description: Multi-source evidence-gathering with mandatory cross-checking and inline citations. Use when a claim requires external verification, when current facts are needed beyond training knowledge, when comparing sources on a contested topic, or when the response depends on evidence the model cannot assert from memory. Triggers on: "research", "verify", "find current", "look up", "sources", "deep research".
---
# Deep Research

## Overview
Training knowledge has a cutoff and is not a substitute for verified current evidence. This skill disciplines the research process: decompose first, search before extracting, cross-check before asserting, cite everything. High rigor means accurate verification with minimal context cost — not exhaustive page dumps.

## When to Use
- The answer depends on current facts, recent events, or version-specific details
- A claim needs source backing before the response can stand
- Multiple sources are needed to form a reliable position on a contested topic
- The user asks to "verify", "research", "find sources", or "look up"

**When NOT to use:**
- Pure reasoning, logic, mathematics, or formal proof (no external facts needed)
- Creative tasks where factual grounding is not required
- The user has explicitly asked for a quick answer and acknowledged the trade-off

## The Process

### Step 1 — Decompose before searching
Rewrite the request into 2–5 concrete factual sub-questions. Tag each:
- **Fact lookup:** current data, dates, versions, names, prices
- **Comparative:** multiple sources needed to form a position
- **Claim verification:** a specific assertion to check against authoritative sources

State the sub-questions before searching. This prevents querying with the wrong framing and wasting context on irrelevant results.

### Step 2 — Search ladder (stop when evidence is sufficient)
Escalate only as far as needed. Stop the moment evidence is sufficient — do not continue to the next rung unnecessarily:

1. **Targeted search (1–3 queries):** prefer tools returning sourced, synthesised answers
2. **Triangulation:** cross-check key claims across 2+ independent sources
3. **Site discovery:** if a specific domain is authoritative, locate the exact page before extracting
4. **Selective extraction:** extract only when search results are insufficient; keep only the minimal relevant fragment
5. **Exhaustive crawl:** last resort only

**Source authority (highest to lowest):** official documentation → primary research / official publications → authoritative aggregators → curated reference sites → general web search

### Step 3 — Cross-check key claims
Before asserting a fact, confirm it in 2+ independent sources when:
- The claim is contested or surprising
- It will be cited as authoritative in the response
- Contradicting it would materially change the answer

When sources conflict: surface the conflict explicitly, state the most credible position, explain why.

### Step 4 — Synthesise and cite
Structure the response as:
1. **Research (Evidence):** what was looked up, what each source said, any discrepancies
2. **Synthesis:** what the evidence supports, with explicit uncertainty where it exists
3. **Final Answer:** concise conclusion
4. **Sources:** inline markdown links throughout; brief list at end for substantial research

Do not assert as fact anything not verified in this session. Flag unverified claims explicitly.

## Common Rationalizations
| Rationalization | Reality |
|---|---|
| "I'm confident about this from training" | Training data is stale and contains errors. Confidence is not verification. Search it. |
| "The answer is obvious, skip the search" | Obvious answers are where undetected training errors hide. |
| "Cross-checking wastes tokens" | A confidently wrong answer wastes far more — and erodes trust irreversibly. |
| "I'll extract the full page to be thorough" | Full-page extraction fills context with noise. Extract the relevant fragment only. |
| "I already know this source is good" | Source quality matters, but so does recency. Retrieve; don't assume currency. |
| "The user stated this fact" | User-provided facts can be wrong. If the response depends on it, verify it. |

## Red Flags
- Asserting current facts without having searched in this session
- Extracting an entire page when only one section was needed
- Citing a single source as definitive for a contested claim
- Using training memory as the primary "source" for a factual claim
- Proceeding to synthesis before cross-checking load-bearing claims
- Presenting uncertain findings as established fact

## Verification
After applying this skill:
- [ ] Every non-trivial factual claim was looked up in this session, not recalled from training
- [ ] Key claims are supported by 2+ independent sources
- [ ] Conflicting sources are surfaced explicitly, not silently resolved
- [ ] Only minimal relevant fragments were extracted (no full-page dumps)
- [ ] Every cited fact has a source link inline in the response
- [ ] Claims that could not be verified are explicitly flagged as unverified
