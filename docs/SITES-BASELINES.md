# Verified Sites Source Baselines

## Decision

The exact Mobile version 8 and Mac version 3 source repositories were recovered
into temporary, detached checkouts through Sites. Their current source branch
heads matched the commits recorded for the corresponding saved versions before
this public synchronization was prepared.

The exact checkouts and production hosting manifests remain private and
immutable. This repository includes separately reviewed derivatives under
`mobile/` and `mac/`. Their production Sites registrations, project identifiers,
and deployment metadata are absent, so neither directory can update a production
Site.

## Separate identities

| Reference | Purpose | Production source baseline |
| --- | --- | --- |
| `mobile/` | iPhone barcode/manual ISBN workflow and direct Zotero filing | Mobile version 8 |
| `mac/` | ISBN workflow plus No ISBN, title search, and verified physical-book transcription | Mac version 3 |

The directories must not be merged into one Site identity. Their names,
application routes, user guidance, and source provenance remain separate.

## Perpusnas change verified in both sources

Both baselines add Perpusnas as the first separate browser check after a valid
ISBN produces no automatic candidate. The exact URL builder is:

`https://isbn.perpusnas.go.id/Account/SearchBuku?searchTxt=<ISBN>&searchCat=ISBN`

Perpusnas remains separate from Indonesia OneSearch and is not an automatic
metadata adapter. A result is not imported automatically. WorldCat is the
second browser check. The normal route is to note the exact title and continue
with the Mac title-search workflow; WorldCat RIS import is exceptional.

## Public boundary

- No production hosting manifest or Site identifier is tracked.
- No Zotero credential, normal library data, cookie, token, or environment value
  is included.
- The public Mobile derivative keeps **Remember on this iPhone** off by default.
- The exact production source histories remain in restricted storage for
  provenance and comparison.
- Synchronizing these derivatives did not save, checkpoint, edit, or redeploy a
  production Site.
