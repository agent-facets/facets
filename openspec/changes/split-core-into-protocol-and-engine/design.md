## Context

Today `@agent-facets/core` is a single workspace package (`packages/core/`) published to npm at v0.9.1, containing both the artifact specification (schemas, integrity verification, deterministic archive format, hash algorithm, front-matter encoding, version-spec grammar) and the CLI's machine-bound implementation (subprocess-driven adapter bundling, registry HTTP client, install pipeline orchestrator, cache, scaffold, edit, self-update). Approximately 30 source files belong to the first set; ~50 belong to the second. The two sets are intermixed in the directory tree and share an `index.ts` that re-exports both.

The core package uses Bun-specific APIs throughout (`Bun.file`, `Bun.gzipSync`, `Bun.gunzipSync`, `Bun.CryptoHasher`, `Bun.spawn`, `Bun.spawnSync`, `Bun.build`, `Bun.which`, `Bun.Glob`, `bun:test`). None of these run on Node, which blocks the registry server (`facet-cafe`, AWS Lambda on Node 24) from importing core for upload validation.

Sixty-two files across the repository import from or reference `@agent-facets/core`: 34 in CLI source, 5 in scripts, multiple `AGENTS.md` files, the root `README.md`, several Mintlify pages under `docs/`, and several `openspec/specs/` files. The release pipeline (`scripts/release/publish.ts`, `.changeset/config.json`) treats core as a linked-version package alongside the CLI and the adapter SDK.

The proposal establishes a target end state: a new public Node-native package (`@agent-facets/protocol`) hosting the artifact specification, a renamed private Bun-native package (`@agent-facets/engine`, formerly `core`) hosting the CLI machinery, and an end to publishing the legacy `@agent-facets/core` npm name (no further releases; existing v0.9.1 is left frozen). This design covers how that end state is reached without breaking the install pipeline, the build pipeline, the release pipeline, or the developer workflow during the transition.

## Goals / Non-Goals

**Goals:**

- Establish a clear, mechanically applicable rule for which file belongs in which package (Decision 1).
- Port the protocol slice from Bun-native to Node-native primitives without changing observable behavior (Decision 2).
- Redesign loader APIs so the protocol's validators operate on bytes, while engine retains path-based convenience wrappers (Decision 3).
- Define the release-pipeline changes needed to publish the new protocol package and stop publishing core (Decision 4).
- Document the tar/gzip split: which bytes are part of the protocol contract and which are delivery-only (Decision 5).
- Establish that the protocol decomposition includes a top-level meta-spec defining facet-compatibility, evolution rules, and the reference-implementation relationship (Decision 6).

**Non-Goals:**

- Implementing the registry-client codegen pipeline (covered by the separate `codegen-registry-client-from-openapi` change).
- Cleaning up engine internals (subprocess style, Bun.* calls outside the protocol-bound files). Engine remains Bun-native.
- Specifying the registry HTTP API. Registry owns its own OpenAPI surface.
- Migrating the cafe consumer in this change. Cafe adoption follows this change.
- Redesigning the integrity protocol, archive format, or hash algorithm. The current rules are extracted as-is and elevated to protocol scope.

## Decisions

### Decision 1: The rule for what goes in protocol vs. engine

**Rule**: `@agent-facets/protocol` is the **TypeScript reference implementation of the facet specification**. `@agent-facets/engine` is **one concrete implementation of the CLI machinery** that conforms to that specification. The protocol describes *what* facets are; the engine implements *how this CLI* produces and consumes them.

**Litmus test**: If `engine` were re-implemented to provide the same CLI behavior on a different runtime, would this code change?
- **No** — the rule it expresses is part of the specification → **protocol**. Any other TypeScript-based system implementing the facet spec would use this same reference implementation. Implementations in other languages would have their own equivalent (e.g., a hypothetical `agent_facets_protocol` crate), but they would express the same rules.
- **Yes** — the code is intrinsic to *how this CLI* does its job → **engine**. A different implementation would have its own subprocess strategy, adapter bundler, registry HTTP client, cache layout, and so on. Engine is replaceable; the protocol it conforms to is not.

A useful corollary: the protocol package's TypeScript surface is *a* reference implementation. If we ever published the specification as a separate language-neutral document (Markdown + JSON Schemas), the TypeScript package would be one of N reference implementations conforming to that document.

Concrete classification:

| In protocol | In engine |
|---|---|
| All schemas (`facet.json`, `facets.json`, `facets.lock`, `build-manifest.json`, server manifest) | Manifest mutation functions (CLI's specific update semantics) |
| Bytes-validators for every schema | Path-based loader wrappers that read from disk |
| Front-matter encoding rule + parser | Disk bridge for `facets.json` I/O |
| Integrity verification (3-check, 1-check) | Cache (developer-machine state at `~/.facets/cache/`) |
| `computeContentHash`, `assembleTar`, `assembleOuterTar`, `collectArchiveEntries`, `computeAssetHashes`, `DETERMINISTIC_ATTRS`, `INNER_ARCHIVE_NAME`, `BUILD_MANIFEST_NAME` | `compressArchive` (gzip — see Decision 5) |
| `parseFacetArchive(bytes)` (new helper for reading outer tar) | Registry HTTP client |
| Build validators that check artifact rules: `detect-collisions`, `validate-content`, `validate-facets` | Build pipeline orchestrator (`pipeline.ts`, progress events) |
| `validate-adapters` runs adapter code → engine | Build write-output (FS mutation) |
| `VersionSpec` type + grammar + matcher (appears in artifacts) | `Source`, `ParseError`, source parsers and resolvers |
| Registry response/request types — **NOT INCLUDED**; registry owns its own wire format | Registry pack (`registry/pack.ts` — CLI packs to upload) |
|  | Install pipeline orchestrator (`runInstall`, journal, lockfile-guard, lockfile-io, materialize) |
|  | Adapter machinery (bundler, install-service, placement, verify, loader, first-party list) |
|  | Scaffold, edit, self-update |

**Alternatives considered:**

- *Single `@agent-facets/core` package, port everything to Node*. Rejected — engine code legitimately needs Bun (`Bun.spawnSync` for git, `Bun.build` for adapter bundling). Forcing Node compatibility on engine adds complexity for code the cafe never runs.
- *Three packages: `protocol`, `engine`, `registry-protocol` (the wire format)*. Rejected — see proposal's reframing thread. Registry owns its own OpenAPI specification published from the cafe repo; baking wire format into a shared package would couple registry release cadence to protocol semver. The CLI consumes the registry's OpenAPI separately.
- *Move loaders entirely to engine, keep protocol schema-only*. Rejected — cafe needs to validate uploaded manifest bytes without writing them to disk first. Bytes-validators are the cafe's primary use case.

### Decision 2: Port Bun-specific primitives to Node within the protocol slice

The protocol slice MUST run on Node 22+ with no `@types/bun` runtime dependency. The Bun APIs used in protocol-bound files map cleanly to Node equivalents:

| Bun API | Node equivalent | Files affected |
|---|---|---|
| `Bun.CryptoHasher.hash('sha256', content, 'hex')` | `crypto.createHash('sha256').update(content).digest('hex')` | `build/content-hash.ts` |
| `Bun.gzipSync(buffer)` | (no port — `compressArchive` stays on `Bun.gzipSync` in engine; see Decision 5) | None in protocol |
| `Bun.file(path).exists()` + `.text()` | `fs.readFile(path, 'utf8')` + try/catch on ENOENT | `loaders/*` (replaced by Decision 3 redesign) |
| `Bun.gunzipSync` | `zlib.gunzipSync` | None in protocol — only consumers (cafe, etc.) need to decompress; protocol does not call gunzip |

The tests that move with each file stay on `bun:test` (per proposal non-goal). Protocol's published code is Node-runnable; protocol's test runtime is still Bun. This works because tests are `devDependencies`-territory and never reach published consumers.

Verification step (in tasks): a Node smoke test that imports the published protocol artifact in a fresh Node 24 process with no Bun on PATH and exercises representative APIs.

### Decision 3: Loader API redesign — pure bytes-validators in protocol, path-loader wrappers in engine

Today's loaders couple validation with disk I/O via `Bun.file().exists()/.text()`. This is wrong on two counts: it makes validation Bun-dependent, and it forces consumers like the cafe to write bytes from S3 to a temporary file before validating.

The redesign: protocol exports pure functions that operate on bytes/strings — no disk I/O at all. Engine retains its existing path-based loader API but now implements it as a thin wrapper that reads bytes from disk (with whatever runtime engine wants — today, Bun) and hands them to protocol's validators.

```
// In @agent-facets/protocol — pure validators, no I/O, runtime-agnostic
export function validateFacetManifest(bytes: Uint8Array | string): Validated<FacetManifest>
export function validateServerManifest(bytes: Uint8Array | string): Validated<ServerManifest>
export function resolvePromptsFromMap(
  manifest: FacetManifest,
  contentByPath: Record<string, string>,
): Validated<ResolvedFacetManifest>

// In @agent-facets/engine — Bun-native path wrappers, read disk and delegate
export async function loadManifest(dir: string): Promise<Validated<FacetManifest>>
export async function loadServerManifest(filePath: string): Promise<Validated<ServerManifest>>
export async function resolvePrompts(manifest: FacetManifest, rootDir: string): Promise<Validated<ResolvedFacetManifest>>
```

Engine's wrappers stay Bun-native — they continue to use `Bun.file(...)` for filesystem I/O, the same as today. The translation of file-not-found to a structured `Validated<T>` failure happens in engine, so callers see the same behavior they had before. What changes is purely *where the validation logic lives*: it moves out of engine's loader files and into protocol, accessible to any consumer that already has bytes (notably the cafe).

The cafe consumes protocol's bytes-validators directly — it never goes through engine, because engine is Bun-native and the cafe runs on Node. Cafe's I/O (reading from S3, parsing the upload body) is its own concern; it just hands the resulting bytes to `validateFacetManifest`.

**Alternatives considered:**

- *Keep loader APIs identical, just port `Bun.file → node:fs/promises` internally*. Rejected — loses the cafe's primary use case (validating bytes from S3 without temp files) and conflates I/O with validation. Also unnecessarily forces engine off Bun for no benefit to engine.
- *Move only the validators to protocol, leave path-loaders in engine unchanged*. This is what we're doing — same result, just framed as a redesign because the loader files in engine end up with a different shape (thin wrappers around protocol calls instead of inline schema validation).

### Decision 4: Release pipeline changes

`scripts/release/publish.ts` already parses any tag matching the per-package format (`<pkg-name>@<version>`) via `parseTag`, so adding `@agent-facets/protocol` and `@agent-facets/engine` requires no script changes — verified in advance and noted in tasks.

`.changeset/config.json` linked-version groupings MUST be updated:
- Remove `@agent-facets/core` from any `linked` group.
- Add `@agent-facets/protocol` to the existing linked group with `@agent-facets/adapter` and `agent-facets` (CLI). Rationale: the protocol's surface is consumed by the CLI; keeping them version-linked avoids skew between published library and the CLI that depends on it.
- `@agent-facets/engine` is private (`"private": true` in package.json) and never publishes — the existing private-package guard in `scripts/release/publish.ts` handles it without further changes.

The first `@agent-facets/protocol` release SHOULD be `0.1.0` (initial version) created via the same changeset flow used for other packages.

### Decision 5: Tar assembly is protocol; gzip is engine

The integrity hash is computed over the **uncompressed** tar bytes (per the existing content-hashing spec). Therefore the deterministic tar layout — entry sort order, fixed file metadata (`mtime: 0`, `uid: 0`, `gid: 0`), the `INNER_ARCHIVE_NAME` and `BUILD_MANIFEST_NAME` constants — IS part of the contract any third party must reproduce. These move to protocol.

Gzip output is NOT hashed. Compression is a delivery concern: the cafe gunzips received archives with `node:zlib.gunzipSync` to recover the inner tar bytes, then hashes the inner tar. Different gzip implementations producing different compressed bytes are fine as long as gunzipping reproduces the same inner tar. So `compressArchive(tarBytes)` (today: `Bun.gzipSync`) moves to engine. Engine retains its Bun-native primitive — `Bun.gzipSync` is fine; this function never needs to run in protocol.

Protocol additionally exports a new `parseFacetArchive(bytes)` helper that takes outer-tar bytes and returns `{ buildManifest, innerArchiveBytes }` using `nanotar.parseTar`. This gives the cafe a one-call entry point for reading uploaded `.facet` files without needing to know the outer-tar internals.

## Risks / Trade-offs

- **[Risk] Circular import between protocol and engine.** Engine depends on protocol; if anything in protocol accidentally imports from engine, the build cycles. → **Mitigation**: an exploration step (in tasks) traces every protocol-bound file's imports before extraction; flagged cross-boundary imports get resolved by reclassification or API redesign before code moves.

- **[Risk] External consumers of `@agent-facets/core` break silently.** Anyone depending on `@agent-facets/core@0.9.1` is left on a frozen-but-installable package. If they later pin to a non-existent newer version, they get an install error with no signposting. → **Mitigation**: the project is closed-alpha and the only intended consumer of core's primitives — the cafe — never successfully consumed it (the Bun-runtime incompatibility this change resolves is the same reason cafe was blocked). We accept the silent-break risk for any other consumers as low-cost given the project's lifecycle stage. If a deprecation message is later deemed worth adding, a maintainer can run `npm deprecate @agent-facets/core@"*" "..."` as a one-off operational task.

- **[Risk] The `protocol__content-hashing` spec rename breaks any spec cross-references.** → **Mitigation**: an audit step (in tasks) greps for `content-hashing/` references across the repo before the rename and updates them in the same change.

- **[Trade-off] Engine remains Bun-native.** This is a deliberate non-goal but worth flagging: engine's `Bun.spawn`, `Bun.file`, `Bun.gzipSync` calls outside the protocol-bound files are not cleaned up. If a third party ever wants to embed engine on Node, they cannot. The bet is that nobody outside this monorepo will ever need engine — third parties consume protocol and build their own engine equivalent. If that bet turns out wrong, a separate change ports engine to Node.

## Migration Plan

The change applies in roughly the following order (full task breakdown lives in `tasks.md`):

1. **Inventory and audit phase** (read-only). Walk every file in `core/src/` and classify per Decision 1. Walk every external `@agent-facets/core` reference and build the rename-map. Trace coupling between protocol-bound and engine-bound code. Audit the release pipeline. Output: source-of-truth tables used for the rest of the change.

2. **Create `packages/protocol/` skeleton**. Empty `src/index.ts`, `package.json` with public access and Node engines field, `tsdown.config.ts`, `bunfig.toml`, `AGENTS.md`. No code moved yet.

3. **Move protocol-bound files into `protocol/src/`**. Schemas first (no Bun usage, leaf modules). Then integrity, front-matter, validators (also Bun-free). Then content-hash with the Bun→Node port (Decision 2). Then loader redesign per Decision 3. Then `parseFacetArchive` helper per Decision 5. Then `VersionSpec` extraction.

4. **Wire `protocol/src/index.ts`** with the full public API. Build, verify with a Node-only smoke test (Decision 2 verification).

5. **Rename `packages/core/` → `packages/engine/`** via `git mv`. Update its `package.json` (name, private, drop publishConfig, add `@agent-facets/protocol` workspace dep). Wire `engine/src/index.ts` with **only** engine-specific exports — no `export *` from protocol, no re-exports of protocol surface. Treat the size of the export list as a litmus test: if it grows uncomfortably large, the engine package's boundary is probably too broad and a future change SHOULD subdivide it. The same discipline applies to `protocol/src/index.ts` (but with a wider audience: third-party implementers, not just the CLI in this repo).

6. **Update engine internal imports** to consume from `@agent-facets/protocol`.

7. **Update CLI imports** across all 34 files to point at protocol (data types) or engine (services). Update `packages/cli/package.json` workspace deps.

8. **Update non-CLI consumers** (scripts, tests, docs, AGENTS.md files, openspec specs).

9. **Update release pipeline** per Decision 4. Add changeset entry.

10. **Verify** (full `bun check`, Node-only smoke test, changeset status).

**Rollback strategy**: Each phase commits independently. If a phase fails verification, the prior commits are still good. The most invasive operation is `git mv packages/core packages/engine` in step 5; before that point the change is purely additive (new package, no renames). After step 5, a full rollback requires reverting that commit and the subsequent CLI/script/doc updates — possible but costly. The verification gates after step 4 (protocol works standalone) and step 10 (everything works together) are the two main commit points.

## Documentation Impact

This design changes the codebase's package layout and the published npm surface. User-facing documentation in `docs/` MUST be updated as follows (also enumerated in the proposal's Documentation referenced section):

- **`README.md`** (root) — Package table currently lists `@agent-facets/core`. After this change it MUST list `@agent-facets/protocol` (public, Node-native, the artifact specification) and remove the `core` row.
- **`docs/docs/contributing/architecture.md`** (NEW) — Contributor-facing page explaining the three-layer architecture (protocol / engine / CLI), with the architecture diagram from the proposal as the centerpiece, and the design rationale for keeping the registry HTTP API outside the protocol. The diagram lives here long-term; the proposal's copy is for change-review context.
- **`docs/docs/contributing/release-pipeline.md`** — References to `@agent-facets/core` in the publishing pipeline MUST be updated to describe `@agent-facets/protocol` as the new published library and the changeset-linked grouping change from Decision 4.
- **`docs/docs/learn/index.md`** — Currently mentions `core`. MUST be corrected to remove the obsolete reference. The user-facing "Key Concepts" page does NOT need to teach the protocol/engine split (that's a contributor concern), but stale package names MUST go.
- **`packages/protocol/AGENTS.md`** (NEW) — Describes Layer 1 (the protocol package's role and constraints).
- **`packages/engine/AGENTS.md`** — Replaces `packages/core/AGENTS.md` after the directory rename. Describes Layer 2 (Bun-native CLI machinery, depends on protocol). MUST include the export discipline from Migration Plan step 5: engine's public surface is whatever the CLI consumes; do not add speculative exports; treat `src/index.ts` size as a boundary signal.
- **`packages/cli/AGENTS.md`** — Updates the "Boundary with `core`" section to describe the new boundaries with `protocol` and `engine`.

No conflicts with existing user-facing documentation: the user-facing CLI behavior is unchanged, so command reference pages (`docs/docs/cli/**`) require no updates.

## Open Questions

(none — all open questions raised during design have been resolved. The meta-spec question previously listed here was resolved in favor of adding a top-level `protocol/spec.md`; see Decision 6 below.)

## Additional Decision (resolved late in design review)

### Decision 6: A top-level `protocol/spec.md` meta-spec is added alongside the sub-specs

The protocol decomposes into five `protocol__*` sub-specs (`schemas`, `content-hashing`, `integrity`, `front-matter`, `version-spec`), each independent and covering one contract. But three classes of normative content do not fit cleanly into any sub-spec:

1. **What facet-compatibility means as a whole.** A system honoring some sub-specs but not others is not facet-compatible. This requires a normative claim that spans all sub-specs.
2. **How the protocol evolves over time.** Semver discipline, additive-change rules, deprecation policy — guarantees the published surface gives consumers about backward compatibility.
3. **The relationship between the published reference implementation and the normative requirements.** The TypeScript `@agent-facets/protocol` package is *a* reference implementation of the spec. The spec must constrain that relationship: divergence between package behavior and sub-specs is a package bug, not a spec bug.

These are constraints on the system. By the principle that specifications constrain and documentation describes, they belong in a spec — not in the architecture doc. The architecture doc remains the human-readable narrative; the meta-spec is the normative cross-cutting contract.

The resulting layout under `openspec/specs/`:

```
protocol/                  ← meta-spec (NEW)
protocol__schemas/         ← sub-spec
protocol__content-hashing/ ← sub-spec (renamed from content-hashing/)
protocol__integrity/       ← sub-spec
protocol__front-matter/    ← sub-spec
protocol__version-spec/    ← sub-spec
```

The meta-spec is one more sibling under the `protocol` category, not a parent that owns the others. Each sub-spec remains a fully independent spec file per spec-governance.

**Alternatives considered:**

- *No meta-spec; rely on the architecture doc for cross-cutting framing.* Rejected — that demotes normative requirements (versioning discipline, conformance definition, package-vs-spec relationship) to descriptive documentation. Specs constrain the system; the architecture doc describes it. They are not substitutable.
- *Put cross-cutting requirements in each relevant sub-spec.* Rejected — would duplicate the same versioning rule across five files and still leave "what facet-compatibility means as a whole" homeless.

This decision is captured here (out of numerical sequence) because it was resolved during design review after Decisions 1-5 were locked in. The final spec count for this change is six: one meta-spec and five sub-specs.
