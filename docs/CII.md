# CII Best Practices Badge — Progress

This project pursues the [OpenSSF Best Practices badge](https://bestpractices.coreinfrastructure.org/) (formerly CII). Self-certify at [bestpractices.coreinfrastructure.org](https://bestpractices.coreinfrastructure.org/en/projects/new).

## Implemented

| Criterion area | Status | Notes |
|----------------|--------|-------|
| **Dependency management** | Done | npm audit in check script; Dependabot for npm and GitHub Actions |
| **Static analysis** | Done | CodeQL (security-extended); oxlint |
| **SBOM** | Done | CycloneDX SBOM generated in CI; artifact per run |
| **Token permissions** | Done | Scorecard workflow uses least-privilege (contents, security-events, id-token) |
| **Pinned actions** | Done | All workflow actions pinned by full commit hash |
| **Credentials** | Done | OS keychain only; no file fallback |
| **PII in errors** | Done | Effect Redacted for paths, emails, phones, URLs |
| **Rate limiting** | Done | Webhook token-bucket (120/min) |
| **Vulnerability reporting** | Done | SECURITY.md; GitHub Private Vulnerability Reporting |

## Next steps

- Complete self-assessment at bestpractices.coreinfrastructure.org
- Signed releases (if/when publishing)
- Fuzzing (N/A for TypeScript)
