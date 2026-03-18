# Biome Migration – Final Review

Comparison with [Biome’s official recipes](https://github.com/biomejs/website/blob/main/src/content/docs/recipes/git-hooks.mdx) and common patterns.

## Summary

| Aspect | Our setup | Biome recipe / common practice | Status |
|--------|-----------|--------------------------------|--------|
| **devDependencies** | `@biomejs/biome` | Same | ✓ |
| **scripts** | `biome check .` | `biome check` (bun run adds `node_modules/.bin` to PATH) | ✓ |
| **lint-staged** | Was: `biome check --write --unsafe` | `biome check --write --no-errors-on-unmatched --files-ignore-unknown=true` | ✓ Fixed |
| **lint-staged invocation** | Was: `biome` | Lefthook/pre-commit use `bun x biome` | ✓ Use `bun x biome` |
| **files.includes** | `**/*.ts`, `**/*.tsx` | Allowlist pattern | ✓ |
| **Lefthook** | `bun x lint-staged` | Same | ✓ |

## Changes applied

1. **lint-staged**
   - Use `bun x biome` so the local install is used when PATH may not include `node_modules/.bin` (e.g. when lefthook runs the hook).
   - Add `--no-errors-on-unmatched` to avoid errors when no matching files are staged.
   - Add `--files-ignore-unknown=true` so unknown file types are ignored instead of causing errors.
   - Consolidate to a single glob: `*.{ts,tsx,mjs}`.

2. **scripts**
   - Keep `biome` (no `bun x`) for `lint`, `lint:fix`, `format`; `bun run` already adds `node_modules/.bin` to PATH.

## References

- [Biome Git Hooks recipe](https://github.com/biomejs/website/blob/main/src/content/docs/recipes/git-hooks.mdx) – lint-staged config and flags
- [Biome Configuration](https://github.com/biomejs/website/blob/main/src/content/docs/reference/configuration.mdx) – `files.includes`, formatter, linter
- [ivangabriele/biome-config](https://github.com/ivangabriele/biome-config) – shared Biome config with lint-staged
