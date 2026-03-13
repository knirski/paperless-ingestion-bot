# CI Workflows

This repo uses GitHub Actions with built-in path filters. No third-party path-filter actions.

## Workflows

| Workflow | Trigger | Path filter | Jobs |
|----------|---------|-------------|------|
| [auto-pr.yml](../.github/workflows/auto-pr.yml) | push → `ai/**` | — | auto-pr (creates/updates PR from conventional commits) |
| [ci.yml](../.github/workflows/ci.yml) | push, pull_request → main | `paths-ignore: '**/*.md'` | check, dependency-review |
| [ci-docs.yml](../.github/workflows/ci-docs.yml) | push, pull_request → main | `paths: '**/*.md'` | check (pass-through) |
| [ci-nix.yml](../.github/workflows/ci-nix.yml) | push, pull_request → main | `paths: **/*.nix, package*.json, flake.lock` | nix |
| [ci-release-please.yml](../.github/workflows/ci-release-please.yml) | pull_request → main | `paths: .release-please-manifest.json` | check |
| [codeql-docs.yml](../.github/workflows/codeql-docs.yml) | pull_request → main | `paths: **/*.md, docs/**` | analyze (pass-through) |
| [docker.yml](../.github/workflows/docker.yml) | release published, workflow_dispatch | — | build (GHCR), sign, sbom |

**auto-pr.yml** runs on push to `ai/**` branches (non-forks). Creates or updates a PR with title from conventional commits (1 semantic commit → use subject; 2+ → Ollama). Uses scripts in `.github/scripts/`. See [GITHUB_APP_AUTO_PR_SETUP.md](GITHUB_APP_AUTO_PR_SETUP.md).

**docker.yml** builds and pushes images to GHCR on each release, with provenance and SBOM attestations, and [Sigstore/cosign keyless signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/) for release images. Also uploads npm SBOM to the release. Manual trigger via workflow_dispatch for testing.

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

**ci.yml** runs when any non-.md file changes. Skips when only docs change.

**ci-release-please.yml** runs when `.release-please-manifest.json` changes (only release-please touches this file). Release-please PRs often don't trigger ci.yml due to path-filter timing; this ensures `check / check` runs on the pull_request event so branch protection allows merge.

**ci-docs.yml** is complementary: runs when only `*.md` files change. Reports a passing `check` job so branch protection allows merge. See [troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).

**ci-nix.yml** runs only when Nix or dependency files change. Runs Nix build and auto-updates `npmDepsHash` in `default.nix` for same-repo PRs and main. Uses the same GitHub App as auto-pr for the push so CI triggers on the new commit (GITHUB_TOKEN pushes do not trigger workflows). When ci-nix pushes an npmDepsHash update, it also triggers the check workflow via `workflow_dispatch` so the required status is reported on the new commit.

**codeql-docs.yml** is complementary to codeql.yml: runs when only docs change. CodeQL skips for docs (paths-ignore); this reports passing status so code scanning allows merge.

## Permissions

All workflows declare explicit permissions. Use `permissions: {}` when no workflow-level access is needed (jobs override with their own). Jobs that need write access (e.g. nix push, dependency-review) declare job-level permissions.

## Reusable Workflows

- **check.yml** — test, lint, typecheck, SBOM, Codecov. Called by ci.yml.
- **check-docs.yml** — rumdl (markdown lint), lychee (link check), typos (spell check). No npm ci. Config: `.rumdl.toml`, `_typos.toml`. Lychee respects `.gitignore`.
- **nix.yml** — Nix build + npmDepsHash update. Called by ci-nix.yml and update-nix-hash.yml.

## Branch Protection

Both ci.yml and ci-docs.yml call reusable workflows with job `check`, so both report **`check / check`**. Configure main branch protection to require:

- **Status checks that are required:** `check / check`

This covers all PR types:
- **Code PRs:** ci.yml runs → `check / check` ✓
- **Docs-only PRs:** ci-docs.yml runs → `check / check` ✓ (markdownlint, links, spelling)
- **Nix-only PRs:** ci.yml runs → `check / check` ✓
- **Mixed PRs:** ci.yml runs → `check / check` ✓ (ci-docs also runs but same check name)
- **Release-please PRs:** ci-release-please.yml runs → `check / check` ✓

Do not require `dependency-review` (PR-only) or `nix` (path-filtered); they would block when skipped.

## Troubleshooting: "check / check" waiting for status

When ci-nix pushes an npmDepsHash update, the PR head changes to a new commit. The required check must run on that new commit. If you see "waiting for status to be reported":

1. **Wait 1–2 minutes** — The push triggers the check workflow; it may take a moment to start.
2. **Re-run workflows** — If the check still hasn't run, use "Re-run all jobs" from the Actions tab.
3. **Manual trigger** — Push an empty commit: `git commit --allow-empty -m "ci: trigger workflows" && git push`.

## Design: ensuring check runs after ci-nix push

We use a **workflow_dispatch trigger** so that when ci-nix pushes an npmDepsHash update, the check workflow is explicitly triggered on the new commit. This guarantees the required status is reported even if the push-triggered run is delayed or cancelled by concurrency.

**Alternatives considered:**

| Approach | Pros | Cons |
|----------|------|------|
| **workflow_dispatch trigger** (chosen) | Explicitly runs check on new commit; reliable safety net | Extra workflow run; requires App "Actions: write" permission |
| **App token push only** | Push should trigger workflows; no extra step | Can be delayed or race with concurrency; we hit this in practice |
| **Don't push on PRs** | No commit mismatch; simpler | Worse DX; contributors must run `nix run .#update-npm-deps-hash` locally |
| **Documentation only** | Simple | No technical fix; still depends on timing |

**GitHub App permission:** The App used for the push must have **Actions: Read and write** so it can trigger workflows via `gh workflow run`. If the trigger step fails, verify this permission in the App settings.

## Local CI-like checks

- **`npm run check:ci`** — Mirrors the code path (ci.yml → check.yml): `check` plus actionlint and shellcheck. Uses system binaries when available, otherwise Nix.
- **`npm run check:docs`** — Mirrors the docs path (ci-docs.yml → check-docs.yml): rumdl, lychee, typos. All via `scripts/nix-run-if-missing.sh` (system binary or `nix run nixpkgs#<tool>`). Run before pushing docs-only changes.

## Fork PRs

CI cannot push to forks. If the nix job fails (ci-nix.yml), update locally: `nix run .#update-npm-deps-hash` (or `npm run update-nix-hash -- <hash>` using the hash from the failed job), then commit and push. See [CONTRIBUTING.md](../CONTRIBUTING.md).
