---
name: deep-analysis
description: Explicit multi-step reasoning with visible assumptions, alternative paths, edge cases, counterarguments, and validation. Use for architecture decisions, strategy, tradeoffs, design critique, proof sketching, complex synthesis, or any problem requiring rigorous derivation and stress-testing before conclusion. Triggers on: "analyse", "compare", "tradeoffs", "design", "should I", "deep analysis", "think through", "stress test".
---

# Deep Analysis

## Purpose
Structured, visible reasoning. The analysis must show its work — not just its conclusions.

## Before Reasoning
State explicitly:
1. What the core question or decision is.
2. What assumptions are being made (and which are load-bearing).
3. What counts as a good answer (success criteria).

## Depth Levels
Scale the analysis to the complexity of the task:

**Standard:** Key reasoning steps + basic check against the most obvious alternative.

**Deep:** Multi-step derivation; at least 2 alternative approaches considered with elimination rationale; explicit edge cases; assumptions tested.

**Ultra:** Full stress-test — generate the strongest counterargument and evaluate it fairly; find the failure mode that most threatens the conclusion; apply a validation strategy; note where genuine uncertainty remains after all of that.

## Required Elements (for Deep and Ultra)
1. **Decomposition** — break the question into independent sub-problems.
2. **Alternatives** — propose at least 2 approaches; explain why each was chosen or eliminated.
3. **Edge cases** — enumerate failure modes, boundary conditions, and adversarial inputs.
4. **Assumptions** — list all non-obvious assumptions; mark which ones the conclusion is most sensitive to.
5. **Validation** — does the conclusion still hold if one key assumption is wrong?

## Output Format
1. **Framing:** the problem restated precisely with stated assumptions and success criteria.
2. **Analysis:** the reasoning path, visible step by step.
3. **Alternatives considered:** honest, not dismissive treatment.
4. **Edge cases / risks:** what could invalidate the conclusion.
5. **Final Answer / Recommendation:** decision-ready, actionable output.
6. **Residual uncertainty:** what remains genuinely unresolved and why.

## Thinking Budget Continuation
If the analysis cannot be completed within the output window:
- Stop at a clean checkpoint.
- Provide: (1) Interim Summary of reasoning so far, (2) What remains, (3) Concrete next steps.
- Ask the user to reply exactly: **CONTINUE THINKING**

## Anti-Patterns
Do not:
- State a conclusion without showing the derivation.
- Treat the first approach as if no alternatives exist.
- Mark something as certain without a derivation or strong empirical basis.
- Skip edge cases because they seem unlikely.
- Conflate confidence in the reasoning process with confidence in the conclusion.
