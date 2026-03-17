#!/usr/bin/env bash
# Run CI workflow locally via gh act or act. Requires Docker.
# Usage: run-check-ci.sh

set -euo pipefail

ci_workflow=".github/workflows/ci.yml"
ci_event="workflow_dispatch"
ci_job="check"

run_gh_act() {
	gh act -W "$ci_workflow" "$ci_event" -j "$ci_job"
}

run_act() {
	act -W "$ci_workflow" "$ci_event" -j "$ci_job"
}

run_gh_act || run_act || {
	echo ""
	echo "check:ci failed. To run CI locally, install:"
	echo "  - Docker: https://docs.docker.com/get-docker/"
	echo "  - gh act: gh extension install nektos/gh-act"
	echo "  - or act:  brew install act (https://github.com/nektos/act#installation)"
	exit 1
}
