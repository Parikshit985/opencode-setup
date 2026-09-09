---
name: context-hygiene
description: Progressive disclosure and prompt-caching discipline — keep context lean, summarize first, expand on demand, keep system prompts stable, respect output limits. Use when writing prompts, planning multi-step work, or when context grows large.
---

# Context Hygiene

Protects context window, latency, and cost.

## Progressive disclosure

1. Give each step only the context it needs: summaries first, details on demand.
2. After finishing a step, hand off a tight summary + pointers, never raw dumps.
3. Use @references and file reads instead of pasting large files into prompts.
4. In multi-agent runs, each agent receives only its slice of the plan.
5. Prefer grep/glob over reading whole files; read tails over full logs.

## Prompt caching

1. Keep system prompts and skill instructions byte-stable within a session; change them only between sessions.
2. Order messages so volatile content (tool outputs, chat) comes AFTER stable content (system prompt, skills, config) — cache hits depend on prefix stability.
3. Do not re-word the same instruction repeatedly.
4. Avoid dynamic text in command templates that run repeatedly (dates, random phrasing).
5. When a task repeats, prefer a skill file over re-typing the instructions.

## Output limits

- tool_output is configured with max_lines/max_bytes — respect those in your own summaries.
- Never dump an entire log into context; read the tail or grep for the error.
- The orchestrator plugin truncates strings above 20k chars — plan for that, don't fight it.