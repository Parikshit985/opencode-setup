---
description: Self-improvement pass — review telemetry and learnings, then improve your own config (agents, skills, commands, permissions). Usage: /retro
agent: improver
---

Run a self-improvement pass:

1. Read the latest telemetry: ~/.config/opencode/telemetry/run-*.jsonl — errors, injection flags, tool usage.
2. Read memory: search the Obsidian vault at `<VAULT_PATH>` (memory-protocol skill) — especially notes tagged #self-improve.
3. Identify 1-3 concrete improvements: repeated failures, routing mistakes, weak prompts, missing guardrails.
4. Apply them: edit agent prompts, skills, commands, or permission rules under ~/.config/opencode/.
5. Log each change as a note tagged #self-improve in `<VAULT_PATH>\Learnings\YYYY-MM-DD - self-improve <topic>.md` with the rationale.
6. Report what changed and why; flag anything you deliberately did NOT change.

Constraints: never change default_agent, never disable the team agent, keep every edit minimal and reversible.