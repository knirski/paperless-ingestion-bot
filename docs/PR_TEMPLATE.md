# PR Template

A single template at [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) serves both manual and automated PR creation.

## Usage

| Mode | How |
|------|-----|
| **Manual** | GitHub shows the template when creating a PR. Replace each `{{placeholder}}` with your content. |
| **Automated** | `npx tsx scripts/fill-pr-body.ts --log-file <path> --files-file <path>` reads the template, replaces placeholders, outputs to stdout. The workflow or `create-or-update-pr.sh` generates these files via git. Use `--format title-body` for first line = PR title (first commit subject). The workflow uses [ollama-action](https://github.com/ai-action/ollama-action) for AI-generated titles. |

## Placeholders

| Placeholder | Source |
|------------|--------|
| `{{description}}` | First commit body (or subject after colon if body starts with Closes/Fixes); max 20 lines |
| `{{typeOfChange}}` | Inferred from conventional commits |
| `{{changes}}` | One bullet per commit subject |
| `{{howToTest}}` | `N/A` for docs-only, else `1. Run \`npm run check\`\n2. ` |
| `{{checklistConventional}}` | `x` or ` ` |
| `{{checklistDocs}}` | `x` or ` ` |
| `{{checklistTests}}` | `x` or ` ` |
| `{{relatedIssues}}` | `Closes #123` etc. from commits |
| `{{breakingChanges}}` | `BREAKING CHANGE:` note when applicable |

## Script

Uses `effect/unstable/cli` (Command, Argument, Flag) like the main project CLI.

### Arguments

- **`--log-file PATH`:** (Required) Path to file containing commit log. Format: `---COMMIT---`-separated blocks (subject + body per commit). Generate via `git log --format="---COMMIT---%n%s%n%n%b" base..HEAD`.
- **`--files-file PATH`:** (Required) Path to file containing newline-separated changed file names. Generate via `git diff --name-only base..HEAD`.
- **`--template PATH`:** Override template file. Default: `.github/PULL_REQUEST_TEMPLATE.md` relative to cwd.
- **`--format title-body`:** Output first line = PR title, blank line, then body. Title = first commit subject. The [auto-PR workflow](../.github/workflows/auto-pr.yml) uses `--format body` (title from workflow: first commit for 1 commit, ollama-action for 2+ commits).
- **`--quiet`:** Suppress logs (for CI when capturing stdout).

### Template path

- **Default:** `.github/PULL_REQUEST_TEMPLATE.md` relative to current working directory.
- **With `--template`:** Relative paths resolved from cwd; absolute paths used as-is.

### title-body format requirements

With `--format title-body`, the script fails if there are no commits or the first commit has an empty subject. The auto-PR workflow requires at least one non-merge commit with non-empty subject (e.g. `feat: add X`) before pushing.

### Substitution

- Plain string replacement: `{{placeholder}}` → value.
- **Escaping:** Literal `{{` and `}}` in commit content are preserved.
- **Empty values:** `{{relatedIssues}}` and `{{breakingChanges}}` when empty → empty string (no extra blank lines).
- **Unreplaced warning:** If output still contains `{{` after substitution, a warning is logged to stderr.

## Behavior

- **Merge commits:** Filtered from body and title input (subjects like `Merge branch 'x' into y` add no semantic value).
- **Non-conventional commits:** Included in body and as Ollama input; type falls back to "Chore".
- **Docs-only:** `isDocsOnly(files)` when `files.length === 0`. PR with commits but no file changes gets `howToTest: "N/A"`.
- **Checklist:** The "I have run `npm run check`" box has no placeholder — always unchecked. By design.
- **Cross-repo refs:** `owner/repo#123` format supported; deduplicated and sorted.

## Implementation notes

- **Git format:** Commit log uses `---COMMIT---` delimiter (`git log --format=---COMMIT---%n%s%n%b`). Changing this breaks parsing.
- **Description:** First 20 lines of commit body. PR description is a summary.
- **Breaking changes:** Truncated at 2000 chars.
