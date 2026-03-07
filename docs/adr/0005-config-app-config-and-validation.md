# Config: env overrides, JSON Schema, loadConfiguration, and startup validation

## Context and Problem Statement

The config system needed to align with common deployment patterns (12-factor, containers) and improve operator experience. Config was file-only; validation happened late; no machine-readable schema existed. How should we evolve config loading and validation?

## Considered Options

* **A)** Keep file-only config — status quo; no env-based overrides for containers
* **B)** Add APP_CONFIG env (full JSON blob) — single env var; rejected: 12-factor favors granular env vars; JSON in env has escaping/size issues; not aligned with Paperless-ngx, Grafana, etc.
* **C)** Individual env var overrides (12-factor style) — file as base; env vars override specific keys; JSON Schema, loadConfiguration, split config (users.json, email-accounts.json), startup validation

## Decision Outcome

Chosen option: **C**, because it aligns with 12-factor ("env vars are granular controls, each fully orthogonal") and common practice (Paperless-ngx uses individual PAPERLESS_* vars). File remains the base; env vars override when set.

### Consequences

* Good, because: granular env vars are 12-factor compliant; no JSON escaping in env; aligns with reputable OSS projects; JSON Schema supports tooling; loadConfiguration centralizes loading; split config (users.json) keeps concerns separate; startup validation fails fast; --skip-reachability-check allows flexible startup order
* Bad, because: more env var names to document; users.json is a separate file to maintain

### Implementation

**Paths** (CLI overrides env):

| File | CLI | Env | Default |
|------|-----|-----|---------|
| config.json | `--config` | `PAPERLESS_INGESTION_CONFIG` | `/etc/paperless-ingestion-bot/config.json` |
| users.json | `--users` | `PAPERLESS_INGESTION_USERS_PATH` | `/var/lib/paperless-ingestion-bot/users.json` |
| email-accounts.json | `--email-accounts` | `PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH` | `/var/lib/paperless-ingestion-bot/email-accounts.json` |

**Loading:** File → parse JSON → env overrides (e.g. `PAPERLESS_INGESTION_CONSUME_DIR`) → `Schema.decodeUnknownEffect`. Effect ConfigProvider orElse(env, file). JSON Schema: `scripts/generate-schema.ts` → `dist/config.schema.json`.

**Startup (Signal):** Validates `consume_dir` and `signal_api_url` reachability; `--skip-reachability-check` bypasses API check.
