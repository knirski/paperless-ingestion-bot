# systemd deployment

Service and timer units for running the ingestion bot under systemd. For a full Docker-based stack, see [Compose](../compose/README.md).

## Full stack (native)

When running everything on the same host:

- **Paperless-ngx** — Document management (Docker or native)
- **signal-cli-rest-api** — Signal webhook (Docker or systemd)
- **Ingestion bot** — These units (Signal webhook + email timer)
- **Ollama** — Optional, for AI eligibility on email (installs its own `ollama.service`)

The units include optional `After=` for `signal-cli-rest-api.service` and `ollama.service` when those run natively. If they run in Docker or don't exist, the bot still starts.

## Prerequisites

- Paperless-ngx
- signal-cli-rest-api (for Signal)
- Node.js ≥ 24 or the Nix package
- Config at `/etc/paperless-ingestion-bot/config.json`
- Users at `/var/lib/paperless-ingestion-bot/users.json`
- **Gmail:** Secret Service (libsecret) for credential storage. Run as a user with an active session, or ensure `gnome-keyring-daemon` / `secret-tool` is available for the service user.

## Install

1. **Create user and dirs**

   ```bash
   sudo useradd -r -s /usr/sbin/nologin paperless-ingestion
   sudo mkdir -p /etc/paperless-ingestion-bot /var/lib/paperless-ingestion-bot
   sudo chown paperless-ingestion:paperless-ingestion /var/lib/paperless-ingestion-bot
   ```

2. **Install the bot**

   Use Bun, Nix, or your package manager. Ensure `paperless-ingestion-bot` is in PATH (e.g. `/usr/bin` or via `nix run`).

3. **Copy units**

   ```bash
   sudo cp paperless-ingestion-email.service paperless-ingestion-email.timer paperless-ingestion-signal.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

4. **Enable and start**

   For Signal (webhook server):

   ```bash
   sudo systemctl enable --now paperless-ingestion-signal.service
   ```

   For email (timer, runs every 15 min):

   ```bash
   sudo systemctl enable --now paperless-ingestion-email.timer
   ```

## Timer interval

Edit `paperless-ingestion-email.timer` to change the schedule. `OnCalendar=*:0/15` = every 15 minutes. Examples:

- `*:0/30` — every 30 minutes
- `hourly` — every hour
- `*-*-* 09,18:00:00` — 9:00 and 18:00 daily

## What's not included (and why)

| Omission | Reason |
|----------|--------|
| **Units for Paperless, signal-cli-rest-api, Ollama** | Separate projects with their own installers and units. Use their official deployment (Docker, native packages). |
| **paperless-ai** | Separate project; runs after Paperless ingests. Add it alongside Paperless if desired. |
| **Reverse proxy / HTTPS** | Out of scope. Add Caddy, nginx, or similar if exposing Paperless/Signal API publicly. |

## paperless-ai

[paperless-ai](https://github.com/clusterzx/paperless-ai) runs **after** Paperless ingests documents (tags, titles, correspondents). It is separate from this bot. See [paperless-ai installation](https://github.com/clusterzx/paperless-ai/wiki/2.-Installation).
