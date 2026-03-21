# Paperless API upload instead of consume directory

## Context and Problem Statement

The ingestion bot originally wrote documents to Paperless's consume directory. That approach was fiddly: weak support for Gmail labels, no custom fields, and a loose integration—the directory acted as a queue, depended on Paperless polling, offered no immediate validation of files, and delivered files without context (tags had to be inferred from subdirs). How should we deliver documents to Paperless?

## Considered Options

* **A)** Keep consume directory — status quo; subdirs-as-tags, consumption templates; loose coupling via filesystem queue; no labels, no custom fields
* **B)** Paperless REST API — POST to `/api/documents/post_document/` with tags; synchronous; full control over metadata (tags, labels); enables custom fields (future)
* **C)** Hybrid (consume + API for metadata) — Rejected: Paperless does not support setting tags at consume time; would require post-consume PATCH, adding complexity without solving the core issues

## Decision Outcome

Chosen option: **B**, because the API gives synchronous delivery, immediate validation, and full control over tags and metadata. The consume directory was a weak abstraction (directory as queue, polling, no context). With the API we can add our own queue and DLQ in the future if needed.

### Consequences

* Good: Synchronous flow; immediate validation (auth, reachability); tags set directly (source, user, Gmail labels); no shared volume; enables custom fields (see [Paperless Custom Fields Design](../plans/2026-03-19-paperless-custom-fields-design.md))
* Good: Clear ownership—we control the upload process; future option for own queue with DLQ
* Bad: Requires `paperless_url` and `paperless_token`; no consume dir fallback for scanners (they can keep a separate consume volume if needed)
* Bad: Network dependency—bot needs reachability to Paperless; mitigated by `retryTransient` and `--skip-reachability-check` for flexible startup order

### Implementation Summary

| Area | Change |
|------|--------|
| **Service** | `PaperlessClient` — `uploadDocument(document, filename, tags)`; POST to `/api/documents/post_document/`; tag resolution via `GET /api/tags/?name__iexact=` + `POST` to create |
| **Config** | Remove `consume_dir`; add `paperless_url`, `paperless_token`; env overrides `PAPERLESS_INGESTION_PAPERLESS_URL`, `PAPERLESS_INGESTION_PAPERLESS_TOKEN` |
| **Pipelines** | Signal: `uploadDocument(data, filename, [signal-{slug}, "signal"])`; Email: `uploadDocument(data, filename, [emailSlug, "email", ...labelTags])` |
| **Labels** | Gmail labels fetched with `labels: true`; filtered, sanitized, prefixed `gmail-`; added as tags |
| **Error handling** | `PaperlessApiError`; `HttpClient.retryTransient` (5 retries) |
| **Deploy** | See [deploy/compose/](../../deploy/compose/); consume volume optional for scanners |

### Related

* [Paperless API Upload Design](../design/paperless-api-upload.md) — Implementation design (interface, pipelines, migration script)
* [Paperless Custom Fields Design](../plans/2026-03-19-paperless-custom-fields-design.md) — Proposal for sender, subject, date in custom fields (not implemented)
