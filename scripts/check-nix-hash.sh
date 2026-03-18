#!/usr/bin/env bash
# Warn when bun.lock changed and bun.nix may be stale.
# CI will update bun.nix automatically when you push (same-repo PRs and main).
# This script never modifies files or fails the check.

set -e

bun_lock_changed() {
	git diff --name-only HEAD -- bun.lock 2>/dev/null | grep -q .
}

warn_mismatch() {
	echo "warning: bun.nix may be out of date (bun.lock changed)." >&2
	echo "" >&2
	echo "CI will update bun.nix automatically when you push. No need to commit this change." >&2
	echo "" >&2
	echo "If you prefer to fix locally:" >&2
	echo "  nix run .#update-bun-nix" >&2
	echo "  git add bun.nix && git commit -m 'fix(nix): update bun.nix for bun.lock'" >&2
	echo "" >&2
}

bun_lock_changed || exit 0

if ! command -v nix >/dev/null 2>&1; then
	echo "warning: bun.lock changed. Nix not installed; cannot verify bun.nix locally." >&2
	echo "" >&2
	echo "CI will update bun.nix when you push. No need to do anything." >&2
	exit 0
fi

# Check if bun.nix was modified together with bun.lock (user ran update-bun-nix)
bun_nix_changed() {
	git diff --name-only HEAD -- bun.nix 2>/dev/null | grep -q .
}
if bun_nix_changed; then
	# Both changed — likely user ran update-bun-nix. No warning.
	exit 0
fi

warn_mismatch
exit 0
