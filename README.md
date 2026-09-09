# opencode-setup

Portable, GitHub-ready opencode setup: team agents, slash commands, skills, plugins, and MCP wiring (orchestrator + Obsidian + optional MiroFish). Clone on **Windows or Mac** and get the same connections.

Source: a working Windows `%USERPROFILE%\.config\opencode` config, sanitized for portability (no personal paths -- see [Sanitization](#sanitization)).

## What's inside

```
opencode-setup/
  opencode.jsonc.example   # portable config template (<VAULT_PATH>/<HOME>/<OBSIDIAN_EXE> placeholders)
  package.json.example     # @opencode-ai/plugin + opencode-obsidian deps
  .env.example             # VAULT_PATH, MEMORY_VAULT, OPENCODE_BIN, OBSIDIAN_EXE, MIROFISH_*
  agent/                   # 14 specialists (team lead + researcher/pm/architect/backend/engineer/qa/...)
  command/                 # 11 slash commands (/orchestrate /parallel /ship /retro /mirofish /research ...)
  skill/                   # 4 core skills (context-hygiene, memory-protocol, model-router, tool-poisoning-guard)
  skills/                  # 10 project skills (hyperframes*, media-use, motion-graphics) -- kept as-is
  plugin/                  # orchestrator.ts (telemetry+injection guard), pixel-agents.ts (office dashboard bridge)
  mcp/orchestrator/        # telemetry/memory/config/run_task MCP server (+ README)
  mcp/mirofish/            # OPTIONAL MiroFish prediction-engine MCP proxy (+ README)
  mcp/obsidian-cli.cmd + obsidian-cli-wrapper.js + obsidian-cli.sh  # Obsidian CLI shims (+ README)
  scripts/install.ps1 + install.sh + configure-vault.ps1/.sh        # one-command installers
  templates/cicd-opencode.yml  # GitHub Actions headless-agent template (used by /ship)
  startup/start-office.ps1 + start-office.sh  # background services launcher (+ README)
```

Obsidian is connected via the **`opencode-obsidian` plugin** (not an `mcp` block) -- the example preserves that shape.

## Prerequisites

- **Node.js 20+** (`node --version`)
- **opencode-ai** (installers run `npm i -g opencode-ai`)
- **Obsidian app running** with your vault open (official CLI requirement)
- Git + clone of this repo

## Clone

```sh
git clone <YOUR_GITHUB_URL> opencode-setup
cd opencode-setup
```

## Windows install

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

It prompts for your **vault path** (default `~/AgentMemory`) and **Obsidian.exe path**, then: copies everything to `$HOME/.config/opencode`, replaces `<VAULT_PATH>`/`<HOME>`/`<OBSIDIAN_EXE>`/`<MIROFISH_DIR>` placeholders, runs `npm install` in `mcp/orchestrator`, `mcp/mirofish`, and the config root, and sets `MEMORY_VAULT`/`OBSIDIAN_EXE` user env vars.

## Mac install

```sh
bash scripts/install.sh
```

Same flow for `~/.config/opencode`; makes `mcp/obsidian-cli.sh` executable; appends `MEMORY_VAULT` to `~/.zshrc` (or `~/.bashrc`). On Mac the `cliPath` in the installed `opencode.jsonc` points at `obsidian-cli.sh` (the official CLI works without a wrapper).

## Manual vault-path config

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts/configure-vault.ps1 -VaultPath 'D:\Notes\AgentMemory'
```

```sh
# Mac/Linux
VAULT_PATH="$HOME/Notes/AgentMemory" bash scripts/configure-vault.sh
```

Or copy `.env.example` → `~/.config/opencode/.env`, fill in `VAULT_PATH`/`MEMORY_VAULT`/`OBSIDIAN_EXE`/`MIROFISH_*`, and replace `<VAULT_PATH>` in `opencode.jsonc` + `agent/*.md` + `command/*.md` + `skill/memory-protocol/SKILL.md`.

## How to verify

1. Restart opencode (picks up new config + MCP servers).
2. `opencode mcp list` -- expect `orchestrator` (and `mirofish` if enabled).
3. In opencode, run the **`config_status`** tool (orchestrator MCP) -- shows telemetry file count, vault note count, and the first 40 lines of `opencode.jsonc`.
4. Ask something vault-backed (e.g. memory search) to confirm the Obsidian plugin answers.

## Troubleshooting

- **Obsidian must be running** with the vault open, or every Obsidian tool fails (official CLI limitation).
- **Installer-noise wrapper (Windows):** Obsidian 1.9.12 prints `Loading updated app package` / `Your Obsidian installer is out of date` into stdout, breaking the plugin's strict `JSON.parse`. `mcp/obsidian-cli-wrapper.js` strips those lines; set `OBSIDIAN_EXE` if your install moved. On Mac the shim just `exec`s `obsidian "$@"` -- if noise ever appears there, uncomment the filter in `mcp/obsidian-cli.sh`.
- **Telemetry dir auto-created:** `plugin/orchestrator.ts` creates `~/.config/opencode/telemetry/` on load; `/observe` + `/heal` + `telemetry_summary` read `run-*.jsonl`. Empty until you use opencode.
- **MiroFish optional, backend required for tooling:** `mirofish_*` tools auto-start the Flask backend (`MIROFISH_BACKEND_DIR`, default `~/MiroFish/backend`, log `.../logs/backend.log`) and wait ~45s. Needs `<MIROFISH_DIR>/.env` with `ZEP_API_KEY` + non-empty `LLM_API_KEY`. Disable by setting `"enabled": false` on the `mirofish` block.
- **`node --check` failures after editing MCP servers:** keep `stdout` reserved for MCP (log to `stderr` only).
- **Relative MCP paths:** the example uses `"command": ["node", "./mcp/orchestrator/index.js"]` (relative to the config dir). If your opencode build rejects relatives, use the absolute `<HOME>/.config/opencode/mcp/...` form noted in the comment.

## Sanitization

All personal paths replaced with placeholders:

| Original | Placeholder | Where |
| -------- | ----------- | ----- |
| `C:/Users/ADMIN`, `C:\Users\ADMIN` | `<HOME>` (`$HOME`/`~`) | `opencode.jsonc.example`, `startup/`, install scripts |
| `D:\Kaam\AgentMemory` | `<VAULT_PATH>` (`MEMORY_VAULT` env) | `agent/*.md`, `command/*.md`, `skill/memory-protocol/SKILL.md`, `mcp/orchestrator/index.js`, `opencode.jsonc.example` |
| `D:\Install\Obsidian\Obsidian.exe` | `<OBSIDIAN_EXE>` (`OBSIDIAN_EXE` env) | `mcp/obsidian-cli-wrapper.js`, `.env.example`, `opencode.jsonc.example` |
| `D:\MiroFish`, `...\uv.exe` fallbacks | `<MIROFISH_DIR>` (`MIROFISH_BACKEND_DIR`/`MIROFISH_BACKEND_LOG` env, `~/MiroFish/...` defaults) | `command/mirofish.md`, `command/research.md`, `mcp/mirofish/index.js` (+ added `os` require) |

`plugin/*.ts` needed no changes (already `homedir()`-based). `skills/*` had no personal paths -- copied as-is. `node_modules/`, `telemetry/`, `logs/`, `memory/` excluded (see `.gitignore`).

## License

MIT -- see [LICENSE](LICENSE).
