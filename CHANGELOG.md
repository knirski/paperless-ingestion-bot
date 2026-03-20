# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]


### Added

* **Paperless API upload:** Documents are uploaded via REST API (`POST /api/documents/post_document/`) instead of consume directory. Tags set directly (source, user, Gmail labels). See [ADR 0007](docs/adr/0007-paperless-api-upload.md).
* **Signal user tags:** User tag derived from slug as `signal-{slug}` (e.g. `signal-krzysiek`); consistent with email slug pattern.
* **ci:** Modern CI (2026): reusable workflows (check.yml, nix.yml), `secrets: inherit`, GitHub-provided actions (checkout@v4, setup-node@v4 with built-in npm cache, upload-artifact@v4). Add packageManager to package.json for reproducibility. Determinate Nix tooling, modular composite actions.
* **auto-pr:** TypeScript/Effect scripts replace shell scripts. `auto-pr-ollama.ts` generates PR title and description via Ollama when 2+ semantic commits; `OLLAMA_MODEL` (default: `llama3.1:8b`) and `OLLAMA_URL` overridable via repo vars. Prompts moved from `.github/prompts/` to `scripts/auto-pr/prompts/`. `fill-pr-template` gains `--description-file` for Ollama output. Error handling aligned with main project (Schema.TaggedErrorClass, formatAutoPrError, mapFsError, redactPath).
* **fill-pr-template:** Renamed from fill-pr-body. Filter merge commits from body and title input; include non-conventional commits (type falls back to Chore). Auto-PR workflow: retry `gh` up to 3 times with 5s delay.
* **PII redaction:** Effect `Redacted` for paths, emails, phones, URLs in domain errors. `redactedForLog`, `redactPath`, `redactEmail`, `redactPhone`, `redactUrl` in domain/utils. Raw values never appear in structured logs.

### Breaking Changes

* **Paperless:** Replace consume directory with REST API upload. Config must include `paperless_url` and `paperless_token` (from Paperless Settings → Users → Create token). Remove `consume_dir` if present. No shared volume with Paperless; bot needs network reachability. See [ADR 0007](docs/adr/0007-paperless-api-upload.md).
* **users.json:** Remove `tag_name` and `consume_subdir` from user entries. New format: `{"slug":"krzysiek","signal_number":"+48...","display_name":"Krzysiek"}`. Signal documents are tagged `signal-{slug}`.
* **config:** Split config files (Option 3). Config path from `--config` or `PAPERLESS_INGESTION_CONFIG`; users path from `--users` or `PAPERLESS_INGESTION_USERS_PATH`; email accounts path from `--email-accounts` or `PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH` (no longer in config.json). Config loading uses Effect ConfigProvider with orElse(env, file).
* **credentials:** Replace keytar with @napi-rs/keyring; remove file-based credential fallback. Credentials are stored only in the OS keychain. Users who relied on `PAPERLESS_INGESTION_CREDENTIALS=file` must migrate credentials to the system keychain before upgrading. On headless Linux, ensure libsecret/Secret Service is available (e.g. gnome-keyring, kwallet). See ADR-0001.

## [0.2.1](https://github.com/knirski/paperless-ingestion-bot/compare/v0.2.0...v0.2.1) (2026-03-19)


### Features

* add artifact signing, code scanning, and policy support ([#102](https://github.com/knirski/paperless-ingestion-bot/issues/102)) ([34a566b](https://github.com/knirski/paperless-ingestion-bot/commit/34a566bce480299a95f5a4e9159ac142fa561e91))
* **auto-pr:** migrate shell scripts to TypeScript ([#115](https://github.com/knirski/paperless-ingestion-bot/issues/115)) ([029fa82](https://github.com/knirski/paperless-ingestion-bot/commit/029fa82e65eac1e90add5d394fabae864ed0c8a0))
* enable GHCR publishing and deploy recipes ([#100](https://github.com/knirski/paperless-ingestion-bot/issues/100)) ([3d7fb6b](https://github.com/knirski/paperless-ingestion-bot/commit/3d7fb6b2007ea237e4ae697012f65ebbb699591a))
* **fill-pr-body:** add security conventional commit type ([#118](https://github.com/knirski/paperless-ingestion-bot/issues/118)) ([185b9bb](https://github.com/knirski/paperless-ingestion-bot/commit/185b9bb50765b054375d1e7c34ad63289ecf6e72))
* improve signal test coverage ([#142](https://github.com/knirski/paperless-ingestion-bot/issues/142)) ([8552f63](https://github.com/knirski/paperless-ingestion-bot/commit/8552f63dd2259a1b1e69b8de95d20fea9b0e26eb))
* migrate to Bun as package manager and runtime ([#130](https://github.com/knirski/paperless-ingestion-bot/issues/130)) ([847d7ea](https://github.com/knirski/paperless-ingestion-bot/commit/847d7ea13133a6078d33e658b6e2082c17861421))
* use Effect RateLimiter for credential failure notifications ([#116](https://github.com/knirski/paperless-ingestion-bot/issues/116)) ([11de027](https://github.com/knirski/paperless-ingestion-bot/commit/11de0276fa72ded83a3239eb87cff22ecd4a62c2))


### Bug Fixes

* **ci:** allow contents: write for ci-nix reusable workflow ([#107](https://github.com/knirski/paperless-ingestion-bot/issues/107)) ([6f78032](https://github.com/knirski/paperless-ingestion-bot/commit/6f780322aff3ae37bb0ba18b99b414c3ad016ea7))
* **ci:** disable cancel-in-progress for release-please workflow ([#108](https://github.com/knirski/paperless-ingestion-bot/issues/108)) ([9df5291](https://github.com/knirski/paperless-ingestion-bot/commit/9df5291a49e32d6c8dc5582156fab1c9c5f8f510))
* **ci:** fix workflow run failures and typos ([#111](https://github.com/knirski/paperless-ingestion-bot/issues/111)) ([83ebd49](https://github.com/knirski/paperless-ingestion-bot/commit/83ebd495485c86e5921e18044dbcf62f27594f59))
* **ci:** improve code scanning setup ([#134](https://github.com/knirski/paperless-ingestion-bot/issues/134)) ([2d9b36a](https://github.com/knirski/paperless-ingestion-bot/commit/2d9b36a2ffe06743fe7e17a39fc52679fc42e718))
* **ci:** replace biomejs.dev links with GitHub equivalents ([#135](https://github.com/knirski/paperless-ingestion-bot/issues/135)) ([98fa484](https://github.com/knirski/paperless-ingestion-bot/commit/98fa484d6582ac95c8022dcafb9c03c01fe0f527))
* **ci:** restrict GITHUB_TOKEN permissions for code scanning ([#98](https://github.com/knirski/paperless-ingestion-bot/issues/98)) ([e89567c](https://github.com/knirski/paperless-ingestion-bot/commit/e89567c2928bc58d05a42d3db6e38aac00b78fa6))
* **ci:** simplify Scorecard workflow to avoid code-scanning config mismatch ([#96](https://github.com/knirski/paperless-ingestion-bot/issues/96)) ([310b480](https://github.com/knirski/paperless-ingestion-bot/commit/310b480c6aacd65682fd9f95e108a5d33959be4d))
* **ci:** suppress codecov plugin and config warnings ([#112](https://github.com/knirski/paperless-ingestion-bot/issues/112)) ([ea88619](https://github.com/knirski/paperless-ingestion-bot/commit/ea88619a7be9c1b93ba9ae9140d9afdcde4dc262))
* **ci:** use GitHub App token for release-please to trigger CI on PR [#97](https://github.com/knirski/paperless-ingestion-bot/issues/97) ([#110](https://github.com/knirski/paperless-ingestion-bot/issues/110)) ([fbe1f82](https://github.com/knirski/paperless-ingestion-bot/commit/fbe1f828d97525650e2b80a0ed249cc233722b21))
* **nix:** update npmDepsHash for package-lock.json ([#113](https://github.com/knirski/paperless-ingestion-bot/issues/113)) ([4686038](https://github.com/knirski/paperless-ingestion-bot/commit/46860380a4e6e29a6a9c0c772a34ead71c21a3ba))
* npmDepsHash and PR generation improvements ([#109](https://github.com/knirski/paperless-ingestion-bot/issues/109)) ([10ddb3a](https://github.com/knirski/paperless-ingestion-bot/commit/10ddb3a3ee0d173e6e162ba0f4d3707a459948d5))
* **release:** use v0.2.0 tag format instead of paperless-ingestion-bot-v0.2.0 ([#95](https://github.com/knirski/paperless-ingestion-bot/issues/95)) ([7216834](https://github.com/knirski/paperless-ingestion-bot/commit/7216834b8d9648e6653b8daeb8fd25ebb1ad3027))
* update bun.nix and effect versions for beta.35 ([#140](https://github.com/knirski/paperless-ingestion-bot/issues/140)) ([8834be4](https://github.com/knirski/paperless-ingestion-bot/commit/8834be4b1edcdba018e0217421adcc0039a0fda3))
* update Layer.mock to Effect 4 curried API ([#105](https://github.com/knirski/paperless-ingestion-bot/issues/105)) ([91ee562](https://github.com/knirski/paperless-ingestion-bot/commit/91ee5627791cbbe1361c434e26e5fb4b156a54ab))
* use codecov.io for coverage badge ([#101](https://github.com/knirski/paperless-ingestion-bot/issues/101)) ([7000591](https://github.com/knirski/paperless-ingestion-bot/commit/7000591fa53d927c2529102bb1eea74ca3f4c8f4))

## [0.2.0](https://github.com/knirski/paperless-ingestion-bot/compare/paperless-ingestion-bot-v0.1.1...paperless-ingestion-bot-v0.2.0) (2026-03-12)


### ⚠ BREAKING CHANGES

* config split, 12-factor path overrides ([#45](https://github.com/knirski/paperless-ingestion-bot/issues/45))

### Features

* add Codecov coverage badge and Test Analytics ([#25](https://github.com/knirski/paperless-ingestion-bot/issues/25)) ([78eb17a](https://github.com/knirski/paperless-ingestion-bot/commit/78eb17a5658bab21c524913930aa3e9ab08ccc8d))
* add Docker support (experimental) ([#22](https://github.com/knirski/paperless-ingestion-bot/issues/22)) ([dfbc7b3](https://github.com/knirski/paperless-ingestion-bot/commit/dfbc7b3ae7b0650918824d0153f0b0d1c0b6ef34))
* add fill-pr-body script, Cursor PR workflow, and config updates ([#47](https://github.com/knirski/paperless-ingestion-bot/issues/47)) ([50a4cd7](https://github.com/knirski/paperless-ingestion-bot/commit/50a4cd78b75dd8a2aa03515dbcd306c7fd8fa974))
* add Redacted PII sanitization for error logging (ADR 0002) ([#39](https://github.com/knirski/paperless-ingestion-bot/issues/39)) ([1f62f40](https://github.com/knirski/paperless-ingestion-bot/commit/1f62f4022d1ee268bf2034860bd111d861342582))
* add webhook rate limiting and npm audit to check ([#26](https://github.com/knirski/paperless-ingestion-bot/issues/26)) ([e6e1c09](https://github.com/knirski/paperless-ingestion-bot/commit/e6e1c096ec195784f46ff82693e787d19d42616f))
* **ci:** add ci documentation and permissions ([#76](https://github.com/knirski/paperless-ingestion-bot/issues/76)) ([9c66d37](https://github.com/knirski/paperless-ingestion-bot/commit/9c66d371ad6de3b541749fa46f040013aa2e46ca))
* **ci:** add ci-docs for docs-only merge and CodeQL permissions ([#75](https://github.com/knirski/paperless-ingestion-bot/issues/75)) ([45c4683](https://github.com/knirski/paperless-ingestion-bot/commit/45c46835c79dd4e616dab66360d32856bafb349c))
* **ci:** create auto-PRs as ready for review, add Gemini config ([#65](https://github.com/knirski/paperless-ingestion-bot/issues/65)) ([49e41be](https://github.com/knirski/paperless-ingestion-bot/commit/49e41be5d744da199c7228fa3f5f04849da82795))
* **ci:** enhance local CI and docs validation ([#77](https://github.com/knirski/paperless-ingestion-bot/issues/77)) ([c02bf43](https://github.com/knirski/paperless-ingestion-bot/commit/c02bf43a1a0efd9f3307109edcbfa5e06c22763c))
* **ci:** use built-in paths filter, split nix into nix-ci ([#73](https://github.com/knirski/paperless-ingestion-bot/issues/73)) ([395d73c](https://github.com/knirski/paperless-ingestion-bot/commit/395d73c76ba56e0dcd2381f7109611d8392a08ff))
* config split, 12-factor path overrides ([#45](https://github.com/knirski/paperless-ingestion-bot/issues/45)) ([2efc841](https://github.com/knirski/paperless-ingestion-bot/commit/2efc8410b3e87f343d8ecae3b0744bf13001b64c))
* migrate credentials from keytar to @napi-rs/keyring (ADR 0001) ([#38](https://github.com/knirski/paperless-ingestion-bot/issues/38)) ([bc0507f](https://github.com/knirski/paperless-ingestion-bot/commit/bc0507f644f63adbd827c7528d0bbe397a97bc06))


### Bug Fixes

* add actions: write for Scorecard upload-artifact ([#16](https://github.com/knirski/paperless-ingestion-bot/issues/16)) ([2fb03de](https://github.com/knirski/paperless-ingestion-bot/commit/2fb03deea9c40bff9a68bda223ff5fc60d784d8c))
* allow Dependabot PRs to pass CI and fix update-hash push ([#18](https://github.com/knirski/paperless-ingestion-bot/issues/18)) ([fb5d0ad](https://github.com/knirski/paperless-ingestion-bot/commit/fb5d0ad8cc862b601e10d014e6a2f7f29b5db846))
* **ci:** add pull_request trigger to scorecard workflow ([#94](https://github.com/knirski/paperless-ingestion-bot/issues/94)) ([2c4f925](https://github.com/knirski/paperless-ingestion-bot/commit/2c4f925ab0804f3a796325df1c30ef107f082752))
* **ci:** align paths filter with Biome migration ([#37](https://github.com/knirski/paperless-ingestion-bot/issues/37)) ([3b0d1e2](https://github.com/knirski/paperless-ingestion-bot/commit/3b0d1e21ead0a5910724f78f9a0ba68e981d0f16))
* **ci:** align Scorecard workflow with OSSF restrictions ([#21](https://github.com/knirski/paperless-ingestion-bot/issues/21)) ([02423a2](https://github.com/knirski/paperless-ingestion-bot/commit/02423a24918f4a8fb17bdf48508bd02e71c91776))
* **ci:** complete paths filter and job adjustments ([#52](https://github.com/knirski/paperless-ingestion-bot/issues/52)) ([b8491fa](https://github.com/knirski/paperless-ingestion-bot/commit/b8491fa25436c82a725019ce316bb5e362db8a51))
* **ci:** do not fail when npmDepsHash is already correct ([#69](https://github.com/knirski/paperless-ingestion-bot/issues/69)) ([5ed99b8](https://github.com/knirski/paperless-ingestion-bot/commit/5ed99b891a83c1e8c04e13ad357b9c15e14a7b44))
* **ci:** grant contents: write to nix job for reusable workflow ([84bac01](https://github.com/knirski/paperless-ingestion-bot/commit/84bac014d4e3d1ecc5c1f01bd5a071318eb2b410))
* **ci:** handle initial push in commitlint, pin scorecard-action to v2.3.1 ([2265a4a](https://github.com/knirski/paperless-ingestion-bot/commit/2265a4a61087fc0543815200ddb656e32fa67f49))
* **ci:** nix permissions, checkout before local actions, paths-filter node24 ([#66](https://github.com/knirski/paperless-ingestion-bot/issues/66)) ([963772e](https://github.com/knirski/paperless-ingestion-bot/commit/963772e76fc969e942d17f1bd6e22d18ada5d0b7))
* **ci:** refactor auto-PR workflow and correct Ollama usage ([#51](https://github.com/knirski/paperless-ingestion-bot/issues/51)) ([e728823](https://github.com/knirski/paperless-ingestion-bot/commit/e728823377ef472948ebc2051db548552a5da8db))
* **ci:** remove custom CodeQL workflow, drop magic-nix-cache-action ([155d435](https://github.com/knirski/paperless-ingestion-bot/commit/155d4352cdf19c34f2c9674dfd819d908d862c3c))
* **ci:** replace deprecated codecov/test-results-action with codecov-action report_type ([#33](https://github.com/knirski/paperless-ingestion-bot/issues/33)) ([5c512fc](https://github.com/knirski/paperless-ingestion-bot/commit/5c512fcfaa3d2bf275f15d86c6bca5b5c29aa1b0))
* **ci:** resolve lychee 404 and nix FlakeHub auth failures ([#93](https://github.com/knirski/paperless-ingestion-bot/issues/93)) ([3af3538](https://github.com/knirski/paperless-ingestion-bot/commit/3af3538444eccd3712b27f7f88fbb492551f300b))
* **ci:** resolve Scorecard and Nix build failures ([#46](https://github.com/knirski/paperless-ingestion-bot/issues/46)) ([41411f8](https://github.com/knirski/paperless-ingestion-bot/commit/41411f8a33f06f0186ba06aad0e632b9b983d5fa))
* **ci:** trigger check workflow after ci-nix pushes npmDepsHash ([#87](https://github.com/knirski/paperless-ingestion-bot/issues/87)) ([fb6298b](https://github.com/knirski/paperless-ingestion-bot/commit/fb6298b643093cbf4cecacc0eb898c4fe995e174))
* **ci:** unify check run name for branch protection ([#82](https://github.com/knirski/paperless-ingestion-bot/issues/82)) ([b1d76c7](https://github.com/knirski/paperless-ingestion-bot/commit/b1d76c764ca8d65a0d3ea159464d78159f3cf145))
* **ci:** use GitHub App token for nix push to trigger CI ([#81](https://github.com/knirski/paperless-ingestion-bot/issues/81)) ([4783639](https://github.com/knirski/paperless-ingestion-bot/commit/4783639056b78f9e283af237e0ae2ce9bd85b2d1))
* **docs:** correct broken relative links and add lychee retries ([#83](https://github.com/knirski/paperless-ingestion-bot/issues/83)) ([77b78cd](https://github.com/knirski/paperless-ingestion-bot/commit/77b78cdeb8ad06b86128732ad8a9ef855b63d820))
* **nix:** update npmDepsHash for package-lock.json ([#79](https://github.com/knirski/paperless-ingestion-bot/issues/79)) ([830d796](https://github.com/knirski/paperless-ingestion-bot/commit/830d796cbcba18a1c50713701c1f42b741c17531))
* **release:** add manifest to respect bump-minor-pre-major ([#89](https://github.com/knirski/paperless-ingestion-bot/issues/89)) ([4d5c6a2](https://github.com/knirski/paperless-ingestion-bot/commit/4d5c6a255a13f6e6a664dfc90c5f3b132b64381a))
* **release:** use manifest mode so release-please reads manifest ([#90](https://github.com/knirski/paperless-ingestion-bot/issues/90)) ([4bbfca2](https://github.com/knirski/paperless-ingestion-bot/commit/4bbfca29bc465288f529bfab7bd02d198360959a))
* **scripts:** create PRs as ready, not draft ([#67](https://github.com/knirski/paperless-ingestion-bot/issues/67)) ([b2a1fe0](https://github.com/knirski/paperless-ingestion-bot/commit/b2a1fe0f61e4b411aa0d3e691320bae615b4ed75))


### Performance Improvements

* **ci:** remove Ollama model cache from auto-pr workflow ([#78](https://github.com/knirski/paperless-ingestion-bot/issues/78)) ([43ad55e](https://github.com/knirski/paperless-ingestion-bot/commit/43ad55e5dddfbe9aa40f4d2f578ed054373858e8))

## [0.1.1](https://github.com/knirski/paperless-ingestion-bot/compare/v0.1.0...v0.1.1) (2026-03-07)


### Bug Fixes

* **ci:** handle initial push in commitlint, pin scorecard-action to v2.3.1 ([2265a4a](https://github.com/knirski/paperless-ingestion-bot/commit/2265a4a61087fc0543815200ddb656e32fa67f49))
* **ci:** remove custom CodeQL workflow, drop magic-nix-cache-action ([155d435](https://github.com/knirski/paperless-ingestion-bot/commit/155d4352cdf19c34f2c9674dfd819d908d862c3c))

## [0.1.0] - 2025-03-07

### Added

- Signal webhook server for document attachments
- Gmail IMAP crawl for email attachments
- Generic IMAP support (manual config)
- Ollama-based eligibility assessment
- Keytar and file-based credential storage
- Config-driven JSON setup
