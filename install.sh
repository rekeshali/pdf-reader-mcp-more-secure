#!/usr/bin/env bash
# Install pdf-reader as a Claude Code plugin under user scope.
# Idempotent: re-running replaces any prior install.

set -euo pipefail

PLUGIN_NAME="pdf-reader"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_ENTRY="$REPO_DIR/dist/index.js"

if ! command -v node >/dev/null 2>&1; then
  echo "error: 'node' not found in PATH" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "error: node >=22 required (found $(node -v))" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "error: 'claude' CLI not found in PATH" >&2
  exit 1
fi

if [ ! -f "$DIST_ENTRY" ]; then
  echo "error: $DIST_ENTRY not found." >&2
  echo "       The build artifact should ship with the internal repo release." >&2
  echo "       To rebuild from source: npm ci --ignore-scripts --omit=optional && npm run build" >&2
  exit 1
fi

claude plugin uninstall "$PLUGIN_NAME" --scope user >/dev/null 2>&1 || true
claude plugin install "$REPO_DIR" --scope user

echo "Installed '$PLUGIN_NAME' plugin (user scope) from $REPO_DIR"
echo
echo "Verify:  claude plugin list"
echo "In a Claude session, run:  /mcp"
