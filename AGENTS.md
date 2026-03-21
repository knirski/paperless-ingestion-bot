# AI Agent Instructions

Paperless-ingestion-bot ingests documents from Signal and Gmail into Paperless-ngx. TypeScript, Effect v4 beta, Tagless Final, FC/IS.

When editing this project, apply these rules. Workflow: apply rules → make changes → run `bun run check` → fix until pass.

## Skills

**Use the ts-scripting skill** when analyzing or editing TypeScript code. It provides canonical patterns for Effect v4, FC/IS, Tagless Final, config, and testing. Compare against its checklist and apply applicable suggestions.

**When to use which skill:**

| Situation | Skill |
|-----------|-------|
| Editing TypeScript | ts-scripting |
| New features, non-trivial changes | brainstorming — design before implementation |
| Before claiming completion | verification-before-completion — run `bun run check`, show output |
| Creating or editing rules | create-rule |

**For new features or non-trivial changes:** Invoke the brainstorming skill before implementation. Present design and get approval before coding.

## Research and Decision-Making

When unsure about how to implement something or when multiple approaches exist:

**Use GitHub MCP (or other relevant MCP) first when available** — Prefer MCP tools over web search or manual lookup: `mcp_github_search_code`, `mcp_github_get_file_contents`, `mcp_context7_query-docs`, etc. Fall back to web fetch or CLI only when MCP has no matching capability.

1. **Check official documentation first** — Use the primary source (library docs, GitHub Actions docs, etc.) to understand intended behavior and options.
2. **Effect sources** — For Effect, use the LLM-oriented docs at `https://github.com/Effect-TS/effect-smol/blob/effect%404.0.0-beta.XX/LLMS.md`. Replace the version segment (`effect%404.0.0-beta.XX`) with the `effect` version from `package.json` dependencies (e.g. `4.0.0-beta.35` → `effect%404.0.0-beta.35`).
3. **When still uncertain, check popular and respectable public repos** — Look at how active, well-maintained projects handle the same problem (e.g. Next.js, React, GitHub’s own repos). This is mandatory when:
   - There are different valid options or paths.
   - There is no obvious solution.
   - You need to validate that an approach aligns with common practice.

Docs give the “what” and “how”; real-world usage shows trade-offs and consensus.

**Use the verification-before-completion skill** when about to commit, create a PR, or claim any task done.

## Setup

- Install: `bun install` then `bun x lefthook install` (Lefthook is a devDependency; the second step enables pre-commit/pre-push hooks)
- Verify: `bun run check` (test, lint, knip, typecheck)
- **Build/typecheck:** Uses [TypeScript Native](https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/) (`tsgo`) for faster compile and typecheck. No declaration emit (standalone app).
- CI: [docs/CI.md](docs/CI.md) — ci.yml (check, dependency-review), ci-workflows.yml (.github-only), ci-docs.yml (markdown), ci-nix.yml (Nix build)

## Commands

| Command                    | Purpose                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`            | Full check: core, docs (rumdl, typos), actionlint, shellcheck. Lychee opt-in via `check:with-links`. Run before committing. |
| `bun run check:with-links` | Same as check plus lychee (~10s). |
| `bun run check:code`       | Code only: audit, test, lint, knip, typecheck. Runs on pre-push. Faster than full check. |
| `bun run check:ci`         | Full CI parity in Docker (`gh act` or `act`). **Prefer for local workflow testing** over pushing to trigger CI. |
| `bun run check:just-links` | Links only: lychee. Quick link verification. |
| `bun run check:docs`       | Docs only: rumdl, typos. Quick docs verification. |
| `bun test`                 | Unit tests with coverage                                                                                                           |
| `bun run test:integration` | Integration tests (mocks; optional live Gmail requires credentials). See [test/integration/README.md](test/integration/README.md). |
| `bun run lint`             | Lint (Biome)                                                                                                                       |
| `bun run lint:fix`         | Lint and fix                                                                                                                       |
| `bun run typecheck`        | TypeScript check                                                                                                                   |
| `bun run knip`             | Unused code detection                                                                                                              |

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

- Config — JSON (Nix-generated). Resolution: `--config` or `PAPERLESS_INGESTION_CONFIG` or default. 12-factor: individual values and paths override via env.
  Config layers load from file and apply env overrides (12-factor: individual vars like `PAPERLESS_INGESTION_SIGNAL_API_URL`). Pipelines `yield* SignalConfig` / `yield* EmailConfig`.
  JSON Schema: `dist/config.schema.json` (build time). Startup validation: paperless_url, signal_api_url; `--skip-reachability-check` bypasses API check.

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
| General-purpose scripts (build, lint, dev)             | `scripts/`                                                  |

## Key Rules

| Rule             | Requirement                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| Effect first     | Use `effect` and `@effect/*`                                               |
| No `any`         | Use `unknown`; Biome enforces `noExplicitAny`                             |
| No `!`           | No non-null assertions                                                     |
| No `enum`        | Use string literal unions                                                  |
| No `console.log` | Use `Effect.log`                                                           |
| Core pure        | No Effect, no I/O in `src/core/`                                           |
| Domain errors    | `Schema.TaggedErrorClass` in `domain/`                                     |
| Optional returns | Use `Option<T>`; avoid `T \| null` or `T \| undefined`                     |
| Optional params  | `param?: T` or `param: T \| undefined`; accept `null` only at API boundary |
| Credentials      | OS keyring only; no file fallback. Use `Redacted` for all PII/secrets. See [SECURITY.md](SECURITY.md#security-considerations). |
| File names       | kebab-case for multi-word                                                  |

## Avoid

- I/O or Effect in `src/core/` — core must stay pure
- `any`, `as` type assertions — use `unknown`, Schema, or narrowing
- Forgetting `Effect.fromResult` when calling core from shell
- `console.log` — use `Effect.log`
- Logging secrets — never call `Redacted.value()` for logging; keep passwords wrapped until use site
- PII in errors — use `redactedForLog(value, redactFn)`; in formatters use `r.label ?? "<redacted>"`

## Commits

[Conventional Commits](https://www.conventionalcommits.org/). Examples: `feat: add X`, `fix: resolve Y`, `docs: update README`, `chore: bump dependency`. Enforced by commitlint in CI.

Create small, focused commits. If changes span many files or concerns, propose splitting into separate branches or PRs.

## GitHub Operations

**Use GitHub MCP first.** Check `mcps/user-github/tools/` before using `gh` CLI.

- PRs: `create_pull_request`, `update_pull_request`, `merge_pull_request`, `pull_request_read`
- Issues: `issue_write`, `add_issue_comment`, `issue_read`
- Fallback to `gh` only when MCP has no matching tool.

## Branch names (auto-PR)

Use `ai/` prefix when pushing so the [auto-PR workflow](.github/workflows/auto-pr.yml) (via [knirski/auto-pr](https://github.com/knirski/auto-pr)) auto-creates a PR with title and body from conventional commits:

- `ai/feature-name` or `ai/fix-bug-description`

## Pull Requests

When creating a PR (e.g. with GitHub MCP or `gh pr create`):

1. **Assess changes** — Inspect uncommitted and committed-but-not-pushed changes. Divide and group them logically (e.g. feature vs docs vs chore). Create separate branches and separate PRs for each logical group.
2. Create branch (use `ai/` prefix for auto-PR), commit, push.
3. Create PR — follow the [PR template](.github/PULL_REQUEST_TEMPLATE.md). See [docs/PR_TEMPLATE.md](docs/PR_TEMPLATE.md).
4. **Checkout main and pull** — `git checkout main && git pull`. Do not finish until this is done; the workspace must be left on `main`.

**PR body:** Include:

1. **Description** — What and why (context, not just title restatement).
2. **Type of change** — Check exactly one.
3. **Changes made** — Specific bullet points (omit for trivial PRs).
4. **How to test** — Step-by-step for reviewers; use "N/A" for docs-only.
5. **Checklist** — Check all items (commits, `bun run check`, docs, tests).
6. **Related issues** — Optional; use "Closes #123" to auto-close.
7. **Breaking changes** — Only when applicable; describe impact and migration.

When using `gh pr create` as fallback, write the body to a temp path (e.g. `/tmp/pr-body.md` or `mktemp`) and pass it to `--body-file`; do not create PR body files in the workspace.

**PR workflow:** When adding commits to an existing PR, batch all changes before pushing, or verify the PR is still open before each push. Avoid merging a PR while additional commits are being prepared—merge only after all intended changes are pushed and CI has run. When done with PR creating, checkout main and pull.

## Verification

```bash
bun run check
```

Runs: check-nix-hash, check:nix, check:code (build, audit, lint, knip, typecheck, test), check:docs (rumdl, typos), lint:workflows, lint:scripts. Coverage: lines 90%, functions 90%. **Do not finish until all pass.**

- Run full suite: `bun test`
- Focus a test: `bun test -- -t "pattern"`
- Add or update tests for the code you change, even if nobody asked.
- Before committing: run `bun run check`; ensure all tests pass.
- **`check` runs everything** — Core, docs (rumdl, typos), actionlint, shellcheck. Use `check:with-links` to add lychee (~10s).
- Pre-push runs `check:code` automatically (Lefthook). Run `bun x lefthook install` after cloning. Use `git push --no-verify` only when necessary.
- For full CI parity locally (e.g. debugging CI): `bun run check:ci` (requires Docker + act or gh-act).

## Security

Credentials and config paths are sensitive; do not log or expose them.

## Planning

- [docs/plans/EFFECT_UNSTABLE_PLAN.md](docs/plans/EFFECT_UNSTABLE_PLAN.md) — Effect unstable adoption (observability, AI, persistence, process).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Entry points, main flows, Gmail vs Generic IMAP (ADT + Match.exhaustive), error model.
- [docs/adr/](docs/adr/) — Architecture Decision Records. See ADR workflow below. [ADR 0006](docs/adr/0006-bun-migration.md): Bun as sole package manager.

## ADR Workflow

**When creating or updating an ADR:**

1. Add or update the ADR in `docs/adr/` using the [template](docs/adr/adr-template.md).
2. Update this AGENTS.md if the decision affects agent instructions: add to Planning, "Where to Put X", or Key Rules as appropriate.
3. Update [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) if the decision changes high-level structure or flows.

**When making a significant architectural change (or planning one):**

1. Follow [Research and Decision-Making](#research-and-decision-making): check official docs, then how popular repos handle similar decisions.
2. Create or update an ADR in `docs/adr/` documenting the decision, context, alternatives, and consequences.
3. Update AGENTS.md and ARCHITECTURE.md as above.

**Significant** means: affects multiple modules, is hard to reverse, changes design principles, or introduces new patterns. Minor refactors or dependency bumps do not require ADRs.

## Project Structure

```
.github/
  workflows/       — GitHub Actions
src/
  cli.ts           — CLI entry point
  core/            — Pure domain logic (FC)
  domain/          — Types, errors, MIME utilities
  interfaces/      — Tagless Final service interfaces
  live/            — Live interpreters
  shell/           — Imperative shell (pipelines, config, layers)
scripts/           — General-purpose scripts (build, check-nix-hash, etc.)
test/
  fixtures/        — Config mocks, credentials, imap/signal mocks
  integration/     — Integration tests
  *.test.ts        — Unit tests
```
