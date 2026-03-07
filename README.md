# Paperless Ingestion Bot

[![CI](https://github.com/knirski/paperless-ingestion-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/knirski/paperless-ingestion-bot/actions)
[![Version](https://img.shields.io/github/package-json/v/knirski/paperless-ingestion-bot)](https://github.com/knirski/paperless-ingestion-bot/blob/main/package.json)
[![Coverage](https://codecov.io/gh/knirski/paperless-ingestion-bot/graph/badge.svg)](https://codecov.io/gh/knirski/paperless-ingestion-bot)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/knirski/paperless-ingestion-bot/badge)](https://scorecard.dev/viewer/?uri=github.com/knirski/paperless-ingestion-bot)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-Support-ea4aaa.svg)](https://github.com/sponsors/knirski)
[![Liberapay](https://img.shields.io/badge/Liberapay-Support-yellow.svg)](https://liberapay.com/knirski/)
[![CII Best Practices](https://img.shields.io/badge/CII%20Best%20Practices-register-green)](https://bestpractices.coreinfrastructure.org/en/projects/new?project_url=https%3A%2F%2Fgithub.com%2Fknirski%2Fpaperless-ingestion-bot)

Signal and Gmail document ingestion for [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx).

**Stop drowning in paper.** Hundreds of emails with receipts, contracts, and attachments buried in your Gmail, or physical docs piling up on your desk? Scan or snap, send via [Signal](https://signal.org/) or email, and let [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) do the rest. Optional AI (local [Ollama](https://ollama.ai/)) filters junk; pair with [paperless-ai](https://github.com/clusterzx/paperless-ai) for tags and summaries. Find any document when you need it.

**Privacy-first:** Runs fully locally. No cloud APIs, no telemetry. Signal is a privacy-focused IM; AI uses local Ollama. Your documents stay on your machine.

Setup is a bit involved. Geeks will feel at home - determined non-geeks can get there too. Linux and macOS, Windows may work (WSL could help).

## Prerequisites

- [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) running with a consume directory
- For **Signal**: [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) must be running first
- For **Gmail**: Signal must be set up first (accounts are added via Signal commands)

## Features

- **Signal**: Webhook server for document attachments sent via Signal.
- **Gmail**: IMAP-based crawl for email attachments. One-shot (runs once, exits). Schedule with cron or systemd timer.
- **Ollama**: Optional AI eligibility filter for email attachments (images, plain text).

Supported file types: PDF, Word (.doc, .docx), RTF, Office formats, images (JPEG, PNG, etc.), plain text, HTML, CSV.

### Future

Might add: other email providers (Outlook, Proton), other IMs (Matrix, Telegram), cloud storage, scanners, fax.

## Dependencies

| Dependency                                                              | Required   | Purpose                                                                                                                                            |
| ----------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx)         | Yes        | Document management system; bot writes files to the consume directory                                                                              |
| [Ollama](https://ollama.ai/)                                            | No         | Optional AI-based eligibility assessment for documents (runs locally)                                                                              |
| [paperless-ai](https://github.com/clusterzx/paperless-ai)               | No         | Optional AI post-processing (tags, titles, correspondents). This bot uses Ollama directly for pre-ingestion; paperless-ai augments after ingestion |
| [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) | For Signal | Webhook server for Signal Messenger                                                                                                                |
| Node.js ≥ 24                                                            | Yes        | Runtime                                                                                                                                            |

## Quick Start

Install below, then follow [Setup](#setup) (Signal or Gmail) before running commands.

### Installation

**npm or Nix:**

**npm (from source):**

```bash
git clone https://github.com/knirski/paperless-ingestion-bot.git
cd paperless-ingestion-bot
npm install && npm run build
```

**Nix:**

```bash
nix build .#default          # Build package
nix develop                   # Development shell
nix run .#default -- signal --config /path/to/config.json
```

**Docker (experimental, in progress):**

A Dockerfile is available; image publishing to GHCR is not yet enabled. You can build locally:

```bash
docker build -t paperless-ingestion-bot .
docker run --rm \
  -v /path/to/config:/etc/paperless-ingestion-bot:ro \
  -v /path/to/data:/var/lib/paperless-ingestion-bot \
  paperless-ingestion-bot signal
```

Mount your config directory at `/etc/paperless-ingestion-bot` (must contain `config.json`) and a data directory at `/var/lib/paperless-ingestion-bot` (for consume, email-accounts.json, ingest-users.json). For headless Linux, set `PAPERLESS_INGESTION_CREDENTIALS=file`.

### Commands

- `paperless-ingestion-bot signal`: Run Signal webhook server
- `paperless-ingestion-bot email`: Scan Gmail inboxes for attachments (one-shot; use with cron/systemd timer)
- `paperless-ingestion-bot --version`: Show version
- `paperless-ingestion-bot email --json`: Output `{ "saved": N }` to stdout for scripting

## Setup

### Signal

1. Run [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) (e.g. via Docker).
2. Link your device: open `http://<signal-api-host>/v1/qrcodelink` in a browser.
3. Configure the webhook URL in signal-cli-rest-api: `RECEIVE_WEBHOOK_URL=http://<ingestion-bot-host>:<port>/webhook`.
4. Create `ingest-users.json` at the path in config (see Config schema below). Do not commit this file.
5. Start the ingestion bot: `paperless-ingestion-bot signal --config /path/to/config.json`.

### Gmail

1. Enable IMAP in Gmail settings.
2. Create an [App Password](https://myaccount.google.com/apppasswords) (requires 2-Step Verification).
3. Add the account via Signal: send `gmail add user@example.com <app_password>` to the linked Signal number.
4. Run the email pipeline (manually or via timer): `paperless-ingestion-bot email --config /path/to/config.json`.

### Generic IMAP

Generic IMAP is supported but adding accounts via Signal isn't implemented yet. Add entries manually to `email-accounts.json` (array of account objects). Each needs `email`, `enabled`, `removed`, `exclude_labels`, `added_by`, and `details` with `type: "generic_imap"`, `host`, `port`, `secure`, `mailbox`. Gmail passwords go in the system keychain via `gmail add`; for generic IMAP you add credentials to the system keychain yourself.

## Config

JSON config (often Nix-generated via `builtins.toJSON`). Standalone: no parent-repo structure, just clone and run.

**Resolution order:** `--config` flag > `PAPERLESS_INGESTION_CONFIG` env > `/etc/paperless-ingestion-bot/config.json`

### Schema

```json
{
	"consume_dir": "/path/to/paperless/consume",
	"email_accounts_path": "/var/lib/paperless-ingestion-bot/email-accounts.json",
	"signal_api_url": "http://127.0.0.1:8080",
	"ingest_users_path": "/var/lib/paperless-ingestion-bot/ingest-users.json",
	"log_level": "INFO",
	"webhook_host": "127.0.0.1",
	"webhook_port": 8089,
	"ollama_url": "http://127.0.0.1:11434",
	"ollama_vision_model": "moondream",
	"ollama_text_model": "llama3.2",
	"mark_processed_label": "paperless",
	"page_size": 50
}
```

- `consume_dir`: Paperless-ngx consume directory (bot writes files here)
- `email_accounts_path`: Path to `email-accounts.json` (Gmail/IMAP account metadata; passwords in system keychain)
- `signal_api_url`: signal-cli-rest-api base URL (e.g. `http://127.0.0.1:8080`)
- `ingest_users_path`: Path to `ingest-users.json` (user registry). Create manually, don't commit
- `webhook_host`, `webhook_port`: Signal webhook server bind address
- `ollama_url`, `ollama_vision_model`, `ollama_text_model`: Ollama endpoint and models for AI eligibility (optional)
- `log_level`: `DEBUG` | `INFO` | `WARN` | `ERROR`
- `mark_processed_label`: Gmail label for processed messages; empty string disables labeling
- `page_size`: Email fetch batch size

See [config.example.json](config.example.json) for a full example.

**ingest-users.json** format (array of user objects):

```json
[
	{
		"slug": "krzysiek",
		"signal_number": "+48123456789",
		"consume_subdir": "krzysiek",
		"display_name": "Krzysiek",
		"tag_name": "Added by Krzysiek"
	}
]
```

- `slug`: Unique identifier (used in consume subdir, config references)
- `signal_number`: User's Signal phone number
- `consume_subdir`: Subdirectory under `consume_dir` for this user's documents
- `display_name`: Human-readable name
- `tag_name`: Tag Paperless-ngx applies when ingesting (e.g. "Added by Krzysiek")

## Security

**Security-first design.** This project takes supply chain and operational security seriously:

- **Credentials** — Stored only in the OS keychain (@napi-rs/keyring). No file fallback; fails clearly when keyring unavailable. Gmail app passwords and Signal API access never touch disk in plaintext.
- **Webhook** — Token-bucket rate limiting (120/min); excess returns 429. Same-host deployment recommended: bind to `127.0.0.1` so only local processes (signal-cli-rest-api) can reach it. See [ADR 0002](docs/adr/0002-signal-webhook-security.md).
- **PII in errors** — Paths, emails, phones, URLs are redacted in logs via Effect `Redacted`; raw values never appear in structured logs.
- **Supply chain** — `npm audit --audit-level=high` in every check. CycloneDX SBOM generated in CI. Dependabot, CodeQL, OpenSSF Scorecard with least-privilege workflow permissions.
- **File permissions** — email-accounts metadata written with mode `0600`. Run as a dedicated user.

**Trust model:** All family members in the config share the same Gmail account registry. Anyone can run `gmail status` to see all configured accounts and use pause/resume/remove on any of them. The design assumes a trusted group.

## Troubleshooting

| Issue                                                              | Solution                                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `System keychain unavailable` or `File system error: getPassword at keyring` | Ensure libsecret/Secret Service is available (e.g. gnome-keyring, kwallet). On headless Linux, run a secret service or use a session with keychain support.                                  |
| `Config file not found`                                            | Pass `--config /path/to/config.json` or set `PAPERLESS_INGESTION_CONFIG`.                                                                                                                    |
| `No users configured`                                              | Create `ingest-users.json` at the path in config: `[{"slug":"krzysiek","signal_number":"+48...","consume_subdir":"krzysiek","display_name":"Krzysiek","tag_name":"Added by Krzysiek"},...]`. |
| `No account found` for gmail commands                              | Run `gmail status` to list accounts. Add with `gmail add email@example.com <app_password>`.                                                                                                  |
| IMAP connection fails                                              | Enable IMAP in Gmail; use App Password, not main password.                                                                                                                                   |
| Ollama assessment timeout                                          | Increase model load or reduce prompt; timeout is 60s.                                                                                                                                        |

## Verification

```bash
npm run check
```

Runs tests, lint, and typecheck.

**CI:** GitHub Actions runs `npm run check` on push and PR. Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint). A CycloneDX SBOM is generated and uploaded as a workflow artifact.

## Documentation

TypeScript implementation using [Effect](https://effect.website/) and functional programming conventions. Bleeding edge: uses the latest Effect version (v4 beta).

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): Project structure and design
- [CONTRIBUTING.md](CONTRIBUTING.md): How to contribute
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): Community standards
- [SECURITY.md](SECURITY.md): Vulnerability reporting
- [SUPPORT.md](SUPPORT.md): Getting help
- [test/integration/README.md](test/integration/README.md): Integration test guide
- [docs/adr/](docs/adr/): Architecture Decision Records

**CII Best Practices:** Complete the [self-assessment](https://bestpractices.coreinfrastructure.org/en/projects/new?project_url=https%3A%2F%2Fgithub.com%2Fknirski%2Fpaperless-ingestion-bot) to earn the badge and improve OpenSSF Scorecard.

This project was developed with assistance from [Cursor](https://cursor.com/).

## License

Apache 2.0. See [LICENSE](LICENSE).
