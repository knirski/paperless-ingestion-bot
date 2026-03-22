# Integration Tests

When editing `test/integration/`, follow these instructions.

## Running

- **Mock-based (all):** `bun run test:integration` — email/signal pipelines with mocks
- **Live (opt-in):** `bun run test:integration:live` — Paperless, Gmail, keyring (require env vars; skips when unset)
  - Gmail: `GMAIL_TEST_EMAIL=... GMAIL_APP_PASSWORD=...`
  - Keyring: `KEYRING_TEST=1`
  - Paperless: `PAPERLESS_API_INTEGRATION_TEST=1` (requires Docker; runs in CI)

## Strategy

- Tagless Final: mock layers (`createImapMockLayer`, `createSignalMockLayer`) replace live services.
- No real IMAP, Ollama, or Signal API required for mock-based tests.
- **Paperless live tests:** Use helpers from `paperless-api-helpers.ts`; `runWithExit` in `test-utils.ts` for failure assertions.
- See [README.md](README.md) for fixtures, adding tests, and optional live Gmail setup.
