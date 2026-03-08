# Composite Actions

Reusable actions for Nix-related CI workflows. Used by reusable workflows (check.yml, nix.yml) and standalone workflows (update-flake-lock.yml).

## Structure

| Action | Purpose | Used by |
|--------|---------|---------|
| **nix-setup** | Checkout, install Nix, enable magic cache | nix workflow, update-flake-lock |
| **nix-npm-deps-hash** | Run update-npm-deps-hash.sh, output hash when updated | nix workflow |
| **nix-commit-npm-deps-hash** | Commit and push npmDepsHash update | nix workflow |
| **nix-fail-npm-deps-hash-fork** | Fail with instructions for fork PRs | nix workflow |

## Reusable Workflows

| Workflow | Purpose | Called by |
|----------|---------|-----------|
| **check.yml** | Full check (test, lint, SBOM, Codecov) | ci.yml |
| **nix.yml** | Nix build + npmDepsHash update | ci.yml, update-nix-hash.yml |

## GitHub-provided features used

- `actions/checkout@v4`, `actions/setup-node@v4` (built-in npm cache), `actions/upload-artifact@v4`
- `secrets: inherit` for reusable workflows
- `workflow_call` for reusable workflows
