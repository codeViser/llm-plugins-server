# Debate Cycle Format

Reference material for the `adversarial-synthesis` skill. Load this file when executing the adversarial loop.

## Cycle Template

Use this structure for each cycle. Fill every section — do not skip a role.

---

### CYCLE [N]

#### THESIS (start of cycle)
State the current thesis with numbered claims:
```
THESIS:
1. [Claim] — Confidence: HIGH / MEDIUM / LOW — Load-bearing: YES / NO
2. [Claim] — Confidence: HIGH / MEDIUM / LOW — Load-bearing: YES / NO
...
```

#### CRITIC
For each claim, generate the strongest plausible objection. Bias toward disproof:
```
CRITIC:
Claim 1: [Severity: BLOCKING / NOTABLE / MANAGEABLE]
  Objection: [The strongest counterargument]
  Basis: [Why this objection is valid — evidence or logical gap]

Claim 2: [Severity: BLOCKING / NOTABLE / MANAGEABLE]
  Objection: [...]
  Basis: [...]
```

Severity definitions:
- **BLOCKING** — invalidates the thesis or the claim if unaddressed
- **NOTABLE** — weakens confidence significantly but does not invalidate
- **MANAGEABLE** — a caveat or minor qualification, not a refutation

#### ACTOR
For each objection, defend or concede explicitly:
```
ACTOR:
Claim 1:
  [DEFEND]: [Rebuttal with reasoning] — Confidence after rebuttal: HIGH / MEDIUM / LOW
  — OR —
  [CONCEDE]: [What is being conceded and how the thesis updates as a result]

Claim 2:
  [DEFEND / CONCEDE]: [...]
```

Rules:
- DEFEND requires a rebuttal with reasoning — not just reassertion
- CONCEDE requires an update to the thesis in Step 4 (Refined Thesis)
- Partial concession is allowed: concede the objection partially, defend the rest

#### JUDGE
Assess the state after Critic and Actor:
```
JUDGE:
  Convergence score: [0–100]
  Blocking issues remaining: [count and summary, or NONE]
  Recommendation: CONVERGE / CONTINUE / END
  Basis: [One sentence explaining the score and recommendation]
```

Scoring guidance:
- 0–40: major unaddressed objections, fundamental claims undefended
- 41–60: significant issues remain, further cycles expected to help
- 61–74: most claims defended, minor or manageable issues remain
- 75–89: convergence threshold met, no blocking issues
- 90–100: strong defence, residual issues are acknowledged trade-offs

Recommendation rules:
- **CONVERGE:** score >= threshold and no BLOCKING issues — exit the loop and synthesise
- **CONTINUE:** score below threshold and further iteration likely to improve — run next cycle
- **END:** 3 cycles completed or further iteration unlikely to produce new findings — exit with hedging

#### REFINED THESIS (end of cycle, if CONTINUE or END)
Update the thesis incorporating all concessions from this cycle:
```
REFINED THESIS:
1. [Updated claim incorporating concessions] — Confidence: ...
2. [Updated claim] — Confidence: ...
...
```

---

## Convergence Reporting Template

After the loop exits, produce this report:
```
CONVERGENCE REPORT
  Final score: [N]/100
  Cycles completed: [N]
  Outcome: CONVERGED / CYCLE LIMIT REACHED / USER-ENDED
  Blocking issues resolved: [YES / NO — if NO, list remaining]
  Confidence in refined thesis: HIGH / MEDIUM / LOW
```

If CYCLE LIMIT REACHED without convergence, add:
```
NOTE: 3 cycles completed without reaching convergence threshold.
Remaining issues: [list BLOCKING and NOTABLE objections not resolved]
This information about the thesis should inform confidence in the final answer.
```
