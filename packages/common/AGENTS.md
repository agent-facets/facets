# `@agent-facets/common`

## What this package is

Shared primitives that the **adapter SDK**, **protocol**, and **engine**
all need. The CLI imports it directly too (per the CLI's own AGENTS.md
exception), but that's not what gates inclusion: the bar for adding
something to `common` is whether at least two of `{adapter SDK,
protocol, engine}` need it.

Why so narrow? Because the adapter SDK and protocol are both published
to npm and cannot take a runtime dependency on engine (which contains
subprocess-spawning, filesystem I/O, the full install pipeline). When
multiple published packages genuinely need the same primitive — a type,
a pure function, a filesystem pattern — that primitive lives here, and
`tsdown`'s `alwaysBundle` inlines it into the published tarballs so
external consumers never end up with `common` as a runtime dependency.
`engine` and `cli` import it normally as a workspace dep.

If only `protocol` or `engine` needs something, it goes in that
package. If only `cli` needs something, it goes in `cli`. If only the
adapter SDK needs something, it goes in `adapter`. `common` is
reserved for the genuine intersection of at least two of `{adapter,
protocol, engine}`.

## What belongs here

- **Types** that more than one of `{adapter SDK, protocol, engine}`
  reference (e.g. `AssetType`, `Scope`, `Validated`, `ValidationError`).
- **Pure helpers** — no I/O side effects at import time, no heavy
  dependencies — that more than one consumer needs. Current examples:
  - `validateAssetName` — asset-name safety check used by both
    protocol's manifest + lockfile schemas and the adapter SDK's I/O
    helpers.
  - `normalizeLineEndings` — BOM strip + CRLF-to-LF used by both
    protocol's front-matter parser and the adapter SDK's
    `splitAssetContent`.
  - `splitFrontMatter` — the canonical YAML front-matter splitter.
    Used by adapter SDK's `splitAssetContent`, by engine's
    `materialize` (for the skip-if-identical comparison), and
    re-exported from protocol's public surface so external consumers
    of `@agent-facets/protocol` (e.g. the cafe registry) get it
    through one package boundary.
  - `atomicWriteFileSync` — tmp + rename pattern used by engine's
    writers and the adapter SDK's asset-fs helper.

## What does NOT belong here

- Anything only the CLI needs (Ink components, prompts, command help) —
  goes in `cli`.
- Anything only `engine` needs (install pipeline, cache, registry
  client, source resolvers, scaffold) — goes in `engine`. Even if the
  CLI imports it indirectly through engine, that doesn't make it
  "common."
- Anything only `protocol` needs (schemas, integrity verification,
  content-hash format, version-spec grammar) — goes in `protocol`.
- Anything only the adapter SDK needs — goes in `adapter`.
- Anything that depends on `arktype` or other schema libraries — the
  validators live in `protocol`; `common` just exposes the primitive
  function they narrow on.
- Anything with heavy runtime dependencies — remember, this gets
  bundled into the published adapter SDK and protocol tarballs, so
  every byte counts.

## Rule of thumb

Before adding a file here, ask **two** questions:

1. Does the adapter SDK genuinely need to call this at runtime, AND
2. Does at least one of `{protocol, engine}` also genuinely need to
   call this?

If the answer is "no" to question 1 and the consumer set is just
`{protocol, engine}` (no adapter SDK), the right home is usually
`protocol` (which engine can import). Common's reason for existing is
the bundling escape hatch for the adapter SDK; without that
constraint, code belongs closer to its primary consumer.

## Workspace-only — no release

This package is workspace-only: it's bundled into the adapter SDK and
protocol at build time and imported directly by `engine` and `cli`, so
there's no npm release path for it. It's kept out of the release
pipeline by two mechanisms:

1. Listed in `.changeset/config.json` `ignore` — changesets never bumps
   its version.
2. Intentionally has no `version` field in `package.json` — `tag.ts` and
   `hasUnpublishedVersions` defensively skip versionless packages.

See `scripts/README.md` ("Workspace-only packages") for the full
rationale.
