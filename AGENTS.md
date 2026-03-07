# AI Agent Instructions

Paperless-ingestion-bot ingests documents from Signal and Gmail into Paperless-ngx. TypeScript, Effect v4 beta, Tagless Final, FC/IS.

When editing this project, apply these rules. Workflow: apply rules → make changes → run `npm run check` → fix until pass.

## Setup

- Install: `npm install`
- Verify: `npm run check` (test, lint, knip, typecheck)
- CI plan: `.github/workflows/`

## Commands

| Command                    | Purpose                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`            | Full verification (test, lint, knip, typecheck). Run before committing.                                                            |
| `npm test`                 | Unit tests with coverage                                                                                                           |
| `npm run test:integration` | Integration tests (mocks; optional live Gmail requires credentials). See [test/integration/README.md](test/integration/README.md). |
| `npm run lint`             | Lint (oxlint, oxfmt)                                                                                                               |
| `npm run lint:fix`         | Lint and fix                                                                                                                       |
| `npm run typecheck`        | TypeScript check                                                                                                                   |
| `npm run knip`             | Unused code detection                                                                                                              |

## Design Principles

- **Functional Core / Imperative Shell:** Core is pure (no Effect, no I/O, returns `Result`). Shell orchestrates I/O and calls core. Bridge with `Effect.fromResult` at the boundary.
- **Tagless Final:** Services are interfaces + Tags; live interpreters in `live/`, tests swap mocks. Programs declare `R`; shell provides via `Effect.provide(layer)`.
- **Effect ecosystem first:** Prefer `effect` and `@effect/*` when adding dependencies.
- **Config as service:** Schema-validated; pipelines `yield* Config`; core takes plain args.
- **ADTs and pattern matching:** Prefer tagged unions over ad-hoc state; use `Match.exhaustive` for exhaustive handling.
- **Dependency direction:** `core` and `domain` do not depend on `shell`, `interfaces`, or `live`.

## Architecture

- `src/core/` — Pure functions. Returns `Result`.

- `src/shell/` — Pipelines, config, layers. `Effect.fromResult` when calling core.

- `src/cli.ts` — Thin CLI. Uses `effect/unstable/cli`. Delegates to pipelines.

- Config — JSON (Nix-generated). Resolution: `--config` > `PAPERLESS_INGESTION_CONFIG` env > default.
  Pipelines `yield* SignalConfig` / `yield* EmailConfig`.

- Services: `SignalClient`, `EmailClient`, `OllamaClient`, `CredentialsStore`, `SignalConfig`, `EmailConfig`.
  Mocks: `signalConfigTest`, `emailConfigTest`, `credentialsStoreTest`, `createImapMockLayer`, `createSignalMockLayer`.

## Where to Put X

| Adding…                                               | Put in                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| Pure validation, eligibility                          | `src/core/`                                                 |
| New I/O or external API                               | `src/interfaces/` + `src/live/`                             |
| Domain type, error, MIME                              | `src/domain/`                                               |
| Pipeline step, config, layer                          | `src/shell/`                                                |
| Extending provider variants (e.g. new email provider) | Add to discriminated union in `domain/` + `Match.when` case |

## Key Rules

| Rule             | Requirement                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| Effect first     | Use `effect` and `@effect/*`                                               |
| No `any`         | Use `unknown`; oxlint enforces `noExplicitAny`                             |
| No `!`           | No non-null assertions                                                     |
| No `enum`        | Use string literal unions                                                  |
| No `console.log` | Use `Effect.log`                                                           |
| Core pure        | No Effect, no I/O in `src/core/`                                           |
| Domain errors    | `Schema.TaggedErrorClass` in `domain/`                                     |
| Optional returns | Use `Option<T>`; avoid `T \| null` or `T \| undefined`                     |
| Optional params  | `param?: T` or `param: T \| undefined`; accept `null` only at API boundary |
| File names       | kebab-case for multi-word                                                  |

## Avoid

- I/O or Effect in `src/core/` — core must stay pure
- `any`, `as` type assertions — use `unknown`, Schema, or narrowing
- Forgetting `Effect.fromResult` when calling core from shell
- `console.log` — use `Effect.log`

## Commits

[Conventional Commits](https://www.conventionalcommits.org/). Examples: `feat: add X`, `fix: resolve Y`, `docs: update README`, `chore: bump dependency`. Enforced by commitlint in CI.

Create small, focused commits. If changes span many files or concerns, propose splitting into separate branches or PRs.

## GitHub Operations

When interacting with GitHub (repos, PRs, issues, etc.):

1. **Prefer GitHub MCP** — Use MCP tools when available (check Available Tools).
2. **Fallback to gh CLI** — Use `gh` when MCP is unavailable or for operations MCP doesn't support.

## Pull Requests

When creating a PR (e.g. with GitHub MCP or `gh pr create`), **follow the [PR template](.github/PULL_REQUEST_TEMPLATE.md)**:

1. **Description** — What and why (context, not just title restatement).
2. **Type of change** — Check exactly one.
3. **Changes made** — Specific bullet points (omit for trivial PRs).
4. **How to test** — Step-by-step for reviewers; use "N/A" for docs-only.
5. **Checklist** — Check all items (commits, `npm run check`, docs, tests).
6. **Related issues** — Optional; use "Closes #123" to auto-close.
7. **Breaking changes** — Only when applicable; describe impact and migration.

Use `gh pr create --body-file <file>` with a file that matches the template structure.

## Verification

```bash
npm run check
```

Runs: `npm run test && npm run lint && npm run knip && npm run typecheck`. Coverage: lines 90%, functions 90%. **Do not finish until all pass.**

- Run full suite: `npm test`
- Focus a test: `npm test -- -t "pattern"`
- Add or update tests for the code you change, even if nobody asked.
- Before committing: run `npm run check`; ensure all tests pass.

## Security

Credentials and config paths are sensitive; do not log or expose them.

## Planning

- [docs/EFFECT_UNSTABLE_PLAN.md](docs/EFFECT_UNSTABLE_PLAN.md) — Effect unstable adoption (observability, AI, persistence, process).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Entry points, main flows, Gmail vs Generic IMAP (ADT + Match.exhaustive), error model.

## Project Structure

```
src/
  cli.ts           — CLI entry point
  core/            — Pure domain logic (FC)
  domain/          — Types, errors, MIME utilities
  interfaces/      — Tagless Final service interfaces
  live/            — Live interpreters
  shell/           — Imperative shell (pipelines, config, layers)
test/
  fixtures/        — Config mocks, credentials, imap/signal mocks
  integration/     — Integration tests
  *.test.ts        — Unit tests
```
