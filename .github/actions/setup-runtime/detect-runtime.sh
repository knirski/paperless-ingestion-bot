#!/usr/bin/env bash
# Detect JS/TS runtime for running auto-pr (npx/bunx -p auto-pr).
# Outputs to stdout: runtime (node|bun), runner (npx|bunx), cache (npm|yarn|pnpm|'').
# Run from repo root (workspace). Action pipes stdout to GITHUB_OUTPUT.
#
# Detection order: packageManager (canonical) > lockfile > default node npx.
# Non-JS projects (Python, Rust, etc.): no lockfile → default to node npx (runs auto-pr).

set -e

emit() {
	local runtime="$1" runner="$2" cache="${3:-}"
	echo "runtime=$runtime"
	echo "runner=$runner"
	if [ -n "$cache" ]; then echo "cache=$cache"; fi
}

# 1. packageManager in package.json (canonical per Corepack)
if [ -f package.json ]; then
	pm=$(jq -r '.packageManager // empty' package.json 2>/dev/null)
	case "$pm" in
	bun@*) emit bun bunx ;;
	npm@*) emit node npx npm ;;
	pnpm@*) emit node npx pnpm ;;
	yarn@*) emit node npx yarn ;;
	*) : ;; # fall through to lockfile
	esac
	# Exit if we matched a known packageManager
	[ -n "$pm" ] && [[ "$pm" == bun@* || "$pm" == npm@* || "$pm" == pnpm@* || "$pm" == yarn@* ]] && exit 0
fi

# 2. Lockfile (bun.lock, bun.lockb, package-lock.json, yarn.lock, pnpm-lock.yaml)
if [ -f bun.lock ] || [ -f bun.lockb ]; then
	emit bun bunx
elif [ -f package-lock.json ]; then
	emit node npx npm
elif [ -f yarn.lock ]; then
	emit node npx yarn
elif [ -f pnpm-lock.yaml ]; then
	emit node npx pnpm
else
	# 3. Default: node npx (non-JS projects, or no package.json)
	emit node npx
fi
