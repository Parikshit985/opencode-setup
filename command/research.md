---
description: Run a long research task using MiroFish (swarm simulation) as the engine, with opencode as the brain. Usage: /research <topic or question> [seed docs/requirements]
agent: team
---

Run a deep research/prediction task on the founder's behalf, driving MiroFish's swarm
simulation engine through its MCP tools while opencode (you) stays the orchestrating brain.

Topic/requirement: $ARGUMENTS

## Preconditions
- MiroFish backend must be up: call `mirofish_health`. If down, run `/mirofish backend`, then
  re-poll health up to ~60s. If it stays down, diagnose `<MIROFISH_DIR>\.env` (keys) and surface to founder.
- Backend URL: http://localhost:5001 (overridable via MIROFISH_BASE_URL in the MCP server).

## Thought loop (strict order, poll with discipline)
1. PREFLIGHT: `mirofish_health` (above).
2. SEED: `mirofish_list_projects` then `mirofish_get_project`. Reuse any project already
   `GRAPH_COMPLETED` (ask the founder only if they want a fresh run). Else `mirofish_ontology_generate`
   with seed doc paths + the simulation requirement (LLM-bound, ~1-3 min).
3. BUILD: `mirofish_build_graph` -> poll `mirofish_task_status` every ~10s, ceiling ~15 min.
   Done when project status = GRAPH_COMPLETED and graph_id present. Treat reused:true as done.
4. SIMULATE: `mirofish_create_simulation` -> `mirofish_prepare_simulation` (skip if already_prepared)
   -> poll `mirofish_prepare_status` every ~10s, ceiling ~30 min -> `mirofish_simulation_start`
   -> poll `mirofish_simulation_status` every ~30s until terminal (completed|stopped|failed).
   On failed: one diagnostic look, then escalate to founder; NEVER auto-restart.
5. REPORT: `mirofish_generate_report` (returns 409 until run is terminal - re-poll run-status,
   don't blind-retry; reuse silently if already_generated) -> poll `mirofish_report_status`
   every ~15s, ceiling ~15 min -> `mirofish_get_report`.
6. INTERROGATE: `mirofish_report_chat` in a short loop (3-6 focused questions; pass chat_history
   back each turn). Pull `mirofish_simulation_timeline` / `mirofish_simulation_agent_stats` for evidence.
7. SYNTHESIZE: write the final research memo/answer citing report ID + simulation evidence.

## Polling hygiene
- One poll tool per phase, fixed interval; do useful work between polls (draft outline, summarize evidence).
- Keep only the LATEST status line in context (collapse older ones).
- Respect `reused`/`already_*`; only pass force flags when a prior attempt FAILED or founder wants a redo.
- Never run two simulations on the same graph concurrently (backend returns 409; treat as wait).

## Finish
- Give the founder a concise 2-3 line summary: what was simulated, the prediction/report ID, key findings,
  and what remains for them to decide.
- Append a short Learnings note to the Obsidian vault (<VAULT_PATH>\Learnings) per memory-protocol.
