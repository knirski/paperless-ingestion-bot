# Paperless-ngx Documents API — Test Research

**Date:** 2026-03-22  
**Purpose:** Research how to robustly test document upload and retrieval in Paperless-ngx integration tests.

## Sources

- [Paperless-ngx API docs](https://docs.paperless-ngx.com/api/) (api.md)
- [paperless-ngx GitHub](https://github.com/paperless-ngx/paperless-ngx) — api.md, discussions
- [Discussion #8536](https://github.com/paperless-ngx/paperless-ngx/discussions/8536): Tasks endpoint usage
- [Discussion #6937](https://github.com/paperless-ngx/paperless-ngx/discussions/6937): Filter documents by tag

---

## 1. Document Consumption Flow

### post_document (`POST /api/documents/post_document/`)

- Returns **HTTP 200** immediately if consumption was *started*
- Response body: **UUID of the consumption task** (plain string), e.g. `"144313f1-4230-4f41-b418-7f02e2c92967"`
- **Does NOT return document ID** — consumption runs asynchronously in Celery
- Optional form fields: `title`, `created`, `correspondent`, `document_type`, `storage_path`, `tags` (multiple), `archive_serial_number`, `custom_fields`

### Consumption Process

- Document is written to temp dir; Celery consumer picks it up
- Consumer: parse, OCR (if enabled), extract metadata, create DB record
- Document appears in `/api/documents/` only **after** consumption completes
- Can take seconds for minimal PDFs; longer for complex documents

---

## 2. Verifying Documents Appear

### Option A: Task-based (most accurate)

**Endpoint:** `GET /api/tasks/?task_id={uuid}`

- Query param: `task_id` (not path like `/api/tasks/{uuid}/` — that returns 404)
- Returns task status and **document ID when consumption succeeds**
- Caveat: [Discussion #8536](https://github.com/paperless-ngx/paperless-ngx/discussions/8536) — task may not be found *immediately* after post; slight delay

**Requires:** Our `PaperlessClient.uploadDocument` does *not* return task_id. We would need to either:

- Add a test-only helper that POSTs directly and returns `{ taskId }`, then poll tasks
- Or extend the client with `uploadDocumentWithTaskId` (or similar) for tests

### Option B: Tag-filtered document list (simplest)

**Endpoint:** `GET /api/documents/?tags__id__all={tagId}`

- Filter documents by tag ID
- Returns paginated: `{ count, next, previous, results }`
- Document appears only after consumption completes

**Flow:**

1. Upload with unique tag (e.g. `live-integration-{timestamp}`)
2. Get tag ID via `GET /api/tags/?name__iexact={tagName}`
3. Poll `GET /api/documents/?tags__id__all={tagId}` until `count >= 1` (or `results.length >= 1`)
4. Assert document fields (id, title, tags, etc.)

**Alternative filter by name:** `GET /api/documents/?tags__name__iexact={tagName}` — no need to resolve tag ID first.

### Option C: Full list + search

- `GET /api/documents/` — all documents (paginated)
- Poll until a document with our tag appears
- Less efficient than filtering by tag

---

## 3. Documents API Response Structure

```json
{
  "count": 31,
  "next": "http://localhost:8000/api/documents/?page=2",
  "previous": null,
  "results": [
    {
      "id": 123,
      "title": "...",
      "content": "...",
      "tags": [1, 2],
      "document_type": null,
      "correspondent": null,
      "created": "...",
      "original_file_name": "test.pdf",
      "archive_serial_number": null,
      ...
    }
  ]
}
```

- Pagination: `page`, `page_size` (default varies)
- Filter params: `tags__id__all`, `tags__name__iexact`, `query` (full-text), `custom_field_query`, etc.

---

## 4. Edge Cases

| Case | Behavior | Test strategy |
|------|----------|---------------|
| **Happy path** | Upload succeeds, doc appears with tags | Poll by tag; assert doc in results, tags match |
| **Empty initially** | Doc not in list yet | Poll with backoff; timeout after N attempts |
| **Minimal/invalid PDF** | May fail consumption | post_document still returns 200 + task_id; task may report failure; doc never appears |
| **Duplicate document** | ConsumerError; doc may not be re-created | [Discussion #8536](https://github.com/paperless-ngx/paperless-ngx/discussions/8536): task can 404 if consumption fails |
| **Pagination** | Many docs | Use tag filter to scope; rarely need pagination in tests |
| **401 invalid token** | API returns 401 | Direct GET; assert status |
| **Unreachable URL** | Connection error | status 0, message present |

---

## 5. Recommended Test Structure

### Happy paths

1. **Upload and verify via tags**
   - Upload with unique tag
   - Poll `GET /api/documents/?tags__name__iexact={tag}` until `results.length >= 1`
   - Assert: document id present, tags include our tag

2. **Upload and verify via document list**
   - Same as above, but assert `GET /api/documents/` count increases (or use tag filter)
   - Assert: at least one doc has expected `original_file_name` or tag

3. **Multiple tags**
   - Upload with tags `["signal-test", "live-integration"]`
   - Verify both tags exist (current test)
   - Optionally: verify document has both tags via `GET /api/documents/{id}` or filtered list

### Edge cases

4. **Empty document list** — Fresh instance; GET documents returns `count: 0` or empty results
5. **Invalid token** — Direct GET returns 401
6. **Unreachable URL** — Upload fails with status 0
7. **Polling timeout** — If doc never appears (e.g. bad file), poll eventually times out

---

## 6. Implementation Notes

### Polling helper

```ts
async function pollUntilDocumentWithTag(
  baseUrl: string,
  token: string,
  tagName: string,
  options: { maxAttempts?: number; intervalMs?: number } = {}
): Promise<DocumentListResult> {
  const { maxAttempts = 15, intervalMs = 2000 } = options;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await apiGetDocumentsByTag(baseUrl, tagName, token);
    if ((res.results?.length ?? 0) >= 1) return res;
    await sleep(intervalMs);
  }
  throw new Error(`Document with tag ${tagName} did not appear after ${maxAttempts} attempts`);
}
```

### API helpers to add

- `apiGetDocumentsByTag(baseUrl, tagName, token)` — `GET /api/documents/?tags__name__iexact={tagName}`
- `apiGetDocumentsByTagId(baseUrl, tagId, token)` — `GET /api/documents/?tags__id__all={tagId}`
- Optionally: `apiPostDocumentRaw(baseUrl, token, formData)` → returns `taskId` for task-based verification

### Valid minimal PDF

- `%PDF-1.4 minimal` is **not a valid PDF** — it lacks trailer, Root, Pages, MediaBox, etc.
- Paperless consumption may reject invalid PDFs; document never appears in list
- Use a proper minimal PDF. Example (67-byte, Acrobat-compatible):

  ```js
  const minimalPdf = new TextEncoder().encode(
    "%PDF-1.\ntrailer<</Root<</Pages<</Kids[<</MediaBox[0 0 3 3]>>]>>>>>>"
  );
  ```

- Or use a fixture file (e.g. `test/fixtures/minimal.pdf`) with a real single-page PDF
- Tags are applied *before* consumption, so tag creation still proves our tag resolution works even if consumption fails

---

## 7. Summary

**For robust document verification:**

1. **Primary:** Use tag-filtered document list — `GET /api/documents/?tags__name__iexact={tag}` — and poll until document appears.
2. **Fallback:** Task-based verification requires access to task_id from post_document; needs a test helper that bypasses PaperlessClient or extends it.
3. **Current test** verifies tags exist after upload — that validates tag resolution and creation. Adding document-list verification makes the test stronger.
4. **Edge cases:** Invalid token (401), unreachable URL (status 0), polling timeout.

**Suggested next steps:** ✅ Applied 2026-03-22

- ✅ Add `apiGetDocumentsByTag` helper
- ✅ Restore "uploads document and resolves tags" to also assert document appears (with polling)
- ✅ Add "empty documents list" test at start
- Consider task-based flow if we need to assert consumption success/failure explicitly (deferred)

**Implementation (2026-03):** Helpers live in `test/integration/paperless-api-helpers.ts`. Includes `apiGet`, `apiGetDocuments` (with optional `pageSize`), `apiGetDocumentsByTag`, `apiGetDocumentsByTagId`, `apiPostToken`, `pollUntilDocumentWithTag`, `pollUntilDocumentWithFilename`, `findDocByFilename`. Uses `page_size=100` when polling by filename to avoid pagination edge cases. Test file: `paperless-api.live.integration.test.ts`.
