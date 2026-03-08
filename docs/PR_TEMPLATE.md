# PR Template

A single template at [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) serves both manual and automated PR creation.

## Usage

| Mode | How |
|------|-----|
| **Manual** | GitHub shows the template when creating a PR. Replace each `{{placeholder}}` with your content. |
| **Automated** | `npx tsx scripts/fill-pr-body.ts [base]` reads the template, replaces placeholders, outputs to stdout. Use `--format title-body` for first line = PR title. With `--ai-title` and multiple commits, the title is generated via Ollama. |

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

- **Base branch:** Optional positional arg. Omitted → inferred from `git rev-parse --abbrev-ref origin/HEAD` (falls back to `main` if no remote).
- **`--template PATH`:** Override template file. Order-independent (e.g. `main --template x` or `--template x main`).
- **`--format title-body`:** Output first line = PR title, blank line, then body. Title = first commit subject (single commit) or Ollama-generated (multiple commits with `--ai-title`). Used by [auto-PR workflow](../.github/workflows/auto-pr.yml).
- **`--ai-title`:** Generate PR title via Ollama when there are multiple commits. Skips Ollama for a single commit; falls back to first commit subject on failure.
- **`--quiet`:** Suppress logs (for CI when capturing stdout).
- **`--ollama-url URL`:** Ollama base URL (default: `http://localhost:11434`).
- **`--ollama-model MODEL`:** Ollama model for title generation (default: `llama3.1:8b`).

### Template path

- **Default:** `.github/PULL_REQUEST_TEMPLATE.md` relative to git root.
- **With `--template`:** Relative paths resolved from repo root; absolute paths used as-is.

### Base branch fallback

If the base branch doesn't exist locally, the script tries `origin/<base>` (e.g. `origin/main`).

### title-body format requirements

With `--format title-body`, the script fails if there are no commits or the first commit has an empty subject. The auto-PR workflow requires at least one non-merge commit with non-empty subject (e.g. `feat: add X`) before pushing.

### Substitution

- Plain string replacement: `{{placeholder}}` → value.
- **Escaping:** Literal `{{` and `}}` in commit content are preserved.
- **Empty values:** `{{relatedIssues}}` and `{{breakingChanges}}` when empty → empty string (no extra blank lines).
- **Unreplaced warning:** If output still contains `{{` after substitution, a warning is logged to stderr (e.g. typos like `{{desciption}}`).

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
