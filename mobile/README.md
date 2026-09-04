# ISBN to Zotero Mobile

This directory contains a sanitized, source-only reference edition derived
from the verified Mobile version 8 Sites source. It scans or accepts
an ISBN, reconciles catalogue results, keeps edition disagreements visible,
checks Zotero for likely duplicates, and can create or file the reviewed book
in a personal Zotero library.

The exact production checkout remains private and immutable. This public copy
deliberately omits its Sites project registration and production deployment
metadata. It is not connected to, and cannot update, the working production
site.

## Requirements

- Node.js 22.13 or later
- npm 11 or later
- Linux with `flock`, `curl`, and GNU `timeout` when using the bounded helper
  scripts

## Install and test

```sh
cd mobile
npm run install:ci
npm test
npm run lint
```

The helper scripts use a project-local cache and runtime directory. They were
written for the Linux build environment used by Sites; on macOS, run the
equivalent locked install and Vinext commands in a suitable development
environment.

## Zotero key and privacy

The repository contains no Zotero credential. A user may enter a personal
Zotero Web API key at runtime. The key is sent over HTTPS through the deployed
application's server route to Zotero for account checks, collection lookup,
duplicate detection, and item creation. The route does not persist it.

**Remember on this iPhone** is off by default in this public edition. If it is
selected, Safari stores the key in that browser's local storage until **Remove
saved connection** is used or the site data is cleared. Use this only on a
private device. A key needs personal-library read and write access; grant no
group access that the application does not need. Keys can be revoked from
Zotero account settings.

Anyone operating a hosted copy controls that server environment. Only enter a
key into a deployment you trust and use HTTPS.

## Deployment boundary

The public source does not track `.openai/hosting.json`. A deployment owner may
create that file privately through their own Sites project. Never commit a
production project identifier, API key, environment file, or ordinary Zotero
library data.

## External services

Automatic runtime lookups can contact Indonesia OneSearch, Open Library, and
Google Books. When those adapters return no candidate for a valid ISBN, the UI
offers a separate Perpusnas browser check using the ISBN database's exact
search URL, followed by WorldCat only if Perpusnas has no record. Neither
browser page imports metadata automatically. The normal recovery route is to
note the exact title and continue with title search in ISBN to Zotero Mac.
WorldCat RIS import is an exceptional final option.

Direct library operations use the Zotero Web API. Service availability and
returned metadata remain outside this repository; the physical book remains
the authority for edition decisions.
