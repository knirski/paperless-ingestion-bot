# Docker Compose deployment

Two options: **minimal** (Signal + ingestion bot only) or **full-stack** (Paperless-ngx + Signal + ingestion bot + Ollama).

## Minimal: Signal + ingestion bot

Use `docker-compose.yml` when you already have Paperless-ngx elsewhere. The `consume` volume holds documents; mount it into Paperless or bind-mount your Paperless consume path.

## Full-stack: Paperless + Signal + ingestion bot + Ollama

Use `docker-compose.full-stack.yml` for a complete setup in one compose:

- **Paperless-ngx** — Document management (PostgreSQL, Redis, Tika, Gotenberg)
- **Signal CLI REST API** — Signal webhook
- **Ingestion bot** — Receives Signal attachments, writes to consume
- **Ollama** — Optional AI (eligibility for email; also for [paperless-ai](#paperless-ai) post-processing)

Shared `consume` volume: ingestion bot writes here; Paperless ingests from here.

### Full-stack setup

1. **Create Paperless env**

   ```bash
   cp docker-compose.env.example docker-compose.env
   # Edit docker-compose.env: set PAPERLESS_SECRET_KEY (long random string)
   ```

2. **Create config and users**

   ```bash
   cp ../../config.example.json config.json
   # Edit config.json if needed (defaults work for full-stack)
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

1. **Create config and users** — Same as above.

2. **Start**

   ```bash
   docker compose up -d
   ```

3. **Link Signal** — Open <http://localhost:8080/v1/qrcodelink> and scan.

4. **Configure webhook** — Set `RECEIVE_WEBHOOK_URL=http://ingestion-bot:8089/webhook` in the signal-api service.

5. **Connect to Paperless** — Either add the `consume` volume to your Paperless compose as an external volume, or bind-mount your Paperless consume path.

## paperless-ai

[paperless-ai](https://github.com/clusterzx/paperless-ai) is a **separate** project that runs **after** Paperless ingests documents. It adds AI-generated tags, titles, and correspondents.

- **This ingestion bot** — Pre-ingestion: receives from Signal/Gmail, optionally filters with Ollama, writes to consume.
- **paperless-ai** — Post-ingestion: augments documents already in Paperless.

To add paperless-ai, run it alongside Paperless-ngx (it connects to Paperless API and uses Ollama). See [paperless-ai installation](https://github.com/clusterzx/paperless-ai/wiki/2.-Installation).

## Image

Images are published to GHCR on each release: `ghcr.io/knirski/paperless-ingestion-bot:latest` or `ghcr.io/knirski/paperless-ingestion-bot:v0.2.0`.
