#!/usr/bin/env bash
# Uninstall pdf-reader plugin from Claude Code (user scope).

set -euo pipefail

PLUGIN_NAME="pdf-reader"

if ! command -v claude >/dev/null 2>&1; then
  echo "error: 'claude' CLI not found in PATH" >&2
  exit 1
fi

claude plugin uninstall "$PLUGIN_NAME" --scope user

echo "Uninstalled '$PLUGIN_NAME' plugin. You may now delete this repo directory if desired."
