# Publication Boundaries

## Included

- Maintained Python and TypeScript/Bun v1.2 source
- Sanitized Mobile v7 reference source with no production Sites registration
- Deterministic and local-integration tests
- Source-only CI workflow
- Architecture, runtime, development, recovery, testing, and Mobile-baseline documentation
- MIT project license and third-party notices
- Repository policy and pre-publication credential scan

## Excluded

- Exact Mobile version 7 production archive, hosting manifest, and private Git bundle
- All production Site URLs, identifiers, version hashes, and hosting manifests
- Recovery snapshots and private audit history
- Personal portraits, recordings, social-media posts, and private shared-chat links
- Zotero credentials, API keys, normal library data, and environment files
- Compiled applications, installers, ZIP archives, signing identities, and notarization materials

## Repository model

The recovery/audit repository must remain private because sensitive identifiers
exist in its source history and evidence. The public project remains a separate
clean repository. Only the reviewed `mobile/` derivative belongs in that public
history; the recovery Git bundle and private production branch do not.

## Approval gate

Preparing and testing this preview does not authorize a repository visibility
change or a production deployment. The owner must inspect the preview and
explicitly approve publishing the prepared commits. The production Mobile Site
remains unchanged, and no macOS binary may be attached to a release until the
distribution acceptance listed in [Testing](TESTING.md) is complete.
