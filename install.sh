#!/usr/bin/env bash
# Install pdf-reader as a Claude Code plugin under user scope.
# Idempotent: re-running replaces any prior install.

set -euo pipefail

PLUGIN_NAME="pdf-reader"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_ENTRY="$REPO_DIR/dist/index.js"
SETTINGS_DIR="$HOME/.claude/plugin-settings"
SETTINGS_FILE="$SETTINGS_DIR/pdf-reader.json"

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
  echo "       To rebuild from source: bun install --frozen-lockfile --ignore-scripts && bun run build" >&2
  exit 1
fi

# Drop a template config on first install only; never overwrite user edits.
mkdir -p "$SETTINGS_DIR"
if [ ! -f "$SETTINGS_FILE" ]; then
  cat > "$SETTINGS_FILE" <<'JSON'
{
  "_comment": "Allow/deny lists for pdf-reader-mcp. Empty arrays = permissive. Deny always wins.",
  "_docs": "Path patterns are shell globs (minimatch). URL patterns match the hostname only; '*' matches any chars including dots.",
  "_ssrf_floor": "The built-in SSRF block list (loopback, link-local, RFC 1918 private ranges) is ALWAYS enforced on URLs regardless of this file.",

  "path": {
    "allow": [],
    "deny": []
  },
  "url": {
    "allow": [],
    "deny": []
  },
  "maxFileSizeMB": 300
}
JSON
  echo "Created default config: $SETTINGS_FILE"
fi

claude plugin uninstall "$PLUGIN_NAME" --scope user >/dev/null 2>&1 || true
claude plugin install "$REPO_DIR" --scope user

echo "Installed '$PLUGIN_NAME' plugin (user scope) from $REPO_DIR"
echo
echo "Config:  $SETTINGS_FILE"
echo "Verify:  claude plugin list"
echo "In a Claude session, run:  /mcp"
