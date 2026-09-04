# ISBN to Zotero

ISBN to Zotero is an edition-aware, human-governed ISBN resolver for Indonesian and older books. It validates the identifier, keeps catalogue disagreements visible, separates edition from printing/cetakan, and lets the user review the physical book before producing RIS or attempting a local Zotero write.

Author: **Dr. Toronata Tambun**

## Release status

This repository contains the **experimental v1.2 local source candidate**,
**sanitized Mobile version 8 and Mac version 3 reference editions**, and their
tests. It is published for review, teaching, and continued development.

- No compiled macOS application, installer, or other downloadable binary is included or approved for distribution.
- The desktop candidate has not completed Zotero 10 acceptance with a disposable profile, Developer ID signing, notarization, or clean-Mac testing.
- The exact production checkouts remain private and immutable. The public
  `mobile/` and `mac/` trees are reviewed derivatives with production Sites
  registrations removed; see [Sites source baselines](docs/SITES-BASELINES.md).
- This source repository is not connected to, and cannot update, any production Site.

## What v1.2 repairs

1. Generates conforming 32-character Zotero write tokens.
2. Represents edition and printing/cetakan separately.
3. Enforces physical-book confirmation in the server before review records can be exported or written.
4. Requires agreement from distinct catalogue sources before assigning high confidence.
5. Detects likely legacy Zotero duplicates even when an existing item has no ISBN.
6. Resolves embedded desktop assets independently of the launch directory.
7. Uses Open Library as the only default catalogue, with identification, pacing, and a one-day cache.
8. Keeps Indonesia OneSearch disabled by default and Google Books outside the combined result view.

## Repository layout

| Path | Purpose |
| --- | --- |
| `python/` | Standard-library Python implementation, browser interface, CLI, and tests |
| `desktop/` | TypeScript/Bun implementation, tests, and experimental macOS build scripts |
| `mobile/` | Sanitized Mobile v8 reference source, barcode workflow, Web API integration, and tests |
| `mac/` | Sanitized Mac v3 Site source, ISBN and title-recovery workflows, Web API integration, and tests |
| `docs/` | Architecture, workflows, testing, verified Sites baselines, and deployment boundaries |
| `scripts/` | Repository policy and pre-publication credential checks |

## Run and test

Python requires Python 3.10 or later and has no runtime package dependencies:

```sh
cd python
python3 -m unittest discover -s tests -v
python3 start.py
```

The desktop source uses Bun 1.3.14 and TypeScript 7.0.2:

```sh
cd desktop
bun install --frozen-lockfile
bun run typecheck
bun test
bun build src/server.ts --target bun --outdir dist/bundle-check
```

The optional live-catalogue Python test is skipped unless explicitly enabled. Deterministic tests use fixtures and local simulated services; they do not write to a normal Zotero library.

The Mobile and Mac Site references require Node.js 22.13 or later and npm 11
or later. Their bounded helper scripts target Linux:

```sh
cd mobile
npm run install:ci
npm test
npm run lint

cd ../mac
npm run install:ci
npm test
npm run lint
```

See [`mobile/README.md`](mobile/README.md) and [`mac/README.md`](mac/README.md)
before entering a Zotero Web API key or preparing a separate deployment.

## Catalogue and recovery order

Indonesia OneSearch, Open Library, and Google Books are automatic catalogue
adapters. Perpusnas is not: it is a separate browser check shown only after a
valid ISBN produces no automatic candidate. Check Perpusnas first, then
WorldCat if Perpusnas has no record. Neither browser result is imported
automatically.

The normal recovery route is to copy the exact title from Perpusnas or
WorldCat and continue with title search in the Mac Site reference. WorldCat
RIS import is an exceptional final option, not the standard route.

## Safety and data policy

- The physical book is the authority for title-page, responsibility, edition, printing, date, and extent decisions.
- Missing bibliographic facts remain blank rather than being guessed.
- The application listens on `127.0.0.1` by default.
- Open Library receives only the searched ISBN and, when configured, a public support contact in the client identity.
- Zotero permission is requested at runtime. The Mobile reference accepts a user-provided Web API key and can remember it in private-device browser storage only when the user chooses that option. The repository contains no Zotero credential, API key, Site identifier, portrait, private link, or production deployment binding.
- In the maintained local v1.2 candidate, Indonesia OneSearch remains an authorized opt-in pending a supported access method or permission, and Google Books remains excluded from the combined view. The two Site references preserve their separately tested three-catalogue automatic workflow and their distinct Mobile and Mac identities.

See [Architecture](docs/ARCHITECTURE.md), [Workflows](docs/WORKFLOWS.md), [Testing](docs/TESTING.md), [Security](SECURITY.md), and [Publication boundaries](docs/PUBLICATION-BOUNDARIES.md).

## License

The project source is offered under the [MIT License](LICENSE). Third-party components and services retain their own licenses and terms; see [Third-Party Notices](THIRD-PARTY-NOTICES.md).
