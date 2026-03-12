# Biome Migration – Final Review

Comparison with [Biome’s official recipes](https://biomejs.dev/recipes/git-hooks/) and common patterns.

## Summary

| Aspect | Our setup | Biome recipe / common practice | Status |
|--------|-----------|--------------------------------|--------|
| **devDependencies** | `@biomejs/biome` | Same | ✓ |
| **npm scripts** | `biome check .` | `biome check` (npm adds `node_modules/.bin` to PATH) | ✓ |
| **lint-staged** | Was: `biome check --write --unsafe` | `biome check --write --no-errors-on-unmatched --files-ignore-unknown=true` | ✓ Fixed |
| **lint-staged invocation** | Was: `biome` | Lefthook/pre-commit use `npx @biomejs/biome` | ✓ Use `npx biome` |
| **files.includes** | `**/*.ts`, `**/*.tsx`, `**/*.mjs` | Allowlist pattern | ✓ |
| **Lefthook** | `npx lint-staged` | Same | ✓ |

## Changes applied

1. **lint-staged**
   - Use `npx biome` so the local install is used when PATH may not include `node_modules/.bin` (e.g. when lefthook runs the hook).
   - Add `--no-errors-on-unmatched` to avoid errors when no matching files are staged.
   - Add `--files-ignore-unknown=true` so unknown file types are ignored instead of causing errors.
   - Consolidate to a single glob: `*.{ts,tsx,mjs}`.

2. **npm scripts**
   - Keep `biome` (no `npx`) for `lint`, `lint:fix`, `format`; `npm run` already adds `node_modules/.bin` to PATH.

## References

- [Biome Git Hooks recipe](https://biomejs.dev/recipes/git-hooks/) – lint-staged config and flags
- [Biome Configuration](https://biomejs.dev/reference/configuration/) – `files.includes`, formatter, linter
- [ivangabriele/biome-config](https://github.com/ivangabriele/biome-config) – shared Biome config with lint-staged
