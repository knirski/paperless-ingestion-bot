# Docker Compose deployment

Two options: **minimal** (Signal + ingestion bot only) or **full-stack** (Paperless-ngx + Signal + ingestion bot + Ollama).

## Minimal: Signal + ingestion bot

Use `docker-compose.yml` when you already have Paperless-ngx elsewhere. The bot uploads documents via Paperless REST API. **Required:** Set `paperless_url` and `paperless_token` in `config.json`, or use env vars `PAPERLESS_INGESTION_PAPERLESS_URL` and `PAPERLESS_INGESTION_PAPERLESS_TOKEN` (e.g. in a `.env` file).

## Full-stack: Paperless + Signal + ingestion bot + Ollama

Use `docker-compose.full-stack.yml` for a complete setup in one compose:

- **Paperless-ngx** — Document management (PostgreSQL, Redis, Tika, Gotenberg)
- **Signal CLI REST API** — Signal webhook
- **Ingestion bot** — Receives Signal attachments, uploads to Paperless via API
- **Ollama** — Optional AI (eligibility for email; also for [paperless-ai](#paperless-ai) post-processing)

### Full-stack setup

1. **Create Paperless env**

   ```bash
   cp docker-compose.env.example docker-compose.env
   # Edit docker-compose.env:
   # - PAPERLESS_SECRET_KEY (long random string)
   # - PAPERLESS_INGESTION_PAPERLESS_TOKEN (see below)
   ```

   **Obtain API token** (no UI required):

   - **Option A — via API** (after Paperless is running, e.g. after step 3):

     ```bash
     curl -s -X POST -d "username=admin&password=YOUR_PASSWORD" \
       http://localhost:8000/api/token/
     ```

     Add the returned token to `docker-compose.env` as `PAPERLESS_INGESTION_PAPERLESS_TOKEN`, then `docker compose -f docker-compose.full-stack.yml up -d` to apply.

   - **Option B — via management command** (inside container, after step 3):

     ```bash
     docker compose -f docker-compose.full-stack.yml exec webserver \
       python manage.py drf_create_token admin
     ```

   - **Option C — via UI:** Settings → Users → Create token

2. **Create config and users**

   ```bash
   cp ../../config.example.json config.json
   # Edit config.json: paperless_url, paperless_token (or use env overrides from docker-compose.env)
   ```

   Create `users.json` with your Signal users (see main [README](../../README.md#config) Config section).

3. **Start**

   ```bash
   docker compose -f docker-compose.full-stack.yml up -d
   ```

4. **Link Signal** — Open <http://localhost:8080/v1/qrcodelink> and scan.

5. **Configure webhook** — Set `RECEIVE_WEBHOOK_URL=http://ingestion-bot:8089/webhook` in the signal-api service.

6. **Paperless UI** — <http://localhost:8000>

7. **Ollama models** (optional, for email AI or paperless-ai):

   ```bash
   docker compose -f docker-compose.full-stack.yml exec ollama ollama pull moondream
   docker compose -f docker-compose.full-stack.yml exec ollama ollama pull llama3.2
   ```

## Minimal setup (Signal only)

1. **Create config and users** — Same as above. Ensure `paperless_url` and `paperless_token` are set (Paperless runs elsewhere).

2. **Start**

   ```bash
   docker compose up -d
   ```

3. **Link Signal** — Open <http://localhost:8080/v1/qrcodelink> and scan.

4. **Configure webhook** — Set `RECEIVE_WEBHOOK_URL=http://ingestion-bot:8089/webhook` in the signal-api service.

5. **Connect to Paperless** — Set `paperless_url` and `paperless_token` in config (or env). The bot uploads via REST API.

## What's not included (and why)

| Omission | Reason |
|----------|--------|
| **Email pipeline in Docker** | Gmail/IMAP credentials require the OS keychain (libsecret). Containers typically lack a usable secret store; the bot would fail at credential lookup. Use systemd or bare-metal for email. |
| **paperless-ai** | Separate project; runs after Paperless ingests. Add it alongside Paperless if desired. |
| **Reverse proxy / HTTPS** | Out of scope. Add Traefik, Caddy, or nginx in front of Paperless/Signal API if exposing publicly. |
| **Generic IMAP** | Same keychain constraint as Gmail. |

## paperless-ai

[paperless-ai](https://github.com/clusterzx/paperless-ai) is a **separate** project that runs **after** Paperless ingests documents. It adds AI-generated tags, titles, and correspondents.

- **This ingestion bot** — Pre-ingestion: receives from Signal/Gmail, optionally filters with Ollama, uploads to Paperless via API.
- **paperless-ai** — Post-ingestion: augments documents already in Paperless.

To add paperless-ai, run it alongside Paperless-ngx (it connects to Paperless API and uses Ollama). See [paperless-ai installation](https://github.com/clusterzx/paperless-ai/wiki/2.-Installation).

## Image

Images are published to GHCR on each release: `ghcr.io/knirski/paperless-ingestion-bot:latest` or `ghcr.io/knirski/paperless-ingestion-bot:v0.2.0`.
