---
description: Launch a background agent run detached from this session. Usage: /headless <agent> <task>
agent: team
---

Launch a headless background run for: $ARGUMENTS (first argument = agent, rest = task)

IMPORTANT: the agent must be a PRIMARY agent (e.g. `team`, or any agent with mode: primary). Subagents (general, qa, engineer...) fall back to the default agent headless.

Use the bash tool to start a detached `opencode run` process via the bundled exe (avoids PowerShell .cmd/.ps1 shim failures):

- Resolve the exe: run `Get-Command opencode`, then find `node_modules\opencode-ai\bin\opencode.exe` beside the returned command path
- Write the task to a temp file (clean quoting), then launch detached:
  `$task = Get-Content -Raw $env:TEMP\headless-task.txt; Start-Process -FilePath <exe> -ArgumentList 'run','--agent','team','--',"$task" -WindowStyle Hidden -RedirectStandardOutput <log> -RedirectStandardError <log>.err -PassThru`
- Report the PID and log path immediately (e.g. `$env:TEMP\opencode-headless\<name>.log`).
- Do NOT wait synchronously — the founder checks results later via /observe or by reading the log.

Keep the task prompt self-contained: the background run has no session context.