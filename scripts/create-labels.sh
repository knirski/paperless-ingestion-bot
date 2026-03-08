#!/usr/bin/env bash
# Creates labels required by update-flake-lock workflow.
# Run once before the first scheduled run. Idempotent: re-run skips existing labels.
#
# Requires: gh CLI, authenticated to the repo.

set -euo pipefail

gh label create "dependencies" --color "0366d6" --description "Dependency updates" || true
gh label create "nix" --color "7f7f7f" --description "Nix-related changes" || true
gh label create "automated" --color "ededed" --description "Automated by CI" || true
