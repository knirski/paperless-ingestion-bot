# Effect Unstable Modules — Adoption Plan

Plan for integrating `effect/unstable/*` modules into paperless-ingestion-bot. Order reflects impact and risk.

---

## 1. Observability (`effect/unstable/observability`)

**Goal:** Add tracing and metrics for pipelines, IMAP, Signal, and Ollama.

### 1.1 Tracing (OtlpTracer)

**Scope:**

- Wrap key operations in spans: `Effect.withSpan`
- Pipeline entry points: `runEmailPipeline`, Signal webhook handlers
- IMAP: `fetchUidsWithRetry`, `fetchAttachmentsForUidsEffect`, connection acquire
- Signal: `resolveSignalSource`, `processWebhookAttachments`, `processWebhookTextCommand`
- Ollama: `OllamaClient.assess`

**Implementation:**

- Add `OtlpTracer.layer` (or equivalent) to `MainLayer` / pipeline layers
- Use `Effect.withSpan("operation_name", { attributes })` around Effect blocks
- Optional: OTLP exporter to collector (env: `OTEL_EXPORTER_OTLP_ENDPOINT`)

**Files to touch:**

- `src/shell/layers.ts` — add OtlpTracer layer
- `src/shell/email-pipeline.ts` — spans for `runEmailPipeline`, `processAccountWithImap`, `processAccountPages`
- `src/shell/signal-pipeline.ts` — spans for webhook handlers, Gmail commands
- `src/shell/email-attachments.ts` — spans for fetch/save
- `src/live/imap-email-client.ts` — spans for IMAP operations
- `src/live/ollama-client.ts` — span for `assess`

**Dependencies:** None (built into `effect`)

**Testing:** Unit tests unaffected; integration tests can assert span creation if needed.

---

### 1.2 Metrics (PrometheusMetrics)

**Scope:**

- Counters: `email_attachments_saved_total`, `email_pipeline_runs_total`, `signal_attachments_saved_total`, `webhook_requests_total`
- Gauges: `imap_connections_active`
- Histograms: `ollama_assess_duration_seconds`, `imap_fetch_duration_seconds`

**Implementation:**

- Use `Metric.counter`, `Metric.gauge`, `Metric.timer` from `effect/Metric`
- `PrometheusMetrics.format()` for scrape endpoint (if Signal server exposes `/metrics`)
- Or: write metrics to file for Prometheus `file_sd` / `node_exporter` textfile collector

**Files to touch:**

- `src/shell/email-pipeline.ts` — pipeline/account metrics
- `src/shell/email-attachments.ts` — attachment metrics
- `src/shell/signal-pipeline.ts` — webhook/attachment metrics
- `src/live/ollama-client.ts` — assess duration
- `src/live/imap-email-client.ts` — connection gauge
- Optional: `src/shell/signal-pipeline.ts` — add `/metrics` route using `PrometheusMetrics.format()`

**Dependencies:** None

---

### 1.3 Rollout

| Phase | Deliverable                                                     |
| ----- | --------------------------------------------------------------- |
| 1a    | OtlpTracer layer + spans in email/signal pipelines              |
| 1b    | PrometheusMetrics counters for saved attachments, pipeline runs |
| 1c    | Optional: `/metrics` HTTP endpoint on Signal server             |
| 1d    | Optional: OTLP exporter config for external collector           |

---

## 2. AI (`effect/unstable/ai`)

**Goal:** Replace custom `OllamaClient` with `LanguageModel` for provider-agnostic LLM access and future tool/tokenization support.

### 2.1 Current State

- `OllamaClient.assess(request)` → POST to Ollama `/api/generate`, parse yes/no
- Used in `email-attachments.ts` for document eligibility (vision model)
- Interface: `src/interfaces/ollama-client.ts`
- Live impl: `src/live/ollama-client.ts`

### 2.2 LanguageModel Adapter

**Approach:** Implement `LanguageModel` service that calls Ollama (no `@effect/ai-ollama` exists yet).

**Tasks:**

1. Create `OllamaLanguageModel` — `Layer` that provides `LanguageModel` backed by Ollama HTTP API
2. Map `OllamaClient.assess` → `LanguageModel.generateText` with structured prompt
3. Keep `OllamaRequest` / `OllamaClient` interface for now, or introduce `DocumentAssessor` that uses `LanguageModel` internally
4. Use `LanguageModel.generateObject` if we need structured output (e.g. `{ eligible: boolean }`)

**Files to touch:**

- `src/live/ollama-client.ts` — refactor to implement `LanguageModel` or wrap it
- `src/interfaces/ollama-client.ts` — possibly rename to `DocumentAssessor` or keep as thin wrapper
- `src/shell/email-attachments.ts` — no change if interface preserved

**Dependencies:** `effect` (already has `effect/unstable/ai`)

**Risk:** `effect/unstable/ai` API may change; keep adapter thin.

---

### 2.3 Optional: Tool / Tokenizer

- **Tool/Toolkit:** Only if we add LLM tool-calling (e.g. “search accounts”, “check eligibility rules”). Low priority.
- **Tokenizer:** Useful if prompts grow and we need truncation. Add when prompt length becomes an issue.

---

### 2.4 Rollout

| Phase | Deliverable                                                                   |
| ----- | ----------------------------------------------------------------------------- |
| 2a    | Implement `OllamaLanguageModel` layer (Ollama → LanguageModel)                |
| 2b    | Refactor `OllamaClient.assess` to use `LanguageModel.generateText` internally |
| 2c    | Optional: Use `generateObject` for structured eligibility output              |
| 2d    | Optional: Add Tokenizer for long prompts                                      |

---

## 3. Persistence (`effect/unstable/persistence`)

**Goal:** Use `KeyValueStore` for config/cache or as abstraction over credentials.

### 3.1 KeyValueStore for Credentials

**Current:** `CredentialsStore` — @napi-rs/keyring (system keychain). Interface: `getPassword`, `setPassword`, `deletePassword`. See ADR-0001.

**Options:**

- **A)** Implement `CredentialsStore` on top of `KeyValueStore` — use `FileSystemKeyValueStore` or custom backend
- **B)** Use `KeyValueStore` only for non-secret cache (e.g. last crawl cursor, rate-limit state)
- **C)** Keep keyring for secrets; use `KeyValueStore` for metadata/cache

**Recommendation:** Start with **B** or **C**. CredentialsStore uses OS keyring only (ADR-0001); `KeyValueStore` fits cache/metadata.

---

### 3.2 KeyValueStore for Cache

**Use cases:**

- Last processed UID per account (avoid re-scanning from scratch)
- Rate-limit state for credential failure notifications
- Optional: memoization of Ollama responses (risky for eligibility — avoid)

**Implementation:**

- Add `KeyValueStore` service to layers
- Use `FileSystemKeyValueStore` with path under `consumeDir` or temp
- New module: `src/shell/crawl-state.ts` — get/set last UID per account

**Files to touch:**

- `src/shell/layers.ts` — add `KeyValueStore` layer (FileSystemKeyValueStore)
- `src/shell/email-pipeline.ts` — optional: resume from last UID
- `src/shell/credential-failure.ts` — optional: rate-limit via KeyValueStore

---

### 3.3 RateLimiter

**Adopted.** Used for Signal webhook (120/min, token-bucket). See [ADR 0003](adr/0003-rate-limiting.md). For multi-instance deployments, `layerStoreRedis` is available.

**Use case:** Throttle Signal notifications (credential failure) or Ollama requests.

**Implementation:**

- `effect/unstable/persistence` includes `RateLimiter`
- Webhook: `RateLimiter.layer` + `layerStoreMemory` in `signal-pipeline.ts`
- Add to `credential-failure.ts` if we want stricter throttling than current logic

---

### 3.4 Rollout

| Phase | Deliverable                                                |
| ----- | ---------------------------------------------------------- |
| 3a    | Add `KeyValueStore` (FileSystemKeyValueStore) to layers    |
| 3b    | Optional: Crawl state (last UID) in KeyValueStore          |
| 3c    | Optional: RateLimiter for credential failure notifications |
| 3d    | Defer: CredentialsStore on KeyValueStore (keep keyring)    |

---

## 4. Process (`effect/unstable/process`)

**Goal:** Use Effect-native `ChildProcess` for any subprocess invocations.

### 4.1 Current State

- `ChildProcessSpawner` from `@effect/platform-node-shared` is used by `effect/unstable/cli` for completions
- No direct subprocess calls in application code (no `pdftotext`, `tesseract`, etc.)

### 4.2 When to Adopt

- **Trigger:** When we add external tool invocations (e.g. OCR, PDF text extraction, image conversion)
- **Usage:** `ChildProcess.make` for `pdftotext - ${file}`, `ChildProcess.pipeTo` for pipelines

**Implementation (future):**

- Replace `child_process.spawn` / `tinyexec` with `ChildProcess.make`
- Use `Stream.runCollect(handle.stdout)` for output
- Provide `NodeServices.layer` (includes `ChildProcessSpawner`) — already in `MainLayer` via CLI

---

### 4.3 Rollout

| Phase | Deliverable                                                   |
| ----- | ------------------------------------------------------------- |
| 4a    | No action until subprocess feature is added                   |
| 4b    | When needed: use `ChildProcess.make` for new subprocess calls |

---

## Summary

| Module        | Priority | Effort | Risk   | When                    |
| ------------- | -------- | ------ | ------ | ----------------------- |
| Observability | High     | Medium | Low    | Next sprint             |
| AI            | Medium   | Medium | Medium | After observability     |
| Persistence   | Low      | Low    | Low    | When cache/state needed |
| Process       | Deferred | Low    | Low    | When subprocess added   |

---

## Dependencies

All modules are in `effect` 4.0.0-beta.27. No new packages required.

---

## References

- Effect v4 beta: <https://effect.website/blog/releases/effect/40-beta/>
- Tracing: <https://effect.website/docs/observability/tracing/>
- `effect/unstable/observability`: OtlpTracer, PrometheusMetrics
- `effect/unstable/ai`: LanguageModel, Tool, Toolkit, Tokenizer
- `effect/unstable/persistence`: KeyValueStore, Persistence, RateLimiter
- `effect/unstable/process`: ChildProcess, ChildProcessSpawner
