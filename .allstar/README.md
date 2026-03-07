# Allstar Configuration

This repository is configured for [Allstar](https://github.com/ossf/allstar), an OpenSSF GitHub App that enforces security policies.

## Installation

1. Install the [Allstar app](https://github.com/apps/allstar-app) on your account or organization.
2. For personal accounts: create a `.allstar` repo (e.g. `knirski/.allstar`) using the [quickstart template](https://github.com/ossf/dot-allstar-quickstart).
3. These repo-level configs in `.allstar/` provide policy preferences when Allstar runs on this repository (when repo override is enabled).

## Policies

The policy files in this directory enable Allstar checks with `action: issue` — violations will create GitHub issues for maintainers to address.

- `secret_scanning` — Ensures GitHub secret scanning and push protection remain enabled.
