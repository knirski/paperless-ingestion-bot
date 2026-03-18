#!/usr/bin/env bash
# Set auto-pr package ref and use_workspace. Outputs to GITHUB_OUTPUT.
# Requires: REPO, REF_NAME, GITHUB_OUTPUT
# From https://github.com/knirski/auto-pr/blob/main/scripts/auto-pr-set-pkg.sh

set -euo pipefail

REPO="${REPO:?}"
REF_NAME="${REF_NAME:?}"
GITHUB_OUTPUT="${GITHUB_OUTPUT:?}"

# Validate ref_name: only allow safe branch chars to prevent code injection.
# For knirski/auto-pr on ai/* branches, use branch; else use published package.
if [ "$REPO" = "knirski/auto-pr" ] && [[ "$REF_NAME" =~ ^[a-zA-Z0-9/_.-]+$ ]]; then
	value="github:knirski/auto-pr#$REF_NAME"
else
	value="github:knirski/auto-pr"
fi
printf 'value=%s\n' "$value" >>"$GITHUB_OUTPUT"

# Use workspace when same repo: avoids "Package does not provide binary" when dist/ is gitignored.
if [ "$REPO" = "knirski/auto-pr" ]; then
	echo "use_workspace=true" >>"$GITHUB_OUTPUT"
else
	echo "use_workspace=false" >>"$GITHUB_OUTPUT"
fi
