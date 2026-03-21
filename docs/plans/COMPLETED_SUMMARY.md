# Completed Plans Summary

Plans and designs that have been fully implemented. For active or proposed work, see individual plan files.

---

## 1. Paperless API Upload

**Documents:** [design/paperless-api-upload.md](../design/paperless-api-upload.md), [ADR 0007](../adr/0007-paperless-api-upload.md)

**Status:** Implementation done (2026-03-19).

**Summary:** Replaced consume-directory writes with Paperless REST API uploads. Documents are POSTed to `/api/documents/post_document/` with metadata (tags) set directly. Tag resolution via `GET /api/tags/?name__iexact=` + `POST` to create; in-memory cache for tags.

**Deliverables:**
- `PaperlessClient` service — `uploadDocument(document, filename, tags)`
- Config: `paperless_url`, `paperless_token` (env overrides)
- Signal pipeline: `[signal-{slug}, "signal"]` tags
- Email pipeline: `[emailSlug, "email", ...labelTags]` (Gmail labels fetched and added)
- `PaperlessApiError` domain error; `HttpClient.retryTransient` (5 retries)

---

## 2. Paperless API Integration Test

**Documents:** [2026-03-21-paperless-api-integration-test-design.md](2026-03-21-paperless-api-integration-test-design.md), [2026-03-21-paperless-api-integration-test-plan.md](2026-03-21-paperless-api-integration-test-plan.md)

**Status:** Implementation done (2026-03-21).

**Summary:** Live integration test for `PaperlessClient` using real paperless-ngx in Docker via Testcontainers. Opt-in via `PAPERLESS_API_INTEGRATION_TEST=1`; excluded from `bun run check` when unset.

**Deliverables:**
- `test/integration/paperless-api.integration.test.ts` — happy path (upload, tag resolution), edge cases (invalid token 401, unreachable URL)
- Reuses `deploy/compose/docker-compose.full-stack.yml`; starts `broker`, `db`, `gotenberg`, `tika`, `webserver`
- Bootstrap token via `POST /api/token/`; verification via `GET /api/documents/`, `GET /api/tags/` with `HttpClient` + `schemaBodyJson(Schema)`
- `.github/workflows/ci-paperless-api-integration.yml` — CI job with `PAPERLESS_API_INTEGRATION_TEST=1`
- `deploy/compose/.env.integration-tests` — test credentials for ephemeral containers

---

## Proposed (Not Implemented)

| Plan | Status | Location |
|------|--------|----------|
| Paperless Custom Fields | Proposal — not implemented | [2026-03-19-paperless-custom-fields-design.md](2026-03-19-paperless-custom-fields-design.md) |
| Effect Unstable adoption | In progress (partial: RateLimiter done) | [EFFECT_UNSTABLE_PLAN.md](EFFECT_UNSTABLE_PLAN.md) |

---

## Related

- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — Project structure
- [test/integration/README.md](../../test/integration/README.md) — Integration test guide
- [docs/adr/README.md](../adr/README.md) — Architecture Decision Records index
