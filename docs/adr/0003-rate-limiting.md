# Webhook rate limiting

## Context and Problem Statement

The Signal webhook receives HTTP POST requests from signal-cli-rest-api. Without rate limiting, a runaway sender or bug could flood the endpoint. What algorithm and parameters should we use?

## Considered Options

* **Fixed-window** — Reset counter at interval boundaries. Simple; allows boundary burst (e.g. 120 at 0:59 + 120 at 1:01 = 240 in 2 sec).
* **Token-bucket** — Gradual refill; no boundary burst. Same average rate, smoother behavior.
* **Sliding-window** — Most accurate; Effect RateLimiter does not support it.

## Decision Outcome

Chosen option: **Token-bucket** via Effect's built-in `RateLimiter` from `effect/unstable/persistence`, because it avoids the fixed-window boundary burst with minimal complexity (one-line algorithm change).

### Parameters

- **Limit:** 120 requests per minute (~2/sec average). Suitable for document ingestion; protects against runaway senders without blocking normal use.
- **Store:** `layerStoreMemory` (in-memory). For multi-instance deployments, `layerStoreRedis` is available.

### Other uses

Credential failure notifications (IMAP auth errors) also use the same `RateLimiter` with in-memory store: 1 notification per 24h per email address. Configurable via `credential_failure_throttle_hours` in email config.

### Consequences

* Good, because Effect RateLimiter is built-in; no third-party package
* Good, because token-bucket prevents boundary burst
* Good, because Redis store available for future scaling
* Bad, because in-memory store does not persist across restarts (acceptable for rate limiting)
