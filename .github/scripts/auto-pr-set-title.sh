#!/usr/bin/env bash
# Set PR title from semantic commits or Ollama.
# For 1 semantic commit: use its subject. For 2+: use Ollama to summarize.
#
# Requires env: COMMIT_COUNT (from get-commits step), GITHUB_OUTPUT
# Optional env: OLLAMA_MODEL (default: llama3.1:8b)
# Reads: semantic_subjects.txt (from get-commits step)

set -euo pipefail

: "${COMMIT_COUNT:?COMMIT_COUNT required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT required}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.1:8b}"

sanitize_for_output() {
	local v="$1"
	v=$(printf '%s' "$v" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
	v="${v:0:72}"
	printf '%s' "$v" | sed 's/%/%25/g; s/\r/%0D/g; s/\n/%0A/g'
}

if [ "$COMMIT_COUNT" = "1" ]; then
	TITLE=$(head -1 semantic_subjects.txt)
else
	{
		echo "Generate a single conventional commit title (max 72 chars) that summarizes this PR."
		echo "Format: type(scope): subject (e.g. feat: add X, fix(ci): resolve bug)."
		echo "Use the most significant type from the commits. Reply with only the title, nothing else."
		echo "Do not wrap the title in quotes."
		echo ""
		echo "Commits:"
		sed 's/^/- /' semantic_subjects.txt
	} > prompt.txt
	BODY=$(jq -n --rawfile p prompt.txt --arg m "$OLLAMA_MODEL" '{model: $m, prompt: $p, stream: false}')

	TITLE=""
	for attempt in 1 2 3; do
		RAW=$(curl -s http://localhost:11434/api/generate -d "$BODY" | jq -r '.response')
		TITLE=$(printf '%s' "$RAW" | sed 's/^"//;s/"$//' | head -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
		if [ -n "$TITLE" ] && [ "$TITLE" != "null" ]; then
			if npx tsx scripts/fill-pr-body.ts --validate-title "$TITLE" 2>/dev/null; then
				break
			fi
		fi
		[ "$attempt" -lt 3 ] && { echo "::warning::Ollama attempt $attempt failed (empty or invalid title), retrying in 3s..."; sleep 3; }
	done

	if [ -z "$TITLE" ] || [ "$TITLE" = "null" ] || ! npx tsx scripts/fill-pr-body.ts --validate-title "$TITLE" 2>/dev/null; then
		echo "::error::Failed to generate valid PR title with Ollama. Using first commit subject as fallback."
		TITLE=$(head -1 semantic_subjects.txt)
	fi
fi

echo "title=$(sanitize_for_output "$TITLE")" >> "$GITHUB_OUTPUT"
