# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the paperless-ingestion-bot project.

## Format

Each ADR is a markdown file named `NNNN-title-with-dashes.md` where NNNN is a zero-padded number. See [adr-template.md](adr-template.md) for the template ([MADR 4.0.0 minimal](https://github.com/adr/madr/blob/4.0.0/template/adr-template-minimal.md)).

## Agent Workflow

When creating or updating an ADR:

1. Add or update the ADR in `docs/adr/` using the [template](adr-template.md).
2. Update [AGENTS.md](../../AGENTS.md) if the decision affects agent instructions (Planning, "Where to Put X", Key Rules).
3. Update [ARCHITECTURE.md](../ARCHITECTURE.md) if the decision changes high-level structure or flows.

When making a significant architectural change (or planning one):

1. Create or update an ADR documenting the decision, context, alternatives, and consequences.
2. Update AGENTS.md and ARCHITECTURE.md as above.

**Significant** means: affects multiple modules, is hard to reverse, changes design principles, or introduces new patterns. Minor refactors or dependency bumps do not require ADRs.

## Index

| ADR  | Title                       |
| ---- | --------------------------- |
| 0000 | [Template](adr-template.md) |
