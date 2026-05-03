# `@agent-facets/engine`

## What this package is

The Bun-native CLI machinery — Layer 2 of the three-layer architecture
(protocol / engine / CLI). One concrete implementation of the facet
specification on a developer's machine: install pipeline, registry
client, adapter machinery, scaffold, edit, self-update, source
resolvers, manifest mutations, cache, build pipeline orchestrator.

Engine is **private** to this monorepo. It is never published to npm.
Other systems implementing the facet spec — a future Rust CLI, the
cafe registry server — would have their own engine equivalent. The
contract they all conform to lives in `@agent-facets/protocol`.

If we rewrote the engine in Rust tomorrow, every line in this package
would be replaced. The protocol it depends on would not.

## What belongs here

- **Adapter machinery** — bundling, install-service, placement, verify,
  loader, first-party list. Adapters are CLI-side abstractions over AI
  coding tools; the spec doesn't mandate adapters at all.
- **Adapter sources** — npm tarball download, git clone, local path
  resolution. Subprocess-driven; engine-only.
- **Facet sources** — git clone, local path resolution. Same shape as
  adapter sources; engine-only.
- **Source-specifier parsers** — `parseFacetSource`, `parseAdapterSpecifier`,
  `parseVersionSpec`. The CLI interprets user-input source strings;
  the parsed `Source` discriminant is engine-internal. Only the
  `VersionSpec` slice (which appears in published artifacts) lives in
  protocol.
- **Install pipeline orchestrator** — `runInstall`, journal,
  lockfile-guard, lockfile-io, materialize. Drives the install flow on
  a developer's machine.
- **Build pipeline orchestrator** — `runBuildPipeline`, `writeBuildOutput`.
  Wires protocol's primitives (validators, content-hash, tar layout)
  into a CLI workflow with progress events.
- **`compressArchive`** — gzip is delivery, not part of the integrity
  contract. Kept here so protocol stays gzip-implementation-agnostic.
- **Cache** — `~/.facets/cache/` layout, identity computation, atomic
  put, lookup. Developer-machine state.
- **Manifest mutations + project-files I/O** — the JSON rewrites for
  `facets.json` and the disk bridge that reads/writes it. Each CLI has
  its own mutation semantics; the spec only constrains the file's
  shape (which lives in protocol).
- **Registry client** — HTTP I/O against the registry server, archive
  download/extract. The wire format is owned by the registry server's
  own OpenAPI specification, not the protocol package.
- **Edit** — interactive reconcile, scanner, manifest-writer, edit
  operations. CLI authoring workflow.
- **Scaffold** — `facet create` machinery. Generates a starter project
  tree.
- **Self-update** — detect install method, run the right updater
  (npm/pnpm/yarn/bun/curl). CLI lifecycle management.
- **Path-based loaders** — `loadManifest(dir)`, `resolvePrompts(rootDir)`,
  `loadServerManifest(filePath)`. Thin wrappers over Bun's filesystem
  primitives that read bytes and call protocol's bytes-validators.

## What does NOT belong here

- **Schemas, integrity verification, content-hash format, tar layout,
  front-matter encoding, version-spec grammar.** All in protocol.
- **Bytes-validators.** Engine reads bytes, protocol validates them.
- **Display code.** No Ink, no chalk, no spinners, no `console.log` for
  user-facing output. If engine needs to surface progress, it returns
  structured events; the CLI renders them.
- **CLI argument parsing or command help text.** That's the CLI's job.
- **Process-exit logic.** Engine returns results; the CLI decides
  exit codes.
- **`process.argv` reads.** Configuration comes in through function
  parameters or, where unavoidable, via environment variables
  documented on the function.

## Public surface discipline

`src/index.ts` exports **only what the CLI consumes**. Do not add
speculative exports for hypothetical future consumers. The protocol
package handles the "exported for any third-party implementer" case;
engine is for one consumer (the CLI in this repo).

If the export list starts feeling bloated, that is a signal the
package boundary is wrong — the same failure mode that produced the
overstuffed `@agent-facets/core` this rename split. A future change
SHOULD subdivide engine before adding more exports.

## Boundary with `protocol`

Engine consumes `@agent-facets/protocol` as a workspace dependency
for everything that is part of the facet spec. Engine NEVER reaches
into protocol's internals; it only imports the public surface from
`@agent-facets/protocol`.

If engine finds itself wanting to reimplement something already in
protocol, that is a smell. Either the engine code is doing something
the protocol doesn't yet support (a real engine concern), or the
engine code is duplicating protocol logic and should be deleted.

## Boundary with `common`

Engine may import `@agent-facets/common` freely for cross-cutting
primitives (`Validated<T>`, `ValidationError`, `AssetType`, etc.).
`common` is shared with `protocol` and `adapter`; it carries types
that are useful at every layer.

## Bun runtime

Engine is **Bun-native** by design. `Bun.spawn`, `Bun.file`,
`Bun.gzipSync`, `Bun.which`, `Bun.build`, `Bun.Glob` are all fair
game. Tests run on `bun:test`. The CLI runs on Bun. The cafe registry
runs on Node — and **doesn't depend on engine** because engine isn't
published. The cafe consumes `@agent-facets/protocol` directly.
