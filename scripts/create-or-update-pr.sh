#!/usr/bin/env bash
# Create or update a PR from fill-pr-body output.
# Used by auto-pr workflow. Requires GH_TOKEN in env.
#
# Usage: create-or-update-pr.sh <branch> <default-branch>
# Example: create-or-update-pr.sh ai/feature-x main

set -euo pipefail

BRANCH="${1:?branch required}"
DEFAULT="${2:?default branch required}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

npx tsx scripts/fill-pr-body.ts "origin/$DEFAULT" --format title-body --ai-title > /tmp/pr-output.txt
OUTPUT=$(cat /tmp/pr-output.txt)
TITLE=$(echo "$OUTPUT" | head -1)

if [ -z "$TITLE" ]; then
	echo "::error::PR title is empty. Add at least one non-merge commit with non-empty subject (e.g. feat: add X) before pushing."
	exit 1
fi

echo "$OUTPUT" | tail -n +3 > /tmp/pr-body.md

if gh pr view "$BRANCH" 2>/dev/null; then
	echo "PR exists, updating..."
	for attempt in 1 2 3; do
		gh pr edit "$BRANCH" --title "$TITLE" --body-file /tmp/pr-body.md && exit 0
		[ "$attempt" -lt 3 ] && { echo "::warning::gh pr edit failed (attempt $attempt/3), retrying in 5s..."; sleep 5; }
	done
	echo "::error::gh pr edit failed after 3 attempts"
	exit 1
else
	echo "Creating PR..."
	for attempt in 1 2 3; do
		gh pr create --base "$DEFAULT" --title "$TITLE" --body-file /tmp/pr-body.md --draft && exit 0
		[ "$attempt" -lt 3 ] && { echo "::warning::gh pr create failed (attempt $attempt/3), retrying in 5s..."; sleep 5; }
	done
	echo "::error::gh pr create failed after 3 attempts"
	exit 1
fi
