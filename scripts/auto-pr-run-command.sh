#!/usr/bin/env bash
# Run auto-pr command from workspace or package.
# Usage: auto-pr-run-command.sh <get-commits|generate-content>
# Requires: USE_WORKSPACE, AUTO_PR_PKG, RUNNER (for package mode)
# From https://github.com/knirski/auto-pr/blob/main/scripts/auto-pr-run-command.sh

set -euo pipefail

CMD="${1:?Usage: auto-pr-run-command.sh <get-commits|generate-content>}"
USE_WORKSPACE="${USE_WORKSPACE:?}"
AUTO_PR_PKG="${AUTO_PR_PKG:?}"
RUNNER="${RUNNER:?}"

case "$CMD" in
get-commits)
	BIN="auto-pr-get-commits"
	SCRIPT="get-commits"
	;;
generate-content)
	BIN="auto-pr-generate-content"
	SCRIPT="generate-content"
	;;
*)
	echo "::error::Unknown command: $CMD"
	exit 1
	;;
esac

if [ "$USE_WORKSPACE" = "true" ]; then
	bun run "$SCRIPT"
else
	$RUNNER -p "$AUTO_PR_PKG" "$BIN"
fi
