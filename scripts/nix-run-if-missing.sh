#!/usr/bin/env bash
# Run command if in PATH, else nix run nixpkgs#<command>.
# Usage: nix-run-if-missing.sh <command> [args...]
# Example: nix-run-if-missing.sh typos
# Example: find scripts -name "*.sh" -print0 | xargs -0 -r nix-run-if-missing.sh shellcheck

set -euo pipefail

cmd="${1:?Usage: nix-run-if-missing.sh <command> [args...]}"
shift

if command -v "$cmd" >/dev/null 2>&1; then
	exec "$cmd" "$@"
else
	exec nix run "nixpkgs#$cmd" -- "$@"
fi
