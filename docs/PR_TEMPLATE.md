# PR Template

A single template at [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) is shown when creating a PR on GitHub.

## Usage

Replace each `{{placeholder}}` with your content when creating a PR manually.

## Placeholders

| Placeholder | Meaning |
|------------|---------|
| `{{description}}` | What the PR does and why (context, not just title restatement) |
| `{{typeOfChange}}` | Bug fix, New feature, Breaking change, Documentation update, or Chore |
| `{{changes}}` | Bullet list of specific changes |
| `{{howToTest}}` | Step-by-step for reviewers; use "N/A" for docs-only |
| `{{checklistConventional}}` | `x` or ` ` (space) |
| `{{checklistDocs}}` | `x` or ` ` (space) |
| `{{checklistTests}}` | `x` or ` ` (space) |
| `{{relatedIssues}}` | `Closes #123` etc. to auto-close on merge |
| `{{breakingChanges}}` | Impact and migration when applicable |

## Checklist

The "I have run `bun run check`" box has no placeholder — check it when done.
