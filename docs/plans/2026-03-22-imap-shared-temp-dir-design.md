# IMAP Shared Temp Directory — Design

**Date:** 2026-03-22  
**Status:** Proposal — not implemented.  
**Related:** [src/live/imap-email-client.ts](../../src/live/imap-email-client.ts) (streamToTempFile, fetchPart).

## Motivation

When fetching email attachments via IMAP, the client streams each attachment to a temp file to avoid buffering large blobs in memory. Currently `streamToTempFile` creates **one temp directory per attachment part** via `fs.makeTempDirectory()`.

- **Problem:** N attachments → N temp directories. Each directory holds a single `.tmp` file. Directories are never explicitly removed (only the temp files are deleted after read).
- **Impact:** Unnecessary `makeDirectory` calls, leftover empty dirs, noisier temp space. Gmail live test mocks FileSystem partly because of this behavior.
- **Goal:** Use a single shared temp directory per fetch batch and stream all attachment files into it.

## Current Behavior

```
fetchAttachmentsForUids(uids)
  for each uid:
    for each attachment part:
      fetchPart() → streamToTempFile()
        makeTempDirectory(prefix)     ← one per part
        fs.sink(path)                ← one file per part
        return { path, size }
      processRawAttachment reads path, then removes file (dir left behind)
```

**Flow:** `streamToTempFile(account, content)` is self-contained: create dir, stream to `{dir}/{uuid}.tmp`, return path. No shared context. Cleanup: `processRawAttachment` removes the file via `Effect.ensuring(fs.remove(raw.path))`; the parent dir is never removed.

## Proposed Design

### 1. Shared temp dir per fetch batch

Create one temp directory at the start of `fetchAttachmentsForUids` (or at the account/session level). Pass it into `streamToTempFile` or provide it via a scoped resource.

### Option A: Pass baseDir into streamToTempFile

```ts
// streamToTempFile(account, content, baseDir: string)
// Caller: fetchAttachmentsForUids creates baseDir once, passes to each fetchPart
```

### Option B: Scoped temp dir (Effect.acquireRelease)

```ts
// Effect.gen: acquire makeTempDirectory, pass to inner Effect.forEach
// ensuring: remove(baseDir, { recursive: true }) on scope exit
```

Option B ensures cleanup of the whole dir when the batch finishes (success or failure). Prefer B if we want to remove the dir; A if we rely on OS temp cleanup.

### 2. streamToTempFile signature change

**Before:**

```ts
streamToTempFile(account, content): Effect<{ path: string; size: number }, ...>
// Creates own makeTempDirectory
```

**After:**

```ts
streamToTempFile(account, content, baseDir: string): Effect<{ path: string; size: number }, ...>
// Writes to pathApi.join(baseDir, `${uuid}.tmp`)
```

### 3. Call site: fetchAttachmentsForUids

```ts
Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const pathApi = yield* Path.Path;
  const baseDir = yield* Effect.acquireRelease(
    Effect.runPromise(fs.makeTempDirectory({ prefix: INGESTION_TEMP_PREFIX })),
    (dir) => Effect.runPromise(fs.remove(dir, { recursive: true }).pipe(Effect.catch(() => Effect.void))),
  );
  // ... openMailbox ...
  const perUid = yield* Effect.forEach(uids, (uid) =>
    Effect.gen(function* () {
      // ...
      return yield* Effect.forEach(parts, (part) =>
        fetchPart(account, client, uid, part, maxSize, labels, baseDir),
      );
    }),
  );
  // ...
});
```

`fetchPart` receives `baseDir` and passes it to `streamToTempFile(account, content, baseDir)`.

### 4. Cleanup

- **Files:** `processRawAttachment` still removes each file after read (or we could batch-remove in `fetchAttachmentsForUids` on scope exit; current per-file remove is fine).
- **Directory:** `Effect.acquireRelease` ensures `fs.remove(baseDir, { recursive: true })` runs when the fetch batch completes (or fails). Any remaining files in the dir are removed with it.

## Implementation Tasks

1. **Refactor streamToTempFile** — Add `baseDir: string` param; remove internal `makeTempDirectory`; write to `pathApi.join(baseDir, `${uuid}.tmp`)`.
2. **Refactor fetchAttachmentsForUids** — Create shared `baseDir` via `Effect.acquireRelease`; pass `baseDir` to `fetchPart`.
3. **Refactor fetchPart** — Add `baseDir` param; pass to `streamToTempFile`.
4. **Tests** — Mock-based integration tests (email-pipeline.integration.test.ts) should still pass; no behavior change except fewer FS ops. Gmail live test: verify no regressions.
5. **Cleanup verification** — Add or extend test that temp dir is removed (e.g. assert `!exists(baseDir)` after scope, or inspect mock calls).

## Risks and Mitigations

- **Concurrent fetches:** If we ever parallelize fetchPart (e.g. `Effect.forEach` with concurrency), one shared dir is safe—each file has a unique UUID name.
- **Partial failure:** If one fetchPart fails mid-batch, `acquireRelease` still runs; dir is removed.
- **Large batches:** One dir with many files; no functional difference from many dirs. `recursive: true` remove handles non-empty dir.

## Out of Scope

- Changing how Paperless upload works (stays in-memory from temp file read).
- Signal pipeline (doesn’t use temp files for attachments).
