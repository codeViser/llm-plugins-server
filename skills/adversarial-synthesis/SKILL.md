---
name: adversarial-synthesis
description: Structured internal critic-actor-judge debate to stress-test a thesis before commitment. Use only when the user explicitly requests adversarial review, devil's-advocate analysis, convergence scoring, or when a high-stakes irreversible claim needs deliberate challenge before it stands. Triggers on: "adversarial", "stress test", "argue against", "devil's advocate", "debate", "challenge this", "find flaws", "convergence".
---
# Adversarial Synthesis

## Overview
A thesis that has not been challenged is not a reliable thesis. When the cost of being wrong is high, deliberately generate the strongest objections, defend or concede them honestly, track convergence, and iterate until the position stabilises. This skill runs entirely as an internal reasoning process — no external models or APIs required.

Use this skill sparingly. It is for high-stakes claims under deliberate adversarial pressure, not for routine analysis. Default analytical behaviour is already available; invoke this skill only when structured challenge is the explicit goal.

## When to Use
- The user explicitly asks for adversarial review, devil's advocate, stress testing, or debate
- A high-stakes or irreversible decision needs deliberate challenge before commitment
- A complex position may contain unexamined assumptions or blind spots worth surfacing
- Convergence scoring across multiple challenge cycles is desired

**When NOT to use:**
- Routine Q&A, explanation, comparison, or analysis where no position is being defended
- Low-stakes questions where the cost of a wrong answer is trivial
- The analytical task is about understanding, not defending a thesis
- The user has not asked for adversarial pressure (do not impose it unsolicited)

## The Protocol

Read `debate-cycle.md` in this skill directory for the full cycle format and templates.

### Overview of the loop
Play three roles sequentially for each cycle:
- **Critic:** find the strongest objection to each claim. Bias toward disproof, not validation.
- **Actor:** defend or concede each objection with explicit reasoning. Genuine concessions improve the thesis.
- **Judge:** score convergence (0–100) and recommend: CONVERGE, CONTINUE, or END.

Iterate until convergence score meets threshold or 3 cycles complete.
After convergence or cycle limit: synthesise the refined thesis and report the outcome.

### Convergence threshold
Default: 75/100. Increase for higher-stakes claims. Convergence is reached when:
- Major objections have been addressed or explicitly accepted as trade-offs
- Additional cycles are unlikely to produce substantively new findings
- The Judge assesses no BLOCKING issues remain unaddressed

### Cycle limit
Stop at 3 cycles. If substantive objections remain after 3 cycles, surface this to the user as information about the thesis — do not silently run more cycles. The user decides whether to continue.

## Output Structure
At the end of the final cycle, report:
1. **Initial Thesis:** the position that was tested (with numbered claims and initial confidence)
2. **Key Objections Surfaced:** the strongest challenges found, labelled by severity (BLOCKING / NOTABLE / MANAGEABLE)
3. **Rebuttals and Concessions:** what held, what was updated, and why
4. **Refined Thesis:** the post-challenge position incorporating valid objections
5. **Residual Issues:** what remains genuinely unresolved after all cycles
6. **Convergence Report:** final score, rounds completed, recommendation

## Common Rationalizations
| Rationalization | Reality |
|---|---|
| "My thesis is solid, no need for adversarial review" | Uncontested confidence is exactly the condition this skill exists to interrupt. |
| "The user didn't say adversarial, but I think the claim deserves it" | Do not impose this protocol unsolicited. It is opt-in, not default. |
| "I'll generate mild objections to avoid conceding anything" | Mild objections produce shallow refinement. The Critic must be adversarial — bias toward disproof. |
| "After 3 cycles nothing changed, so the thesis must be correct" | No change can mean the objections were weak, not that the thesis is flawless. Flag this distinction. |
| "Conceding a point weakens my answer" | Conceding valid objections and incorporating them makes the refined thesis stronger, not weaker. |
| "This is too slow, I'll skip the Judge step" | The Judge tracks convergence and prevents infinite loops. It is not optional. |

## Red Flags
- Generating objections that do not challenge load-bearing claims
- Treating the Critic and Actor as one role (they must be adversarial to each other)
- Declaring convergence without a Judge score above threshold
- Running more than 3 cycles without surfacing to the user that convergence was not reached
- Using this skill for questions where no thesis is being defended
- Presenting the initial thesis as the final answer without running the loop

## Verification
After applying this skill:
- [ ] The initial thesis was stated with numbered claims and confidence per claim
- [ ] The Critic generated objections biased toward disproof, not toward validation
- [ ] Every BLOCKING objection was explicitly addressed (defended or conceded)
- [ ] Valid concessions were incorporated into the refined thesis
- [ ] A Judge score was produced for each cycle with recommendation
- [ ] The loop stopped at convergence or at 3 cycles (not silently continued)
- [ ] The final output includes all 6 sections from Output Structure
