---
description: Full pipeline for a feature idea — research, spec, build, test, ship. Usage: /orchestrate <idea>
agent: team
---

The founder wants a full pipeline for: $ARGUMENTS

Run the complete workflow with the specialist team:

1. researcher — research the domain, present options with a recommendation
2. pm — turn the brief into a spec with user stories, acceptance criteria, edge cases
3. architect — system design: data flow, service boundaries, API contracts
4. backend/engineer — implement per the design
5. qa — verify with tests, hunt edge cases, review the work
6. devops — deployment/CI if applicable; docs-writer — README/API docs
7. finance — only if pricing or costs are involved

Working rules for this run:

- Progressive disclosure: keep handoffs tight — summaries first, expand only what the next step needs.
- Read memory (search the vault `<VAULT_PATH>`) at start; append findings at the end (memory-protocol skill).
- Parallelize independent steps with the Task tool (parallel fan-out when possible).
- Log a short status line per step so the founder can follow along.
- Guard the founder's time: skip any step that is not needed for this task.

Finish with a 2-3 line summary: what each specialist did and what the founder must decide.