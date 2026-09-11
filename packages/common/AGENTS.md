# `@agent-facets/common`

## What this package is

The primitives that must be identical on both sides of a published
package boundary. `common` exists for one reason: **the adapter SDK and
protocol are published to npm and cannot depend on `engine`**, yet all
three need to speak the same vocabulary. `tsdown`'s `alwaysBundle`
inlines this package into their published tarballs, so an external
consumer never sees `@agent-facets/common` in their dependency tree.

This package is workspace-only. It has no `version` field and is listed
in `.changeset/config.json`'s `ignore`, so the release pipeline skips
it. See `scripts/README.md` ("Workspace-only packages") for why.

## The bar for adding something here

**This file is the single owner of that rule.** Other packages' AGENTS
files point here rather than restating it.

Add something to `common` when **the adapter SDK needs it at runtime,
and at least one of `{protocol, engine}` needs it too.**

If the consumer set is just `{protocol, engine}`, the right home is
`protocol` — engine can import protocol freely, and nothing has to be
bundled. If only one package needs it, it belongs in that package.

The bar is deliberately narrow because everything here is duplicated
into two published tarballs.

Two current entries predate this rule and do not meet it:
`atomicWriteFileSync` (only `engine` calls it) and
`NonEmptyArray`/`isNonEmpty` (only `engine` and `cli`). Do not cite
them as precedent. Moving them into `engine` is a welcome cleanup; do
not add more like them.

## What belongs here

- **The file-state and mutation vocabulary.** This is the largest and
  most load-bearing part of the package, and the clearest example of
  why it exists: an adapter *plans* mutations, engine's transaction
  *applies* them, and both must agree on the shape.
  `FileState`, `FileMutation`, `FileMutationAction`, `ABSENT_FILE`,
  `regularFile`, `bytesEqual`, `fileStatesEqual`, `isNoOpMutation`,
  plus the inspection helpers (`inspectFileState`,
  `describeInspectFailure`, `nodeFileReadSyscalls`).
- **Cross-boundary types** — `AssetType`, `Scope`, `Validated<T>`,
  `ValidationError`.
- **Pure helpers with genuinely shared consumers** — `validateAssetName`
  (path-safety), `splitFrontMatter`, `decodeFileText`.

`src/index.ts` is the authoritative list. Do not maintain a copy here.

### Two functions named `validateAssetName`

`common`'s is the **path-safety** check: is this name safe to use as a
filesystem path, a tar entry, or a lockfile key. Protocol exports a
*different* `validateAssetName`
(`packages/protocol/src/schemas/asset-name.ts`) that enforces the
stricter Agent Skills **authoring grammar** for author-declared manifest
keys.

Protocol imports both. When you reach for one, be explicit about which
concern you are enforcing — picking the wrong one silently changes
validation strictness.

## What does NOT belong here

- Anything only the CLI needs (Ink components, prompts, help text).
- Anything only `engine` needs. The CLI importing it *through* engine
  does not make it common.
- Anything only `protocol` needs — schemas, integrity, content-hash
  format, version-spec grammar.
- Anything that depends on `arktype` or another schema library. The
  validators live in `protocol`; `common` exposes the primitive they
  narrow on.
- Anything with a heavy runtime dependency. Every byte here ships
  twice, in two packages other people install.
