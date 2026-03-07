# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1](https://github.com/knirski/paperless-ingestion-bot/compare/v0.1.0...v0.1.1) (2026-03-07)


### Bug Fixes

* **ci:** handle initial push in commitlint, pin scorecard-action to v2.3.1 ([2265a4a](https://github.com/knirski/paperless-ingestion-bot/commit/2265a4a61087fc0543815200ddb656e32fa67f49))
* **ci:** remove custom CodeQL workflow, drop magic-nix-cache-action ([155d435](https://github.com/knirski/paperless-ingestion-bot/commit/155d4352cdf19c34f2c9674dfd819d908d862c3c))

## [Unreleased]

### Added

* **PII redaction:** Effect `Redacted` for paths, emails, phones, URLs in domain errors. `redactedForLog`, `redactPath`, `redactEmail`, `redactPhone`, `redactUrl` in domain/utils. Raw values never appear in structured logs.

### Changed

* **credentials:** Replace keytar with @napi-rs/keyring; remove file-based credential fallback. Credentials are stored only in the OS keychain. Users who relied on `PAPERLESS_INGESTION_CREDENTIALS=file` must migrate credentials to the system keychain before upgrading. On headless Linux, ensure libsecret/Secret Service is available (e.g. gnome-keyring, kwallet). See ADR-0001.

## [0.1.0] - 2025-03-07

### Added

- Signal webhook server for document attachments
- Gmail IMAP crawl for email attachments
- Generic IMAP support (manual config)
- Ollama-based eligibility assessment
- Keytar and file-based credential storage
- Config-driven JSON setup
