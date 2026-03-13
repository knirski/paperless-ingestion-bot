# GitHub CI Scripts

Shell scripts used by GitHub Actions workflows. Kept separate from general-purpose scripts in `scripts/`. All scripts run from the repository root (workspace).

**Merge commit filter:** Lines matching `^Merge ` (case-insensitive) are excluded. Keep in sync: `auto-pr-get-commits.sh` (grep) and `scripts/fill-pr-body.ts` (`isMergeCommit`).

| Script | Purpose | Used by |
|--------|---------|---------|
| **auto-pr-get-commits.sh** | Get commit log, filter semantic commits (exclude merge/blank), output paths and count | auto-pr.yml |
| **auto-pr-set-title.sh** | Set PR title from first semantic commit (1) or Ollama (2+). Sanitizes output, truncates to 72 chars, retries Ollama 3×. `OLLAMA_MODEL` env overridable. | auto-pr.yml |
| **create-or-update-pr.sh** | Create or update PR with fill-pr-body output | auto-pr.yml |
