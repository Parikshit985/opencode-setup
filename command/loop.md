---
description: Goal-driven loop — iterate until the goal is met, with guards and checkpoints. Usage: /loop <goal> [max-iterations]
agent: team
---

Run a goal-driven loop for: $ARGUMENTS (second argument optional = max iterations, default 5)

Rules:

1. Define a measurable success condition BEFORE starting — state what proves the goal is met.
2. Max iterations: 5 by default, or the number given.
3. Each iteration: do the work, verify with tests/checks, record a checkpoint note in the memory vault `<VAULT_PATH>`, then decide: continue / stop-success / stop-failed.
4. Never start a new iteration without a recorded checkpoint from the previous one.
5. If an iteration makes no progress (same failure twice), stop and report the blocker instead of retrying blindly.
6. The doom_loop permission is set to ask — treat it as a hard guard. Never attempt an unbounded loop.

Finish with: iterations used, what changed per iteration, final status.