#!/usr/bin/env bash
# obsidian-cli.sh -- Mac/Linux equivalent of obsidian-cli.cmd + obsidian-cli-wrapper.js.
# On modern Obsidian the official CLI works without a wrapper, so this is a thin proxy.
# If Obsidian installer-noise lines ever appear in stdout (cf. Windows 1.9.12 workaround),
# uncomment the NOISE filter below -- same regexes as the .js wrapper.
set -euo pipefail

# Allow override: OBSIDIAN_BIN=/path/to/obsidian obsidian-cli.sh search ...
BIN="${OBSIDIAN_BIN:-obsidian}"

if [ "$#" -eq 0 ]; then
  echo "usage: obsidian-cli <obsidian-command> [args]" >&2
  exit 2
fi

# Plain passthrough (no filtering):
exec "$BIN" "$@"

# --- Filtered variant (use instead of the exec above if noise appears): ---
# "$BIN" "$@" 2> >(cat >&2) | grep -vE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}[[:space:]]+Loading updated app package' | grep -vE '^Your Obsidian installer is out of date'
