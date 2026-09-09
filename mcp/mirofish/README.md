# mirofish MCP server (OPTIONAL)

Local MCP server proxying the MiroFish prediction-engine REST API as typed
`mirofish_*` tools (health, projects, ontology, graph, simulation, report).
Only needed for `command/mirofish.md` (`/mirofish`) and `command/research.md` (`/research`).

## Install

```sh
cd ~/.config/opencode/mcp/mirofish
npm install
```

To disable: set `"enabled": false` on the `mirofish` block in `opencode.jsonc`
(or delete the block).

## Env vars

| Var | Default | Purpose |
| --- | ------- | ------- |
| `MIROFISH_BASE_URL` | `http://localhost:5001` | Flask backend base URL. |
| `MIROFISH_BACKEND_DIR` | `~/MiroFish/backend` | Dir containing `run.py`. MCP auto-starts the backend on first tool call if down (waits ~45s). Original author default was `<MIROFISH_DIR>/backend`. |
| `MIROFISH_BACKEND_LOG` | `~/MiroFish/backend/logs/backend.log` | Auto-start backend log file. |

Backend prerequisites live in `<MIROFISH_DIR>/.env`: `ZEP_API_KEY` (Zep Cloud,
free tier) and non-empty `LLM_API_KEY` (e.g. placeholder `opencode-free-zen`).
Tuning knobs: `OASIS_DEFAULT_MAX_ROUNDS`, `LLM_MAX_CONCURRENCY` / `LLM_RATE_PER_MIN`.
