# `@agent-facets/common`

## What this package is

Shared primitives that the **adapter SDK** and **core** both need.
That's it — those two packages, and only those two. CLI is not in the
list. CLI is a consumer of core, not a peer.

Why so narrow? Because the adapter SDK is published to npm and cannot
take a runtime dependency on core (which contains the entire facet
pipeline). When the adapter SDK and core both genuinely need the same
primitive — a type, a pure function, a filesystem pattern — that
primitive lives here, and `tsdown`'s `alwaysBundle` inlines it into the
published adapter so consumers don't end up with `common` as a runtime
dependency. `core` and `cli` import it normally as a workspace dep.

If only `core` needs something, it goes in `core`. If only `cli` needs
something, it goes in `cli`. If only the adapter SDK needs something,
it goes in `adapter`. `common` is reserved for the genuine intersection
of `adapter ∩ core`.

## What belongs here

- **Types** that both the adapter SDK and core reference (e.g.
  `AssetType`, `Scope`, `Validated`, `ValidationError`).
- **Pure helpers** — no I/O side effects at import time, no heavy
  dependencies — that both the adapter SDK and core need. Current
  examples:
  - `validateAssetName` — asset-name safety check used by both core's
    manifest + lockfile schemas and the adapter SDK's I/O helpers.
  - `normalizeLineEndings` — BOM strip + CRLF-to-LF used by both core's
    front-matter parser and the adapter SDK's `splitAssetContent`.
  - `atomicWriteFileSync` — tmp + rename pattern used by core's writers
    and the adapter SDK's asset-fs helper.

## What does NOT belong here

- Anything only the CLI needs (Ink components, prompts, command help) —
  goes in `cli`.
- Anything only `core` needs (parsers, schemas, install pipeline,
  cache, integrity protocol, registry client) — goes in `core`. Even
  if the CLI imports it indirectly through core, that doesn't make it
  "common."
- Anything only the adapter SDK needs — goes in `adapter`.
- Anything that depends on `arktype` or other schema libraries — the
  validators live in `core`; `common` just exposes the primitive
  function they narrow on.
- Anything with heavy runtime dependencies — remember, this gets
  bundled into the published adapter SDK, so every byte counts.

## Rule of thumb

Before adding a file here, ask **two** questions:

1. Does the adapter SDK genuinely need to call this at runtime?
2. Does `core` also genuinely need to call this?

If the answer to either is "no," the file belongs elsewhere — usually
`core`. The CLI's needs are not a reason to put something here; the
CLI gets everything via `core`.

## Workspace-only — no release

This package is workspace-only: it's bundled into the adapter SDK at
build time and imported directly by `core` and `cli`, so there's no npm
release path for it. It's kept out of the release pipeline by two
mechanisms:

1. Listed in `.changeset/config.json` `ignore` — changesets never bumps
   its version.
2. Intentionally has no `version` field in `package.json` — `tag.ts` and
   `hasUnpublishedVersions` defensively skip versionless packages.

See `scripts/README.md` ("Workspace-only packages") for the full
rationale.
