# Signal webhook security

## Context and Problem Statement

The Signal pipeline receives HTTP POST requests from signal-cli-rest-api when messages arrive. The webhook endpoint must be protected against unauthorized access. signal-cli-rest-api does not support HMAC signing or custom auth headers. What options exist, and which is appropriate for our deployment model?

## Research Findings

### HMAC and alternatives

* **signal-cli-rest-api** — No webhook signing. Maintainer recommends reverse proxy for auth ([issue #519](https://github.com/bbernhard/signal-cli-rest-api/issues/519)).
* **signal-http**, **signal-api-receiver** — No documented webhook auth.
* **secured-signal-api** — Proxy for *incoming* API calls (Bearer, Basic, Query, Path auth). Does not affect the *outgoing* webhook POSTs that signal-cli-rest-api sends to our server.
* **SignalWire / SignalZen** — Different products (telecom); not Signal Messenger.

**Conclusion:** No Signal bridge supports HMAC for webhooks. HMAC requires the sender to sign; we can only verify. Implementing HMAC would require forking or PRing signal-cli-rest-api (medium effort).

### Security options

| Option | Security | Effort | Notes |
|--------|----------|--------|-------|
| **Network isolation** | Highest | Low | Bind to localhost; only local processes can reach it |
| **Reverse proxy** | Strong | Medium | Basic Auth, API key, etc. at nginx/Traefik/Caddy |
| **Secret path** | Moderate | Low | `/webhook/:secret`; URL can leak in logs, referrer |
| **HMAC** | Strong | High | Requires sender support; we cannot add it alone |

## Decision Outcome

Chosen option: **Network isolation via localhost binding**, because the service is intended to run on the same host as signal-cli-rest-api.

### Consequences

* Good, because no extra config; default `webhook_host: "127.0.0.1"` achieves isolation; no credentials to leak
* Good, because same-host deployment is the natural model; signal-cli-rest-api and our bot both run locally
* Bad, because binding to `0.0.0.0` or exposing the webhook externally would require additional measures (reverse proxy or secret path)

### Deployment guidance

When both services run on the same host:

1. Use default `webhook_host: "127.0.0.1"` (or equivalent).
2. Configure signal-cli-rest-api: `RECEIVE_WEBHOOK_URL=http://127.0.0.1:<webhook_port>/webhook`.
3. No secret path, HMAC, or reverse proxy needed.

If the webhook must be exposed beyond localhost, use a reverse proxy with auth or a secret path in the URL.
