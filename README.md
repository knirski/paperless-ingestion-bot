# Paperless Ingestion Bot

[![CI](https://github.com/knirski/paperless-ingestion-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/knirski/paperless-ingestion-bot/actions)
[![Version](https://img.shields.io/github/package-json/v/knirski/paperless-ingestion-bot)](https://github.com/knirski/paperless-ingestion-bot/blob/main/package.json)
[![Coverage](https://codecov.io/gh/knirski/paperless-ingestion-bot/graph/badge.svg)](https://app.codecov.io/gh/knirski/paperless-ingestion-bot)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/knirski/paperless-ingestion-bot/badge)](https://scorecard.dev/viewer/?uri=github.com/knirski/paperless-ingestion-bot)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/license/Apache-2.0)
[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-Support-ea4aaa.svg)](https://github.com/sponsors/knirski)
[![Liberapay](https://img.shields.io/badge/Liberapay-Support-yellow.svg)](https://liberapay.com/knirski/)
[![CII Best Practices](https://img.shields.io/badge/CII%20Best%20Practices-register-green)](https://www.bestpractices.dev/en/projects/new?project_url=https%3A%2F%2Fgithub.com%2Fknirski%2Fpaperless-ingestion-bot)

Signal and Gmail document ingestion for [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx).

**Stop drowning in paper.** Hundreds of emails with receipts, contracts, and attachments buried in your Gmail, or physical docs piling up on your desk? Scan or snap, send via [Signal](https://signal.org/) or email, and let [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) do the rest. Optional AI (local [Ollama](https://ollama.com/)) filters junk; pair with [paperless-ai](https://github.com/clusterzx/paperless-ai) for tags and summaries. Find any document when you need it.

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
- **Auto-PR**: Push to `ai/**` branches to auto-create PRs with titles from conventional commits via [knirski/auto-pr](https://github.com/knirski/auto-pr).

Supported file types: PDF, Word (.doc, .docx), RTF, Office formats, images (JPEG, PNG, etc.), plain text, HTML, CSV.

### Future

Might add: other email providers (Outlook, Proton), other IMs (Matrix, Telegram), cloud storage, scanners, fax.

### Potentially useful projects

See [docs/RELATED_PROJECTS.md](docs/RELATED_PROJECTS.md) for a list of projects that complement or extend this bot.

## Dependencies

| Dependency                                                              | Required   | Purpose                                                                                                                                            |
| ----------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx)         | Yes        | Document management system; bot writes files to the consume directory                                                                              |
| [Ollama](https://ollama.com/)                                            | No         | Optional AI eligibility assessment; also used for AI-generated PR titles in the auto-PR workflow (runs locally)                                    |
| [paperless-ai](https://github.com/clusterzx/paperless-ai)               | No         | Optional AI post-processing (tags, titles, correspondents). This bot uses Ollama directly for pre-ingestion; paperless-ai augments after ingestion |
| [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) | For Signal | Webhook server for Signal Messenger                                                                                                                |
| Bun ≥ 1.3                                                              | Yes        | Runtime. See [Bun support policy](#bun-support-policy) below.                                                                                         |

## Quick Start

Install below, then follow [Setup](#setup) (Signal or Gmail) before running commands.

### Installation

**Bun or Nix:**

**Bun (from source):**

```bash
git clone https://github.com/knirski/paperless-ingestion-bot.git
cd paperless-ingestion-bot
bun install && bun run build
```

**Nix:**

```bash
nix build .#default          # Build package
nix develop                  # Development shell
nix run .#default -- signal --config /path/to/config.json
```

**Docker:**

Images are published to [GHCR](https://github.com/knirski/paperless-ingestion-bot/pkgs/container/paperless-ingestion-bot) on each release. Release images are signed with Sigstore keyless signing; see [docs/CI.md](docs/CI.md) for verification steps. Use [Compose](deploy/compose/README.md) — minimal (Signal + ingestion bot) or full-stack (Paperless + Signal + Ollama) — or run standalone:

```bash
docker run --rm \
  -v /path/to/config:/etc/paperless-ingestion-bot:ro \
  -v /path/to/data:/var/lib/paperless-ingestion-bot \
  ghcr.io/knirski/paperless-ingestion-bot:latest signal
```

Mount your config directory at `/etc/paperless-ingestion-bot` (must contain `config.json`) and a data directory at `/var/lib/paperless-ingestion-bot` (for consume, email-accounts.json, users.json). For Gmail, headless Linux requires a system credential store (libsecret/Secret Service); see [Troubleshooting](#troubleshooting).

**Env overrides:** Override file values with individual env vars (e.g. `-e PAPERLESS_INGESTION_SIGNAL_API_URL=http://signal:8080`). Use `--skip-reachability-check` when the Signal API starts after the bot (e.g. Docker Compose).

**Deployment:** [deploy/](deploy/) — [Compose](deploy/compose/README.md) (minimal or full-stack) and [systemd](deploy/systemd/README.md) (service + timer units).

### Commands

- `paperless-ingestion-bot signal`: Run Signal webhook server (validates `consume_dir` and `signal_api_url` at startup; use `--skip-reachability-check` to bypass API reachability check)
- `paperless-ingestion-bot email`: Scan Gmail inboxes for attachments (one-shot; use with cron/systemd timer)
- `paperless-ingestion-bot --help`: Show help
- `paperless-ingestion-bot --version`: Show version
- `paperless-ingestion-bot email --json`: Output `{ "saved": N }` to stdout for scripting
- `paperless-ingestion-bot --completions <bash|zsh|fish>`: Print shell completion script (append to `~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`)

## Setup

### Signal

1. Run [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) (e.g. via Docker).
2. Link your device: open `http://<signal-api-host>/v1/qrcodelink` in a browser.
3. Configure the webhook URL in signal-cli-rest-api: `RECEIVE_WEBHOOK_URL=http://<ingestion-bot-host>:<port>/webhook`.
4. Create `users.json` at `--users` path or default (see Config schema below). Do not commit this file.
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

**Resolution:** `--config` flag or `PAPERLESS_INGESTION_CONFIG` env or default `/etc/paperless-ingestion-bot/config.json`. 12-factor: individual values and paths override via env (e.g. `PAPERLESS_INGESTION_SIGNAL_API_URL`).

**Env overrides (12-factor):** Individual env vars override file values when set: `PAPERLESS_INGESTION_CONSUME_DIR`, `PAPERLESS_INGESTION_SIGNAL_API_URL`, `PAPERLESS_INGESTION_WEBHOOK_HOST`, `PAPERLESS_INGESTION_WEBHOOK_PORT`, `PAPERLESS_INGESTION_LOG_LEVEL`, etc. See schema for full list.

### Schema

```json
{
	"consume_dir": "/path/to/paperless/consume",
	"signal_api_url": "http://127.0.0.1:8080",
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
- `signal_api_url`: signal-cli-rest-api base URL (e.g. `http://127.0.0.1:8080`)
- Config path: `--config` or `PAPERLESS_INGESTION_CONFIG` (default: `/etc/paperless-ingestion-bot/config.json`).
- Users path: `--users` or `PAPERLESS_INGESTION_USERS_PATH` (default: `/var/lib/paperless-ingestion-bot/users.json`). Create manually, don't commit.
- Email accounts path: `--email-accounts` or `PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH` (default: `/var/lib/paperless-ingestion-bot/email-accounts.json`). Gmail/IMAP account metadata; passwords in system keychain.
- `webhook_host`, `webhook_port`: Signal webhook server bind address
- `ollama_url`, `ollama_vision_model`, `ollama_text_model`: Ollama endpoint and models for AI eligibility (optional)
- `log_level`: `DEBUG` | `INFO` | `WARN` | `ERROR`
- `mark_processed_label`: Gmail label for processed messages; empty string disables labeling
- `page_size`: Email fetch batch size

**Env overrides:** Each key can be overridden by an env var: `PAPERLESS_INGESTION_` + UPPER_SNAKE_CASE of the key (e.g. `consume_dir` → `PAPERLESS_INGESTION_CONSUME_DIR`).

See [config.example.json](config.example.json) for a full example. A JSON Schema is emitted at build time: `dist/config.schema.json`.

**users.json** format (array of user objects):

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
- **Supply chain** — `bun audit --audit-level=high` in every check. CycloneDX SBOM generated in CI. Dependabot, CodeQL, OpenSSF Scorecard with least-privilege workflow permissions. Release images signed with Sigstore/cosign keyless signing.
- **File permissions** — email-accounts metadata written with mode `0600`. Run as a dedicated user.

**Trust model:** All family members in the config share the same Gmail account registry. Anyone can run `gmail status` to see all configured accounts and use pause/resume/remove on any of them. The design assumes a trusted group.

## Troubleshooting

| Issue                                                              | Solution                                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `System keychain unavailable` or `File system error: getPassword at keyring` | Ensure libsecret/Secret Service is available (e.g. gnome-keyring, kwallet). On headless Linux, run a secret service or use a session with keychain support.                                  |
| `Config file not found`                                            | Pass `--config /path/to/config.json` or set `PAPERLESS_INGESTION_CONFIG`.                                                                                |
| `consume_dir does not exist`                                       | Create the directory: `mkdir -p /path/to/consume`.                                                                                                                                            |
| `signal_api_url not reachable`                                     | Ensure Signal REST API is running. Use `--skip-reachability-check` to bypass (e.g. API starts after bot).                                                                                     |
| `No users configured`                                              | Create `users.json` at `--users` path or `PAPERLESS_INGESTION_USERS_PATH`: `[{"slug":"krzysiek","signal_number":"+48...","consume_subdir":"krzysiek","display_name":"Krzysiek","tag_name":"Added by Krzysiek"},...]`. |
| `No account found` for gmail commands                              | Run `gmail status` to list accounts. Add with `gmail add email@example.com <app_password>`.                                                                                                  |
| IMAP connection fails                                              | Enable IMAP in Gmail; use App Password, not main password.                                                                                                                                   |
| Ollama assessment timeout                                          | Increase model load or reduce prompt; timeout is 60s.                                                                                                                                        |

## Verification

```bash
bun run check
```

Runs tests, lint, and typecheck.

**CI:** GitHub Actions runs `bun run check` on push and PR. Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint). A CycloneDX SBOM is generated and uploaded as a workflow artifact.

## Documentation

TypeScript implementation using [Effect](https://effect.website/) and functional programming conventions. Bleeding edge: Effect v4 beta, [TypeScript Native](https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/) (`tsgo`) for build and typecheck (~10× faster than `tsc`).

### Bun support policy

We target **Bun 1.3+** and Effect v4 beta. This is a deliberate choice for modern features. We intend to support the Bun version that Effect v4 officially supports. Check [Effect compatibility](https://effect.website/) and our `packageManager` field in `package.json` for the minimum supported version.

- [deploy/](deploy/): Deployment recipes — [Compose](deploy/compose/README.md) (Docker) and [systemd](deploy/systemd/README.md) (service units)
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): Project structure and design
- [RELATED_PROJECTS.md](docs/RELATED_PROJECTS.md): Potentially useful complementary projects
- [CONTRIBUTING.md](CONTRIBUTING.md): How to contribute
- [knirski/auto-pr](https://github.com/knirski/auto-pr): Auto-PR workflow (push to `ai/*` branches)
- [docs/SCHEDULED_WORKFLOWS.md](docs/SCHEDULED_WORKFLOWS.md): Enable scheduled workflows (cron)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): Community standards
- [SECURITY.md](SECURITY.md): Vulnerability reporting
- [SUPPORT.md](SUPPORT.md): Getting help
- [test/integration/README.md](test/integration/README.md): Integration test guide
- [docs/adr/](docs/adr/): Architecture Decision Records

**CII Best Practices:** See [docs/CII.md](docs/CII.md) for progress. Complete the [self-assessment](https://www.bestpractices.dev/en/projects/new?project_url=https%3A%2F%2Fgithub.com%2Fknirski%2Fpaperless-ingestion-bot) to earn the badge.

This project was developed with assistance from AI coding tools.

## License

Apache 2.0. See [LICENSE](LICENSE).
