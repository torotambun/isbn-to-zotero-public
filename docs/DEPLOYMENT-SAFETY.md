# Deployment Safety

The `mobile/` and `mac/` directories are source references, not deployment
checkouts. They intentionally omit `.openai/hosting.json`, production project
identifiers, environment values, and source credentials.

## Identity rule

- Mobile version 8 and Mac version 3 are different Sites projects.
- Their source, tests, documentation, and future deployment work must remain
  separate.
- Never copy a hosting manifest from one application to the other.
- Never add either production registration to this public repository.

## Safe synchronization rule

Production comparison is read-only: recover a fresh temporary checkout through
Sites, select the exact saved-version commit, and compare it with GitHub. A
GitHub source synchronization must not save a Site version, create a checkpoint,
deploy, rename, disconnect, or alter access.

To deploy a derivative in the future, create a new private Sites project and a
private hosting manifest. Do not connect this repository to either production
Site.
