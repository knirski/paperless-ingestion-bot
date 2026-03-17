# setup-runtime

Composite action that sets up the JS/TS runtime matching the project's lockfile or `packageManager` field.

**Detection order:** `packageManager` (package.json) → lockfile → default node npx.

**Outputs:** `runner` (npx|bunx), `cache-hit`.

**Used by:** auto-pr-generate-reusable (when called from this repo), check.
