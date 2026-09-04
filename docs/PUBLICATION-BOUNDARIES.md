# Publication Boundaries

## Included

- Maintained Python and TypeScript/Bun v1.2 source
- Sanitized Mobile v8 and Mac v3 reference sources with no production Sites registrations
- Deterministic and local-integration tests
- Source-only CI workflow
- Architecture, runtime, development, recovery, testing, Sites-baseline, and deployment-safety documentation
- MIT project license and third-party notices
- Repository policy and pre-publication credential scan

## Excluded

- Exact Mobile version 8 and Mac version 3 production checkouts, hosting manifests, and private Git histories
- All production Site URLs, identifiers, version hashes, and hosting manifests
- Recovery snapshots and private audit history
- Personal portraits, recordings, social-media posts, and private shared-chat links
- Zotero credentials, API keys, normal library data, and environment files
- Compiled applications, installers, ZIP archives, signing identities, and notarization materials

## Repository model

The recovery/audit repository remains private because restricted provenance and
historical evidence exist there. The public project remains a separate clean
repository. Only the reviewed `mobile/` and `mac/` derivatives belong in public
history; private production checkouts and hosting registrations do not.

## Approval gate

Preparing and testing this preview does not authorize a repository visibility
change or a production deployment. The owner must inspect the preview and
explicitly approve publishing the prepared commits. The production Mobile Site
remains unchanged, and no macOS binary may be attached to a release until the
distribution acceptance listed in [Testing](TESTING.md) is complete.
