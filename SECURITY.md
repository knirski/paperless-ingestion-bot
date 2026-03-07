# Security Policy

## Supported Versions

Security updates are provided for the latest major version. Older major versions may receive critical security fixes at the maintainer's discretion.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

If you believe you have found a security vulnerability, please report it privately:

1. **GitHub Private Vulnerability Reporting** — Use the "Report a vulnerability" button on the Security tab of this repository. This creates a private advisory and notifies maintainers.

2. **Alternative** — Open a new issue and add the `security` label. Do not include sensitive details in the issue body; describe that you have a security report and request private contact.

Please include as much of the following as possible:

- Type of issue (e.g. credential exposure, injection, path traversal)
- Full paths of affected source files
- Location of affected code (tag, branch, or commit)
- Steps to reproduce
- Impact and potential attack vectors
- Proof-of-concept or exploit code (if available)

We will acknowledge receipt within 48 hours and provide an initial assessment within 7 days.

## Security Considerations

This project handles:

- **Credentials** — Gmail app passwords, Signal API access. Stored via keytar (system keychain) or file-based fallback. Run as a dedicated user with minimal permissions.
- **Document ingestion** — Files are written to a consume directory. Ensure the consume path is not world-writable.
- **Webhook** — The Signal webhook receives HTTP requests. Run behind a reverse proxy or firewall; do not expose directly to the internet without authentication.

See [README.md](README.md#security) for configuration guidance.
