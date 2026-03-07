# Core (Functional Core)

Pure functions only. No Effect, no I/O.

## Rules

- **Return `Result`** — Use `Result.succeed` / `Result.fail` for sync validation.
- **No Effect** — No `Effect`, `Layer`, or `yield*` in this directory.
- **No I/O** — No `fetch`, `readFile`, `writeFile`, network, or keychain. Take plain args; return `Result<T>`.
- **No `console.log`** — Use `Effect.log` in shell, not here.

## Boundary

Shell calls core and bridges with `Effect.fromResult(coreResult)`. Core never imports from `shell`, `interfaces`, or `live`.
