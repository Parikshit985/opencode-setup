# orchestrator MCP server

Local MCP server exposing the orchestration platform to opencode agents.

Tools: `telemetry_summary`, `telemetry_errors`, `memory_read`, `config_status`, `run_task`.

## Install

```sh
cd ~/.config/opencode/mcp/orchestrator
npm install
```

(or on Windows, same from PowerShell).

## Env vars

| Var | Default | Purpose |
| --- | ------- | ------- |
| `MEMORY_VAULT` | `~/AgentMemory` | Obsidian vault root (contains `Learnings/`). Replaces the author's `<VAULT_PATH>` default. |
| `OPENCODE_BIN` | `opencode` | Binary used by `run_task` for headless `opencode run` launches. |

All logs go to stderr (stdout is MCP protocol). Telemetry is read from
`~/.config/opencode/telemetry/run-*.jsonl` (auto-created by `plugin/orchestrator.ts`).
