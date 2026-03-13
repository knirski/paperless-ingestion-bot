# Docker Compose deployment

Runs the ingestion bot with Signal CLI REST API. The `consume` volume holds documents; mount it into Paperless-ngx or bind-mount your Paperless consume path.

## Prerequisites

- Docker and Docker Compose
- Paperless-ngx (to consume the documents)

## Setup

1. **Create config and users**

   Copy and edit the config:

   ```bash
   cp ../../config.example.json config.json
   # Edit config.json: set consume_dir, paths, etc.
   ```

   Create `users.json` with your Signal users (see main [README](../../README.md#config) Config section).

2. **Start services**

   ```bash
   docker compose up -d
   ```

3. **Link Signal**

   Open <http://localhost:8080/v1/qrcodelink> in a browser and scan with your phone.

4. **Configure webhook**

   Set `RECEIVE_WEBHOOK_URL=http://ingestion-bot:8089/webhook` in the signal-api service (add to `environment` in docker-compose.yml, or use the signal-cli-rest-api config).

5. **Connect to Paperless**

   Either:

   - Use the `consume` volume: add it to your Paperless compose as an external volume, or
   - Bind-mount your Paperless consume path: replace the consume volume with `./paperless-consume:/var/lib/paperless-ingestion-bot/consume` (create the dir first).

## Image

Images are published to GHCR on each release: `ghcr.io/knirski/paperless-ingestion-bot:latest` or `ghcr.io/knirski/paperless-ingestion-bot:v0.2.0`.
