# CI Workflows

This repo uses GitHub Actions with built-in path filters. No third-party path-filter actions.

## Workflows

| Workflow | Trigger | Path filter | Jobs |
|----------|---------|-------------|------|
| [ci.yml](../.github/workflows/ci.yml) | push, pull_request → main | `paths-ignore: '**/*.md'` | check, dependency-review |
| [ci-docs.yml](../.github/workflows/ci-docs.yml) | push, pull_request → main | `paths: '**/*.md'` | check (pass-through) |
| [ci-nix.yml](../.github/workflows/ci-nix.yml) | push, pull_request → main | `paths: **/*.nix, package*.json, flake.lock` | nix |
| [codeql-docs.yml](../.github/workflows/codeql-docs.yml) | pull_request → main | `paths: **/*.md, docs/**` | analyze (pass-through) |

**ci.yml** runs when any non-.md file changes. Skips when only docs change.

**ci-docs.yml** is complementary: runs when only `*.md` files change. Reports a passing `check` job so branch protection allows merge. See [troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).

**ci-nix.yml** runs only when Nix or dependency files change. Runs Nix build and auto-updates `npmDepsHash` in `default.nix` for same-repo PRs and main.

**codeql-docs.yml** is complementary to codeql.yml: runs when only docs change. CodeQL skips for docs (paths-ignore); this reports passing status so code scanning allows merge.

## Permissions

All workflows declare explicit permissions. Use `permissions: {}` when no workflow-level access is needed (jobs override with their own). Jobs that need write access (e.g. nix push, dependency-review) declare job-level permissions.

## Reusable Workflows

- **check.yml** — test, lint, typecheck, SBOM, Codecov. Called by ci.yml.
- **check-docs.yml** — lightweight pass-through for docs-only. Called by ci-docs.yml.
- **nix.yml** — Nix build + npmDepsHash update. Called by ci-nix.yml and update-nix-hash.yml.

## Branch Protection

Both ci.yml and ci-docs.yml call reusable workflows with job `check`, so both report **`check / check`**. Configure main branch protection to require:

- **Status checks that are required:** `check / check`

This covers all PR types:
- **Code PRs:** ci.yml runs → `check / check` ✓
- **Docs-only PRs:** ci-docs.yml runs → `check / check` ✓ (lightweight pass-through)
- **Nix-only PRs:** ci.yml runs → `check / check` ✓
- **Mixed PRs:** ci.yml runs → `check / check` ✓ (ci-docs also runs but same check name)

Do not require `dependency-review` (PR-only) or `nix` (path-filtered); they would block when skipped.

## Fork PRs

CI cannot push to forks. If the nix job fails (ci-nix.yml), update locally: `nix run .#update-npm-deps-hash` (or `npm run update-nix-hash -- <hash>` using the hash from the failed job), then commit and push. See [CONTRIBUTING.md](../CONTRIBUTING.md).
