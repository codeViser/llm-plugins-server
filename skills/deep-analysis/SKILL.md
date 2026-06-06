---
name: deep-analysis
description: Explicit multi-step reasoning with visible assumptions, alternatives, edge cases, and validation. Use when correctness matters more than speed, when a decision has real tradeoffs to expose, when stakes are high or the reasoning is non-obvious, or when the user needs to understand a derivation — not just its conclusion. Triggers on: "analyse", "tradeoffs", "compare", "design", "should I", "deep analysis", "think through", "why".
---
# Deep Analysis

## Overview
A confident conclusion is not the same as a correct one. This skill forces reasoning to be visible: assumptions stated, alternatives considered, edge cases enumerated, and the conclusion validated before it stands. Do not use it as a performance of thoroughness — use it when the task genuinely requires derivation to be trustworthy.

## When to Use
- An architectural, design, or strategic decision has real tradeoffs that need exposure
- The user needs to understand the reasoning path, not just the answer
- Stakes are high enough that a fast wrong answer is worse than a slower correct one
- The task requires synthesising multiple inputs into a non-obvious conclusion
- The user asks to "think through", "analyse deeply", "compare", or "walk me through"

**When NOT to use:**
- Routine explanation or description with no genuine tradeoff
- The user wants a quick answer and the cost of being wrong is low
- Mechanical operations, formatting, lookups, or single-step tasks
- The reasoning is already obvious — do not confuse depth with length

## The Process

### Step 1 — Frame before reasoning
Before writing a single analytical line, state:
1. **The exact question being answered** (restate it precisely, not paraphrased)
2. **Success criteria** — what would a good answer look like?
3. **Non-obvious assumptions** — list them; mark which ones are load-bearing (the conclusion fails if these are wrong)

If you cannot frame the question clearly, surface that confusion to the user before proceeding.

### Step 2 — Decompose
Break the question into independent sub-problems. Each sub-problem should be answerable on its own. Map which sub-problems depend on others before starting — ordering matters.

### Step 3 — Consider alternatives
For any non-trivial decision, propose at least 2 meaningfully different approaches:
- Why each approach exists (what problem does it solve?)
- The decisive criteria for choosing between them
- Why the eliminated approaches were ruled out

Do not treat the first approach that comes to mind as the only one. If only one approach is found, that is a flag — push harder.

### Step 4 — Enumerate edge cases
For each major claim or step, ask:
- What happens at the boundaries?
- What fails under adversarial or unexpected input?
- What breaks if usage scales up (volume, time, users)?
- Is there a plausible scenario where this step doesn't hold?

Label edge cases: **Likely**, **Possible**, **Unlikely but non-negligible**.

### Step 5 — Validate
Before committing to the conclusion:
- If one load-bearing assumption is wrong, does the conclusion still hold?
- Does the recommendation survive the strongest opposing argument?
- Is anything being treated as certain that is actually inferred?

If the conclusion does not survive this check, revise the conclusion or explicitly hedge it.

### Step 6 — Output structure
Structure the response as:
1. **Framing:** the question, success criteria, assumptions (flagged as load-bearing or not)
2. **Analysis:** reasoning path, visible step by step
3. **Alternatives considered:** honest treatment — not dismissive
4. **Edge cases / risks:** labelled by likelihood
5. **Final Answer / Recommendation:** decision-ready, actionable
6. **Residual uncertainty:** what remains genuinely unresolved after all of the above

### Thinking budget continuation
If the analysis cannot be completed within the output window:
- Stop at a clean checkpoint; do not trail off mid-derivation
- Provide: (1) Interim Summary of reasoning so far, (2) What remains, (3) Concrete next steps
- Ask the user to reply exactly: **CONTINUE THINKING**

## Common Rationalizations
| Rationalization | Reality |
|---|---|
| "I got a confident answer, no need to check alternatives" | Confidence on the first approach is the leading cause of avoidable wrong decisions. |
| "Edge cases are unlikely, I'll skip them" | Edge cases fail in production at the worst times. Name them even if ruling them out. |
| "The stakes aren't high enough for this" | The skill is triggered by the nature of the question, not by the user's expressed urgency. Use When to Use. |
| "I'll add the framing at the end" | Assumptions stated after the reasoning are post-hoc rationalisation. State them first. |
| "Mentioning uncertainty makes me look weak" | Presenting inferred conclusions as certain is the actual epistemic failure. Hedge correctly. |
| "Deep means long" | Depth is about rigour — showing work, testing assumptions, naming alternatives. Length is not a proxy. |

## Red Flags
- Stating a conclusion without a derivation
- Treating the first approach as if no alternatives exist
- Marking something as certain without derivation or strong empirical basis
- Skipping edge cases because they seem unlikely
- Stating assumptions after the reasoning instead of before
- Confusing length of output with depth of reasoning

## Verification
After applying this skill:
- [ ] The exact question is stated before any reasoning begins
- [ ] Non-obvious assumptions are listed and load-bearing ones are identified
- [ ] At least 2 meaningful alternatives were considered with explicit elimination rationale
- [ ] Edge cases are named and labelled by likelihood
- [ ] The conclusion was tested against at least one load-bearing assumption being wrong
- [ ] Residual uncertainty is stated honestly, not hidden
- [ ] If the analysis was cut short: a checkpoint summary + CONTINUE THINKING offer was provided
