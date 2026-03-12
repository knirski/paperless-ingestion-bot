# GitHub App Setup for Auto-PR Creation

This guide walks you through setting up a GitHub App so that when an AI agent (or any tool) pushes a branch with the `ai/` prefix, a workflow automatically creates or updates a pull request **opened by the bot**. PR titles are generated from conventional commits; for multi-commit PRs, local [Ollama](https://ollama.com/) (llama3.1:8b) summarizes commits into a conventional title. You can then approve the PR as the repo owner.

## Overview

1. **AI agent** (or terminal) pushes a branch (e.g. `ai/feature-x` or `ai/fix-y`)
2. **Workflow** runs on push to `ai/**` branches (installs Ollama, pulls model, generates title)
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
   - **Contents**: Read
   - **Pull requests**: Read and write
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

## Step 5: Add the Workflow File

Copy from this repository: [.github/workflows/auto-pr.yml](../.github/workflows/auto-pr.yml), [scripts/create-or-update-pr.sh](../scripts/create-or-update-pr.sh), and [scripts/fill-pr-body.ts](../scripts/fill-pr-body.ts). The workflow uses the PR template at [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) (see [PR template](PR_TEMPLATE.md) for details).

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
| **fill-pr-body** | Base branch must exist | The workflow passes the default branch to `create-or-update-pr.sh`. If renamed, update the workflow. |
| **npmDepsHash** | CI cannot push to fork PRs | See [CONTRIBUTING](../CONTRIBUTING.md). Update locally: `nix run .#update-npm-deps-hash`. |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Workflow doesn't run | Ensure branch name matches `ai/**`; workflow skips on forks |
| "Resource not accessible" | Check app permissions (Contents: Read, Pull requests: Read and write) |
| "Secret not found" | Verify `APP_ID` and `APP_PRIVATE_KEY` in repo secrets |
| PR already exists | Workflow updates the PR title and body from the latest commits |

---

## How PR title and body are set

The workflow uses `scripts/fill-pr-body.ts` to parse conventional commits and fill the [PR template](../.github/PULL_REQUEST_TEMPLATE.md). See [PR template](PR_TEMPLATE.md).

| Section | Source |
|---------|--------|
| **Title** | First commit subject (1 commit) or Ollama-generated (2+ commits); falls back to first commit if Ollama fails or is skipped |
| **Description** | First commit body, or subject with conventional prefix stripped |
| **Type of change** | Inferred from conventional commit (`feat`→New feature, `fix`→Bug fix, `docs`→Documentation update, `chore`→Chore, `feat!`/`BREAKING`→Breaking change); non-conventional commits fall back to Chore. |
| **Changes made** | One bullet per non-merge commit (merge commits filtered; non-conventional included) |
| **How to test** | `N/A` for docs-only changes; otherwise `1. Run \`npm run check\`` + placeholder |
| **Checklist** | Auto-checks: conventional commits format, docs updated (if `*.md` changed), tests added (if test files changed) |
| **Related issues** | Extracted `Closes #123`, `Fixes #456` from commit messages |
| **Breaking changes** | Content after `BREAKING CHANGE:` in commit body (when type is Breaking change) |

The script is TypeScript (Effect, pure core + shell) for type safety, readability, and alignment with the project's FP style. Uses [conventional-commits-parser](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-commits-parser) for spec-aligned parsing.

## Testing

- **Script:** Unit tests in `test/scripts/fill-pr-body.test.ts` (pure logic + runFillBody file-based pipeline)
- **Workflow:** No GitHub API mock exists. Validate by pushing to `ai/**` and checking Actions/PR

## Optional: Add labels

To tag auto-created PRs, add `--label "ai"` to the `gh pr create` command in [scripts/create-or-update-pr.sh](../scripts/create-or-update-pr.sh) (requires an `ai` label in the repo).
