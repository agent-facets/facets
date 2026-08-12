# `@agent-facets/protocol`

## What this package is

The TypeScript reference implementation of the **facet specification**.
This is Layer 1 of the three-layer architecture (protocol / engine / CLI).
Any other TypeScript-based system implementing the facet spec — a registry
server, an offline `.facet` linter, an alternative CLI — would consume
this package directly. Implementations in other languages (Rust, Go,
Python) would have their own equivalent package, but they would all
satisfy the same published requirements.

The protocol describes *what* facets are. Service interactions (how a
CLI talks to a registry over HTTP, for example) are owned by the
service whose API surface they describe — not by this package.

## What belongs here

- **Schemas** for every facet artifact format: `facet.json`,
  `facets.json`, `facets.lock`, `build-manifest.json`.
- **Bytes-validators** for those schemas — pure functions on
  `Uint8Array | string` that return `Validated<T>` (typed value or
  structured errors). No disk I/O.
- **Front-matter encoding** — extract/strip YAML front matter from
  asset bodies; this is part of the file-format contract. The
  canonical implementation lives in `@agent-facets/common`'s
  `splitFrontMatter` (so the adapter SDK can use it without taking
  a runtime dep on protocol's heavy deps); protocol re-exports it
  from `index.ts` so external consumers see one surface.
- **Integrity verification** — registry three-check (lockfile / cache /
  archive-manifest / computed-content), git one-check (lockfile /
  computed). Pure functions on hash strings; no I/O.
- **Content hashing** — `computeContentHash`, the deterministic tar
  layout (`assembleTar`, `assembleOuterTar`, `collectArchiveEntries`,
  `computeAssetHashes`), and format constants (`INNER_ARCHIVE_NAME`,
  `BUILD_MANIFEST_NAME`, `DETERMINISTIC_ATTRS`). Tar bytes are part of
  the hash contract; gzip output is NOT (compression is delivery).
- **Archive readers** — `parseFacetArchive(bytes)` and
  `parseInnerArchive(innerTarBytes)` for consumers (e.g. registry
  servers) that need to read uploaded `.facet` bytes without writing
  them to disk first.
- **Build validators** that encode artifact contract rules:
  `detectNamingCollisions`, `validateContentFiles`, `validateCompactFacets`.
- **Version-spec grammar** — the `VersionSpec` type, the regex grammar
  for `1.*` / `1.2.*` / exact / `*` / `latest`, and the `resolvesToLatest`
  matcher. Version specifiers appear in artifacts (`facets.json` and
  `facets.lock`), so the grammar is normative.

## What does NOT belong here

- **Subprocess spawning.** No `Bun.spawn`, no `node:child_process`. If
  a future protocol concept requires running git or npm or any other
  binary, that's an engine concern.
- **Network I/O.** No `fetch`, no HTTP clients, no registry talking.
  The registry's HTTP API is owned by the registry server, not the
  protocol.
- **Filesystem mutations.** No `Bun.write`, no `node:fs/promises.writeFile`,
  no temporary directories, no cache paths. Validators take bytes;
  they never reach for disk.
- **Path-based loaders.** `loadManifest(dir)`, `resolvePrompts(rootDir)`,
  and similar disk-reading wrappers belong in engine, not here. Engine
  reads bytes (using whatever runtime it likes) and hands them to
  protocol's bytes-validators.
- **Compression.** `compressArchive` (gzip) is engine. Decompression is
  also engine — protocol exports `parseFacetArchive(bytes)` which takes
  outer-tar bytes (uncompressed); consumers use `node:zlib.gunzipSync`
  or equivalent to decompress the inner archive themselves before
  hashing.
- **Source-specifier parsers.** The `Source` discriminant
  (github/git/file/registry), `parseFacetSource`, `parseAdapterSpecifier`,
  `cloneFacetGitSource`, etc. are all engine — the CLI interprets
  user-input source strings. The published artifacts (lockfile,
  project manifest) only carry the `VersionSpec` part of source
  grammar; that's the slice that's protocol.
- **Build orchestrators.** `runBuildPipeline`, `writeBuildOutput`,
  `runInstall`, `materialize`, `runSelfUpdate` — all engine.
- **Anything that imports from `@agent-facets/adapter`.** Adapter code
  runs in the CLI's developer-machine context; protocol stays
  upstream of it. If a value type exists in adapter that protocol
  also needs, the type belongs in `@agent-facets/common` (or
  duplicated as a pure structural type).

## Runtime constraints

- **Node 22+** is the minimum supported runtime. The `engines.node`
  field in `package.json` declares this. The package MUST run on Node
  with no Bun on `$PATH` — that's the whole point of separating it
  from engine.
- **No `@types/bun` runtime dependency.** `@types/bun` MAY appear in
  the workspace devDependencies for test-time use, but never in
  protocol's own dependency manifest.
- **Tests run on `bun:test`** (per the change's non-goals). Tests are
  devDependency-territory; they never reach published consumers.
  The published bundle does not include tests.

## Rule of thumb

Before adding a file here, ask: **"If `engine` were re-implemented in
another language tomorrow, would this code change?"**

- **No** — the rule it expresses is part of the published spec → it
  belongs here. The TypeScript implementation is one reference; other
  languages would have their own, but the rule is the same.
- **Yes** — the code is intrinsic to *how this CLI* does its job →
  it belongs in `@agent-facets/engine`.

## Boundary with `common`

`protocol` may import `@agent-facets/common` freely. `common` carries
primitives shared across protocol, the adapter SDK, and engine —
things like `Validated<T>`, `ValidationError`, `AssetType`, `Scope`,
`splitFrontMatter`, `validateAssetName`, `normalizeLineEndings`,
`atomicWriteFileSync`. The bundler inlines `common` into the published
protocol tarball so consumers see a single package surface.

Don't move things into `common` just because both `protocol` and
another package use them — the test for `common` is whether the
adapter SDK needs them at runtime.
