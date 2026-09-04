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
| Node.js | 22.13+ | Runtime for the Mobile and Mac Site reference builds and tests | MIT |
| React and React DOM | 19.2.6 | Mobile and Mac Site reference interfaces | MIT |
| Next.js | 16.2.6 | Mobile and Mac Site reference application framework | MIT |
| Vinext | 0.0.50 | Vite-compatible Next.js runtime | MIT |
| `@zxing/browser` | 0.2.1 | In-browser barcode scanning | MIT |
| Lucide React | 1.31.0 | Interface icons | ISC |

Upstream license sources:

- Bun: <https://github.com/oven-sh/bun/blob/main/LICENSE.md>
- TypeScript: <https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt>
- DefinitelyTyped: <https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE>
- Undici: <https://github.com/nodejs/undici/blob/main/LICENSE>
- Python: <https://docs.python.org/3/license.html>
- Node.js: <https://github.com/nodejs/node/blob/main/LICENSE>
- React: <https://github.com/facebook/react/blob/main/LICENSE>
- Next.js: <https://github.com/vercel/next.js/blob/canary/license.md>
- Vinext: <https://github.com/cloudflare/vinext/blob/main/LICENSE>
- ZXing browser: <https://github.com/zxing-js/browser/blob/master/LICENSE>
- Lucide: <https://github.com/lucide-icons/lucide/blob/main/LICENSE>

The lockfile is the authoritative dependency version inventory. Recheck this notice after every lockfile or runtime update.

## Binary-distribution requirement

The experimental desktop build can compile the Bun runtime into a standalone executable. Any future binary distribution must include `desktop/THIRD-PARTY-NOTICES.txt`, preserve all applicable upstream notices, and pass a new dependency and license review. No such binary is distributed by this repository.

## External services

The project can communicate with Indonesia OneSearch, Open Library, Google
Books, Perpusnas ISBN, WorldCat, the Zotero local API, and the Zotero Web API. These services,
APIs, and returned data are governed by their own terms; the project’s MIT
License does not license third-party data or services.

- Open Library API and data licensing: <https://openlibrary.org/developers/api> and <https://openlibrary.org/developers/licensing>
- Zotero local API: <https://www.zotero.org/support/dev/web_api/v3/local_api>
- Zotero Web API: <https://www.zotero.org/support/dev/web_api/v3/start>
- Google Books API terms and branding: <https://developers.google.com/books/terms> and <https://developers.google.com/books/branding>
- Perpusnas ISBN catalogue: <https://isbn.perpusnas.go.id/>
- WorldCat terms: <https://www.oclc.org/en/policies.html>
