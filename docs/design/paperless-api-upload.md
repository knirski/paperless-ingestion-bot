# Paperless API Upload Design

**Date:** 2026-03-19  
**Status:** Approved (user chose API path over consume directory)  
**Implementation:** Done.

## Summary

Replace consume-directory writes with Paperless REST API uploads. Documents are POSTed to `/api/documents/post_document/` with metadata (tags) set directly. No directory tricks, subdirs-as-tags, or consumption templates needed.

## Goals

- Upload documents via Paperless API
- Set tags directly: source (signal/email), user (`signal-{slug}`), Gmail labels
- Config: `paperless_url`, `paperless_token`

## Architecture

### New Service: PaperlessClient

- **Interface** (`src/interfaces/paperless-client.ts`): `uploadDocument(document: Uint8Array, filename: string, tags: readonly TagName[]) => AppEffect<void>`
- **Live** (`src/live/paperless-client.ts`): HTTP POST to `{baseUrl}/api/documents/post_document/` with multipart form
- **Tag resolution**: `GET /api/tags/?name__iexact=TagName` per tag; if empty, create via `POST /api/tags/`. In-memory cache (`Ref<Map<TagName, TagId>>`) shared across uploads to avoid repeated API calls. Branded types: `TagName` (normalized string), `TagId` (number from API).
- **Auth**: `Authorization: Token {token}` header
- **API version contract**: All requests send `Accept: application/json; version=N`. The version is fixed in `PAPERLESS_NGX_ACCEPT_VERSION` (`src/live/paperless-client.ts`). This is the integration contract with paperless-ngx: the version must be in paperless-ngx `ALLOWED_VERSIONS` (Settings → General). Bumping requires compatibility verification.

### Config Changes

- **Add**: `paperless_url` (e.g. `http://localhost:8000`), `paperless_token` (API token from Paperless Settings → Users → Create token)
- **Env overrides**: `PAPERLESS_INGESTION_PAPERLESS_URL`, `PAPERLESS_INGESTION_PAPERLESS_TOKEN`
- **Startup validation**: Reachability check (optional, like Signal API) — GET `/api/` or `/api/tags/` to verify auth

### Signal Pipeline

- Fetch attachment → `paperless.uploadDocument(data, filename, [signal-{slug}, "signal"])`
- Tags: `signal-{user.slug}` (e.g. `signal-krzysiek`), `"signal"` (source)

### Email Pipeline

- Fetch attachments → `paperless.uploadDocument(data, filename, tags)`
- Tags: `"email"` (source), `emailToSlug(acc.email)` or a friendly slug, plus Gmail labels (if fetched)
- **Gmail labels**: `RawImapAttachment.labels: readonly EmailLabel[]` (empty for generic IMAP). imap-email-client requests `labels: true` when provider is Gmail. System labels (INBOX, UNREAD, etc.) filtered; sanitized and prefixed (e.g. `category:promotions` → `gmail-category-promotions`). Added to Paperless tags.

### Removing the gmail- prefix in bulk

If you want to drop the `gmail-` prefix from existing tags:

1. `GET /api/tags/` to list all tags.
2. For each tag whose `name` starts with `gmail-`, `PATCH /api/tags/{id}/` with `{"name": "<name without prefix>"}` (e.g. `gmail-category-promotions` → `category-promotions`).
3. Example script (requires `PAPERLESS_URL` and `PAPERLESS_TOKEN`):

```bash
curl -s -H "Authorization: Token $PAPERLESS_TOKEN" "$PAPERLESS_URL/api/tags/" | jq -r '.results[] | select(.name | startswith("gmail-")) | "\(.id) \(.name)"' | while read id name; do
  new_name="${name#gmail-}"
  curl -s -X PATCH -H "Authorization: Token $PAPERLESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"name\": \"$new_name\"}" "$PAPERLESS_URL/api/tags/$id/"
done
```

### Error Handling

- `PaperlessApiError` domain error (HTTP 4xx/5xx, network failure)
- Retry: `HttpClient.retryTransient` (5 retries) on transient failures
- Log and fail; do not silently drop documents

## Data Flow

```
Signal: Webhook → fetch attachment → uploadDocument(data, filename, [signal-{slug}, "signal"])
Email:  IMAP → fetch attachments (with labels) → uploadDocument(data, filename, [emailSlug, "email", ...labels])
```

## Migration

- Existing deployments: config uses `paperless_url` and `paperless_token`
- Docker Compose: ingestion bot uploads via API; Paperless consume volume optional for scanners
- Full-stack compose: ingestion bot needs network access to Paperless (same compose network)

## Out of Scope (YAGNI)

- Correspondent, document_type, title from content (future AI integration)
- Retry with exponential backoff (we use fixed 5 retries for now)

## Related

- [ADR 0007: Paperless API upload instead of consume directory](../adr/0007-paperless-api-upload.md) — Decision record.
- [Paperless Custom Fields Design](../plans/2026-03-19-paperless-custom-fields-design.md) — Proposal for storing sender, subject, date, etc. in Paperless custom fields (not implemented).
