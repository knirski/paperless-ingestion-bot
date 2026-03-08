# Allstar Configuration

This repository is configured for [Allstar](https://github.com/ossf/allstar), an OpenSSF GitHub App that enforces security policies.

## Installation

1. Install the [Allstar app](https://github.com/apps/allstar-app) on your account or organization.
2. For personal accounts: create a `.allstar` repo (e.g. `knirski/.allstar`) using the [quickstart template](https://github.com/ossf/dot-allstar-quickstart).
3. These repo-level configs in `.allstar/` provide policy preferences when Allstar runs on this repository (when repo override is enabled).

## Policies

All policies use `action: issue` — violations create GitHub issues for maintainers to address.

| Policy | File | Purpose |
|--------|------|---------|
| Admin | `admin.yaml` | Repository must have a user or team as Administrator |
| Binary artifacts | `binary_artifacts.yaml` | No binary artifacts in the repository |
| Branch protection | `branch_protection.yaml` | Branch protection rules on default branch |
| CODEOWNERS | `codeowners.yaml` | Requires CODEOWNERS file |
| Dangerous workflow | `dangerous_workflow.yaml` | Checks workflows for unsafe patterns |
| GitHub Actions | `actions.yaml` | Workflow rules (require/deny) per org config |
| Outside collaborators | `outside.yaml` | Restricts outside collaborators with admin/push access |
| Scorecard | `scorecard.yaml` | OpenSSF Scorecard checks |
| SECURITY.md | `security.yaml` | Requires non-empty SECURITY.md |
