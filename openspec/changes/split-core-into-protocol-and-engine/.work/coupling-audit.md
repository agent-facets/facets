# Coupling Audit: Protocol-Bound Files in `packages/core/src/`

Audit goal: confirm import direction is uniformly **engine → protocol**, never the inverse, for every file slated to move into `@agent-facets/protocol`.

Conventions used below:
- **OK — pure node:* / external dep**: `node:*`, `arktype`, `nanotar`, `yaml`, etc. Protocol may depend on these.
- **OK — workspace dep**: `@agent-facets/common` (allowed per Decision 1 / `packages/common/AGENTS.md`).
- **OK — protocol-bound**: imports from another file in the protocol-bound set.
- **PROBLEM — engine-bound**: imports from a file the inventory classifies as engine-bound. Would create an engine→protocol→engine cycle if left unresolved.

---

## 1. Per-file import audit

### `schemas/build-manifest.ts` (→ protocol)
- Imports:
  - `from 'arktype'` — OK external dep
- Imported by (in `core/src/`):
  - `install/run-install.ts` (engine-bound — fine)
  - `install/materialize.ts` (engine-bound — fine; via `lockfile.ts` re-export downstream not relevant here)
  - `cache/operations.ts` (engine-bound — fine)
  - `index.ts` (engine-bound public re-export — fine)
  - `__tests__/run-install.test.ts`, `__tests__/cache.test.ts` (engine-bound tests — fine)

### `schemas/facet-manifest.ts` (→ protocol)
- Imports:
  - `from '@agent-facets/common'` (`validateAssetName`) — OK workspace dep
  - `from 'arktype'` — OK external dep
- Imported by:
  - `loaders/facet.ts` (protocol-bound — fine)
  - `build/detect-collisions.ts` (protocol-bound — fine)
  - `build/validate-facets.ts` (protocol-bound — fine)
  - `build/validate-adapters.ts` (engine-bound — fine)
  - `edit/types.ts`, `edit/operations.ts`, `edit/manifest-writer.ts`, `edit/reconcile.ts` (engine-bound — fine)
  - `index.ts` (engine-bound — fine)
  - `__tests__/build-pipeline.test.ts`, `__tests__/facet-manifest.test.ts`, `__tests__/edit.test.ts` (engine-bound — fine)

### `schemas/lockfile.ts` (→ protocol)
- Imports:
  - `from '@agent-facets/common'` (`validateAssetName`) — OK workspace dep
  - `from 'arktype'` — OK external dep
- Imported by:
  - `install/run-install.ts`, `install/materialize.ts`, `install/lockfile-io.ts`, `install/types.ts` (engine-bound — fine)
  - `install/__tests__/resolve-clone-ref.test.ts`, `__tests__/run-install.test.ts`, `__tests__/lockfile.test.ts` (engine-bound — fine)
  - `index.ts` (engine-bound — fine)

### `schemas/project-manifest.ts` (→ protocol)
- Imports:
  - `from 'arktype'` — OK external dep
- Imported by:
  - `install/run-install.ts` (engine-bound — fine)
  - `manifest/project-files.ts`, `manifest/mutations.ts` (engine-bound — fine)
  - `index.ts`, `__tests__/project-manifest.test.ts` (engine-bound — fine)

### `schemas/server-manifest.ts` (→ protocol)
- Imports:
  - `from 'arktype'` — OK external dep
- Imported by:
  - `loaders/server.ts` (protocol-bound — fine)
  - `index.ts`, `__tests__/server-manifest.test.ts` (engine-bound — fine)

---

### `loaders/validate.ts` (→ protocol — bytes-validator parts only)
- Imports:
  - `from '@agent-facets/common'` (`ValidationError` type) — OK workspace dep
  - `from 'arktype'` (`type` for error mapping) — OK external dep
- Imported by:
  - `loaders/facet.ts` (protocol-bound — fine)
  - `loaders/server.ts` (protocol-bound — fine)
  - `manifest/mutations.ts` (engine-bound — fine; uses `mapArkErrors`)
- Note: This file already mixes pure functions (`mapArkErrors`, `parseJson`) with one filesystem-touching helper (`readFile`, which calls `Bun.file().exists()` and `.text()`). The bytes-validator parts (`mapArkErrors`, `parseJson`) are pure and protocol-safe. `readFile` is the path-based piece that should stay in engine.

### `loaders/facet.ts` (→ protocol — bytes-validator parts only; `loadManifest` & `resolvePrompts` stay in engine)
- Imports:
  - `from 'node:path'` (`join`) — OK node external
  - `from '@agent-facets/common'` (`Validated`, `ValidationError`) — OK workspace dep
  - `from 'arktype'` (`type`) — OK external dep
  - `from '../schemas/facet-manifest.ts'` — OK protocol-bound
  - `from './validate.ts'` — OK protocol-bound (within bytes-validator subset)
- Imported by:
  - `install/run-install.ts`, `install/materialize.ts` (engine-bound — fine; consume `loadManifest` / `ResolvedFacetManifest`)
  - `build/pipeline.ts` (engine-bound — fine)
  - **`build/content-hash.ts`** (PROTOCOL-BOUND — see Problem #1 below)
  - **`build/validate-content.ts`** (PROTOCOL-BOUND — see Problem #2 below)
  - `edit/context.ts`, `edit/manifest-writer.ts` (engine-bound — fine)
  - `scaffold/index.ts` (engine-bound — fine)
  - `index.ts`, `__tests__/materialize.test.ts`, `__tests__/facet-loader.test.ts`, `__tests__/content-hash.test.ts` (engine-bound — fine)
- Note: This file is genuinely split across protocol/engine. The exports it provides:
  - `FACET_MANIFEST_FILE` (constant) — needed by protocol-bound `content-hash.ts`
  - `ResolvedFacetManifest` (type) — needed by protocol-bound `content-hash.ts` and `validate-content.ts`
  - `loadManifest`, `resolvePrompts`, `resolveAssetPrompt` — engine (path-based)

### `loaders/server.ts` (→ protocol — bytes-validator parts only)
- Imports:
  - `from 'node:path'` — OK node external
  - `from '@agent-facets/common'` — OK workspace dep
  - `from 'arktype'` — OK external dep
  - `from '../schemas/server-manifest.ts'` — OK protocol-bound
  - `from './validate.ts'` — OK protocol-bound
- Imported by:
  - `index.ts`, `__tests__/server-loader.test.ts` (engine-bound — fine)
- Note: same shape as `loaders/facet.ts` — `loadServerManifest` is the path-based wrapper that goes to engine; the schema validation it does is the protocol part. Currently the file has only one exported function, which is the path wrapper. There is no separate bytes-validator export today; that surface needs to be created when splitting.

---

### `front-matter.ts` (→ protocol)
- Imports:
  - `from '@agent-facets/common'` (`normalizeLineEndings`) — OK workspace dep
  - `from 'yaml'` (`parse as parseYaml`) — OK external dep
- Imported by:
  - `index.ts` only (engine-bound public re-export — fine)
- Note: Cleanest file in the audit. No internal callers outside `index.ts`; pure functions only.

---

### `integrity/index.ts` (→ protocol)
- Imports:
  - `from './types.ts'` — OK protocol-bound
  - `from './verify.ts'` — OK protocol-bound
- Imported by:
  - `install/run-install.ts`, `install/types.ts` (engine-bound — fine)
  - `index.ts`, `__tests__/integrity.test.ts` (engine-bound — fine)

### `integrity/types.ts` (→ protocol)
- Imports: NONE
- Imported by:
  - `integrity/index.ts`, `integrity/verify.ts` (protocol-bound — fine)
  - `cache/operations.ts` (engine-bound — fine; imports `AssetIntegrityFailure`, `FacetIntegrityFailure`, `IntegrityFailure`)

### `integrity/verify.ts` (→ protocol)
- Imports:
  - `from './types.ts'` — OK protocol-bound
- Imported by:
  - `integrity/index.ts` (protocol-bound — fine)

---

### `build/content-hash.ts` (→ protocol — except `compressArchive`, which stays in engine)
- Imports:
  - `from 'nanotar'` (`createTar`, `TarFileInput`) — OK external dep
  - **`from '../loaders/facet.ts'`** (`FACET_MANIFEST_FILE`, `ResolvedFacetManifest`) — see resolution
- Imported by:
  - `build/pipeline.ts` (engine-bound — fine)
  - `cache/operations.ts` (engine-bound — fine)
  - `index.ts`, `__tests__/run-install.test.ts`, `__tests__/build-pipeline.test.ts`, `__tests__/cache.test.ts`, `__tests__/content-hash.test.ts` (engine-bound — fine)
- The `compressArchive` function uses `Bun.gzipSync` — this is the only piece that the inventory explicitly excludes from protocol. Splitting it out is a one-line move; the rest of the file (hashing, deterministic tar assembly, archive entry collection) is pure and protocol-safe.
- Status: see **Problem #1** below — the import from `loaders/facet.ts` IS allowed because both `FACET_MANIFEST_FILE` and `ResolvedFacetManifest` are part of the bytes-validator slice of `loaders/facet.ts` that moves to protocol. So this is internally consistent within the protocol boundary. Flagged for visibility because the apparent direction looks bad on first read.

### `build/detect-collisions.ts` (→ protocol)
- Imports:
  - `from '@agent-facets/common'` (`AssetType`, `ValidationError`) — OK workspace dep
  - `from '../schemas/facet-manifest.ts'` — OK protocol-bound
- Imported by:
  - `build/pipeline.ts` (engine-bound — fine)
  - `index.ts`, `__tests__/build-pipeline.test.ts` (engine-bound — fine)

### `build/validate-content.ts` (→ protocol)
- Imports:
  - `from '@agent-facets/common'` (`ValidationError`) — OK workspace dep
  - **`from '../loaders/facet.ts'`** (`ResolvedFacetManifest`) — see Problem #2 below for status
- Imported by:
  - `build/pipeline.ts` (engine-bound — fine)
  - `index.ts` is NOT explicitly re-exporting this one (verified — only `validateAdapterMetadata` and `validateCompactFacets` and `detectNamingCollisions` are re-exported from `build/`); it's used internally by the build pipeline.
- Status: same as `content-hash.ts` — depends on `ResolvedFacetManifest` being moved as part of the bytes-validator slice. Internally consistent within the protocol boundary, but flagged because it depends on a non-obvious split of `loaders/facet.ts`.

### `build/validate-facets.ts` (→ protocol)
- Imports:
  - `from '@agent-facets/common'` (`ValidationError`) — OK workspace dep
  - `from '../schemas/facet-manifest.ts'` — OK protocol-bound
- Imported by:
  - `build/pipeline.ts` (engine-bound — fine)
  - `index.ts`, `__tests__/build-pipeline.test.ts` (engine-bound — fine)

---

### `sources/facet/types.ts` (→ protocol — only `VersionSpec`, grammar regex constants, `resolvesToLatest`; `Source`, `ParseError`, `ParseErrorCode`, `ParseResult` stay in engine)
- Imports: NONE
- Imported by:
  - `sources/facet/parse-version.ts` (engine-bound, but slated to move alongside? — see Problem #3 below)
  - `sources/facet/parse-source.ts` (engine-bound — fine)
  - `install/types.ts` (engine-bound — uses `ParseError`)
  - `registry/types.ts`, `registry/describe.ts` (engine-bound — uses `VersionSpec`)
  - `index.ts` (engine-bound — re-exports the union)
- Status: see **Problem #3** below — the file itself must be split into protocol-bound pieces and engine-bound pieces. Crucially, the inventory's phrase "the grammar regex constants" is misplaced: there are NO grammar regex constants in `types.ts`. The only regex literal in `types.ts` is none. The grammar regex constants (`PATH_RE`, `SCP_RE`, `GITHUB_RE`, `SCHEME_RE`, `REGISTRY_RE`) all live in `sources/facet/parse-source.ts`, which the inventory classifies as engine-bound. This is an inventory inconsistency, not a coupling problem.

---

## 2. Coupling problems

### Problem #1 — `build/content-hash.ts` imports from `loaders/facet.ts`

**What**: `content-hash.ts` imports `FACET_MANIFEST_FILE` (constant) and `ResolvedFacetManifest` (type) from `loaders/facet.ts`. The inventory says `loadManifest` and `resolvePrompts` stay in engine while only the bytes-validator parts of `loaders/facet.ts` move to protocol.

**Why it isn't a cycle in practice**: `FACET_MANIFEST_FILE` is a pure string constant and `ResolvedFacetManifest` is a pure interface — neither has any path-based behavior. They naturally belong to the bytes-validator slice that moves to protocol. The import direction stays engine→protocol once the split is done correctly.

**Resolution — API redesign (file split)**:
When splitting `loaders/facet.ts` between protocol and engine, the protocol-bound module must export:
- `FACET_MANIFEST_FILE` — constant
- `ResolvedFacetManifest` — interface

The engine-bound module retains:
- `loadManifest` (path → file → JSON parse → schema validate)
- `resolvePrompts` (manifest + rootDir → resolved with prompt strings)
- `resolveAssetPrompt` (private helper that touches `Bun.file`)

A natural split would be: `protocol/facet-manifest-types.ts` (constant + `ResolvedFacetManifest`) and `engine/loaders/facet.ts` (the I/O wrappers, importing types from protocol).

### Problem #2 — `build/validate-content.ts` imports from `loaders/facet.ts`

**What**: Same shape as Problem #1 — imports `ResolvedFacetManifest` from `loaders/facet.ts`.

**Resolution**: identical — falls out of the same split. Once `ResolvedFacetManifest` is in a protocol-bound module, this import is fine.

### Problem #3 — `sources/facet/types.ts` is half-moving

**What**: The inventory wants `VersionSpec` and `resolvesToLatest` to move to protocol, but `Source`, `ParseError`, `ParseErrorCode`, and `ParseResult` to stay in engine. The file is currently one unit. Also, the inventory references "grammar regex constants" in `types.ts` — those constants don't exist in `types.ts`; they live in `parse-source.ts`.

**Resolution — API redesign (file split + inventory clarification)**:
Split `sources/facet/types.ts` into two files:
- `protocol: sources/version-spec.ts` — `VersionSpec`, `resolvesToLatest`. Pure data and a pure predicate; no dependencies. Also, since `parseVersionSpec` (currently in `sources/facet/parse-version.ts`) is a pure parser of byte-level input that returns `VersionSpec` and only depends on `ParseResult`, consider whether it too belongs in protocol; if so, move `ParseResult`/`ParseError`/`ParseErrorCode` (the result envelope) to protocol as well — they're pure data. The boundary should land at "registry-name parsing and source-kind discrimination," not in the middle of a parser.
- `engine: sources/facet/source-types.ts` — `Source`, plus whatever parser-result types stay engine-side.

Inventory clarification needed: the "grammar regex constants" the inventory calls out almost certainly refer to those in `parse-source.ts` (`PATH_RE`, `SCP_RE`, `GITHUB_RE`, `SCHEME_RE`, `REGISTRY_RE`). The author of the inventory should reconfirm whether those move to protocol; doing so would also pull `parseFacetSource` itself across, which seems aligned with the pattern of "all pure parsing of bytes lives in protocol." This is NOT a coupling problem in the import-graph sense; it's a scope-of-split clarification.

---

## 3. Summary

- **Total protocol-bound files audited**: 17
  - `schemas/`: 5 files (`build-manifest.ts`, `facet-manifest.ts`, `lockfile.ts`, `project-manifest.ts`, `server-manifest.ts`)
  - `loaders/`: 3 files, partial (`validate.ts`, `facet.ts`, `server.ts` — bytes-validator parts only)
  - `front-matter.ts`: 1 file
  - `integrity/`: 3 files (`index.ts`, `types.ts`, `verify.ts`)
  - `build/`: 4 files (`content-hash.ts` minus `compressArchive`, `detect-collisions.ts`, `validate-content.ts`, `validate-facets.ts`)
  - `sources/facet/types.ts`: 1 file, partial
- **Files with fully clean imports (no cross-boundary)**: 13
  - All 5 schemas
  - `loaders/validate.ts`, `loaders/server.ts`, `loaders/facet.ts` (clean once split-between-protocol-and-engine is the basis)
  - `front-matter.ts`
  - All 3 integrity files
  - `build/detect-collisions.ts`, `build/validate-facets.ts`
- **Files with PROBLEMS**: 4 (but all of them resolve via file-splitting, not redirection of import direction)
  - `build/content-hash.ts` — Problem #1 (depends on `loaders/facet.ts` split working as intended)
  - `build/validate-content.ts` — Problem #2 (same)
  - `loaders/facet.ts` — needs to be split itself (provides exports that BOTH sides need)
  - `sources/facet/types.ts` — needs to be split itself (Problem #3)

### Net assessment: **YELLOW**

There are no PROBLEM-class engine→protocol→engine cycles. Every "problem" is a **file-splitting** issue, not a **dependency-inversion** issue:
- `loaders/facet.ts` is one file today but contains a clean pure/impure boundary that maps cleanly onto protocol/engine. The two protocol-bound importers (`build/content-hash.ts`, `build/validate-content.ts`) only consume the pure exports; the import direction stays engine→protocol once the file is physically split.
- `sources/facet/types.ts` similarly mixes types that go to protocol with types that stay in engine. No file currently imports the engine-only types from protocol-bound files, so no inversion exists today.

No file in the protocol-bound set imports from a file that is unambiguously engine-bound in a way that would survive the split. The remaining work is mechanical:
1. Split `loaders/facet.ts` into a protocol-side module (constant + `ResolvedFacetManifest`) and an engine-side module (`loadManifest`, `resolvePrompts`).
2. Split `loaders/server.ts` similarly if its bytes-validator slice is going to be exposed independently of the path wrapper.
3. Split `loaders/validate.ts` to keep `readFile` engine-side (it touches `Bun.file`) and the JSON-parse + ark-error mapper protocol-side.
4. Split `sources/facet/types.ts` into `version-spec.ts` (protocol) and `source-types.ts` (engine), and clarify the inventory's note about "grammar regex constants" (they aren't in this file).
5. Move `compressArchive` out of `build/content-hash.ts` into an engine-side helper.

If those splits happen as described, the import graph becomes uniformly engine→protocol. The risk profile is low because the splits follow natural seams already present in the source.

