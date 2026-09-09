---
name: model-router
description: Model routing decisions — which agent and model tier to use per task, when small_model suffices, when to escalate, and how to correct routing from telemetry. Use when planning agent assignment, choosing a model, or reviewing routing effectiveness.
---

# Model Routing

Routes every request to the cheapest agent/model combination that can complete it reliably.

## Routing table

| Task type | Route to | Model tier |
|---|---|---|
| Quick questions, summaries, /observe | Answer directly (no agent) | small/fast |
| Domain research, specs, architecture | researcher, pm, architect | default |
| Code implementation | backend / engineer | default |
| Tests, reviews, edge cases | qa | default |
| Infra, CI/CD, pipelines | devops / cicd | default |
| Docs, copy | docs-writer, marketing | default |
| Pricing, unit economics | finance | default |
| Long multi-step builds | team lead (orchestrates) | default, escalate when stuck |

## Rules

1. Never use a large model where a small one suffices (summaries, titles, simple edits, log triage).
2. Escalate to a larger model only after 2 failed attempts or when the task is novel/complex.
3. Agent capability beats raw model power: routing to the right specialist is worth more than a stronger model on the wrong job.
4. Review routing weekly: /observe + /retro. When a route fails repeatedly in telemetry, fix the routing table or the agent's prompt — do not just escalate models.
5. Agent `model:` overrides exist but should stay unset unless this table demands otherwise — inherit the default.
6. Keep system prompts byte-stable within a session (see context-hygiene) — changing them kills prompt-cache hits and costs money.