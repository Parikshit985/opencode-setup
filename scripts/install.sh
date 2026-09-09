#!/usr/bin/env bash
# Mac/Linux installer: clone -> portable opencode setup (~/.config/opencode).
# Usage: bash scripts/install.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$HOME/.config/opencode"

echo "== opencode-setup Mac/Linux install =="

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found on PATH. Install Node.js 20+ (https://nodejs.org), then re-run." >&2
  exit 1
fi
NODE_VER="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: node $NODE_VER found, but >=20 required." >&2
  exit 1
fi
echo "node $NODE_VER ok ($(command -v node))"

VAULT_DEFAULT="$HOME/AgentMemory"
read -r -p "Obsidian vault path [$VAULT_DEFAULT]: " VAULT || true
VAULT="${VAULT:-$VAULT_DEFAULT}"
read -r -p "MiroFish dir (optional, Enter to skip) [$HOME/MiroFish]: " MIRO_DIR || true
MIRO_DIR="${MIRO_DIR:-$HOME/MiroFish}"

echo "Installing opencode-ai globally (npm i -g opencode-ai)..."
npm i -g opencode-ai

echo "Copying files to $CONFIG_DIR ..."
mkdir -p "$CONFIG_DIR"
for d in agent command skill skills plugin mcp templates startup scripts; do
  if [ -d "$REPO_ROOT/$d" ]; then
    mkdir -p "$CONFIG_DIR/$d"
    cp -R "$REPO_ROOT/$d/." "$CONFIG_DIR/$d/"
  fi
done
cp "$REPO_ROOT/opencode.jsonc.example" "$CONFIG_DIR/opencode.jsonc"
cp "$REPO_ROOT/package.json.example" "$CONFIG_DIR/package.json"
[ -f "$REPO_ROOT/.env.example" ] && cp "$REPO_ROOT/.env.example" "$CONFIG_DIR/.env.example" || true
chmod +x "$CONFIG_DIR/mcp/obsidian-cli.sh" 2>/dev/null || true

echo "Substituting placeholders (<VAULT_PATH>, <HOME>, <OBSIDIAN_EXE>, <MIROFISH_DIR>)..."
# Portable in-place sed (macOS + GNU)
sedi() { sed -i.bak "$@" ; rm -f *.bak 2>/dev/null || true; }
export VAULT HOME MIRO_DIR
find "$CONFIG_DIR" \( -name 'opencode.jsonc' -o -name '*.md' -o -name '*.js' -o -name '*.ps1' -o -name '*.sh' -o -name '.env.example' \) -type f | while IFS= read -r f; do
  perl -i -pe 's|<VAULT_PATH>|$ENV{VAULT}|g; s|<HOME>|$ENV{HOME}|g; s|<MIROFISH_DIR>|$ENV{MIRO_DIR}|g' "$f"
  # obsidian exe placeholder only matters on Windows; on Mac keep shim default
  perl -i -pe 's|<OBSIDIAN_EXE>|obsidian|g' "$f"
done

echo "npm install: mcp/orchestrator ..."
(cd "$CONFIG_DIR/mcp/orchestrator" && npm install)
echo "npm install: mcp/mirofish (optional) ..."
(cd "$CONFIG_DIR/mcp/mirofish" && npm install)
echo "npm install: config root (plugin deps) ..."
(cd "$CONFIG_DIR" && npm install)

# Persist MEMORY_VAULT for future shells (append once)
SHELL_RC="$HOME/.zshrc"
[ -n "${BASH_VERSION:-}" ] && SHELL_RC="$HOME/.bashrc"
if ! grep -q 'MEMORY_VAULT' "$SHELL_RC" 2>/dev/null; then
  echo "export MEMORY_VAULT=\"$VAULT\"" >> "$SHELL_RC"
  echo "(appended MEMORY_VAULT to $SHELL_RC)"
fi
export MEMORY_VAULT="$VAULT"

echo ""
echo "Done. Next:"
echo "  1. Start the Obsidian app and open your vault."
echo "  2. Restart opencode, then verify: opencode mcp list  (expect orchestrator; mirofish optional)"
echo "  3. In opencode, run the config_status tool (orchestrator MCP)."
echo "  4. Optional: export MIROFISH_BACKEND_DIR if you use /mirofish + /research."
