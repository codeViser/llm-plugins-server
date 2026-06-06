# Skills

Agent skills for this TypingMind workspace, following the [Agent Skills](https://agentskills.io) open standard and the anatomy defined in [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills).

## Available Skills

| Skill | Purpose | When to load |
|---|---|---|
| [deep-research](./deep-research/) | Multi-source evidence-gathering with cross-checking and citations | Factual claims needing external verification |
| [deep-analysis](./deep-analysis/) | Visible step-by-step reasoning with alternatives, edge cases, and validation | High-stakes decisions and non-obvious derivations |
| [adversarial-synthesis](./adversarial-synthesis/) | Structured internal critic/actor/judge loop to stress-test a thesis | Explicit adversarial review requests only |

## Structure

Each skill directory follows the standard layout:
```
skills/
  skill-name/
    SKILL.md            # Required: entry point (process + when to use)
    supporting-file.md  # Optional: reference material loaded on demand
    scripts/            # Optional: runnable helpers (omitted when not needed)
```

## Design Principles

- **Thin entry point:** SKILL.md describes the process and triggers. Supporting files provide depth loaded only when executing the workflow.
- **Process over prose:** steps, checkpoints, and exit criteria — not reference docs.
- **Sparse activation:** skills activate on clear trigger phrases or explicit request. They do not override default model behaviour for tasks that don't require them.
- **Always enabled:** skills are context-efficient (catalog entries are short; only the matched skill body loads). Leave all skills enabled.
- **No secrets or credentials:** all skill files are safe to publish publicly.

## Importing into TypingMind

Plugins → Skills store → Add Skill → From GitHub URL → paste this repo URL → navigate to `skills/` → install all.
Requires TypingMind Cloud Sync sign-in for GitHub import. Alternatively, download as .zip and use From .zip file.

## Branch

Development on `self/dev`.
