# Shell (Imperative Shell)

Pipelines, config, layers. Orchestrates I/O and calls core.

## Rules

- **Bridge core with `Effect.fromResult`** — When calling core, wrap the result: `Effect.fromResult(coreFunction(...))`. Do not call core and ignore the Result.
- **Config as service** — Pipelines `yield* SignalConfig` / `yield* EmailConfig`. Core receives plain args, not config services.
- **Use `Effect.log`** — No `console.log`.

## Entry points

- [email-pipeline.ts](email-pipeline.ts) — IMAP crawl, eligibility, save.
- [signal-pipeline.ts](signal-pipeline.ts) — Webhook server, attachment handling, account commands.
- [layers.ts](layers.ts) — Composes `SignalAppLayer` and `EmailLayer`.

See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for flows and config.
