# CI Workflows

This repo uses GitHub Actions with built-in path filters. No third-party path-filter actions.

## Workflows

| Workflow | Trigger | Path filter | Jobs |
|----------|---------|-------------|------|
| [ci.yml](../.github/workflows/ci.yml) | push, pull_request → main | `paths-ignore: '**/*.md'` | check, dependency-review |
| [ci-docs.yml](../.github/workflows/ci-docs.yml) | push, pull_request → main | `paths: '**/*.md'` | check (pass-through) |
| [ci-nix.yml](../.github/workflows/ci-nix.yml) | push, pull_request → main | `paths: **/*.nix, package*.json, flake.lock` | nix |

**ci.yml** runs when any non-.md file changes. Skips when only docs change.

**ci-docs.yml** is complementary: runs when only `*.md` files change. Reports a passing `check` job so branch protection allows merge. See [troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).

**ci-nix.yml** runs only when Nix or dependency files change. Runs Nix build and auto-updates `npmDepsHash` in `default.nix` for same-repo PRs and main. Uses the same GitHub App as auto-pr for the push so CI triggers on the new commit (GITHUB_TOKEN pushes do not trigger workflows).

## Reusable Workflows

- **check.yml** — test, lint, typecheck, SBOM, Codecov. Called by ci.yml.
- **nix.yml** — Nix build + npmDepsHash update. Called by ci-nix.yml and update-nix-hash.yml.

## Branch Protection

Both ci.yml and ci-docs.yml use `name: CI` and job `check`, so both produce status **`CI / check`**. Configure main branch protection to require only this one check:

- **Status checks that are required:** `CI / check`

This covers all PR types:
- **Code PRs:** ci.yml runs → `CI / check` ✓
- **Docs-only PRs:** ci-docs.yml runs → `CI / check` ✓
- **Nix-only PRs:** ci.yml runs → `CI / check` ✓
- **Mixed PRs:** ci.yml runs → `CI / check` ✓

Do not require `dependency-review` (PR-only) or `nix` (path-filtered); they would block when skipped.

## Fork PRs

CI cannot push to forks. If the nix job fails (ci-nix.yml), update locally: `nix run .#update-npm-deps-hash` (or `npm run update-nix-hash -- <hash>` using the hash from the failed job), then commit and push. See [CONTRIBUTING.md](../CONTRIBUTING.md).
