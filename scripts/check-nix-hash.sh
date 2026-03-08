#!/usr/bin/env bash
# Update npmDepsHash in default.nix when Nix is available and package-lock.json changed.
# When Nix is unavailable and package-lock.json changed, warn that CI may fail.

set -e

package_lock_changed() {
	git diff --name-only HEAD -- package-lock.json 2>/dev/null | grep -q . || \
	git diff --cached --name-only -- package-lock.json 2>/dev/null | grep -q .
}

if ! command -v nix >/dev/null 2>&1; then
	if package_lock_changed; then
		echo "warning: Nix not installed. package-lock.json changed; CI nix job may fail." >&2
		echo "" >&2
		echo "Do one of:" >&2
		echo "  1. Install Nix (https://nixos.org/download/), run: nix run .#update-npm-deps-hash" >&2
		echo "  2. Push and let CI fail; expand the 'Verify npmDepsHash' step and copy the hash. Run: npm run update-nix-hash -- <hash>" >&2
		echo "" >&2
		echo "Then commit default.nix with your package-lock.json change." >&2
	fi
	exit 0
fi

package_lock_changed || exit 0
nix run .#update-npm-deps-hash
if git diff --name-only HEAD -- default.nix 2>/dev/null | grep -q . || \
   git diff --cached --name-only -- default.nix 2>/dev/null | grep -q .; then
	echo "" >&2
	echo "default.nix was updated. Commit it with your package-lock.json changes:" >&2
	echo "  git add default.nix && git commit -m 'fix(nix): update npmDepsHash for package-lock.json'" >&2
fi
