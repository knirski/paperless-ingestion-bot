# Integration Tests

**Mock-based** (`*.integration.test.ts`): End-to-end tests for email and Signal pipelines using programmable mocks. No real IMAP, Ollama, or Signal API required. Run with `bun run test:integration` or `bun test` (included in check).

**Live** (`*.live.integration.test.ts`): Optional tests against real services (Paperless, Gmail, keyring). Skips when env unset. Run with `bun run test:integration:live` and the appropriate env vars. CI runs the Paperless live test only.

## Optional: Live Gmail Test

**Read-only.** Runs the full email pipeline against real Gmail but mocks all write operations (save, markProcessed). No files are written, no labels are applied. Your mailbox and account state are unchanged.

The test:

1. Connects to Gmail via IMAP using your credentials
2. Runs the full pipeline: search, fetch, eligibility (Ollama mocked to always accept), path resolution
3. Mocks `writeFile`, `makeDirectory`, and `markProcessed`; logs each with `confidence: "high"` and a reason
4. Asserts the pipeline completes and returns `saved` (the count of messages that would be saved)

**What it proves:** Gmail IMAP connection, X-GM-RAW search, fetch, eligibility flow, and path resolution work end-to-end with real Gmail. A passing run with logged mocks gives high confidence that production writes would succeed.

**What it does not prove:** Actual file writes, label changes, Ollama, Signal, CLI, or webhook. Those are covered by mock-based tests only.

**Confidence:** Each mocked write logs `confidence: "high"` with a reason (e.g. `fetch succeeded, session valid, path resolved`). The test maximizes confidence by exercising the real path up to the write boundary without changing state.

```bash
GMAIL_TEST_EMAIL=your@gmail.com GMAIL_APP_PASSWORD=xxxx bun run test:integration:live
```

Requires a Gmail account with 2FA enabled and an [app password](https://support.google.com/accounts/answer/185833). Skips when credentials are not set.

## Optional: Paperless API Integration Test

Runs real paperless-ngx in Docker via Testcontainers. Uses `beforeAll`/`afterAll` for compose lifecycle so tests can be split into multiple `it()` blocks. Skips when `PAPERLESS_API_INTEGRATION_TEST` is not set.

**API version:** Same contract as production — see [Config](../../README.md#config) (Paperless API version contract) and `PAPERLESS_NGX_ACCEPT_VERSION` in `src/live/paperless-client.ts`.

```bash
PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration:live
```

Requires Docker. See [deploy/compose/README.md](../../deploy/compose/README.md) for Testcontainers setup. Compose starts in `beforeAll`, tears down in `afterAll`.

**Helpers:** API verification and polling live in `paperless-api-helpers.ts` — `apiGet`, `apiGetDocuments`, `apiGetTags`, `apiPostToken`, `pollUntilDocumentWithTag`, `pollUntilDocumentWithFilename`, `findDocByFilename`, etc. Use `HttpClient` + `filterStatusOk` + `schemaBodyJson(Schema)` for type-safe decoding.

## Optional: Keyring Availability Test

Verifies that @napi-rs/keyring (system keychain) can be imported and performs a round-trip: `setPassword` → `getPassword` → `deletePassword`. Skips when `KEYRING_TEST` is not set (like the Gmail test). When set, runs the test; fails if keyring is unavailable (e.g. headless Linux, CI without keychain).

```bash
KEYRING_TEST=1 bun run test:integration:live
```

Requires a system keychain (libsecret/Secret Service, e.g. gnome-keyring, kwallet). Skips when `KEYRING_TEST` is not set.

## Strategy

- **Tagless Final**: Mock layers (`createImapMockLayer`, `createSignalMockLayer`, `Layer.succeed(OllamaClient)(...)`) replace live services.
- **Effect.runPromise** at the boundary; no `@effect/vitest` (incompatible with Effect v4).
- **Fixtures**: `integrationTest` provides `tmpDir` and `emailAccountsPath`; `buildTestLayer` composes layers per test.
- **Optional live tests** (keyring, Gmail): For availability probes at load time, use `Effect.gen` + `Layer.build` + `Effect.exit`; run with `Effect.runPromise(Effect.scoped(...))`. Test the service layer (e.g. `CredentialsStore.live`), not the underlying library.
- **Paperless API integration** (Testcontainers): Use `beforeAll`/`afterAll` for compose lifecycle so multiple `it()` blocks share the same env. Helpers in `paperless-api-helpers.ts`; API verification via `HttpClient` + `schemaBodyJson(Schema)`.

## Fixtures

| Fixture                                                                                  | Purpose                                                                                       |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `paperless-api-helpers.ts`                                                               | API GET, token, polling (`pollUntilDocumentWithTag`, `pollUntilDocumentWithFilename`), `findDocByFilename` for Paperless live tests |
| `integrationTest`                                                                        | Vitest `test.extend()` with tmpDir, emailAccountsPath; auto cleanup                           |
| `createImapMockLayer(scenario, { spy? })`                                                | Mock IMAP; supports `searchFail`, `fetchFail`, `markProcessedFail`                            |
| `createSignalMockLayer(scenario, { spy?; defaultAccount? })`                             | Mock Signal; supports `fetchAttachmentFail`, `sendMessageFail`, `getAccountResult`            |
| `writeAccountsFile(tmpDir, accounts)`                                                    | Write custom `email-accounts.json` for multi-account tests                                    |
| `eligiblePdfAttachment(uid)`, etc.                                                       | Attachment factories for email eligibility scenarios                                          |
| `signalPdfAttachment(id)`, `signalImageAttachment(id)`, `signalIneligibleAttachment(id)` | Attachment helpers for Signal (return `Record<string, Uint8Array>` for `fetchAttachmentData`) |

## Signal Pipeline

Same strategy as email: `processWebhookPayload` is called directly with mock layers. No HTTP server needed.

- **Adding a test**: Use `integrationTest`, `buildTestLayer`, `runWebhook(layer, payload)`. Assert on `spy.sendMessageCalls`, `spy.fetchAttachmentCalls`, or `paperlessSpy.uploadCalls`. Use `configOverrides` for custom registry; `credentialsStore` for gmail commands with specific accounts.

## Adding a Test

### Email pipeline

1. Use `integrationTest("name", async ({ tmpDir, emailAccountsPath }) => { ... })`.
2. Build layer: `buildTestLayer({ tmpDir, emailAccountsPath }, scenario, options)`.
3. Run: `const result = await runPipeline(layer)`.
4. Assert on `result.saved`, `spy.*Calls`, or files in `accountSubdir(tmpDir)`.

For failure tests, pass `configOverrides: { imapRetrySchedule: imapRetryScheduleFast }` to avoid ~3s retry delays.

### Signal pipeline

1. Use `integrationTest("name", async ({ tmpDir, emailAccountsPath }) => { ... })`.
2. Build layer: `buildTestLayer({ tmpDir, emailAccountsPath }, scenario, options)`.
3. Run: `await runWebhook(layer, payload)`.
4. Assert on `spy.sendMessageCalls`, `spy.fetchAttachmentCalls`, or `paperlessSpy.uploadCalls`.
