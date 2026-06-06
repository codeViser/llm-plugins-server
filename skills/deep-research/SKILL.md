---
name: deep-research
description: Web-grounded multi-source research with triangulation, selective extraction, and inline citations. Use for current facts, comparisons, technical verification, investigative questions, or any response where evidence provenance matters. Triggers on: "research", "find", "verify", "what is X currently", "look into", "deep research", "sources".
---

# Deep Research

## Purpose
Disciplined, evidence-grounded research. Prioritise context efficiency: spend tokens on verified signal, not noise.

## Step 1 — Decompose the Request
Before searching, rewrite the request into 2–5 concrete factual sub-questions. Tag each:
- **(A) Factual lookup** — current events, specs, prices, names, dates, technical details.
- **(B) Comparative / synthesis** — multiple sources needed to form a position.
- **(C) Claim verification** — a specific assertion to check against authoritative sources.

## Step 2 — Search Ladder (follow in order; stop when sufficient evidence exists)
1. **Targeted search** — 1–3 focused queries. Prefer tools that return sourced, synthesised answers.
2. **Triangulation** — cross-check key claims across 2+ independent sources.
3. **Site discovery** — if a specific site or domain is authoritative, locate the exact page before extracting.
4. **Selective extraction** — extract specific pages only when search results are insufficient. Summarise aggressively; do not dump full pages into context.
5. **Exhaustive crawl** — last resort only.

## Rules
- Do not assert factual claims not verified in this session.
- When sources conflict, note the conflict explicitly and state the most credible position with reasoning.
- Stop escalating the search ladder when evidence is sufficient.
- Prefer fewer, higher-quality sources over many low-quality ones.
- Keep extracted fragments minimal; discard surrounding noise before proceeding.

## Output Format
Structure responses as:
1. **Research (Evidence):** what was looked up, what each source said, discrepancies if any.
2. **Synthesis:** what the evidence supports, with explicit uncertainty where it exists.
3. **Final Answer:** concise conclusion.
4. **Sources:** inline markdown links throughout; brief list at end when research was substantial.

## Context Discipline
Extracts consume context heavily. When you must extract, strip everything irrelevant before reasoning on the fragment. Prefer a targeted search hit over a full page read.
