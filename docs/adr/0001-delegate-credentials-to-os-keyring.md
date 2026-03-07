# Delegate credential storage to OS keyring

## Context and Problem Statement

The CredentialsStore currently uses keytar (archived, node-gyp) with a file-based fallback. The file fallback is less secure and undermines the goal of secure credential handling. OpenSSF recommends platform keychains over plaintext. How should we store credentials?

## Considered Options

* **A)** Keep keytar + file fallback — status quo; file fallback is insecure
* **B)** Replace keytar with @napi-rs/keyring, keep file fallback — improves keychain implementation but retains insecure path
* **C)** Delegate entirely to OS keyring — use @napi-rs/keyring; remove file fallback; fail clearly when keyring unavailable

## Decision Outcome

Chosen option: **C**, because security is the primary driver; file fallback is not acceptable.

### Consequences

* Good, because aligns with OpenSSF best practices; single, secure storage path; no temptation to use file store
* Bad, because headless Linux without keychain (e.g. minimal Docker) will fail; users must ensure libsecret/Secret Service is available

### Implementation

* Replace keytar with @napi-rs/keyring (AsyncEntry API)
* Remove `PAPERLESS_INGESTION_CREDENTIALS`, `PAPERLESS_INGESTION_CREDENTIALS_FILE`
* Remove `createFileStore`, file-related code
* Error message when keyring unavailable: direct users to set up keychain (libsecret, gnome-keyring, Secret Service)

### Credential compatibility

Both keytar and @napi-rs/keyring use the same system keychain backends with `(service, account)` semantics. Credentials stored under service `"paperless-ingestion-bot"` should remain accessible after the swap. If edge-case incompatibility appears, users can re-add via `gmail add`.

### Security rule — never log secrets

Passwords must remain wrapped in `Redacted` until the final use site (IMAP auth, `setPassword`). Never call `Redacted.value()` for logging or debugging. Use `Effect.log` only for non-secret data. Credentials must not appear in logs, error messages, or stack traces.
