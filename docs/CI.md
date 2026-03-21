# CI Workflows

This repo uses GitHub Actions with built-in path filters. No third-party path-filter actions.

## CI overview

| When | What runs |
|------|-----------|
| Push to `ai/**` | auto-pr creates/updates PR (via [knirski/auto-pr](https://github.com/knirski/auto-pr)) |
| PR to main (code changes) | ci → check, dependency-review |
| PR to main (docs only) | ci-docs → check-docs |
| PR to main (.github only) | ci-workflows → check (actionlint) |
| PR to main (nix/deps) | ci-nix → nix flake check + bun.nix update |
| PR to main (release-please) | ci-release-please → check |
| Push to main | release-please, scorecard (if configured) |
| Manual | update-bun-nix, update-flake-lock |
| Weekly | update-flake-lock (Sun), scorecard (Sat), stale (Mon) |

## Workflows

| Workflow | Trigger | Path filter | Jobs |
|----------|---------|-------------|------|
| [auto-pr.yml](../.github/workflows/auto-pr.yml) | push → `ai/**` | — | generate, create (PR from conventional commits) |
| [ci.yml](../.github/workflows/ci.yml) | push, pull_request → main | `paths-ignore: '**/*.md', '.github/**'` | check, dependency-review |
| [ci-workflows.yml](../.github/workflows/ci-workflows.yml) | push, pull_request → main | `paths: '.github/**'` | check (minimal) |
| [ci-docs.yml](../.github/workflows/ci-docs.yml) | push, pull_request → main | `paths: '**/*.md'` | check (pass-through) |
| [ci-nix.yml](../.github/workflows/ci-nix.yml) | push, pull_request → main | `paths: **/*.nix, package*.json, bun.lock, flake.lock` | nix |
| [ci-paperless-api-integration.yml](../.github/workflows/ci-paperless-api-integration.yml) | push, pull_request → main | `paths: paperless-client, paperless*, deploy/compose, package*.json, bun.lock` | paperless-api-integration |
| [ci-release-please.yml](../.github/workflows/ci-release-please.yml) | pull_request → main | `paths: .release-please-manifest.json` | check |
| [codeql.yml](../.github/workflows/codeql.yml) | push, pull_request → main | `paths-ignore: **/*.md, docs/**` | analyze |
| [codeql-docs.yml](../.github/workflows/codeql-docs.yml) | pull_request → main | `paths: **/*.md, docs/**` | analyze (pass-through, distinct name) |
| [docker.yml](../.github/workflows/docker.yml) | release published, workflow_dispatch | — | build (GHCR), sign, sbom |
| [release-please.yml](../.github/workflows/release-please.yml) | push → main | — | release-please (creates release PRs) |
| [update-bun-nix.yml](../.github/workflows/update-bun-nix.yml) | workflow_dispatch | — | update bun.nix (manual) |
| [update-flake-lock.yml](../.github/workflows/update-flake-lock.yml) | workflow_dispatch, schedule (Sun) | — | update flake.lock |
| [scorecard.yml](../.github/workflows/scorecard.yml) | push → main, schedule (Sat) | — | OpenSSF Scorecard |
| [stale.yml](../.github/workflows/stale.yml) | schedule (Mon), workflow_dispatch | — | Mark stale issues/PRs |

**auto-pr.yml** runs on push to `ai/**` branches (non-forks, excludes default branch). Uses [knirski/auto-pr](https://github.com/knirski/auto-pr) reusable workflows to create or update a PR with title and body from conventional commits (1 commit → subject; 2+ → Ollama summary). Requires `APP_ID` and `APP_PRIVATE_KEY`. Update `knirski/auto-pr@SHA` refs in the workflow when upgrading.

**docker.yml** builds and pushes images to GHCR on each release, with provenance and SBOM attestations, and [Sigstore/cosign keyless signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/) for release images. Also uploads CycloneDX SBOM to the release. Manual trigger via workflow_dispatch for testing.

**Verifying signed images:** Release images are signed with Sigstore keyless signing. To verify before pulling:

```bash
# Install cosign: https://docs.sigstore.dev/cosign/system_config/installation/
cosign verify ghcr.io/knirski/paperless-ingestion-bot:v0.2.0
```

For digest-based verification (recommended for reproducibility), install [crane](https://github.com/google/go-containerregistry/tree/main/cmd/crane) (`go install github.com/google/go-containerregistry/cmd/crane@latest`), then:

```bash
IMAGE_DIGEST=$(crane digest ghcr.io/knirski/paperless-ingestion-bot:v0.2.0)
cosign verify "ghcr.io/knirski/paperless-ingestion-bot@${IMAGE_DIGEST}"
```

Signatures are recorded in the [Rekor transparency log](https://search.sigstore.dev/).

**ci.yml** runs when any non-.md, non-.github file changes. Skips when only docs or only .github changes.

**ci-workflows.yml** runs when only `.github/**` changes. Minimal check: actionlint on workflows. Reports `check / check` for branch protection.

**ci-release-please.yml** runs when `.release-please-manifest.json` changes (only release-please touches this file). Release-please PRs often don't trigger ci.yml due to path-filter timing; this ensures `check / check` runs on the pull_request event so branch protection allows merge. Uses `cancel-in-progress: false` so Release Please's frequent force-pushes don't cancel runs before they complete. The release-please workflow uses the same GitHub App token (APP_ID, APP_PRIVATE_KEY) as auto-pr and nix so its pushes trigger workflows; GITHUB_TOKEN pushes do not.

**ci-docs.yml** is complementary: runs when only `*.md` files change. Reports a passing `check` job so branch protection allows merge. See [troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).

**ci-nix.yml** runs only when Nix or dependency files change. Runs Nix build and auto-updates `bun.nix` for same-repo PRs and main. Uses the same GitHub App as auto-pr for the push so CI triggers on the new commit (GITHUB_TOKEN pushes do not trigger workflows). When ci-nix pushes a bun.nix update, it also triggers the check workflow via `workflow_dispatch` so the required status is reported on the new commit.

**ci-paperless-api-integration.yml** runs only when Paperless-related paths change (paperless-client, tests, compose, deps). Executes the live Paperless API integration test via Testcontainers. Skips on doc-only or unrelated code changes.

**codeql.yml** runs when non-docs code changes. Uses security-extended queries. Skips for docs-only (paths-ignore).

**codeql-docs.yml** is complementary to codeql.yml: runs when only docs change. CodeQL skips for docs (paths-ignore); this reports passing status so code scanning allows merge.

**release-please.yml** runs on push to main. Creates release PRs from conventional commits; updates version and CHANGELOG. Requires `APP_ID` and `APP_PRIVATE_KEY` secrets.

**update-bun-nix.yml** runs on manual trigger (workflow_dispatch). Use when main has a stale bun.nix (e.g. after merging a lockfile change from a fork). Runs on the default branch and pushes the updated bun.nix to main.

**update-flake-lock.yml** runs weekly (Sunday 00:00 UTC) and on manual trigger. Updates flake.lock and opens a PR.

**scorecard.yml** runs on push to main and weekly (Saturday). Publishes OpenSSF Scorecard results to code scanning.

**stale.yml** runs weekly (Monday) and on manual trigger. Marks issues/PRs stale after 180 days, closes after 180 more.

## First-time setup

Before CI can run fully:

1. **GitHub App** — Create an app with Contents and Pull requests (Read and write). Add `APP_ID` and `APP_PRIVATE_KEY` to **Settings → Secrets and variables → Actions**. Required for auto-pr, release-please, and ci-nix.
2. **Codecov** (optional) — Add `CODECOV_TOKEN` for coverage badge. Without it, the upload step is skipped; CI still passes.
3. **Branch protection** — Require `check / check` before merging to main.

## Updating auto-pr refs

Auto-pr pins live in [.github/workflows/auto-pr.yml](../.github/workflows/auto-pr.yml). To upgrade:

1. Get the latest main SHA from [knirski/auto-pr](https://github.com/knirski/auto-pr).
2. Update both `knirski/auto-pr/...@<SHA>` refs (generate and create workflows) to the same SHA.

## Permissions

All workflows declare explicit permissions. Use `permissions: {}` when no workflow-level access is needed (jobs override with their own). Jobs that need write access (e.g. nix push, dependency-review) declare job-level permissions.

## Reusable Workflows

- **check.yml** — test, lint, knip, typecheck, rumdl, typos, lychee, actionlint, shellcheck, SBOM (bunx cdxgen CycloneDX), Codecov. Called by ci.yml.
- **check-workflows.yml** — actionlint on workflows. Called by ci-workflows.yml for .github-only changes.
- **check-docs.yml** — rumdl (markdown lint), lychee (link check), typos (spell check). No bun install. Config: `.rumdl.toml`, `_typos.toml`. Lychee respects `.gitignore`. Rumdl excludes `CHANGELOG.md` (auto-generated).
- **nix.yml** — Nix build + bun.nix update. Called by ci-nix.yml and update-bun-nix.yml.

## Branch Protection

ci.yml, ci-docs.yml, and ci-workflows.yml report **`check / check`**. Configure main branch protection to require:

- **Status checks that are required:** `check / check`

This covers all PR types:
- **Code PRs:** ci.yml runs → `check / check` ✓
- **Docs-only PRs:** ci-docs.yml runs → `check / check` ✓ (markdownlint, links, spelling)
- **.github-only PRs:** ci-workflows.yml runs → `check / check` ✓ (actionlint)
- **Nix-only PRs:** ci-nix runs; ci.yml may also run → `check / check` ✓
- **Mixed PRs:** ci.yml runs → `check / check` ✓
- **Release-please PRs:** ci-release-please.yml runs → `check / check` ✓

Do not require `dependency-review` (PR-only) or `nix` (path-filtered); they would block when skipped.

## Troubleshooting: "check / check" waiting for status

When ci-nix pushes a bun.nix update, the PR head changes to a new commit. The required check must run on that new commit. If you see "waiting for status to be reported":

1. **Wait 1–2 minutes** — The push triggers the check workflow; it may take a moment to start.
2. **Re-run workflows** — If the check still hasn't run, use "Re-run all jobs" from the Actions tab.
3. **Manual trigger** — Push an empty commit: `git commit --allow-empty -m "ci: trigger workflows" && git push`.

## Troubleshooting: Code scanning / CodeQL

If the [Security → Code scanning](https://docs.github.com/en/code-security/code-scanning) tab shows no results, errors, or your custom CodeQL workflow appears disabled:

**Default setup conflicts with advanced setup.** This repo uses advanced setup (custom `codeql.yml`). If default setup is enabled in **Settings → Security → Code security and analysis → CodeQL analysis**, it disables custom workflows. Fix: Click "Switch to advanced" or "Disable CodeQL", then re-enable so only the custom workflows run. See [GitHub docs on default vs advanced setup](https://docs.github.com/en/code-security/code-scanning/enabling-code-scanning/configuring-default-setup-for-code-scanning).

**No source code seen.** For JavaScript/TypeScript with `build-mode: none`, CodeQL analyzes without a build. If you see "No source code was seen", ensure the repo has analyzable `.ts`/`.js` files and the workflow `paths-ignore` does not exclude them.

## Design: ensuring check runs after ci-nix push

We use a **workflow_dispatch trigger** so that when ci-nix pushes a bun.nix update, the check workflow is explicitly triggered on the new commit. This guarantees the required status is reported even if the push-triggered run is delayed or cancelled by concurrency.

**Alternatives considered:**

| Approach | Pros | Cons |
|----------|------|------|
| **workflow_dispatch trigger** (chosen) | Explicitly runs check on new commit; reliable safety net | Extra workflow run; requires App "Actions: write" permission |
| **App token push only** | Push should trigger workflows; no extra step | Can be delayed or race with concurrency; we hit this in practice |
| **Don't push on PRs** | No commit mismatch; simpler | Worse DX; contributors must run `nix run .#update-bun-nix` locally |
| **Documentation only** | Simple | No technical fix; still depends on timing |

**GitHub App permission:** The App used for the push must have **Actions: Read and write** so it can trigger workflows via `gh workflow run`. If you see "Failed to trigger ci.yml. Ensure App has Actions: Read and write permission.", go to [github.com/settings/apps](https://github.com/settings/apps) → your app → **Repository permissions** → set **Actions** to **Read and write**. If already set, go to **Install App** → **Configure** next to the repo → accept any pending permission changes.

## Local CI-like checks

- **`bun run check`** — Full check: core (test, lint, knip, typecheck), docs (rumdl, typos), CI extras (actionlint, shellcheck). Lychee (link check) runs as a separate step in CI.
- **`bun run check:with-links`** — Same as check plus lychee. Use before pushing when you want to verify links.
- **`bun run check:code`** — Code only: audit, test, lint, knip, typecheck. Faster than full check.
- **`bun run check:just-links`** — Links only: lychee. Quick link verification without core checks.
- **`bun run check:docs`** — Docs only: rumdl, typos. Quick docs verification without core checks.

## Fork PRs

CI cannot push to forks. If the nix job fails (ci-nix.yml), update locally: `nix run .#update-bun-nix`, then commit and push. See [CONTRIBUTING.md](../CONTRIBUTING.md).
