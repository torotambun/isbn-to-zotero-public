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

## Mobile Web API key

The public Mobile reference does not include a Zotero key. A key entered at
runtime passes through the deployment's server route to Zotero and is not
persisted by that route. Browser storage is optional and off by default in the
public edition. Only use it on a private device, only with a deployment operator
you trust, and only over HTTPS.

Grant personal-library read and write access only. Do not grant group access or
other permissions the workflow does not need. If a device or deployment is no
longer trusted, remove the saved connection and revoke the key in Zotero account
settings.

The repository policy script runs in CI and checks tracked files for prohibited deployment bindings, private-link patterns, distributables, and common credential formats.
