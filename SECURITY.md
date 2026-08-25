# Security Policy

## Supported code

Only the source on the current public branch is maintained. No downloadable application binary is supported or distributed from this repository.

## Reporting a vulnerability

Please use GitHub’s private vulnerability-reporting feature when it is enabled for the public repository. Do not include real Zotero keys, Site identifiers, private URLs, or personal library records in an issue.

## Sensitive-data rules

- Never commit `.env` files, credentials, API keys, private keys, production hosting manifests, recovery archives, or normal Zotero library data.
- Use synthetic records in tests.
- Keep the local HTTP service bound to `127.0.0.1`.
- Treat every external catalogue response as untrusted input.
- Use a disposable Zotero profile for real integration acceptance.
- Preserve the exact Mobile production recovery archive only in restricted storage.

The repository policy script runs in CI and checks tracked files for prohibited deployment bindings, private-link patterns, distributables, and common credential formats.
