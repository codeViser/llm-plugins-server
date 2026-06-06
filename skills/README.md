# Skills

Agent skills for this TypingMind workspace, following the [Agent Skills](https://agentskills.io) open standard.

Each subdirectory is a standalone skill installable in TypingMind via GitHub URL or .zip import.

## Available Skills

| Skill | Description |
|---|---|
| [deep-research](./deep-research/) | Web-grounded multi-source research with triangulation, selective extraction, and inline citations. |
| [deep-analysis](./deep-analysis/) | Rigorous multi-step reasoning with alternatives, edge cases, and explicit validation. |
| [adversarial-synthesis](./adversarial-synthesis/) | Critic/actor/judge adversarial review; also orchestrates MARS plugin when enabled. |

## Design Philosophy

- **All skills are always enabled** — they are context-efficient (catalog entries are short; full instructions load on demand).
- **Skills do not mandate automatic execution** — they load when the task matches and the model decides to use them.
- **No secrets or credentials** inside any skill file. These files are safe to publish publicly.
- **Skills replace always-on system prompt bloat** — detailed workflow instructions live here, not in the global system prompt.

## Installation

In TypingMind: Plugins → Skills store → Add Skill → From GitHub URL → paste this repo URL and select skills/ folder.
Or import as .zip. Requires TypingMind Cloud Sync sign-in for GitHub import.

## Branch

Development happens on the self/dev branch.