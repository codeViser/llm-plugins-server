---
name: adversarial-synthesis
description: Structured adversarial review of a thesis or position using critic/actor/judge reasoning. Surfaces blind spots, stress-tests claims, and produces a refined robustly-defended conclusion. Use when the user requests devil's-advocate analysis, adversarial review, debate-style stress-testing, or convergence scoring. Also orchestrates the MARS plugin when MARS is enabled. Triggers on: "adversarial", "stress test", "argue against", "devil's advocate", "debate", "challenge my thesis", "MARS".
---

# Adversarial Synthesis

## Purpose
Simulate structured intellectual debate to produce a thesis that has survived rigorous challenge. Activates when the task explicitly calls for adversarial pressure or MARS orchestration — not on all queries.

## When to Use
Activate this skill when:
- The user says 'stress test this', 'argue against', 'devil's advocate', 'adversarial review', 'debate', 'find flaws', or similar.
- A high-stakes decision needs challenge before commitment.
- A complex thesis may contain unexamined assumptions or blind spots.
- The user wants convergence scoring on a multi-perspective question.
- The MARS plugin is enabled and a research+debate workflow is appropriate.

Do **not** use for routine Q&A, simple lookups, creative tasks, or computation.

---

## Internal Mode (no MARS plugin)

Run the adversarial loop as an internal reasoning process.

### Phase 1 — Initial Thesis
1. State the thesis clearly with numbered claims.
2. For each claim, note its evidence basis and rate confidence: HIGH / MEDIUM / LOW.
3. Identify which claims are load-bearing (the conclusion collapses if these fail).

### Phase 2 — Critic Pass
For each major claim, generate the strongest plausible objection:
- Is the evidence sufficient, or could it support a different conclusion?
- Are there logical gaps or invalid inferences?
- What counterexamples exist?
- What relevant considerations have been omitted?
- Is the scope of the claim accurately bounded?

Label each objection by severity:
- **BLOCKING** — invalidates the conclusion if unaddressed.
- **NOTABLE** — weakens confidence significantly.
- **MANAGEABLE** — a caveat, not a refutation.

### Phase 3 — Actor Pass
For each objection:
- If valid: concede and update the thesis.
- If not valid: provide a specific rebuttal with reasoning.
- What additional evidence would most strengthen the current position?
- What would falsify the thesis, and is that falsification actually possible?

### Phase 4 — Synthesis
1. Update the thesis to incorporate valid objections and new evidence.
2. Mark positions that survived challenge with a brief explanation of why.
3. Flag genuine unresolved issues with appropriate hedging language.
4. State a convergence assessment: what confidence level does the final thesis warrant, and on what basis?

---

## MARS Plugin Mode (when MARS is enabled)

When the MARS plugin (start_debate_round) is available and the task warrants it:

### Phase 1 — Research + Initial Thesis
1. Use available retrieval tools to research the topic thoroughly.
2. Write a detailed initial_thesis: numbered claims, evidence citations, and explicit limitations.
3. Do NOT present this thesis to the user as a final answer — proceed to Phase 2 immediately.

### Phase 2 — Debate Loop
4. Call start_debate_round with the current thesis and original query.
5. Read the Orchestration Instructions at the bottom of the tool result:
   - PHASE 2.5 or SEARCH REQUIRED: execute all pending search queries, then proceed.
   - PROCEED TO NEXT ROUND: increment round and call again.
   - DEBATE COMPLETE or MAX ROUNDS: proceed to Phase 3.

### Phase 2.5 — Orchestrator Active Reasoning (between every round)
Between each MARS round, you must:
1. Execute all pending sub-agent search queries using available search tools.
2. Conduct additional targeted research on BLOCKING issues.
3. Reason: which objections are supported vs refuted by evidence?
4. Apply the Judge synthesis_guidance recommendation.
5. Produce an Orchestrator-Enhanced Thesis that carries your own intellectual authorship.
6. Pass this enhanced thesis as current_thesis in the next start_debate_round call.

### Phase 3 — Final Synthesis
After DEBATE COMPLETE, FORCE_CONCLUDED, or MAX ROUNDS:
1. Write the final response based on the Orchestrator-Enhanced Thesis.
2. Address all BLOCKING issues explicitly.
3. Report: convergence score, rounds completed, premise validity, and unresolved disputes.
4. If score is below threshold or guards failed: hedge conclusions proportionally.

---

## Output Format (both modes)
1. **Initial Thesis:** the position being tested, with confidence ratings per claim.
2. **Key Objections:** the strongest challenges found, labelled by severity.
3. **Rebuttals / Concessions:** what held, what was updated, and why.
4. **Refined Thesis:** the strengthened, post-challenge position.
5. **Residual Issues:** what remains genuinely uncertain after the full process.
6. **Convergence Assessment:** what confidence the conclusion warrants and on what basis.