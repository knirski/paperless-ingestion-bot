# GitHub App Setup for Auto-PR Creation

This guide walks you through setting up a GitHub App so that when an AI agent (or any tool) pushes a branch with the `ai/` prefix, a workflow automatically creates or updates a pull request **opened by the bot**. You can then approve it as the repo owner.

## Overview

1. **AI agent** (or terminal) pushes a branch (e.g. `ai/feature-x` or `ai/fix-y`)
2. **Workflow** runs on push to `ai/**` branches
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
   - **Contents**: Read and write
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

Create `.github/workflows/auto-pr.yml` with:

```yaml
name: Create PR from AI branch

on:
  push:
    branches:
      - 'ai/**'

concurrency:
  group: auto-pr-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write

jobs:
  create-pr:
    if: github.event.repository.fork != true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.ref_name }}
          fetch-depth: 0

      - name: Generate GitHub App token
        id: app-token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - name: Create or update pull request
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
        run: |
          BRANCH="${{ github.ref_name }}"
          DEFAULT="${{ github.event.repository.default_branch }}"
          OUTPUT=$(npx tsx scripts/fill-pr-body.ts "$DEFAULT" --format title-body)
          TITLE=$(echo "$OUTPUT" | head -1)
          if [ -z "$TITLE" ]; then
            echo "::error::PR title is empty. Add at least one conventional commit (e.g. feat: add X) before pushing."
            exit 1
          fi
          echo "$OUTPUT" | tail -n +3 > /tmp/pr-body.md
          if ! gh pr view --head "$BRANCH" 2>/dev/null; then
            gh pr create --base "$DEFAULT" --title "$TITLE" --body-file /tmp/pr-body.md
          else
            gh pr edit "$BRANCH" --title "$TITLE" --body-file /tmp/pr-body.md
          fi
```

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
| **Empty title** | Fails with clear error | Requires at least one conventional commit with non-empty subject. |
| **gh auth / rate limit** | Unclear errors possible | If token scope is wrong or rate limited, `gh` fails. Retry later or check app permissions. |
| **Token scope** | Requires `pull_requests: write` | App must have Pull requests: Read and write. |
| **fill-pr-body** | Base branch must exist | If default branch was renamed, pass correct base via `--base` or fix `origin/HEAD`. |
| **npmDepsHash** | CI cannot push to fork PRs | See [CONTRIBUTING](../CONTRIBUTING.md). Update locally: `nix run .#update-npm-deps-hash`. |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Workflow doesn't run | Ensure branch name matches `ai/**`; workflow skips on forks |
| "Resource not accessible" | Check app permissions (Contents, Pull requests: read & write) |
| "Secret not found" | Verify `APP_ID` and `APP_PRIVATE_KEY` in repo secrets |
| PR already exists | Workflow updates the PR title and body from the latest commits |

---

## How PR title and body are set

The workflow uses `scripts/fill-pr-body.ts` to parse conventional commits and fill the [PR template](../.github/PULL_REQUEST_TEMPLATE.md). See [PR template](PR_TEMPLATE.md).

| Section | Source |
|---------|--------|
| **Title** | First commit subject |
| **Description** | First commit body, or subject with conventional prefix stripped |
| **Type of change** | Inferred from conventional commit (`feat`→New feature, `fix`→Bug fix, `docs`→Documentation update, `chore`→Chore, `feat!`/`BREAKING`→Breaking change) |
| **Changes made** | One bullet per commit (commit subjects) |
| **How to test** | `N/A` for docs-only changes; otherwise `1. Run \`npm run check\`` + placeholder |
| **Checklist** | Auto-checks: conventional commits format, docs updated (if `*.md` changed), tests added (if test files changed) |
| **Related issues** | Extracted `Closes #123`, `Fixes #456` from commit messages |
| **Breaking changes** | Content after `BREAKING CHANGE:` in commit body (when type is Breaking change) |

The script is TypeScript (Effect, pure core + shell) for type safety, readability, and alignment with the project's FP style. Uses [conventional-commits-parser](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-commits-parser) for spec-aligned parsing.

## Testing

- **Script (pure logic):** Unit tests in `test/scripts/fill-pr-body.test.ts`
- **Script (git + output):** Integration test in `test/integration/fill-pr-body.integration.test.ts` (temp git repo)
- **Workflow:** No GitHub API mock exists. Validate by pushing to `ai/**` and checking Actions/PR

## Optional: Add labels

To tag auto-created PRs, add `--label "ai"` to the `gh pr create` command (requires an `ai` label in the repo).
