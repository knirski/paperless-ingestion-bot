# Paperless Custom Fields Design

**Date:** 2025-03-19  
**Status:** Proposal — not implemented.  
**Related:** [Paperless API Upload Design](../design/paperless-api-upload.md) (prerequisite: API upload is done).

## Motivation

Paperless custom fields allow storing arbitrary metadata (e.g. "Invoice Number", "Sender Email", "Received Date"). Unlike tags, they are single-value per field and support structured types (text, date, url, select). Users may want to store sender email, subject, date, or account email in custom fields for search and filtering.

## Paperless API Constraints

- **POST /api/documents/post_document/**: Accepts tags only; custom field **values** are **not** supported at upload time. (PR #6222 added field assignments only, not values.)
- **PATCH /api/documents/{id}/**: Accepts `custom_field_values` to set values. Document must exist first.
- **Flow**: POST → returns `task_id` → poll `GET /api/tasks/{task_id}` until consumption completes → get `document_id` from task result → PATCH with custom field values.

## Proposed Design

**Prerequisite:** Email custom fields require message-level envelope (subject, from, to, cc, date). The current email pipeline fetches `RawImapAttachment[]` per UID without envelope. Envelope support must be implemented first: imap-email-client must request `envelope: true` in `fetchOne`, parse envelope per message, and return `EmailMessage[]` (one per UID) with `(message, attachments)` pairs. Until then, email custom fields cannot be populated.

**Paperless reachability:** When `custom_fields.mapping` is present, Paperless reachability at startup is **required** (non-optional) for field ID validation.

**Implementation phases:** (1) Envelope support (imap-email-client, EmailMessage); (2) Domain types (email-types, signal-types, custom-field-types); (3) Config layer (custom_fields schema); (4) Core `buildCustomFieldValues`; (5) Live layer POST → poll → PATCH.

### 1. Config: `custom_fields`

**Location:** `config.json` (same file as `paperless_url`, `paperless_token`). Path: `--config` or `PAPERLESS_INGESTION_CONFIG` (default `/etc/paperless-ingestion-bot/config.json`). All custom field settings live in a nested `custom_fields` object.

```json
{
  "paperless_url": "http://localhost:8000",
  "paperless_token": "...",
  "custom_fields": {
    "mapping": {
      "email-sender-email": 5,
      "email-sender-name": 6,
      "email-subject": 7,
      "email-account-email": 8,
      "email-received-date": 9
    },
    "timezone": "Europe/Warsaw",
    "poll_interval_ms": 500,
    "poll_timeout_s": 60
  }
}
```

- **mapping:** Keys = logical source names from supported source fields table (§3). Validated by branded `CustomFieldSourceKeySchema` at decode time; unknown keys fail schema parse. Values = Paperless custom field IDs (non-negative integers, `Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))`). User creates fields in Paperless UI first; IDs from `GET /api/custom_fields/`. v1: numeric IDs only; field name resolution deferred.
- **timezone:** IANA timezone for date fields. Default: `"Europe/Warsaw"`.
- **poll_interval_ms**, **poll_timeout_s:** Polling parameters (see §10). Defaults: 500 ms, 60 s.

### 2. Data: Envelope metadata

**Email pipeline** — envelope is **mandatory** (message-level). One message per UID, many attachments.

```ts
// import * as DateTime from "effect/DateTime"
// Structured address from IMAP envelope (imapflow: envelope.from[0], envelope.to[0], etc.)
interface EmailAddress {
  readonly name?: string;   // display name
  readonly address: string; // "email@example.com"
}

// Message = metadata + attachments (one type)
// RFC 5322 compliance: From and Date are required; Subject, To, Cc, Bcc are optional.
// Bcc not modeled (often empty for recipients; add if needed).

interface EmailMessage {
  readonly subject?: string;   // optional per RFC 5322
  readonly from: readonly EmailAddress[];   // envelope.from (required; may be empty for malformed)
  readonly to?: readonly EmailAddress[];    // envelope.to
  readonly cc?: readonly EmailAddress[];    // envelope.cc
  readonly date: DateTime.Utc;  // envelope date (origination Date header)
  readonly attachments: readonly RawImapAttachment[];
}

// RawImapAttachment — unchanged; attachments are payload-only.
// imap-email-client returns EmailMessage[] (one per UID).

// Base: common payload for upload. Both pipelines produce at least this.
interface Attachment {
  readonly filename: string;
  readonly data: Uint8Array;
  readonly ollamaRequest?: OllamaRequest;
}

// Email: extends Attachment with pipeline-specific metadata. Context (message, accountEmail) passed at call site.
// Tags: derive slug from accountEmail via emailToSlug(accountEmail).
interface EmailAttachment extends Attachment {
  readonly messageUid: MessageUid;
  readonly labels: readonly EmailLabel[];
}

// Signal: uses Attachment as-is (no extra fields). Context (message) passed at call site.
type SignalAttachment = Attachment;
```

- imap-email-client: request `envelope: true` in `fetchOne` (fetches single message by UID; `fetch` fetches multiple by range). Parse envelope once per message. Return `EmailMessage[]` (one per UID). Envelope is **mandatory** — if missing, treat as error.
- Pipeline: **Don't flatten.** Process `(message, attachment)` pairs in a nested loop. For each `EmailMessage`, for each attachment: `processRawAttachment(raw)` → `EmailAttachment`; then `saveItem(item, message, accountEmail)` — pass `message` and `accountEmail` at the call site.

**Signal pipeline** — same pattern: one message, many attachments. `SignalDataMessage.attachments` is an array; webhook delivers one message with multiple attachment refs.

```ts
// Message = metadata + attachments (one type)
interface SignalMessage {
  readonly source: SignalNumber;           // sender phone number
  readonly sourceName?: string;            // from signal-cli webhook (sender's Signal profile)
  readonly userDisplayName?: string;       // from our user registry (displayName if sender is registered)
  readonly timestamp: DateTime.Utc;   // dataMessage timestamp
  readonly body?: string;                   // dataMessage.body (text accompanying attachments)
  readonly attachments: readonly RawSignalAttachment[];  // from dataMessage.attachments; validateAttachmentsToRaw fails fast on invalid id
}
```

- Signal webhook: `source`, `sourceName` (from signal-cli when available), `dataMessage.attachments`, `dataMessage.timestamp` (required). `userDisplayName` from our user registry when source matches a registered user.
- Pipeline: **Don't flatten.** Process `(message, attachment)` pairs. Each attachment yields `SignalAttachment` (filename, data, ollamaRequest?); pass `(attachment, message)` to `uploadDocument`; custom fields from `buildCustomFieldValues({ source: "signal", message, filename: attachment.filename })`.

### 3. Supported source fields

**Value:** High = core for search/filter; Medium = useful when needed.

**Email:**

| Source key       | Source | Value |
|------------------|--------|-------|
| `email-sender-email`   | from[0].address | **High** — Sender address (first if multiple) |
| `email-sender-name`    | from[0].name | **Medium** — Sender display name |
| `email-subject`        | Envelope subject | **High** — What it's about; very searchable |
| `email-account-email`  | Account email (as-is) | **High** — Which inbox (multi-account) |
| `email-received-date`  | Envelope date (ISO string) | **High** — When received; date search |
| `email-filename`       | Attachment filename | **Medium** — Original filename; search by name |
| `email-to`             | to.map(a => a.address).join("; ") | **Medium** — To recipients (semicolon-separated) |
| `email-cc`             | cc?.map(a => a.address).join("; ") | **Medium** — CC recipients (semicolon-separated) |

**Signal:**

| Source key       | Source | Value |
|------------------|--------|-------|
| `signal-sender-number` | Sender Signal number | **High** — Who sent it |
| `signal-source-name`   | signal-cli sourceName (sender's Signal profile) | **Medium** — When available |
| `signal-user-display-name` | Our registry displayName (if sender is registered) | **Medium** — When registered |
| `signal-received-date` | Webhook timestamp | **High** — When received |
| `signal-filename`      | Attachment filename (customFilename or built) | **Medium** — Original filename |
| `signal-message-body`  | dataMessage.body (text accompanying attachment) | **Medium** — Context; can be long or empty |

### 4. Empty values (Option A)

When a source value is missing or empty (e.g. `from[0]` absent, empty subject, no `sourceName`), **omit** the field from `custom_field_values`. Do not send `null` or `""`; only include entries for which we have a non-empty value.

### 5. Field type compatibility

| Paperless type | Our sources | Format / notes |
|----------------|-------------|----------------|
| **Text** | `email-sender-email`, `email-sender-name`, `email-subject`, `email-account-email`, `email-filename`, `email-to`, `email-cc`, `signal-sender-number`, `signal-source-name`, `signal-user-display-name`, `signal-filename`, `signal-message-body` | No validation on sender email; pass as-is. Standard text fields: **128 chars** (Paperless limit). Long text fields: no limit. **Truncate to 125 chars + "..."** so total length is 128. |
| **Date** | `email-received-date`, `signal-received-date` | ISO-8601 with configurable timezone (default: `Europe/Warsaw`). Domain keeps `DateTime.Utc` (canonical); convert at boundary: `DateTime.formatIsoZoned(DateTime.setZone(utc, zone))`. |
| **URL** | — | Not supported in v1. Sender email is not a URL. |
| **Select** | — | Out of scope. Would require value mapping (our string → Paperless option ID). |
| **Checkbox** | — | Out of scope. None of our sources map to boolean. |

**Paperless-ngx limits:** Standard text custom fields: 128 characters. Long text custom fields (added in later versions): no limit.

### 6. PaperlessClient interface

```ts
// CustomFieldValue from src/domain/custom-field-types.ts
uploadDocument(
  document: Uint8Array,
  filename: string,
  tags: readonly TagName[],
  customFieldValues?: ReadonlyArray<CustomFieldValue>,
): AppEffect<void>;
```

**Chosen approach:** Extend `uploadDocument` with optional `customFieldValues`. When provided: POST document → poll for `document_id` → PATCH with custom field values. When absent: POST only (current behavior). Single entry point; live layer handles the full flow atomically.

**Atomicity:** Either upload everything (document + custom fields) or fail. No partial success: if PATCH fails, the whole operation fails. **No rollback:** We do not DELETE the document on PATCH failure. The document is the primary value; custom fields are metadata. Paperless may have already processed it (OCR, etc.). User can fix custom fields manually. Rollback would also risk DELETE failing.

**Empty customFieldValues:** If `buildCustomFieldValues` returns `[]`, skip poll and PATCH; POST only (same as when customFieldValues is absent).

### 7. Live implementation sketch

1. POST document with tags (as today).
2. Parse response → `task_id`.
3. Poll `GET /api/tasks/{task_id}` using `customFieldPollInterval` (Duration) and `customFieldPollTimeout` (Duration), until `status === "SUCCESS"` and `result` contains `document_id`.
4. PATCH `/api/documents/{document_id}/` with `{ "custom_field_values": customFieldValues }` (API uses `field` and `value` keys).
5. **Error handling:**
   - Poll timeout: log, fail. Document uploaded; custom fields not set.
   - PATCH 4xx: fail, **no retry**, log (invalid field ID, type mismatch, etc.).
   - PATCH 5xx: **retryTransient**, 5 retries (use existing resilient client pattern).

### 8. Core: pure mapping

Pass domain objects, not a flat optional schema. The function extracts what it needs.

**Branded type for mapping keys:** Each domain boundary owns its source keys. Custom-field types merge them for config validation.

```ts
// src/domain/email-types.ts (or wherever EmailMessage lives)
export const EMAIL_CUSTOM_FIELD_SOURCE_KEYS = [
  "email-sender-email", "email-sender-name", "email-subject", "email-account-email",
  "email-received-date", "email-filename", "email-to", "email-cc",
] as const;

// src/domain/signal-types.ts
export const SIGNAL_CUSTOM_FIELD_SOURCE_KEYS = [
  "signal-sender-number", "signal-source-name", "signal-user-display-name",
  "signal-received-date", "signal-filename", "signal-message-body",
] as const;

// src/domain/custom-field-types.ts
import { EMAIL_CUSTOM_FIELD_SOURCE_KEYS } from "./email-types.js";
import { SIGNAL_CUSTOM_FIELD_SOURCE_KEYS } from "./signal-types.js";

const CUSTOM_FIELD_SOURCE_KEYS = [
  ...EMAIL_CUSTOM_FIELD_SOURCE_KEYS,
  ...SIGNAL_CUSTOM_FIELD_SOURCE_KEYS,
] as const;

export const CustomFieldSourceKeySchema = Schema.Literals(...CUSTOM_FIELD_SOURCE_KEYS).pipe(
  Schema.brand("CustomFieldSourceKey")
);
export type CustomFieldSourceKey = Schema.Schema.Type<typeof CustomFieldSourceKeySchema>;

/** Branded type for Paperless custom field ID (non-negative integer from API). */
export const CustomFieldIdSchema = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("CustomFieldId")
);
export type CustomFieldId = Schema.Schema.Type<typeof CustomFieldIdSchema>;

/** Mapping: source key → Paperless custom field ID. Keys validated by schema; values = non-negative integers. Non-empty required. */
export const CustomFieldMappingSchema = Schema.Record(
  CustomFieldSourceKeySchema,
  CustomFieldIdSchema
).pipe(
  Schema.filter(
    (m) => Object.keys(m).length > 0 || "custom_fields.mapping must have at least one entry",
    { jsonSchema: { minProperties: 1 } }  // required for dist/config.schema.json generation
  )
);
export type CustomFieldMapping = Schema.Schema.Type<typeof CustomFieldMappingSchema>;

/** Paperless custom field assignment (API payload). */
export interface CustomFieldValue {
  readonly field: CustomFieldId;
  readonly value: string | number | boolean | null;
}
```

```ts
// src/core/custom-fields.ts
// import * as DateTime from "effect/DateTime"
type CustomFieldContext =
  | { readonly source: "email"; readonly message: EmailMessage; readonly accountEmail: string; readonly filename: string }
  | { readonly source: "signal"; readonly message: SignalMessage; readonly filename: string };

export function buildCustomFieldValues(
  mapping: CustomFieldMapping,
  context: CustomFieldContext,
  timeZone: DateTime.TimeZone.Named,
): ReadonlyArray<CustomFieldValue>
```

- Pure function: takes mapping + context + timeZone, returns `CustomFieldValue[]` for API.
- Shell passes `{ source: "email", message, accountEmail, filename }` or `{ source: "signal", message, filename }`, plus `timeZone` from config.
- Extraction: for each key in mapping, if context has a **non-empty** value (Option A: omit when empty), add `{ field, value }`. Date fields: `DateTime.formatIsoZoned(DateTime.setZone(utc, timeZone))`.
- No flat optional schema — type-safe, single source of truth from domain types.

### 9. Config schema

```ts
custom_fields: Schema.optional(
  Schema.Struct({
    mapping: CustomFieldMappingSchema,  // keys validated via branded schema; values = Paperless field IDs
    timezone: Schema.TimeZoneNamed.pipe(
      Schema.withDecodingDefault(() => DateTime.zoneMakeNamedUnsafe("Europe/Warsaw"))
    ),  // decoded type: DateTime.TimeZone.Named
    poll_interval_ms: Schema.Int.pipe(
      Schema.transform((n) => Duration.millis(n), (d) => d.millis),
      Schema.withDecodingDefault(() => 500)
    ),  // decoded type: Duration
    poll_timeout_s: Schema.Int.pipe(
      Schema.transform((n) => Duration.seconds(n), (d) => d.seconds),
      Schema.withDecodingDefault(() => 60)
    ),  // decoded type: Duration
  })
);
```

Config JSON: `custom_fields` is optional. When absent, custom fields are disabled and poll params are unused. When present: `mapping` is required; `timezone`, `poll_interval_ms`, `poll_timeout_s` have defaults. Poll params use `Schema.Int` (whole numbers only). Schema decodes to `Duration` and `DateTime.TimeZone.Named`. Config service exposes `customFieldPollInterval: Duration`, `customFieldPollTimeout: Duration`, `customFieldTimeZone: DateTime.TimeZone.Named` only when `custom_fields` is configured.

- **Validation (early, at startup):** When `custom_fields` is present:
  - **Keys:** Validated by `CustomFieldSourceKeySchema` at decode time. Unknown keys fail schema parse.
  - **Non-empty mapping:** `CustomFieldMappingSchema` fails when `mapping` has zero entries. `Schema.filter` uses `jsonSchema: { minProperties: 1 }` for `dist/config.schema.json` generation.
  - **Field IDs:** Fetch `GET /api/custom_fields/` and verify each mapped ID exists. **Fail on invalid IDs.**
  - When `custom_fields.mapping` is present, **Paperless reachability is required** (non-optional) for field ID validation.
- **Env overrides:** `PAPERLESS_INGESTION_CUSTOM_FIELDS_TIMEZONE`, `PAPERLESS_INGESTION_CUSTOM_FIELDS_POLL_INTERVAL_MS`, `PAPERLESS_INGESTION_CUSTOM_FIELDS_POLL_TIMEOUT_S`. Optional: `PAPERLESS_INGESTION_CUSTOM_FIELDS_MAPPING` = path to JSON file that **replaces** the mapping from config.

### 10. Polling parameters

- **Interval:** `Duration` (from `custom_fields.poll_interval_ms`, default 500). Config stores integer; schema transforms to `Duration.millis(n)`.
- **Timeout:** `Duration` (from `custom_fields.poll_timeout_s`, default 60). Config stores integer; schema transforms to `Duration.seconds(n)`. Large documents may take longer; user can increase or fix manually.
- **Scope:** Poll params apply only when `custom_fields` is configured. When `custom_fields` is absent, no poll/PATCH flow runs.

### 11. Testing

- **Unit:** `buildCustomFieldValues` with various contexts (empty, partial, full). Test Option A (omit empty).
- **Integration:** Mock POST → poll → PATCH flow; verify custom field values passed correctly. No real Paperless instance.
- **Real-API (when available):** When the [paperless-api integration test](2025-03-21-paperless-api-integration-test-design.md) infrastructure exists (`PAPERLESS_API_INTEGRATION_TEST=1`), add real-API tests for the custom-field flow (POST → poll → PATCH), asserting values via `GET /api/documents/{id}/`.

### 12. PII and logging

Custom fields can contain PII (emails, phone numbers, names). Use existing redaction utilities (`redactedForLog`, `redactEmail`, `redactPhone`) when logging custom field values. Never log raw values in structured logs.

### 13. Multiple attachments, same message

All attachments from one message share the same metadata (subject, from, date, etc.). Each attachment gets the same custom field values from the message. No change needed.

## Out of scope for v1

- Custom field values in `post_document` (not supported by Paperless).
- Resolving field name → ID at runtime (user supplies IDs explicitly).
- Select fields (would need value mapping; start with text/date).
- URL, checkbox field types.
- `email-message-id` (RFC Message-ID): low value for search/filter; useful only for deduplication or correlation with raw headers.
- `signal-attachment-id` (Signal internal UUID): debugging-only; not user-facing. Deferred.
