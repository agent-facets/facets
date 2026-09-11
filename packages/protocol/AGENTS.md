# `@agent-facets/protocol`

## What this package is

The TypeScript reference implementation of the **facet specification** —
Layer 1 of the protocol / engine / CLI split. Any TypeScript system
implementing the spec (a registry server, an offline `.facet` linter, an
alternative CLI) consumes this package directly. Implementations in
other languages have their own equivalent; they satisfy the same
published requirements.

The protocol describes *what facets are*. How a CLI talks to a registry
over HTTP is owned by the registry's own API surface, not by this
package.

## Rule of thumb

Before adding a file here, ask: **"If `engine` were re-implemented in
another language tomorrow, would this code change?"**

- **No** — the rule it expresses is part of the published spec. It
  belongs here. The TypeScript implementation is one reference among
  possible others; the rule is the same everywhere.
- **Yes** — the code is intrinsic to how *this* CLI does its job. It
  belongs in `@agent-facets/engine`.

## What belongs here

- **Schemas** for every artifact format: `facet.json`, `facets.json`,
  `facets.lock`, `build-manifest.json`, the MCP server declaration, and
  the materialization dispositions. Legacy schema variants live
  alongside the current ones.
- **Versioned document dispatch.** `parseBuildManifestDocument`,
  `parseLockfileDocument`, `parseProjectManifestDocument`. Format
  versions dispatch on an **exact** match — never numeric ordering,
  never shape-sniffing. That strictness is normative.
- **Bytes-validators** — pure functions over `Uint8Array | string`
  returning `Validated<T>`. No disk I/O.
- **Integrity verification** — registry three-check, git one-check.
  Pure functions over hash strings.
- **Content hashing and the deterministic archive layout** —
  `computeContentHash`, `assembleTar`, `assembleOuterTar`,
  `collectArchiveEntries`, `computeAssetHashes`, and the format
  constants. Tar bytes are part of the hash contract; gzip output is
  not.
- **Archive reading and validation** — `parseFacetArchive`,
  `parseInnerArchive`, `planArchiveEntries`, `validateSupplementaryPath`,
  and the raw tar-header validation in `src/build/tar-headers.ts`.
- **Materialization planning** — effective names, namespacing, collision
  keys, and the server materialization wrappers. Exported so another
  implementation can reproduce the ordering, alias, and stale-intent
  contract exactly.
- **MCP canonical encoding and fingerprinting** —
  `canonicalMcpServerEncoding`, `computeMcpServerFingerprint`, the
  freeze helpers, and the transport vocabulary.
- **Name grammars** — `parseAssetName`, `parseFacetName`, `parseSlug`.
- **Deterministic ordering** — `compareCodeUnits`. Sort order is part of
  the hash contract, so the comparator is normative.
- **Version-spec grammar** — the `VersionSpec` type, the grammar for
  `1.*` / `1.2.*` / exact / `*` / `latest`, and `resolvesToLatest`.

`src/index.ts` is the authoritative export list.

## What does NOT belong here

- **Subprocess spawning.** No `Bun.spawn`, no `node:child_process`.
- **Network I/O.** No `fetch`, no HTTP client, no registry protocol.
- **Filesystem access of any kind.** No reads, no writes, no temp
  directories, no cache paths. Validators take bytes. Path-based
  loaders (`loadManifest(dir)` and friends) are engine's job: engine
  reads bytes with whatever runtime it likes and hands them here.
- **Compression.** `compressArchive` is engine. Consumers decompress
  before calling `parseFacetArchive`, which takes uncompressed
  outer-tar bytes.
- **Source-specifier parsers.** `parseFacetSource`,
  `parseAdapterSpecifier`, git cloning — all engine. Published
  artifacts only carry the `VersionSpec` slice of source grammar, and
  that slice is here.
- **Orchestrators.** `runBuildPipeline`, `runInstall`, `materialize`,
  `runSelfUpdate` — engine.
- **Anything importing `@agent-facets/adapter`.** Protocol sits
  upstream of the adapter SDK. If both need a type, it goes in
  `@agent-facets/common`.

## Runtime constraints

- **Node 22+**, declared in `engines.node`. The package MUST run with
  no Bun on `$PATH` — that is the entire point of separating it from
  engine. No `Bun.*` globals in `src/`.
- **No `@types/bun` in this package's manifest.** It may exist in the
  workspace devDependencies for tests.
- Tests run on `bun:test` and are excluded from the published bundle
  (`files: ["dist"]`).

## The `./mcp-declaration` subpath

`package.json` publishes a second entry point,
`@agent-facets/protocol/mcp-declaration`, pointing at
`src/schemas/mcp-server-declaration.ts`.

It exists so the adapter SDK can inline the portable
`McpServerDeclaration` type into its published declarations **without
dragging arktype's type graph along with it**. That subpath must stay
dependency-free. `src/index.ts` carries a compile-time assertion that
the two definitions agree, and
`packages/adapter/src/__tests__/dist.e2e.test.ts` pins the invariant
from the other side.

This is the one sanctioned direction between the two packages: adapter
may take a *type-only* dependency on protocol through this subpath.
Protocol still may not import adapter.

## Boundary with `common`

`protocol` may import `@agent-facets/common` freely; the bundler
inlines it into the published tarball. What protocol actually uses:
`Validated<T>`, `ValidationError`, `AssetType`, `Scope`,
`splitFrontMatter` (re-exported from `index.ts` so external consumers
get it through one package), and common's path-safety
`validateAssetName`.

Note that protocol exports its *own* `validateAssetName` for the
stricter authoring grammar. `packages/common/AGENTS.md` explains the
split; do not conflate them.

`common`'s inclusion rule is owned by `packages/common/AGENTS.md`. Do
not restate it here.
