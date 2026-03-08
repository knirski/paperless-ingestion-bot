#!/usr/bin/env bash
# Warn when package-lock.json changed and npmDepsHash may be stale.
# (Test comment for auto-pr workflow)
# CI will update default.nix automatically when you push (same-repo PRs and main).
# This script never modifies files or fails the check.

set -e

package_lock_changed() {
	git diff --name-only HEAD -- package-lock.json 2>/dev/null | grep -q .
}

warn_mismatch() {
	echo "warning: npmDepsHash in default.nix is out of date (package-lock.json changed)." >&2
	echo "" >&2
	echo "CI will update default.nix automatically when you push. No need to commit this change." >&2
	echo "" >&2
	echo "If you prefer to fix locally:" >&2
	echo "  With Nix:    nix run .#update-npm-deps-hash" >&2
	echo "  Without Nix: npm run update-nix-hash -- <hash>  (hash from CI 'Update npmDepsHash' step)" >&2
	echo "" >&2
}

package_lock_changed || exit 0

if ! command -v nix >/dev/null 2>&1; then
	echo "warning: package-lock.json changed. Nix not installed; cannot verify npmDepsHash locally." >&2
	echo "" >&2
	echo "CI will update default.nix when you push. No need to do anything." >&2
	exit 0
fi

expected=$(nix run nixpkgs#prefetch-npm-deps -- package-lock.json 2>/dev/null) || true
if [ -z "$expected" ]; then
	echo "warning: package-lock.json changed. Could not compute npmDepsHash (prefetch-npm-deps failed)." >&2
	echo "" >&2
	echo "CI will update default.nix when you push." >&2
	exit 0
fi

current=$(sed -n 's/.*npmDepsHash = "\([^"]*\)".*/\1/p' default.nix 2>/dev/null | head -1)
if [ -z "$current" ] || [[ ! "$current" =~ ^sha256-[A-Za-z0-9+/=]+$ ]]; then
	echo "warning: Could not parse npmDepsHash from default.nix (expected format: npmDepsHash = \"sha256-...\"). Skipping check." >&2
	exit 0
fi
if [ "$expected" != "$current" ]; then
	warn_mismatch
fi
exit 0
