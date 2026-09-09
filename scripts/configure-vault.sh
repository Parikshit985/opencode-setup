#!/usr/bin/env bash
# Re-point an installed ~/.config/opencode to a different Obsidian vault.
# Usage: VAULT_PATH="$HOME/Notes/AgentMemory" bash scripts/configure-vault.sh
set -euo pipefail
CONFIG_DIR="$HOME/.config/opencode"
VAULT_PATH="${VAULT_PATH:-${1:-}}"
if [ -z "$VAULT_PATH" ]; then
  read -r -p "Obsidian vault path [$HOME/AgentMemory]: " VAULT_PATH || true
  VAULT_PATH="${VAULT_PATH:-$HOME/AgentMemory}"
fi
export VAULT_PATH
perl -i -pe 's|<VAULT_PATH>|$ENV{VAULT_PATH}|g' "$CONFIG_DIR/opencode.jsonc"
find "$CONFIG_DIR" -name '*.md' -type f -exec perl -i -pe 's|<VAULT_PATH>|$ENV{VAULT_PATH}|g' {} +
echo "Vault set to $VAULT_PATH (opencode.jsonc). Also: export MEMORY_VAULT=\"$VAULT_PATH\" (persisted below if missing)."
SHELL_RC="$HOME/.zshrc"; [ -n "${BASH_VERSION:-}" ] && SHELL_RC="$HOME/.bashrc"
grep -q 'MEMORY_VAULT' "$SHELL_RC" 2>/dev/null || echo "export MEMORY_VAULT=\"$VAULT_PATH\"" >> "$SHELL_RC"
export MEMORY_VAULT="$VAULT_PATH"
echo "Restart opencode."
