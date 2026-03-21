# Paperless Client Live Integration Test Design

**Date:** 2025-03-21  
**Status:** Design approved — ready for implementation.

## Summary

Add an integration test for `PaperlessClient` that uses real paperless-ngx running in Docker, via Testcontainers. Tests cover happy path (upload, tag resolution) and edge cases (invalid token, unreachable). Opt-in via `PAPERLESS_API_INTEGRATION_TEST=1`; excluded from `bun run check` and pre-push hooks; runs in CI when Docker is available.

---

## Decisions

### 1. Approach: Testcontainers with Docker Compose

- **Library:** [testcontainers](https://www.npmjs.com/package/testcontainers) (testcontainers-node)
- **Pattern:** `DockerComposeEnvironment` to start a subset of services from the existing full-stack compose
- **Compose file:** Reuse `deploy/compose/docker-compose.full-stack.yml`
- **Rationale:** Single source of truth; validates the actual compose users deploy; no drift from a separate test compose

### 2. Service Selection

Start only paperless-related services:

```ts
.up(["broker", "db", "gotenberg", "tika", "webserver"])
```

Skip: `signal-api`, `ingestion-bot`, `ollama` — avoids missing config files and unrelated services.

### 3. Execution Model

| Context | Runs? | Mechanism |
|---------|-------|-----------|
| `bun run check` | No | Tests use `describe.skipIf(!runPaperlessApiIntegrationTest)` |
| Pre-push (Lefthook) | No | Same skip when `PAPERLESS_API_INTEGRATION_TEST` unset |
| CI | Yes | Job sets `PAPERLESS_API_INTEGRATION_TEST=1`, has Docker |

Same pattern as Gmail live and keyring tests.

### 4. Env Vars

**Mitigation:** Committed `deploy/compose/docker-compose.test.env` for Testcontainers:

```env
# Integration tests only — ephemeral containers, not for production
PAPERLESS_SECRET_KEY=test-secret-key-for-ephemeral-containers
PAPERLESS_ADMIN_USER=admin
PAPERLESS_ADMIN_PASSWORD=test-admin-password
```

Use `.withEnvironmentFile()` or `.withEnvironment()` depending on Testcontainers behavior with `env_file` in the compose. Fallback: centralize in `test/integration/paperless-api-integration-env.ts` and pass via `.withEnvironment()`.

### 5. Test Scope

- **Happy path:** Upload document, resolve tags (fetch existing + create new), verify via `GET /api/documents/` (or tags API)
- **Edge cases:** Invalid token (401), unreachable URL, tag resolution errors

---

## Implementation Outline

### Files to Create/Modify

| File | Action |
|------|--------|
| `deploy/compose/docker-compose.test.env` | Create — committed test env vars |
| `test/integration/paperless-api.integration.test.ts` | Create — live tests |
| `test/integration/paperless-api-integration-env.ts` | Create — env constants (if not using env file) |
| `package.json` | Add `testcontainers` devDependency |
| `test/integration/README.md` | Update — document PAPERLESS_API_INTEGRATION_TEST |
| `.github/workflows/` | Add or extend CI job — run with PAPERLESS_API_INTEGRATION_TEST=1, Docker |

### Test Flow

1. Check `PAPERLESS_API_INTEGRATION_TEST === "1"` → skip entire describe if not
2. Start compose: `DockerComposeEnvironment(deploy/compose, docker-compose.full-stack.yml).withEnvironment(…).up(["broker","db","gotenberg","tika","webserver"])`
3. Wait for `webserver` ready (e.g. `Wait.forHttp("/api/", 8000)` or log message)
4. Bootstrap token: `POST /api/token/` with admin credentials → get token
5. Create layer: `PaperlessClient.live(baseUrl, token)` + `Http.FetchHttpClient.layer`
6. Run tests: upload, assert via API
7. Cleanup: `environment.down()`

### Test Structure

```ts
const runPaperlessApiIntegrationTest = process.env.PAPERLESS_API_INTEGRATION_TEST === "1";

describe.skipIf(!runPaperlessApiIntegrationTest)("paperless-client live", () => {
  // beforeAll: start compose, get baseUrl + token
  // afterAll: environment.down()

  describe("happy path", () => {
    it("uploads document and resolves tags");
    it("creates new tag when not found");
  });

  describe("edge cases", () => {
    it("fails with invalid token");
    it("handles unreachable URL");
  });
});
```

### CI Job

- Dedicated job or added to existing integration job
- `PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration` (or equivalent)
- Requires Docker (e.g. `ubuntu-latest` with default Docker)
- Consider timeout: 5–10 min (first run pulls images ~2–3 min)

---

## References

- [Testcontainers for Node.js](https://node.testcontainers.org/) — [Compose feature](https://node.testcontainers.org/features/compose/)
- [DockerComposeEnvironment.up(services?)](https://github.com/testcontainers/testcontainers-node/pull/252) — start subset of services (v7.19.0+)
- [Paperless-ngx REST API](https://docs.paperless-ngx.com/api/) — token auth, document upload
- Project: `test/fixtures/paperless-mock.ts` — current mock; `src/live/paperless-client.ts` — live client
