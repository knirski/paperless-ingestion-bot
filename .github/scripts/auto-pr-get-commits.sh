#!/usr/bin/env bash
# Get commit log and changed files for auto-PR workflow.
# Writes commits.txt, subjects.txt, files.txt, semantic_subjects.txt.
# Outputs to GITHUB_OUTPUT: commits, files, count (semantic commit count).
#
# Requires env: DEFAULT_BRANCH (e.g. main), GITHUB_WORKSPACE, GITHUB_OUTPUT

set -euo pipefail

: "${DEFAULT_BRANCH:?DEFAULT_BRANCH required}"
: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT required}"

BASE_REF="origin/${DEFAULT_BRANCH}"

git log --format="---COMMIT---%n%s%n%n%b" "$BASE_REF..HEAD" > commits.txt
git log --format="%s" "$BASE_REF..HEAD" > subjects.txt
git diff --name-only "$BASE_REF..HEAD" > files.txt

# Exclude merge commits and blank lines; count only semantic commits for Ollama decision
grep -vi '^Merge ' subjects.txt | grep -v '^[[:space:]]*$' > semantic_subjects.txt
COUNT=$(wc -l < semantic_subjects.txt | tr -d ' ')

if [ "$COUNT" -eq 0 ]; then
	echo "::error::No semantic commits (all merge or non-semantic). Add at least one non-merge commit before pushing to ai/ branch."
	exit 1
fi

{
	echo "commits=${GITHUB_WORKSPACE}/commits.txt"
	echo "files=${GITHUB_WORKSPACE}/files.txt"
	echo "count=$COUNT"
} >> "$GITHUB_OUTPUT"
