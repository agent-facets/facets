# `@agent-facets/common`

## What this package is

Shared primitives that cross the core / adapter SDK / CLI boundary. Kept
deliberately tiny because this package is bundled into
`@agent-facets/adapter` at build time (via `tsdown`'s `alwaysBundle`) so it
never becomes a runtime dependency of the adapter SDK. `core` and `cli`
import it normally as a workspace dependency — in those builds `common`
behaves like any other internal package.

Think of it as the floor that everyone stands on: if two layers need the
same primitive (a type, a pure function, a filesystem pattern), it goes
here so there's one definition, not two.

## What belongs here

- **Types** every layer references (e.g. `AssetType`, `Scope`, `Validated`,
  `ValidationError`).
- **Pure helpers** — no I/O side effects at import time, no heavy
  dependencies — that multiple packages need. Current examples:
  - `validateAssetName` — asset-name safety check used by both the
    manifest + lockfile schemas in `core` and defensively in the adapter
    SDK's I/O helpers.
  - `normalizeLineEndings` — BOM strip + CRLF-to-LF used by both core's
    front-matter parser and the adapter SDK's `splitAssetContent`.
  - `atomicWriteFileSync` — tmp + rename pattern used by every writer in
    the CLI.

## What does NOT belong here

- Anything that depends on `arktype` or other schema libraries — the
  validators live in `core`; `common` just exposes the underlying primitive
  function they narrow on.
- CLI-facing logic — that's `core`'s job. `core` is the logic layer that
  could one day be rewritten in Rust/Go with the CLI TUI on top.
- Adapter-specific logic — that's `@agent-facets/adapter`.
- Anything with heavy runtime dependencies — remember, this gets bundled
  into the published adapter SDK, so every byte counts.

## Rule of thumb

Before adding a file here, ask: "Would the adapter SDK want to call this
at runtime?" If no, it probably belongs in `core`. If yes, and it has no
heavy dependencies, `common` is the right home.

## Release marker

This package carries `"agentFacets": { "release": "skip" }` in its
`package.json`. That tells `scripts/release/tag.ts` (and
`scripts/lib/changesets.ts#hasUnpublishedVersions`) to never create a git
tag for this package. `common` is workspace-only — it's bundled into the
adapter SDK at build time and imported directly by `core` and `cli`, so
there's no npm release path for it and no companion pipeline to trigger.

See `scripts/README.md` ("Opting a workspace package out of releases")
for the full rationale.
