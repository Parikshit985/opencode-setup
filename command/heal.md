---
description: Self-healing — diagnose recurring failures from telemetry and fix root causes. Usage: /heal [pattern]
agent: team
---

Diagnose and fix failures for: $ARGUMENTS (or the most recent ones if empty)

1. Scan ~/.config/opencode/telemetry/run-*.jsonl for tool failures, errors, and injection flags.
2. Cluster recurring failures by root cause (same tool, same error message, same repo).
3. Fix each root cause: broken scripts, missing dependencies, bad commands, permission gaps, prompt ambiguity.
4. Re-run the failing step headless to verify the fix (opencode run --agent <relevant-agent> "<step>").
5. Append findings to the memory vault `<VAULT_PATH>` (memory-protocol skill).

Report: what broke, what you fixed, what remains unfixable without the founder.