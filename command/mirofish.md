---
description: Start/stop MiroFish (swarm-intelligence prediction engine) from inside opencode. Usage: /mirofish [start|backend|frontend|status|stop|help]
agent: team
---

Start or manage the MiroFish prediction engine located at `<MIROFISH_DIR>`.

Architecture (opencode = brain, MiroFish = tool):
- MiroFish's simulated agents run on opencode's FREE models via the OpenCode Zen
  OpenAI-compatible endpoint (https://opencode.ai/zen/v1, model hy3-free in .env).
  No external LLM API key is needed — the free endpoint is keyless.
- opencode agents drive MiroFish programmatically through MCP tools (`mirofish_*`)
  exposed by `~/.config/opencode/mcp/mirofish/index.js` (registered in opencode.jsonc).
  The MCP server AUTO-STARTS the Flask backend on the first tool call if it isn't
  already running, so you do NOT need to start it manually first.

MiroFish services:
- Frontend (Vite/Vue): http://localhost:3000  (only for the manual UI; not needed for tooling)
- Backend API (Flask): http://localhost:5001   (health: http://localhost:5001/health) — REQUIRED for tooling

Commands (argument = `$ARGUMENTS`):
- `start` (default): launch the full stack via `npm run dev` from `<MIROFISH_DIR>` (backend + frontend).
  Note: for tooling use you normally do NOT need this — the `mirofish_*` MCP tools auto-start
  the backend on demand. `start`/`backend` are for the manual UI or pre-warming.
- `backend`: launch only the backend (`cmd /c "cd /d <MIROFISH_DIR>\backend && uv run python run.py"`).
- `frontend`: launch only the frontend (`cmd /c "cd /d <MIROFISH_DIR>\frontend && npm run dev"`).
- `status` / `health`: check whether ports 3000/5001 are listening and call the backend health endpoint.
- `stop`: stop the running MiroFish dev processes.
- `help`: print this usage.

Prerequisites:
- `<MIROFISH_DIR>\.env` must have `ZEP_API_KEY` set (Zep Cloud, free tier) and a non-empty
  `LLM_API_KEY` (we use placeholder `opencode-free-zen`). Backend exits on startup if either is empty.
- Tuning knobs in `.env`: `OASIS_DEFAULT_MAX_ROUNDS` (<40 recommended, default 10),
  `LLM_MAX_CONCURRENCY` / `LLM_RATE_PER_MIN` (free-tier 429 throttle), `LLM_STRONG_MODEL` (optional).

Log a short status line (ports up, health result) so the founder can follow along.
