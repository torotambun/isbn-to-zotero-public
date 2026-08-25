# Testing

## Current deterministic results

| Check | Expected result |
| --- | --- |
| Python suite | 23 pass; one optional live-catalogue test skipped |
| TypeScript/Bun suite | 19 pass |
| TypeScript strict type check | Pass |
| TypeScript production bundle | Pass |
| Sanitized Mobile v7 lint and build | Pass |
| Sanitized Mobile v7 deterministic tests | 9 pass |
| Repository policy and credential scan | Pass |

The tests cover ISBN validation and conversion, manifestation separation, RIS output, distinct-source confidence, physical-confirmation enforcement, local Zotero token shape, duplicate protection, cache migration, source defaults, pacing, and local HTTP routes.

The Zotero and local HTTP integration tests use temporary simulated loopback services. They do not write to a normal Zotero library. The live-catalogue test is disabled by default because external availability is time-sensitive.

## Commands

```sh
bash scripts/check-repository-policy.sh

cd python
python3 -m unittest discover -s tests -v

cd ../desktop
bun install --frozen-lockfile
bun run typecheck
bun test
bun build src/server.ts --target bun --outdir dist/bundle-check

cd ../mobile
npm run install:ci
npm test
npm run lint
```

Mobile tests use local simulated fetch responses for catalogue and Zotero Web
API behavior. They do not contain a key or write to a normal library.

## Remaining desktop-distribution acceptance

The source repository can be reviewed independently of binary distribution. A downloadable macOS application remains blocked until all of the following pass:

1. Zotero 10 or later acceptance using a disposable profile and explicit approval.
2. Correct the included bundle verifier’s stale v1.1.0 assertion, then rerun bundle verification against v1.2.
3. Developer ID signing.
4. Apple notarization and stapling.
5. Clean-Mac launch tests on Apple silicon and Intel/Rosetta as applicable.
