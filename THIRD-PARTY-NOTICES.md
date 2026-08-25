# Third-Party Notices

This repository contains source code only. It does not distribute a compiled macOS application or vendored dependency directory.

## Development and build components

| Component | Version | Use | License |
| --- | ---: | --- | --- |
| Bun and `bun-types` | 1.3.14 | TypeScript runtime, test runner, compiler, and type definitions | MIT |
| TypeScript | 7.0.2 | Development compiler | Apache-2.0 |
| `@types/node` | 26.2.0 | Development type definitions | MIT |
| `undici-types` | 8.3.0 | Transitive development type definitions | MIT |
| Python | 3.10+ | Runtime for the Python implementation | Python Software Foundation License |

Upstream license sources:

- Bun: <https://github.com/oven-sh/bun/blob/main/LICENSE.md>
- TypeScript: <https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt>
- DefinitelyTyped: <https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE>
- Undici: <https://github.com/nodejs/undici/blob/main/LICENSE>
- Python: <https://docs.python.org/3/license.html>

The lockfile is the authoritative dependency version inventory. Recheck this notice after every lockfile or runtime update.

## Binary-distribution requirement

The experimental desktop build can compile the Bun runtime into a standalone executable. Any future binary distribution must include `desktop/THIRD-PARTY-NOTICES.txt`, preserve all applicable upstream notices, and pass a new dependency and license review. No such binary is distributed by this repository.

## External services

The project can communicate with Open Library and the local Zotero API. A dormant Google Books adapter and a disabled-by-default Indonesia OneSearch adapter are retained in source. These services, APIs, and returned data are governed by their own terms; the project’s MIT License does not license third-party data or services.

- Open Library API and data licensing: <https://openlibrary.org/developers/api> and <https://openlibrary.org/developers/licensing>
- Zotero local API: <https://www.zotero.org/support/dev/web_api/v3/local_api>
- Google Books API terms and branding: <https://developers.google.com/books/terms> and <https://developers.google.com/books/branding>

Indonesia OneSearch remains disabled in the public configuration until a supported access method or permission is documented.
