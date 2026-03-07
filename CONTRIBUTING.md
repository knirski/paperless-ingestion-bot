# Contributing

Thanks for your interest in contributing to Paperless Ingestion Bot.

## Development Setup

```bash
git clone https://github.com/knirski/paperless-ingestion-bot.git
cd paperless-ingestion-bot
npm install && npm run build
```

See [README.md](README.md) for runtime requirements and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for project structure.

## Commits

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/). This is enforced locally via [commitlint](https://commitlint.js.org/) (husky hook) and in CI.

Examples:

- `feat: add support for X`
- `fix: resolve Y when Z`
- `docs: update README`
- `chore: bump dependency`

## Pull Requests

1. Run `npm run check` before submitting.
2. Ensure your commits follow Conventional Commits (the PR template includes a checklist).
3. Update documentation if your changes affect user-facing behavior.

## Good First Issues

Issues labeled `good first issue` are suitable for newcomers: they have clear scope, acceptance criteria, and links to relevant code. If you're new to the project, start there.

## Code Style

The project uses [oxlint](https://oxc-project.github.io/docs/linter/) and [oxfmt](https://oxc-project.github.io/docs/formatter/) for linting and formatting. Run `npm run lint:fix` to auto-fix issues.
