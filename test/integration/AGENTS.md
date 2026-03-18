# Integration Tests

When editing `test/integration/`, follow these instructions.

## Running

- **This directory:** `bun run test:integration`
- **Optional live Gmail:** `GMAIL_TEST_EMAIL=... GMAIL_APP_PASSWORD=... bun run test:integration` (requires 2FA + app password; skips when unset)
- **Optional keyring test:** `KEYRING_TEST=1 bun run test:integration` (verifies system keychain; skips when unset)

## Strategy

- Tagless Final: mock layers (`createImapMockLayer`, `createSignalMockLayer`) replace live services.
- No real IMAP, Ollama, or Signal API required for mock-based tests.
- See [README.md](README.md) for fixtures, adding tests, and optional live Gmail setup.
