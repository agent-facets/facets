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
overstuffed `@agent-facets/core` before this split. A future change
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

## Registry client codegen

The registry client's wire-format types come from a vendored snapshot
of the registry's OpenAPI specification. The contract:

- **Snapshot** at `src/registry/openapi.snapshot.yaml` — the YAML
  fetched from the registry, with a 4-line header (Generated-by,
  Source, Generated-At, do-not-edit). Committed; never hand-edited.
- **Generated types** at `src/registry/generated/registry-api.ts` —
  emitted by `openapi-typescript` from the snapshot. Committed;
  never hand-edited; ignored by Biome and marked
  `linguist-generated` for GitHub.
- **Curated re-exports** at `src/registry/wire.ts` — the only
  import surface that other engine code (and the CLI via engine's
  public exports) should use. Provides stable names like
  `WireMetadataResponse`, `WireErrorResponse`, `WireAssetCounts`
  so generator-internals churn doesn't ripple across call sites.

To refresh: run `bun run codegen:registry` from `packages/engine`.
The script fetches the OpenAPI YAML (from `FACET_REGISTRY_OPENAPI_URL`
env, defaulting to the production registry), validates it, atomically
writes the snapshot, and runs `openapi-typescript`. Idempotent at
the generated-module boundary — re-running against an unchanged
registry produces a byte-identical generated file (the snapshot's
`Generated-At` line updates by design).

The script never runs at build time. Fresh clones must build
offline; CI must build deterministically. Codegen is manual,
committed, and reviewable in PRs.

Contributors call the registry through `createRegistryClient()`,
which returns a typed `openapi-fetch` client with retry, timeout,
and abort middleware pre-applied:

```ts
import { createRegistryClient } from '@agent-facets/engine'
const client = createRegistryClient()
const { data, error, response } = await client.GET(
  '/v0/packages/{name}/{version}',
  { params: { path: { name, version } } },
)
```

Wire errors become structured `RegistryError` values via
`translateWireError(error, response.status)` and
`translateThrownError(err)`. The discriminator surfaces four codes:
`NOT_FOUND`, `NETWORK_ERROR` (with `attempts` count),
`REGISTRY_NOT_AVAILABLE`, `UNEXPECTED_ERROR`.

A CircleCI advisory job (`openapi-snapshot-freshness` in
`.circleci/development/jobs/`) verifies the snapshot's
`Generated-At` is no more than `STALENESS_THRESHOLD_DAYS` (default
`7`) old. Stale snapshots produce a failed CircleCI status and a
red X on the PR; the check is advisory and does not block merge by
default. Add the job to GitHub branch protection if you want
hard-block behavior.

## Bun runtime

Engine is **Bun-native** by design. `Bun.spawn`, `Bun.file`,
`Bun.gzipSync`, `Bun.which`, `Bun.build`, `Bun.Glob` are all fair
game. Tests run on `bun:test`. The CLI runs on Bun. The cafe registry
runs on Node — and **doesn't depend on engine** because engine isn't
published. The cafe consumes `@agent-facets/protocol` directly.
