#!/usr/bin/env bash
# Updates npmDepsHash in default.nix when package-lock.json has changed.
# Used by CI and update-nix-hash workflow.
#
# When an update is made: prints "hash=sha256-xxx" to stdout (for GITHUB_OUTPUT).
# When no update needed: exits 0 with no output.
# On error: exits 1.
#
# Must run from repository root (parent of default.nix and package-lock.json).

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [[ ! -f default.nix ]] || [[ ! -f package-lock.json ]]; then
	echo "::error::default.nix or package-lock.json not found (run from repo root)" >&2
	exit 1
fi

expected=$(nix run nixpkgs#prefetch-npm-deps -- package-lock.json)
if [ -z "$expected" ] || [[ ! "$expected" =~ ^sha256-[A-Za-z0-9+/=]+$ ]]; then
	echo "::error::prefetch-npm-deps failed or returned invalid hash" >&2
	exit 1
fi

current=$(sed -n 's/.*npmDepsHash = "\([^"]*\)".*/\1/p' default.nix | head -1)
if [ -z "$current" ] || [[ ! "$current" =~ ^sha256-[A-Za-z0-9+/=]+$ ]]; then
	echo "::error::Could not parse npmDepsHash from default.nix (expected format: npmDepsHash = \"sha256-...\")" >&2
	exit 1
fi

if [ "$expected" = "$current" ]; then
	echo "Hash correct, no update needed" >&2
	exit 0
fi

sed -i "s|npmDepsHash = \"sha256-[^\"]*\"|npmDepsHash = \"$expected\"|" default.nix
echo "Updated npmDepsHash in default.nix" >&2
echo "hash=$expected"
