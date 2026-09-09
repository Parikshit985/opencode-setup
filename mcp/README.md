# Obsidian MCP wiring (Windows + Mac)

Source setup connects Obsidian via the **`opencode-obsidian` plugin** (not an `mcp` block):

```jsonc
["opencode-obsidian", { "vaultPath": "<VAULT_PATH>", "cliPath": "<HOME>/.config/opencode/mcp/obsidian-cli.cmd" }]
// Mac: "cliPath": "<HOME>/.config/opencode/mcp/obsidian-cli.sh"
```

- `vaultPath` = your Obsidian vault root (`MEMORY_VAULT` / `VAULT_PATH` in `.env.example`).
- `cliPath` = OS-specific CLI shim (this folder).

## Files

| File | OS | Purpose |
| ---- | -- | ------- |
| `obsidian-cli.cmd` | Windows | `node obsidian-cli-wrapper.js %*` trampoline. |
| `obsidian-cli-wrapper.js` | Windows | Strips Obsidian 1.9.12 installer noise lines (`Loading updated app package`, `Your Obsidian installer is out of date`) that break the plugin's strict `JSON.parse`. Reads `OBSIDIAN_EXE` env var, fallback is the author's example path. Requires the Obsidian app **running**. |
| `obsidian-cli.sh` | Mac/Linux | Thin proxy to the system `obsidian` CLI. No wrapper needed on modern Obsidian; same noise filter applies if installer-noise reappears (see comments). |

## Env

- `OBSIDIAN_EXE` (Windows): full path to `Obsidian.exe`. Example: `C:\Users\you\AppData\Local\Obsidian\Obsidian.exe`.
- `MEMORY_VAULT` / vault `vaultPath`: same vault folder.
