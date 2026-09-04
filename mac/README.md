# ISBN to Zotero Mac Site

This directory contains a sanitized, source-only reference edition derived
from the verified Mac version 3 Sites source. It supports the normal ISBN
workflow and the Mac recovery workflow for books with no usable ISBN or no
automatic catalogue candidate.

The exact production checkout remains private and immutable. This public copy
deliberately omits its Sites project registration and production deployment
metadata. It is not connected to, and cannot update, the working production
site.

## Recovery workflow

Automatic lookups use Indonesia OneSearch, Open Library, and Google Books.
When a valid ISBN produces no automatic candidate:

1. Open the separate Perpusnas ISBN browser check.
2. If Perpusnas has a record, note its exact title and return here.
3. Choose **No ISBN** and search by the exact title.
4. Check WorldCat only if Perpusnas has no record.
5. Treat WorldCat RIS import as an exceptional final option.

Perpusnas and WorldCat are browser checks, not automatic metadata adapters.
Their records are not imported automatically. The physical book remains the
authority, and verified physical-book transcription remains available when no
catalogue candidate matches.

## Requirements

- Node.js 22.13 or later
- npm 11 or later
- Linux with `flock`, `curl`, and GNU `timeout` when using the bounded helper
  scripts

## Install and test

```sh
cd mac
npm run install:ci
npm test
npm run lint
```

The helper scripts use project-local cache and runtime directories. They were
written for the Linux build environment used by Sites; on macOS, run the
equivalent locked install and Vinext commands in a suitable development
environment.

## Zotero key and privacy

The repository contains no Zotero credential. A user may enter a personal
Zotero Web API key at runtime. The key is sent over HTTPS through the deployed
application's server route to Zotero for account checks, collection lookup,
duplicate detection, filing an existing item, and item creation. The route
does not persist it.

Anyone operating a hosted copy controls that server environment. Only enter a
key into a deployment you trust, use HTTPS, and revoke the key if necessary.

## Deployment boundary

The public source does not track `.openai/hosting.json`. A deployment owner may
create that file privately through a separate Sites project. Never commit a
production project identifier, API key, environment file, or ordinary Zotero
library data.
