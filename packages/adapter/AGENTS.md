# `@agent-facets/adapter`

## What this package is

The published adapter SDK. Defines the abstraction that adapters
(Claude Code, OpenCode, etc.) implement to plug into the facet
pipeline. Every adapter package ships a `defineAdapter({...})` call
and is consumed by `core` at install time.

This package is published to npm and intended for third-party adapter
authors. That has consequences for what's allowed here.

## What belongs here

- **The `defineAdapter` factory** and any helpers it composes.
- **Adapter types.** The shapes adapters must implement: asset
  installation, base-dir resolution, capability declarations.
- **I/O helpers an adapter author needs at runtime.** Asset filesystem
  helpers (`installAssetFile`), content splitters, anything generic
  enough to live below the adapter boundary but not specific to any
  single adapter.

## What does NOT belong here

- **Any dependency on `core`.** This is a hard rule. The adapter SDK
  must remain a leaf — depending on `core` would create a cycle since
  `core` imports adapter implementations. If you find yourself wanting
  to import from `core`, the right move is usually to push the shared
  primitive down into `common` instead.
- **Any dependency on `cli`.** The CLI consumes adapters; adapters
  don't know about the CLI.
- **Heavy runtime dependencies.** `common` is bundled into this
  package's published artifact via `tsdown`'s `alwaysBundle`, so
  third-party adapter authors don't end up with `common` as a peer
  dependency. Keep that bundle small. Every dependency listed in
  `package.json` becomes a transitive dep for every adapter consumer.
- **Facet-pipeline business logic.** Validation, source parsing, cache
  layout, integrity protocol — all live in `core`. The adapter SDK is
  about defining what an adapter is, not about running the install
  pipeline.

## Boundary with `common`

`adapter` depends on `@agent-facets/common` for truly cross-package
primitives (`AssetType`, `Scope`, `validateAssetName`, etc.). At build
time, tsdown's `alwaysBundle` inlines `common` into the published
artifact, so adapter consumers never see `common` as a runtime dep.

This bundling is why `common` exists at all and why it stays so small.
If a primitive only `core` and `cli` need, it doesn't belong in
`common` — putting it there would inflate the published adapter
artifact for no reason.

## Rule of thumb

Before adding a file here, ask: "Does an adapter author need to call
this at runtime to implement a working adapter?" If yes, it belongs
here. If the code is about *running* facet installs (rather than
implementing the adapter contract), it belongs in `core`.
