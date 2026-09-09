---
description: Multi-repo orchestration — fan the same task out across all git repos under a root folder, then merge reports. Usage: /multi <root-folder> <task>
agent: team
---

Orchestrate across repos for: $ARGUMENTS

1. Parse: first argument = root folder, the rest = the task.
2. Run the fan-out script:
   powershell -File ~/.config/opencode/scripts/multi.ps1 -Root <root> -Task "<task>" -Agent team
3. Read the generated report ($env:TEMP\opencode-multi\report.md).
4. Summarize per-repo outcomes, cross-repo dependencies, and follow-up actions.

If the root contains no git repos, list the folders and ask the founder which to include.