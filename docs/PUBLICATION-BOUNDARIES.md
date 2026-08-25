# Publication Boundaries

## Included

- Maintained Python and TypeScript/Bun v1.2 source
- Deterministic and local-integration tests
- Source-only CI workflow
- Architecture, runtime, development, recovery, testing, and Mobile-baseline documentation
- MIT project license and third-party notices
- Repository policy and pre-publication credential scan

## Excluded

- Exact Mobile version 7 production source and recovery archive
- All production Site URLs, identifiers, version hashes, and hosting manifests
- Recovery snapshots and private audit history
- Personal portraits, recordings, social-media posts, and private shared-chat links
- Zotero credentials, API keys, normal library data, and environment files
- Compiled applications, installers, ZIP archives, signing identities, and notarization materials

## Repository model

The recovery/audit repository must remain private because sensitive identifiers and personal fixtures exist in its history. The public project must use a clean repository with fresh history based only on this approved source tree. A sanitized branch inside the old repository is insufficient: changing that repository’s visibility could expose its other branches, tags, and earlier commits.

## Approval gate

Preparing and testing this preview does not authorize any visibility change. The owner must inspect the preview and explicitly approve creation or publication of the clean repository. The production Mobile Site remains unchanged, and no macOS binary may be attached to a release until the distribution acceptance listed in [Testing](TESTING.md) is complete.
