# Migrate to Bun as sole package manager and runtime

## Context and Problem Statement

The project had `packageManager: bun@1.3.10` and `bun.lock`, but documentation, scripts, workflows, and the Dockerfile still referenced npm. Contributors saw mixed instructions (`npm run check` vs `bun run check`). The Dockerfile used `node:24-alpine` and `npm ci`; shell.nix used `nodePackages.npm`. Obsolete npm-era artifacts remained: `update-nix-hash.mjs`, `update-npm-deps-hash.sh`, and composite actions (`nix-npm-deps-hash`, `nix-commit-npm-deps-hash`, `nix-fail-npm-deps-hash-fork`) that referenced `package-lock.json` and `npmDepsHash`—despite the project using `bun.nix` and `bun.lock` since the Nix migration to bun2nix. How should we align tooling and documentation with the actual runtime?

## Considered Options

* **Keep npm references where "necessary"** — Use bun for dev, keep npm for Docker (node base image) and docs that mention "npm publish" (npm registry). Minimal change; perpetuates confusion.
* **Full Bun migration** — Replace all npm references with bun. Dockerfile uses `oven/bun`, shell.nix uses `pkgs.bun`, docs and scripts use `bun run`/`bun install`. Remove obsolete npm-deps-hash scripts and actions. Single source of truth.
* **Dual support (npm and bun)** — Document both; maintain both in CI. Rejected: doubles maintenance; project already standardizes on bun.

## Decision Outcome

Chosen option: **Full Bun migration**, because the project is already Bun-first (`packageManager`, `bun.lock`). Consistency reduces contributor confusion and simplifies onboarding. Obsolete npm-deps-hash tooling was dead code (nix.yml uses `bun.nix` and `update-bun-nix`); removing it reduces maintenance.

### Consequences

* Good: Single package manager (bun) across docs, scripts, CI, Docker, shell.nix. Clear contributor instructions.
* Good: Docker image uses Bun runtime; smaller surface than node+npm.
* Good: Removed obsolete scripts (`update-nix-hash.mjs`, `update-npm-deps-hash.sh`, `commit-msg-hint.mjs`) and composite actions; less dead code.
* Good: `bun pm pack --dry-run` replaces `npm pack --dry-run` for pre-publish verification; `bun audit` replaces `npm audit`.
* Neutral: `npm publish` and "npm registry" remain in docs where publishing to npm is discussed; that is the registry name, not the tool.
* Bad: Contributors without Bun must install it; Bun is less ubiquitous than Node/npm. Mitigated: Nix dev shell and Docker both provide Bun.

### Implementation Summary

| Area | Change |
|------|--------|
| **Docs** | README, CONTRIBUTING, PR_TEMPLATE, GITHUB_APP_AUTO_PR_SETUP, PUBLICATION_CHECKLIST, CI, CII, BIOME_REVIEW, deploy/systemd — `npm` → `bun` |
| **Dockerfile** | `node:24-alpine` → `oven/bun:1-alpine`; `package-lock.json` → `bun.lock`; `npm ci` → `bun install --frozen-lockfile`; entrypoint `node` → `bun` |
| **shell.nix** | `nodejs_24`, `nodePackages.npm` → `pkgs.bun`; `npm install` → `bun install` |
| **package.json** | `pack:dry` → `bun pm pack --dry-run`; `check:code` → sequential `bun run lint && knip && typecheck` (removed npm-run-all); removed npm-run-all devDep |
| **Scripts** | fill-pr-template.ts howToTest → `bun run check`; removed update-nix-hash.mjs, update-npm-deps-hash.sh, commit-msg-hint.mjs |
| **Actions** | Removed nix-npm-deps-hash, nix-commit-npm-deps-hash, nix-fail-npm-deps-hash-fork |
| **Biome** | Removed `**/*.mjs` from files.includes (no project-owned .mjs) |
