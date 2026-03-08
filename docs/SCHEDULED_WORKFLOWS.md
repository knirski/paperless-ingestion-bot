# Scheduled Workflows

This repo uses GitHub Actions scheduled workflows (cron). They run only from the **default branch** of the repository.

## Enable Scheduled Workflows

Scheduled workflows are **disabled by default** for new repositories and forks. You must enable them in GitHub Settings.

### Steps

1. Go to your repository on GitHub.
2. **Settings** → **Actions** → **General**.
3. Under **Actions permissions**, ensure **Allow all actions and reusable workflows** (or at least allow the actions used by the workflows).
4. Under **Fork pull request workflows from outside collaborators**, choose your preference (e.g. **Require approval for first-time contributors**).
5. Scroll to **Workflow permissions**.
6. Ensure **Read and write permissions** is selected if workflows need to push (e.g. update-flake-lock creates PRs).
7. **Save** if you changed anything.

### Enable the schedule trigger

1. **Settings** → **Actions** → **General**.
2. Find **Scheduled workflows** (or **Allow scheduled workflows**).
3. If you see an option to enable scheduled workflows, turn it **on**.
4. **Save**.

> **Note:** As of 2024, GitHub enables scheduled workflows by default for most repos. If your `update-flake-lock` workflow does not run on schedule, check:
> - The default branch is `main` (or whatever branch contains the workflow file).
> - Actions are enabled for the repo.
> - The workflow file is on the default branch (not only on a feature branch).

## Before First update-flake-lock Run

Create the labels used by the workflow (otherwise PR creation may fail):

```bash
./scripts/create-labels.sh
```

Requires [gh CLI](https://cli.github.com/) authenticated to the repo. See also [PUBLICATION_CHECKLIST.md](PUBLICATION_CHECKLIST.md#6-labels-optional).

## Workflows That Use Schedule

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| [update-flake-lock.yml](../.github/workflows/update-flake-lock.yml) | `0 0 * * 0` (Sundays 00:00 UTC) | Updates `flake.lock` and opens a PR |

## Manual Trigger

You can run scheduled workflows manually:

1. **Actions** tab → select the workflow (e.g. **Update flake.lock**).
2. Click **Run workflow**.
3. Choose the branch (usually `main`) and run.

## Troubleshooting

- **Workflow never runs on schedule:** Ensure the workflow file is on the default branch. Schedules are evaluated from the default branch only.
- **Workflow runs but fails:** Check the run logs. Common issues: missing labels (`dependencies`, `nix`, `automated`), insufficient permissions, or `GITHUB_TOKEN` restrictions in org settings.
- **Forked repos:** Scheduled workflows do not run on forks. They run only on the upstream repo’s default branch.
