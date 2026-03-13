# systemd deployment

Service and timer units for running the ingestion bot under systemd.

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

   Use npm, Nix, or your package manager. Ensure `paperless-ingestion-bot` is in PATH (e.g. `/usr/bin` or via `nix run`).

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
