# Potentially Useful Projects

Projects that complement or extend paperless-ingestion-bot. See also [paperless-ngx Related Projects](https://github.com/paperless-ngx/paperless-ngx/wiki/Related-Projects).

## Scan & physical ingestion

- [scan-to-paperless](https://github.com/sbrunner/scan-to-paperless) — Physical scanner → NAS → Paperless (crop, deskew, OCR). Complements digital ingestion; scan-to-paperless uses Paperless consume dir; this bot uses the API.
- [scanservjs](https://github.com/sbs20/scanservjs) — SANE scanner web UI for network scanners.
- [scantopl](https://github.com/Celedhrim/scantopl) — Auto-upload to Paperless when filename matches a prefix; pairs with scanservjs.

## Mobile & desktop clients

- [paperless-mobile](https://github.com/astubenbord/paperless-mobile) — Flutter app for Android/iOS: browse, search, upload.
- [Paperparrot](https://github.com/LeoKlaus/Paperparrot) — Native Swift/SwiftUI client for macOS/iOS; offline support.
- [Keeplys](https://keeplys.com/) — iOS document scanning app with Paperless integration.

## AI & post-processing

- [paperless-ai](https://github.com/clusterzx/paperless-ai) — Auto-tag, title, correspondent (Ollama, OpenAI, etc.). Post-ingestion.
- [paperless-gpt](https://github.com/icereed/paperless-gpt) — Go-based LLM titles and tags for Paperless.
- [Paperless-AIssist](https://github.com/nyxtron/paperless-aissist) — AI middleware: tag `ai-process` → auto-classify, title, tag (Ollama, OpenAI, Grok).

## Messaging (Telegram)

- [paperless-telegram-bot](https://github.com/GeiserX/paperless-telegram-bot) — Upload, search, organize Paperless via Telegram.
- [paperless-concierge](https://github.com/mitchins/paperless-concierge) — Telegram bot for upload to Paperless and paperless-ai.

## Signal API alternatives

- [h4x0r/signal-cli-api](https://github.com/h4x0r/signal-cli-api) — Rust-based; WebSocket/SSE, Prometheus, no Docker. Newer; may suit real-time needs.

## MCP & AI integration

- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) — RAG/chat interface with built-in Paperless-ngx data connector; query your documents via AI chat.
- [paper2anything](https://github.com/oserz/paper2anything) — Sync Paperless-ngx documents into AnythingLLM workspaces based on tags.
- [paperless-mcp](https://github.com/baruchiro/paperless-mcp) — MCP server for AI clients (Claude, Cursor) to query and manage Paperless.
- [paperless-ngx-n8n-integration](https://github.com/PDangelmaier/paperless-ngx-n8n-integration) — MCP + n8n for AI-triggered workflows.

## Monitoring & tooling

- [prometheus-paperless-exporter](https://github.com/hansmi/prometheus-paperless-exporter) — Prometheus metrics for Paperless-ngx.
- [Paperhooks](https://github.com/hansmi/paperhooks) — Consumption hooks and REST API client for Paperless.

## Document management alternatives

- [Docspell](https://github.com/eikek/docspell) — Self-hosted DMS with automation and NLP.
- [Mayan EDMS](https://www.mayan-edms.com/) — Enterprise-oriented document management.

## Effect ecosystem

- [EffectPatterns](https://github.com/PaulJPhilp/EffectPatterns) — Community patterns for Effect-TS.
- [effect-http](https://github.com/sukovanej/effect-http) — Declarative HTTP API for Effect.
- [koka](https://github.com/koka-ts/koka) — Lightweight Effect alternative (algebraic effects).
