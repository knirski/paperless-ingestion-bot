# GitHub App Setup for Auto-PR Creation

This guide walks you through setting up a GitHub App so that when an AI agent (or any tool) pushes a branch with the `ai/` prefix, a workflow automatically creates or updates a pull request **opened by the bot**. PR titles are generated from conventional commits; for multi-commit PRs, local [Ollama](https://ollama.com/) summarizes commits into a conventional title and description (default model: `llama3.1:8b`, overridable via `OLLAMA_MODEL`). You can then approve the PR as the repo owner.

**Workflow:** Uses [knirski/auto-pr](https://github.com/knirski/auto-pr) reusable workflows. See [auto-pr INTEGRATION.md](https://github.com/knirski/auto-pr/blob/main/docs/INTEGRATION.md) for the canonical setup guide.

## Overview

1. **AI agent** (or terminal) pushes a branch (e.g. `ai/feature-x` or `ai/fix-y`)
2. **Workflow** runs on push to `ai/**` branches (for 1 semantic commit: uses its subject; for 2+: installs Ollama, pulls model, generates title)
3. **GitHub App** creates or updates the PR using its token
4. **PR** is opened by `your-app-name[bot]` → you can approve it

---

## Step 1: Create the GitHub App

1. Go to [github.com/settings/apps/new](https://github.com/settings/apps/new)
2. Fill in:
   - **GitHub App name**: e.g. `knirski-auto-pr-bot` (must be unique)
   - **Homepage URL**: Your repo URL, e.g. `https://github.com/knirski/paperless-ingestion-bot`
   - **Webhook**: Uncheck **Active** (we don't need webhooks)
3. Under **Repository permissions**:
   - **Contents**: Read and write (needed for release-please and nix pushes; GITHUB_TOKEN pushes do not trigger workflows)
   - **Pull requests**: Read and write
   - **Actions**: Read and write (required for nix and release-please; they trigger workflows via `gh workflow run`)
4. Under **Where can this GitHub App be installed?**: Choose **Only on this account**
5. Click **Create GitHub App**

---

## Step 2: Generate and Save the Private Key

1. On the app's settings page, scroll to **Private keys**
2. Click **Generate a private key**
3. A `.pem` file downloads — **keep it secure**. You'll need its contents for a secret.

---

## Step 3: Install the App on Your Repo

1. On the app settings page, click **Install App** in the left sidebar
2. Click **Install** next to your user/org
3. Choose **Only select repositories**
4. Select `paperless-ingestion-bot` (or your repo)
5. Click **Install**

---

## Step 4: Add Repository Secrets

1. Go to your repo: `https://github.com/knirski/paperless-ingestion-bot`
2. **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add two secrets:

| Secret name   | Value                                                                 |
|---------------|-----------------------------------------------------------------------|
| `APP_ID`      | Your app's **App ID** (from the app settings page, under "About")    |
| `APP_PRIVATE_KEY` | Full contents of the `.pem` file (including `-----BEGIN...` and `-----END...`) |

---

## Environment variables

Each script expects specific env vars. The workflow sets these automatically; for manual runs, set them yourself.

| Script | Required | Optional |
|--------|----------|----------|
| **auto-pr-get-commits** | `DEFAULT_BRANCH`, `GITHUB_WORKSPACE`, `GITHUB_OUTPUT` | — |
| **auto-pr-ollama** | `COMMITS`, `GITHUB_OUTPUT` | `OLLAMA_MODEL` (default: `llama3.1:8b`), `OLLAMA_URL` (default: `http://localhost:11434/api/generate`), `GITHUB_WORKSPACE` (default: `.`) |
| **create-or-update-pr** | `GH_TOKEN`, `BRANCH`, `DEFAULT_BRANCH`, `COMMITS`, `FILES` | `PR_TITLE` (when empty, uses first line of `semantic_subjects.txt`), `DESCRIPTION_FILE` (Ollama output path), `GITHUB_WORKSPACE` (default: `.`) |

---

## Step 5: Add the Workflow File

The workflow at [.github/workflows/auto-pr.yml](../.github/workflows/auto-pr.yml) uses [knirski/auto-pr](https://github.com/knirski/auto-pr) reusable workflows. It runs a check job first, then generate (commit parsing, Ollama for 2+ commits), then create (PR via GitHub App). The PR template is at [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) (see [PR template](PR_TEMPLATE.md)).

**Local scripts** (`scripts/auto-pr-get-commits.ts`, `scripts/auto-pr-ollama.ts`, `scripts/create-or-update-pr.ts`, `scripts/fill-pr-template.ts`) remain for local runs and tests; the CI workflow uses the auto-pr package.

---

## Step 6: Use the Right Branch Names

When creating changes (from any AI agent or terminal), use branch names that match the workflow:

- `ai/feature-name`
- `ai/fix-bug-description`

Or adjust the `branches` filter in the workflow to match your preferred prefix.

---

## Verification

**Workflow validation is manual.** There is no GitHub API mock for integration tests. To verify the workflow:

1. Create and push a branch:

   ```bash
   git checkout -b ai/test-setup
   git commit --allow-empty -m "chore: test auto-PR workflow"
   git push origin ai/test-setup
   ```

2. Check **Actions** in your repo — the workflow should run
3. A new PR should appear, opened by `your-app-name[bot]`
4. You can approve it as the repo owner

---

## Known limitations and edge cases

| Area | Limitation | Notes |
|------|------------|-------|
| **Forks** | Workflow does not run on forks | `if: github.event.repository.fork != true` skips the job. Pushing to `ai/**` on a fork creates no PR; create the PR to upstream manually. |
| **PR title length** | No enforced limit | Very long titles (>72 chars) may truncate in some UIs. Conventional commits typically stay short. |
| **Empty title** | Fails with clear error | Requires at least one non-merge commit with non-empty subject. |
| **All merge commits** | Fails with empty title | Branch with only merge commits (e.g. after merging base) yields no semantic commits; add at least one regular commit. |
| **gh auth / rate limit** | Unclear errors possible | Workflow retries `gh` up to 3 times with 5s delay. If token scope is wrong, retries won't help. |
| **Token scope** | Requires `pull_requests: write` | App must have Pull requests: Read and write. |
| **fill-pr-template** | Base branch must exist | The workflow passes the default branch to `create-or-update-pr.ts`. If renamed, update the workflow. |
| **Ollama model** | Overridable via repo var | Set repository variable `OLLAMA_MODEL` (e.g. `llama3.2`) to use a different model. Default: `llama3.1:8b`. |
| **Ollama URL** | Overridable via repo var | Set repository variable `OLLAMA_URL` for remote Ollama. Default: `http://localhost:11434/api/generate` (setup-ollama runs server on localhost). |
| **bun.nix** | CI cannot push to fork PRs | See [CONTRIBUTING](../CONTRIBUTING.md). Update locally: `nix run .#update-bun-nix`. |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Workflow doesn't run | Ensure branch name matches `ai/**`; workflow skips on forks |
| "Resource not accessible" | Check app permissions (Contents: Read and write, Pull requests: Read and write, Actions: Read and write) |
| "Secret not found" | Verify `APP_ID` and `APP_PRIVATE_KEY` in repo secrets |
| PR already exists | Workflow updates the PR title and body from the latest commits |
| Ollama returns invalid or odd title | Workflow validates with `fill-pr-template --validate-title`; falls back to first semantic commit subject after 3 attempts |

---

## How PR title and body are set

The workflow uses `scripts/fill-pr-template.ts` (invoked by `scripts/create-or-update-pr.ts`) to parse conventional commits and fill the [PR template](../.github/PULL_REQUEST_TEMPLATE.md). See [PR template](PR_TEMPLATE.md).

| Section | Source |
|---------|--------|
| **Title** | First semantic commit subject (1 semantic commit) or Ollama-generated (2+ semantic commits); falls back to first semantic commit if Ollama fails or is skipped. Merge commits and blank lines are filtered before counting. |
| **Description** | For 1 commit: first commit body (or subject after colon). For 2+ commits: Ollama summarizes all commit bodies; fallback to concatenated bodies if Ollama fails |
| **Type of change** | Inferred from conventional commit (`feat`→New feature, `fix`→Bug fix, `docs`→Documentation update, `chore`→Chore, `feat!`/`BREAKING`→Breaking change); non-conventional commits fall back to Chore. |
| **Changes made** | One bullet per non-merge commit (merge commits filtered; non-conventional included) |
| **How to test** | `N/A` for docs-only changes; otherwise `1. Run \`npm run check\`` + placeholder |
| **Checklist** | Auto-checks: conventional commits format, docs updated (if `*.md` changed), tests added (if test files changed) |
| **Related issues** | Extracted `Closes #123`, `Fixes #456` from commit messages |
| **Breaking changes** | Content after `BREAKING CHANGE:` in commit body (when type is Breaking change) |

The script is TypeScript (Effect, pure core + shell) for type safety, readability, and alignment with the project's FP style. Uses [conventional-commits-parser](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-commits-parser) for spec-aligned parsing.

## Testing

- **Script:** Unit tests in `test/scripts/fill-pr-template.test.ts` (pure logic + runFillBody file-based pipeline)
- **Workflow:** No GitHub API mock exists. Validate by pushing to `ai/**` and checking Actions/PR

## Optional: Add labels

To tag auto-created PRs, add `--label "ai"` to the `gh pr create` command in [scripts/create-or-update-pr.ts](../scripts/create-or-update-pr.ts) (requires an `ai` label in the repo).
