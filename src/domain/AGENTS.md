# Domain

Types, errors, MIME utilities. Shared by core and shell.

## Rules

- **Errors:** Use `Schema.TaggedErrorClass` in `errors.ts`. Do not use ad-hoc error objects.
- **ADTs:** Prefer tagged unions over ad-hoc state. Use `Match.exhaustive` for exhaustive handling.
- **Extending provider variants** (e.g. new email provider): Add to the discriminated union in `account.ts` and add a `Match.when` case; `Match.exhaustive` enforces compile-time exhaustiveness.

## Gmail vs Generic IMAP

- **ConnectionDetails** (`account.ts`): `GmailDetails | GenericImapDetails`.
- **detailsToImapConfig** / **imapConfigToDetails**: Use `Match.value(...).pipe(Match.when(...), Match.exhaustive)`.
- See [domain/imap-provider.ts](imap-provider.ts) for presets; [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for the full pattern.
