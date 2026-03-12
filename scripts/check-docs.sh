#!/usr/bin/env bash
# Run docs validation locally (markdownlint, Lychee, cspell).
# Mirrors .github/workflows/check-docs.yml for docs-only PRs.

set -e

run_markdownlint() {
	if command -v markdownlint-cli2 >/dev/null 2>&1; then
		markdownlint-cli2 "**/*.md" "!**/node_modules/**" "!**/result/**"
	else
		nix run nixpkgs#markdownlint-cli2 -- "**/*.md" "!**/node_modules/**" "!**/result/**"
	fi
}

run_lychee() {
	if command -v lychee >/dev/null 2>&1; then
		lychee --no-progress --max-retries 5 .
	else
		nix run nixpkgs#lychee -- --no-progress --max-retries 5 .
	fi
}

run_cspell() {
	# Scope to markdown only (matches docs CI; avoids coverage/dist noise)
	if command -v cspell >/dev/null 2>&1; then
		cspell lint "**/*.md" "!**/node_modules/**" "!**/result/**"
	else
		nix run nixpkgs#cspell -- lint "**/*.md" "!**/node_modules/**" "!**/result/**"
	fi
}

run_markdownlint
run_lychee
run_cspell
