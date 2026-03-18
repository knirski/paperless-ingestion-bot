# Composite Actions

Reusable actions for CI workflows. Used by reusable workflows (check.yml) and docker.yml. See [docs/CI.md](../../docs/CI.md) for workflow structure.

## Structure

| Action | Purpose | Used by |
|--------|---------|---------|
| **generate-sbom** | Trivy CycloneDX SBOM + optional upload (artifact or release). Requires checkout + bun install. Inputs: `upload`, `release_tag`, `artifact_name` | check.yml, docker.yml sbom job |

## Reusable Workflows

| Workflow | Purpose | Called by |
|----------|---------|-----------|
| **check.yml** | Full check (test, lint, SBOM, Codecov) | ci.yml |
| **nix.yml** | Nix build + bun.nix update | ci-nix.yml, update-bun-nix.yml |

## GitHub-provided features used

- `actions/checkout`, `oven-sh/setup-bun` (Bun runtime), `actions/upload-artifact` (all SHA-pinned)
- `secrets: inherit` for reusable workflows
- `workflow_call` for reusable workflows
