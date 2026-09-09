# startup

| File | OS | Purpose |
| ---- | -- | ------- |
| `start-office.ps1` | Windows | Logon launcher: `opencode serve` (:41017) + `pixel-agents --port 4748`. Idempotent, hidden windows, logs to `~/.config/opencode/logs/`. Ported to portable `$HOME` paths (TODOs inline for `$WorkDir`). |
| `start-office.sh` | Mac/Linux | Equivalent: `nohup` background launches, same ports/logs. `chmod +x start-office.sh`. Set `WORK_DIR` env to override the serve dir (default `~/Desktop`). |

Both always exit 0 and skip anything whose port is already listening.
