# Migrate from oxlint/oxfmt to Biome with allowlist

## Context and Problem Statement

The project used oxlint and oxfmt for linting and formatting. Docs-only PRs failed CI because oxfmt formatted markdown files (README.md, docs/*.md) and produced format diffs. This caused unexpected failures when contributors edited documentation.

## Considered Options

* **Add markdown to oxfmt ignore** — Minimal change; keeps oxlint/oxfmt. Still requires maintaining two tools and configs.
* **Migrate to Biome with allowlist** — Single tool for lint + format; `files.includes: ["**/*.ts", "**/*.tsx"]` ensures only TypeScript/JS are processed. Markdown and other files are never touched.
* **Keep oxlint/oxfmt, ignore all markdown** — Same as first option; already applied as a quick fix in docs PR.

## Decision Outcome

Chosen option: **Migrate to Biome with allowlist**, because it prevents surprises: only explicitly included file types (`.ts`, `.tsx`) are linted and formatted. Documentation changes cannot trigger format failures.

### Consequences

* Good: Single tool (Biome) for lint and format; simpler config.
* Good: Allowlist (`files.includes`) avoids accidental formatting of markdown, JSON configs, etc.
* Good: Biome is fast, actively maintained, and has good editor support.
* Neutral: Rule names differ from oxlint; some rules mapped (noExplicitAny, noConsole, noParameterAssign, etc.).
* Bad: Migration effort; contributors need to use `biome-ignore` instead of `oxlint-disable` for rare exceptions.
