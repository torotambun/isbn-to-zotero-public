# Mobile Version 7 Baseline

## Decision

The exact Mobile version 7 recovery archive remains **private and immutable**.
This repository now includes a separately reviewed public derivative under
`mobile/`.

The private recovery archive includes the production hosting manifest and the
complete seven-commit source history. Publishing it unchanged would expose
production metadata. Redacting that archive would make it no longer exact, so
it remains in restricted storage for provenance and comparison.

The `mobile/` directory is a source-only derivative of the recovered head
commit. Its production Sites manifest and project identifier are absent, its
build accepts that intentional omission, and its documentation explains the
runtime Zotero-key trust boundary. It cannot update the live Site.

## What can be stated publicly

- The working Mobile workflow is field-proven through more than 400 successful book saves reported by its owner.
- It sends a selected record directly to Zotero using a write-enabled credential provided by the user at runtime.
- No credential was embedded in the recovered source.
- The production Mobile Site was not edited, republished, disconnected, or otherwise changed during recovery or public-readiness work.
- This repository contains no production hosting registration and does not
  deploy or update the live Site.

## Public Mobile boundary

A user may provide a Zotero Web API key at runtime. The application server uses
it transiently for Zotero requests and does not persist it. If the user selects
the remember option, the browser stores it locally on that device. The public
README warns users to trust the deployment operator, use HTTPS, grant only the
needed personal-library permissions, and revoke the key if necessary.

The sanitized derivative must never replace or modify the preserved production
baseline merely to make publication easier.
