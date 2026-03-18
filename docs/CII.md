# CII Best Practices Badge — Progress

This project pursues the [OpenSSF Best Practices badge](https://www.bestpractices.dev/en) (formerly CII). Self-certify at [bestpractices.dev](https://www.bestpractices.dev/en/projects/new).

## Implemented

| Criterion area | Status | Notes |
|----------------|--------|-------|
| **Dependency management** | Done | bun audit in check script; Dependabot for npm and GitHub Actions |
| **Static analysis** | Done | CodeQL (security-extended); Biome |
| **SBOM** | Done | CycloneDX SBOM generated in CI; artifact per run |
| **Token permissions** | Done | All workflows use explicit least-privilege permissions (`permissions: {}` or job-level overrides) |
| **Pinned actions** | Done | All workflow actions pinned by full commit hash |
| **Credentials** | Done | OS keychain only; no file fallback |
| **PII in errors** | Done | Effect Redacted for paths, emails, phones, URLs |
| **Rate limiting** | Done | Webhook token-bucket (120/min) |
| **Vulnerability reporting** | Done | SECURITY.md; GitHub Private Vulnerability Reporting |

## Next steps

- Complete self-assessment at bestpractices.dev
- ~~Signed releases (if/when publishing)~~ — Done: Sigstore/cosign keyless signing on release images; see [CI.md](CI.md) for verification steps
- Fuzzing (N/A for TypeScript)
