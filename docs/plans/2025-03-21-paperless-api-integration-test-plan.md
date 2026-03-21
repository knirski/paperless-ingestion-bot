# Paperless Client Live Integration Test — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an integration test for `PaperlessClient` that uses real paperless-ngx in Docker via Testcontainers. Opt-in via `PAPERLESS_API_INTEGRATION_TEST=1`; excluded from check and pre-push; runs in CI.

**Architecture:** Reuse `deploy/compose/docker-compose.full-stack.yml`, start only `broker`, `db`, `gotenberg`, `tika`, `webserver`. Bootstrap API token via `POST /api/token/`. Run tests with `PaperlessClient.live(baseUrl, token)` + `Http.FetchHttpClient.layer`. Use `describe.skipIf(!runPaperlessApiIntegrationTest)` so tests skip when env unset.

**Tech Stack:** testcontainers (Node.js), Bun test, Effect v4, Paperless-ngx REST API.

**Design reference:** [docs/plans/2025-03-21-paperless-api-integration-test-design.md](2025-03-21-paperless-api-integration-test-design.md)

---

## Task 1: Add testcontainers dependency

**Files:**
- Modify: `package.json`

### Step 1: Add devDependency

Add `testcontainers` to devDependencies:

```json
"testcontainers": "^11.13.0"
```

### Step 2: Install

```bash
bun install
```

Expected: Exit 0.

### Step 3: Commit

```bash
git add package.json bun.lockb
git commit -m "chore: add testcontainers for paperless-api live integration test"
```

---

## Task 2: Create docker-compose.test.env

**Files:**
- Create: `deploy/compose/docker-compose.test.env`

### Step 1: Create the file

```env
# Integration tests only — ephemeral containers, not for production
PAPERLESS_SECRET_KEY=test-secret-key-for-ephemeral-containers
PAPERLESS_ADMIN_USER=admin
PAPERLESS_ADMIN_PASSWORD=test-admin-password
```

### Step 2: Commit

```bash
git add deploy/compose/docker-compose.test.env
git commit -m "chore: add test env for paperless-api live integration test"
```

---

## Task 3: Create paperless-api-integration-env helper

**Files:**
- Create: `test/integration/paperless-api-integration-env.ts`

### Step 1: Create helper

Centralize env for Testcontainers; use when `withEnvironmentFile` does not override compose `env_file`:

```ts
/**
 * Env vars for paperless-ngx in Testcontainers. Used when compose's env_file
 * (docker-compose.env) is not available. Match deploy/compose/docker-compose.test.env.
 */
export const paperlessTestEnv = {
	PAPERLESS_SECRET_KEY: "test-secret-key-for-ephemeral-containers",
	PAPERLESS_ADMIN_USER: "admin",
	PAPERLESS_ADMIN_PASSWORD: "test-admin-password",
} as const;

```

### Step 2: Commit

```bash
git add test/integration/paperless-api-integration-env.ts
git commit -m "chore: add paperless test env constants for paperless-api live test"
```

---

## Task 4: Add paperless-api integration test (happy path)

**Files:**
- Create: `test/integration/paperless-api.integration.test.ts`
- Test: same file

### Step 1: Write the test file (structure + happy path)

Use `describe.skipIf(!runPaperlessApiLiveTest)`, `beforeAll`/`afterAll` for compose lifecycle. Bootstrap token via `POST /api/token/` with admin credentials. Use `Effect.runPromise` and `Effect.provide(layer)` to run `paperless.uploadDocument`. Assert document appears via `GET /api/documents/`.

Reference: `test/integration/gmail-live.test.ts` for skip pattern; `src/live/paperless-client.ts` for `PaperlessClient.live`; `test/test-utils.ts` for `PlatformServicesLayer`, `TestBaseLayer`.

Compose path: resolve from `import.meta.dir` or `process.cwd()`. Example: `path.join(process.cwd(), "deploy", "compose")` and `"docker-compose.full-stack.yml"`.

Token bootstrap: `fetch(baseUrl + "/api/token/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })` → parse `{ token }`.

```ts
/**
 * Optional live Paperless API test. Skips when PAPERLESS_API_INTEGRATION_TEST is not set.
 * Requires Docker. Runs real paperless-ngx via Testcontainers.
 *
 * Run with:
 *   PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration
 */

import { join as pathJoin } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import * as Http from "effect/unstable/http";
import { PaperlessClient } from "../../src/live/paperless-client.js";
import { toTagName } from "../../src/domain/paperless-types.js";
import { paperlessTestEnv } from "./paperless-api-integration-env.js";
import { TestBaseLayer } from "../test-utils.js";
import { DockerComposeEnvironment, Wait } from "testcontainers";

const runPaperlessApiLiveTest = process.env.PAPERLESS_API_INTEGRATION_TEST === "1";

const COMPOSE_DIR = pathJoin(process.cwd(), "deploy", "compose");
const COMPOSE_FILE = "docker-compose.full-stack.yml";
const SERVICES = ["broker", "db", "gotenberg", "tika", "webserver"] as const;
const CONTAINER_WEBSERVER = "webserver-1";

async function bootstrapToken(baseUrl: string): Promise<string> {
	const res = await fetch(`${baseUrl}/api/token/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: paperlessTestEnv.PAPERLESS_ADMIN_USER,
			password: paperlessTestEnv.PAPERLESS_ADMIN_PASSWORD,
		}),
	});
	if (!res.ok) throw new Error(`Token bootstrap failed: ${res.status} ${await res.text()}`);
	const json = (await res.json()) as { token: string };
	return json.token;
}

describe.skipIf(!runPaperlessApiLiveTest)("paperless-api live", () => {
	let environment: Awaited<ReturnType<DockerComposeEnvironment["up"]>>;
	let baseUrl: string;
	let token: string;

	beforeAll(async () => {
		environment = await new DockerComposeEnvironment(COMPOSE_DIR, COMPOSE_FILE)
			.withEnvironment(paperlessTestEnv)
			.withWaitStrategy(CONTAINER_WEBSERVER, Wait.forHttp("/api/", 8000).forStatusCode(200))
			.withStartupTimeout(180_000)
			.up(SERVICES);

		const container = environment.getContainer(CONTAINER_WEBSERVER);
		const host = container.getHost();
		const port = container.getMappedPort(8000);
		baseUrl = `http://${host}:${port}`;
		token = await bootstrapToken(baseUrl);
	}, 200_000);

	afterAll(async () => {
		await environment?.down();
	});

	it("uploads document and resolves tags", {
		timeout: 30_000,
	}, async () => {
		const layer = Layer.mergeAll(
			TestBaseLayer,
			Http.FetchHttpClient.layer,
			PaperlessClient.live(baseUrl, token),
		);

		const pdfBytes = new TextEncoder().encode("%PDF-1.4 minimal");
		const program = Effect.gen(function* () {
			const paperless = yield* PaperlessClient;
			yield* paperless.uploadDocument(
				pdfBytes,
				"test-doc.pdf",
				[toTagName("signal-test"), toTagName("live-integration")],
			);
		}).pipe(Effect.provide(layer));

		await Effect.runPromise(program);

		const listRes = await fetch(`${baseUrl}/api/documents/`, {
			headers: { Authorization: `Token ${token}` },
		});
		expect(listRes.ok).toBe(true);
		const listJson = (await listRes.json()) as { results?: { id: number }[] };
		expect(listJson.results?.length).toBeGreaterThanOrEqual(1);
	});
});
```

**Note:** Verify Testcontainers API: `withWaitStrategy` may take `(containerName, strategy)` or differ. Check [node.testcontainers.org/features/compose](https://node.testcontainers.org/features/compose/) and [node.testcontainers.org/features/wait-strategies](https://node.testcontainers.org/features/wait-strategies/). If `Wait.forHttp` is not available for compose, use `Wait.forLogMessage` with a paperless-ngx startup log pattern, or poll in a loop until `/api/` returns 200.

### Step 2: Run test (skipped)

```bash
bun run test:integration
```

Expected: Paperless API tests skip (0 runs) when `PAPERLESS_API_INTEGRATION_TEST` unset.

### Step 3: Run test (enabled)

```bash
PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration
```

Expected: Test runs, may fail until implementation is correct. If Testcontainers API differs, fix imports/API usage.

### Step 4: Commit

```bash
git add test/integration/paperless-api.integration.test.ts
git commit -m "feat: add paperless-api live integration test (happy path)"
```

---

## Task 5: Add edge case tests

**Files:**
- Modify: `test/integration/paperless-api.integration.test.ts`

### Step 1: Add "fails with invalid token"

Use `PaperlessClient.live(baseUrl, "invalid-token")`. Expect `Effect.runPromise(program).catch(...)` or `Effect.exit` to yield `Exit.fail` with `PaperlessApiError` (status 401 or similar).

```ts
	it("fails with invalid token", {
		timeout: 10_000,
	}, async () => {
		const layer = Layer.mergeAll(
			TestBaseLayer,
			Http.FetchHttpClient.layer,
			PaperlessClient.live(baseUrl, "invalid-token"),
		);
		const program = Effect.gen(function* () {
			const paperless = yield* PaperlessClient;
			yield* paperless.uploadDocument(
				new Uint8Array([1, 2, 3]),
				"bad.pdf",
				[toTagName("test")],
			);
		}).pipe(Effect.provide(layer));

		const exit = await Effect.runPromise(Effect.exit(program));
		expect(exit._tag).toBe("Failure");
		// Paperless returns 401 for invalid token
		if (exit._tag === "Failure") {
			const cause = exit.cause;
			// PaperlessApiError has status 401
			expect(typeof cause).toBe("object");
		}
	});
```

Adjust assertion to match how `PaperlessApiError` is extracted from `Cause`.

### Step 2: Add "creates new tag when not found"

Reuse happy path pattern: upload with a unique tag name (e.g. `live-integration-${Date.now()}`), then `GET /api/tags/?name__iexact=...` to verify tag exists.

### Step 3: Run tests

```bash
PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration
```

Expected: All paperless live tests pass.

### Step 4: Commit

```bash
git add test/integration/paperless-api.integration.test.ts
git commit -m "feat: add paperless-api live edge case tests"
```

---

## Task 6: Update integration README

**Files:**
- Modify: `test/integration/README.md`

### Step 1: Add "Optional: Paperless API Integration Test" section

Insert after "Optional: Keyring Availability Test":

```markdown
## Optional: Live Paperless API Test

Runs the PaperlessClient against real paperless-ngx in Docker via Testcontainers. Tests upload, tag resolution (fetch/create), and error handling (invalid token).

Requires Docker. Skips when `PAPERLESS_API_INTEGRATION_TEST` is not set.

    PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration

Uses `deploy/compose/docker-compose.full-stack.yml`; starts only `broker`, `db`, `gotenberg`, `tika`, `webserver`. First run may take ~2–3 min (image pulls).
```

### Step 2: Commit

```bash
git add test/integration/README.md
git commit -m "docs: document PAPERLESS_API_INTEGRATION_TEST paperless-api live test"
```

---

## Task 7: Add CI job for paperless live test

**Files:**
- Modify: `.github/workflows/ci.yml` or create new workflow
- Reference: `docs/CI.md` for CI structure

### Step 1: Add job

Option A: Add a job to `ci.yml` or `check.yml` that runs when `PAPERLESS_API_INTEGRATION_TEST` is set. GitHub Actions does not pass env to workflow_call by default; use a `workflow_dispatch` with input, or a scheduled/cron job.

Option B: Create `.github/workflows/ci-paperless-api-integration.yml` that runs on `push` to `main` and `pull_request` (when paths include `src/live/paperless-client.ts`, `test/integration/paperless*`, `deploy/compose/*`), or run on schedule (e.g. daily).

Recommendation: Add a separate job in `ci.yml` or a new workflow that runs `PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration` on `push`/`pull_request` to main. Use `paths` filter to avoid running on doc-only changes. Docker is available on `ubuntu-24.04` by default.

Example job:

```yaml
  paperless-api-integration:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@...
      - uses: oven-sh/setup-bun@...
      - run: bun install --frozen-lockfile
      - run: bun run test:integration
        env:
          PAPERLESS_API_INTEGRATION_TEST: "1"
```

### Step 2: Verify

Push to a branch and confirm CI runs (or use `bun run check:ci` / `act` if available).

### Step 3: Commit

```bash
git add .github/workflows/ci.yml  # or ci-paperless-api-integration.yml
git commit -m "ci: add paperless-api live integration test job"
```

---

## Task 8: Run full check and fix any issues

**Files:** (any)

### Step 1: Run check (without live test)

```bash
bun run check
```

Expected: Exit 0. Paperless live tests are skipped.

### Step 2: Run check:code

```bash
bun run check:code
```

Expected: Exit 0.

### Step 3: Fix linter/type errors

Resolve any `ReadLints` or typecheck failures in new files.

### Step 4: Commit

```bash
git add -A
git commit -m "fix: resolve lint/type issues in paperless-api live test"
```

---

## Execution Handoff

Plan saved to `docs/plans/2025-03-21-paperless-api-integration-test-plan.md`.

**Execution options:**

1. **Subagent-Driven (this session)** — Dispatch a subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Use a new session with executing-plans for batch execution and checkpoints.

Which approach do you prefer?
