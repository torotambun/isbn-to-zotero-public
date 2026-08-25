# Mobile Version 7 Baseline

## Decision

The exact Mobile version 7 source is **not included** in this public source preview.

The private recovery archive is an immutable production baseline. It includes a hosting manifest and implements a personal, credential-dependent Zotero Web API write path. Redacting that archive would make it no longer exact; publishing it unchanged would expose production metadata and broaden the security review. The archive therefore remains in restricted storage for provenance and comparison.

## What can be stated publicly

- The working Mobile workflow is field-proven through more than 400 successful book saves reported by its owner.
- It sends a selected record directly to Zotero using a write-enabled credential provided by the user at runtime.
- No credential was embedded in the recovered source.
- The production Mobile Site was not edited, republished, disconnected, or otherwise changed during recovery or public-readiness work.
- This repository neither contains nor deploys that production source.

## Future public Mobile code

A Mobile implementation may be published later as a separate sanitized reference project after its credential storage, privacy disclosure, hosting configuration, and third-party service use receive a dedicated review. It must not replace or modify the preserved production baseline merely to make publication easier.
