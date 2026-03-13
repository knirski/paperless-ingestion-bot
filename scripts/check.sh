#!/usr/bin/env bash
# Run full check: core, docs (rumdl, typos), CI extras (actionlint, shellcheck).
# Lychee (link check, ~10s) is opt-in: set CHECK_LINKS=1.
# See docs/CI.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Core
bash scripts/check-nix-hash.sh
npm audit --audit-level=high
npm run test
npm run lint
npm run knip
npm run typecheck

# Docs
"$SCRIPT_DIR/nix-run-if-missing.sh" rumdl check .
"$SCRIPT_DIR/nix-run-if-missing.sh" typos
if [ "${CHECK_LINKS:-0}" = "1" ]; then
	"$SCRIPT_DIR/nix-run-if-missing.sh" lychee --timeout 30 --max-retries 10 --retry-wait-time 2 .
fi

# CI extras
"$SCRIPT_DIR/nix-run-if-missing.sh" actionlint
find scripts .github/scripts -name '*.sh' -print0 | xargs -0 -r "$SCRIPT_DIR/nix-run-if-missing.sh" shellcheck
