# Publication Checklist

Use this checklist when preparing paperless-ingestion-bot for independent publication.

## Completed

- [x] LICENSE (Apache 2.0)
- [x] Standalone flake.nix and default.nix
- [x] README rewritten for standalone use
- [x] CONTRIBUTING.md
- [x] CHANGELOG.md
- [x] config.example.json
- [x] docs/ARCHITECTURE.md
- [x] package.json metadata (license, repository, keywords)
- [x] Conventional commits (commitlint + lefthook + lint-staged)
- [x] release-please (version + changelog automation)
- [x] Dependabot (dependency updates)
- [x] GitHub Actions CI
- [x] PR template
- [x] CODE_OF_CONDUCT.md (Contributor Covenant 2.1)
- [x] SECURITY.md
- [x] Issue templates (bug report, feature request)
- [x] package.json `files` field
- [x] Pre-publish scripts (`npm run publint`, `npm run pack:dry`)

## Before Publishing

### 0. Documentation

- [x] **README.md** — Dependencies documented (paperless-ngx, ollama, paperless-ai, signal-cli-rest-api)
- [x] **README.md** — Privacy-first statement (runs locally, no cloud leakage)

### 1. Update repository URLs

- [x] **package.json** — Set `repository.url` to your actual repo
- [x] **README.md** — Replace `<repository-url>` in clone instructions
- [x] **CONTRIBUTING.md** — Same as above

### 2. Generate flake.lock

```bash
nix flake lock
```

Commit `flake.lock` for reproducible Nix builds.

### 3. Verify Nix build

```bash
nix build .#default
./result/bin/paperless-ingestion-bot --help
```

If `npmDepsHash` is wrong, CI will auto-update on push. For fork PRs or manual fix: `nix run .#update-npm-deps-hash` or `npm run update-nix-hash -- <hash>` (hash from the failed CI step).

### 4. npm publish (optional)

If publishing to npm:

- [ ] Add `publishConfig` if using a scoped package
- [ ] Run `npm run pack:dry` to verify included files
- [ ] Run `npm run publint` to validate package structure
- [ ] Run `npm publish --dry-run` before publishing

### 5. Branch protection (GitHub Settings)

In **Settings → Branches → Add rule** for `main`:

- [ ] Require a pull request before merging
- [ ] Require status checks to pass (e.g. `check`, `nix`, `dependency-review`)
- [ ] Do not allow bypassing the above settings
- [ ] Restrict who can push (optional)

## Recommended Additions

- [x] Nix CI job (`.github/workflows/ci-nix.yml`; runs when nix/deps change)
- [x] update-flake-lock workflow (weekly flake.lock updates; `.github/workflows/update-flake-lock.yml`). Runs on schedule from the default branch. See [docs/SCHEDULED_WORKFLOWS.md](SCHEDULED_WORKFLOWS.md) for enabling scheduled workflows. PRs from this workflow must pass CI (`check`, `nix`, `dependency-review`) before merging.
- [x] Badges (CI, Version, Coverage, License, etc.) in README
- [x] .editorconfig (editor consistency)
- [x] Docker image (Dockerfile + `.github/workflows/docker.yml`; experimental, build-only — publishing disabled)
- [x] Allstar config (`.allstar/` for security policy enforcement)
- [x] CII Best Practices badge link (README)
- [x] CITATION.cff (citation metadata for academic use)

### On each release

- [ ] **CITATION.cff** — Update `version` and `date-released` to match the new release (package.json and release date)
- [x] GitHub Sponsors (FUNDING.yml)
- [x] Architecture diagrams (Mermaid in docs/ARCHITECTURE.md)
- [x] ADRs (docs/adr/)

## Manual Steps (GitHub UI)

Do these in your repository on GitHub:

### 1. Repository topics

**Settings → General → Topics** — Add topics for discoverability:

`paperless-ngx`, `document-ingestion`, `gmail`, `imap`, `signal`, `typescript`, `effect`, `nodejs`, `cli`

### 2. About section

On the repository homepage, click the gear icon next to "About" and set:

- **Description:** Signal and Gmail document ingestion for Paperless-ngx
- **Website:** (optional) docs URL if you have one

### 3. Security features

**Settings → Security → Code security and analysis** — Verify:

- [ ] Secret scanning is enabled
- [ ] Push protection is enabled (blocks pushes containing secrets)

New public repos often have these on by default.

### 4. Branch protection (recommended)

**Settings → Branches → Add rule** for `main`:

- [ ] Require a pull request before merging
- [ ] Require status checks to pass (`check`, `nix`, `dependency-review`) — `nix` ensures npmDepsHash stays in sync
- [ ] Do not allow bypassing the above settings

### 5. GitHub Discussions (optional)

**Settings → General → Features** — Enable **Discussions** for Q&A, ideas, and community.

### 6. Labels (optional)

**Issues → Labels** — Create labels for contributor guidance and automation:

```bash
gh label create "good first issue" --color "0e8a16" --description "Good for newcomers"
gh label create "help wanted" --color "5319e7" --description "Extra attention is needed"
# Required for update-flake-lock workflow PRs (or run: ./scripts/create-labels.sh)
gh label create "dependencies" --color "0366d6" --description "Dependency updates"
gh label create "nix" --color "7f7f7f" --description "Nix-related changes"
gh label create "automated" --color "ededed" --description "Automated by CI"
```

The `dependencies`, `nix`, and `automated` labels are used by the [update-flake-lock](../.github/workflows/update-flake-lock.yml) workflow. Create them before the first scheduled run, or PR creation may fail. See [scripts/create-labels.sh](../scripts/create-labels.sh).

### 7. Allstar (optional)

**Install** the [Allstar app](https://github.com/apps/allstar-app) for continuous security policy enforcement. This repo includes `.allstar/` configs; create a `knirski/.allstar` repo from the [quickstart template](https://github.com/ossf/dot-allstar-quickstart) for org-level setup.

## Integration with homelab NixOS config

If you keep this as a submodule or vendored copy in your homelab config:

- **packages/paperless-ingestion-bot/default.nix** — Can use `builtins.fetchGit` or `builtins.fetchTarball` to pull from the published repo, or keep the path reference to `../../paperless/ingestion-bot` if the repo is a submodule.
- **flake.nix** — Add the ingestion-bot as a flake input and pass it to the Paperless module.

Example flake input:

```nix
inputs.paperless-ingestion-bot = {
  url = "github:knirski/paperless-ingestion-bot";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

Then use `inputs.paperless-ingestion-bot.packages.${system}.default` as `paperlessIngest`.
