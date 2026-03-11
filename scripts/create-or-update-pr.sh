#!/usr/bin/env bash
# Create or update a PR from fill-pr-body output.
# Requires env: GH_TOKEN, BRANCH, DEFAULT_BRANCH, COMMITS, FILES, PR_TITLE

set -euo pipefail

for v in GH_TOKEN BRANCH DEFAULT_BRANCH COMMITS FILES PR_TITLE; do
	: "${!v:?$v required}"
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

npx tsx scripts/fill-pr-body.ts --log-file "$COMMITS" --files-file "$FILES" --format body --quiet > /tmp/pr-body.md

retry() {
	for attempt in 1 2 3; do
		"$@" && return 0
		[ "$attempt" -lt 3 ] && { echo "::warning::gh failed (attempt $attempt/3), retrying in 5s..."; sleep 5; }
	done
	echo "::error::gh failed after 3 attempts"
	exit 1
}

if gh pr view "$BRANCH" 2>/dev/null; then
	echo "PR exists, updating..."
	retry gh pr edit "$BRANCH" --title "$PR_TITLE" --body-file /tmp/pr-body.md
else
	echo "Creating PR..."
	retry gh pr create --base "$DEFAULT_BRANCH" --title "$PR_TITLE" --body-file /tmp/pr-body.md
fi
