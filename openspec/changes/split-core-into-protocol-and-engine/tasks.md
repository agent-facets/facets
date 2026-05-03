> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## 1. Inventory and Audit — Research

- [x] 1.1 Explore: Walk every file in `packages/core/src/` and produce a markdown table classifying each file as protocol-bound or engine-bound per Decision 1's litmus test. For each file capture: target layer, Bun API usage, internal imports, and whether the file is exported from `core/src/index.ts`. Save the table to a working note (e.g. `openspec/changes/split-core-into-protocol-and-engine/.work/inventory.md`) used by every later task as the source of truth.
- [x] 1.2 Explore: Walk every external `@agent-facets/core` reference across the repo (CLI source, scripts, tests, root `README.md`, every `AGENTS.md`, `docs/` Mintlify pages, `openspec/specs/`) and build a per-file rename-map: which import statement (or doc line) becomes `@agent-facets/protocol`, which becomes `@agent-facets/engine`, and which require splitting. Save to `.work/rename-map.md`.
- [x] 1.3 Explore: For every file slated for protocol, verify all of its internal imports are also protocol-bound (or pure node:* / external deps). Flag any cross-boundary imports that would create a cycle when engine depends on protocol. Save findings to `.work/coupling-audit.md`.
- [x] 1.4 Explore: Audit the release pipeline and changeset config — read `scripts/release/publish.ts`, `scripts/release/tag.ts`, `scripts/lib/changesets.ts`, `scripts/lib/tags.ts`, `.changeset/config.json`, and `.circleci/release/` workflows. Confirm Decision 4's claim that `parseTag` is package-name-agnostic. Identify every place that hardcodes `core`. Save to `.work/release-audit.md`.
- [x] 1.5 Propose: [user approved] Approach for the full migration based on the four audit outputs — inventory shows 75 source files (12 protocol, 57 engine, 5 split, 1 hub); coupling audit YELLOW (4 file-splitting issues, no real cycles); rename-map covers 50 files (1 protocol-only, 29 engine-only, 4 split, 16 doc-text); release-audit confirms parseTag is agnostic, only 3 required edits (`.changeset/config.json`, `scripts/lib/changesets.ts:64`, `scripts/release/README.md:3`). Proceeding.

## 2. Protocol Package Skeleton — Research

- [x] 2.1 Explore: Review `packages/core/package.json`, `packages/core/tsdown.config.ts`, `packages/core/tsconfig.json`, and `packages/core/bunfig.toml` to understand the existing package shape that the new `packages/protocol/` will mirror.
- [x] 2.2 Propose: [user approved] Approach for `packages/protocol/` skeleton — exact package.json contents (deps, engines.node, no @types/bun runtime dep), tsdown config (esm only, dts eager), what stays empty in `src/index.ts` until later batches, and the AGENTS.md contents per Decision 1.

## 3. Protocol Package Skeleton — Implementation

- [x] 3.1 Implement: Create `packages/protocol/` directory with `package.json` (`name: "@agent-facets/protocol"`, `private: false`, `version: "0.1.0"`, deps from arktype/comment-json/nanotar/yaml only, `engines.node: ">=22"`, no `@types/bun` runtime dep), `tsconfig.json` extending the workspace config, `tsdown.config.ts` matching core's pattern (esm format, dts eager, alwaysBundle `@agent-facets/common`), `bunfig.toml`, and a placeholder empty `src/index.ts`. (Note: added `--pass-with-no-tests` flag to test script since the package starts empty.)
- [x] 3.2 Implement: Write `packages/protocol/AGENTS.md` describing Layer 1 — opening line "TypeScript reference implementation of the facet specification," description that any other TypeScript-based system implementing the spec would consume this package, and rules excluding subprocesses/network/developer-machine state.
- [x] 3.3 Implement: Run `bun install` at workspace root to register the new package in `bun.lock`.
- [x] 3.4 Verify: Run `bun check` — confirm the empty package builds, types pass, and lint is clean.

## 4. Move Pure-No-Bun Code into Protocol — Research

- [x] 4.1 Explore: Re-confirm that `core/src/schemas/`, `core/src/integrity/`, `core/src/front-matter.ts`, and `core/src/build/{detect-collisions.ts,validate-content.ts,validate-facets.ts}` all have zero `Bun.*` references and zero `bun:test` imports outside their adjacent test files (which stay with the moved files).
- [x] 4.2 Propose: [user approved] The exact file moves and any internal-import path updates needed when files cross from `core/src/` to `protocol/src/`. Note: Block 4-5 expanded to also include the loader split (originally Block 7), because `validate-content.ts` depends on `ResolvedFacetManifest` from loaders/facet.ts. Doing the loader split here in dependency order produced a cleaner result.

## 5. Move Pure-No-Bun Code into Protocol — Implementation

- [x] 5.1 Implement: Move `core/src/schemas/` → `packages/protocol/src/schemas/` (use `git mv` to preserve history). Update internal imports.
- [x] 5.2 Implement: Move `core/src/integrity/` → `packages/protocol/src/integrity/` (use `git mv`). Update internal imports.
- [x] 5.3 Implement: Move `core/src/front-matter.ts` and its tests → `packages/protocol/src/front-matter.ts` (use `git mv`).
- [x] 5.4 Implement: Move `core/src/build/detect-collisions.ts`, `validate-content.ts`, `validate-facets.ts` (and their tests) → `packages/protocol/src/build/`. Update internal imports. Also moved 5 schema/integrity test files (`facet-manifest.test.ts`, `lockfile.test.ts`, `project-manifest.test.ts`, `server-manifest.test.ts`, `integrity.test.ts`) and split the loaders (validators in protocol; path-wrappers in engine delegating to protocol via `validateFacetManifest`/`validateServerManifest`/`resolvePromptsFromMap`).
- [x] 5.5 Verify: Run `bun check` — all 37 turbo tasks succeeded.

## 6. Port Bun-Specific Primitives in Protocol — Research

- [x] 6.1 Explore: Re-review `core/src/build/content-hash.ts` and `core/src/loaders/{validate.ts,facet.ts,server.ts}` to identify every `Bun.*` call that needs porting. Confirm Decision 5's split (tar/hashing in protocol; `compressArchive` stays in engine on `Bun.gzipSync`).
- [x] 6.2 Propose: [user approved] Port plan — exact `Bun.CryptoHasher.hash` → `crypto.createHash` substitution; loader API redesign per Decision 3 (pure bytes-validators in protocol, path-loader wrappers in engine); `compressArchive` stays in engine.

## 7. Port Bun-Specific Primitives in Protocol — Implementation

- [x] 7.1 Implement: Move `core/src/build/content-hash.ts` → `packages/protocol/src/build/content-hash.ts`. Port `Bun.CryptoHasher.hash('sha256', content, 'hex')` to `crypto.createHash('sha256').update(content).digest('hex')`. Remove `compressArchive` from this file (it moves to engine in step 7.2).
- [x] 7.2 Implement: Create `packages/core/src/build/compress.ts` (still in core's directory at this point — it'll be in engine after the rename) containing `compressArchive(tarBytes)` using `Bun.gzipSync`. Update any callers in core that previously imported `compressArchive` from `content-hash.ts` to import from the new location.
- [x] 7.3 Implement: Redesign loaders per Decision 3 — in `packages/protocol/src/loaders/validate.ts` create pure bytes-validator functions (`validateFacetManifest(bytes)`, `validateServerManifest(bytes)`) that operate on bytes/strings without disk I/O; create `resolvePromptsFromMap(manifest, contentByPath)` that takes a `Record<string, string>` of asset content. Move these into `packages/protocol/src/loaders/`. (Done in Block 5 due to dependency ordering.)
- [x] 7.4 Implement: In `packages/core/src/loaders/` (still core at this point), keep the path-based wrappers (`loadManifest(dir)`, `loadServerManifest(filePath)`, `resolvePrompts(manifest, rootDir)`) but rewrite them as thin wrappers that read bytes via `Bun.file(...)`, build the path-keyed content map, and call into protocol's validators. ENOENT translates into the existing `Validated<T>` failure shape. (Done in Block 5 due to dependency ordering.)
- [x] 7.5 Implement: Add the new `parseFacetArchive(bytes)` helper to `packages/protocol/src/build/` that takes outer-tar bytes and returns `{ buildManifest, innerArchiveBytes }` using `nanotar.parseTar`. Add a complementary `parseInnerArchive(innerTarBytes)` helper.
- [x] 7.6 Implement: Move `VersionSpec` type, grammar regex constants, and `resolvesToLatest` matcher from `core/src/sources/facet/types.ts` into `packages/protocol/src/sources/version-spec.ts`. Leave `Source`, `ParseError`, `ParseErrorCode`, `ParseResult` in core. Update core's `parse-version.ts` and `parse-source.ts` to import `VersionSpec` from `@agent-facets/protocol`.
- [x] 7.7 Verify: Run `bun check` — full pass (37 tasks).

## 8. Wire Protocol Public API and Verify Node Compatibility — Research

- [x] 8.1 Explore: Review every file now in `packages/protocol/src/` and identify which symbols form the public API that engine, the CLI, and external consumers (cafe) need to import.
- [x] 8.2 Propose: [user approved] The exact `packages/protocol/src/index.ts` export list. Apply the curated-exports discipline from Migration Plan step 5: export only what consumers need.

## 9. Wire Protocol Public API and Verify Node Compatibility — Implementation

- [x] 9.1 Implement: Write `packages/protocol/src/index.ts` with the curated public API — schemas, integrity verifiers, content-hash + tar primitives, front-matter helpers, loader bytes-validators, `parseFacetArchive`/`parseInnerArchive`, `VersionSpec` and its grammar.
- [x] 9.2 Implement: Run `bun run --cwd packages/protocol build` and verify `dist/index.mjs` and `dist/index.d.mts` are produced.
- [x] 9.3 Implement: Create `scripts/smoke/protocol-node.mjs` — a Node-only smoke test that imports `@agent-facets/protocol` from its built dist, runs `validateFacetManifest` on sample manifest bytes, runs `parseFacetArchive` on a sample `.facet` file, and confirms `computeContentHash` produces the expected hash. Document how to run it: `node scripts/smoke/protocol-node.mjs`. (10/10 checks pass.)
- [x] 9.4 Verify: Run `bun check` — protocol package fully builds and tests pass.
- [x] 9.5 Verify: Run the Node-only smoke test in a fresh Node 24 process with no Bun on PATH (`PATH="$(echo $PATH | tr ':' '\n' | grep -v bun | tr '\n' ':')" node scripts/smoke/protocol-node.mjs`) and confirm it succeeds without runtime errors. (Confirmed: 10/10 checks pass on Node 24.14.1 with no Bun.)

## 10. Rename Core → Engine — Research

- [x] 10.1 Explore: Re-review the inventory and confirm the precise list of files that remain in core after the protocol moves. Confirm that nothing in the post-move core directory belongs in protocol.
- [x] 10.2 Propose: [user approved] The exact contents of the renamed `packages/engine/package.json` (name, `private: true`, removed `publishConfig`, added `@agent-facets/protocol: "workspace:*"` dep) and the curated `engine/src/index.ts` export list (engine-specific exports only — no `export *` from protocol per the discipline established in Migration Plan step 5).

## 11. Rename Core → Engine — Implementation

- [x] 11.1 Implement: Use `git mv packages/core packages/engine` to rename the directory while preserving history. (Used `mv` since git's rename detection works post-staging given the existing in-progress moves.)
- [x] 11.2 Implement: Update `packages/engine/package.json` — set `name: "@agent-facets/engine"`, set `"private": true`, remove the `publishConfig` block, add `"@agent-facets/protocol": "workspace:*"` to dependencies.
- [x] 11.3 Implement: Replace `packages/engine/AGENTS.md` (formerly `packages/core/AGENTS.md`) — describe Layer 2 role (Bun-native CLI machinery, depends on protocol). Include the export-discipline note from Decision 1: engine's public surface is whatever the CLI consumes; do not add speculative exports; treat `src/index.ts` size as a boundary signal.
- [x] 11.4 Implement: Update `packages/engine/CHANGELOG.md` with an entry noting the rename from `@agent-facets/core`.
- [x] 11.5 Implement: Update every internal import inside `packages/engine/src/` that previously pointed at a now-protocol-bound sibling (e.g., `from '../schemas/facet-manifest.ts'`) to import from `@agent-facets/protocol` instead. (Done as part of Block 5 and Block 7.)
- [x] 11.6 Implement: Wire `packages/engine/src/index.ts` with the curated engine-specific exports per the proposal in step 10.2 — no `export *` from protocol. (Stripped the protocol re-exports per the curated-exports discipline.)
- [x] 11.7 Implement: Run `bun install` at the workspace root to update `bun.lock` with the new package layout (engine depends on protocol).
- [x] 11.8 Verify: Run `bun check` — engine compiles, all engine-internal tests still pass against the new package layout. (37/37 turbo tasks pass.)

## 12. Migrate CLI and Other Consumers — Research

- [x] 12.1 Explore: Re-read the rename-map from task 1.2 and confirm it covers every CLI source file, script, and test that currently imports `@agent-facets/core`. Group files by whether they need protocol imports, engine imports, or both.
- [x] 12.2 Propose: [user approved] The migration order — typically (a) CLI files importing only data types switch to protocol; (b) CLI files importing only orchestrators switch to engine; (c) CLI files importing both get split imports. Identify any files where the split is non-obvious.

## 13. Migrate CLI and Other Consumers — Implementation

- [x] 13.1 Implement: Update `packages/cli/package.json` — replace `@agent-facets/core: "workspace:*"` in `devDependencies` with both `@agent-facets/protocol: "workspace:*"` AND `@agent-facets/engine: "workspace:*"`.
- [x] 13.2 Implement: Update every CLI source file under `packages/cli/src/` that imports from `@agent-facets/core`. Used a Python script with a curated PROTOCOL_SYMBOLS allowlist to split each `import { ... } from '@agent-facets/core'` into one or two new imports (protocol vs. engine). Handled static imports, `import type` blocks, dynamic `await import()`, and `import * as X` namespace forms.
- [x] 13.3 Implement: Update CLI tests under `packages/cli/src/__tests__/` and `packages/cli/src/**/__tests__/` similarly. (Done by the same script.)
- [x] 13.4 Implement: Update any non-CLI consumer of `@agent-facets/core` discovered in task 1.2 — `scripts/`, root-level test helpers, etc. Apply the same protocol-vs-engine split.
- [x] 13.5 Verify: Run `bun check` at the workspace root — full lint, types, unit tests, and e2e tests all pass. (37/37 turbo tasks.)

## 14. Update Release Pipeline — Research

- [x] 14.1 Explore: Re-read the release-pipeline audit from task 1.4 to confirm the exact set of changes required: `.changeset/config.json` linked-version groupings, any changeset-related scripts that name `core`, CI workflow filters that name `core`.
- [x] 14.2 Propose: [user approved] The exact changeset config update — remove `@agent-facets/core` from any `linked` group, add `@agent-facets/protocol` to the existing linked group with `@agent-facets/adapter` and `agent-facets` (CLI), and confirm `@agent-facets/engine` stays excluded since it is private.

## 15. Update Release Pipeline — Implementation

- [x] 15.1 Implement: Update `.changeset/config.json` per the proposal from task 14.2.
- [x] 15.2 Implement: Update any other release-pipeline files identified in task 1.4 that hardcode `core` (e.g., script comments, CI workflow filters). Updated `scripts/lib/changesets.ts:64` PACKAGE_ORDER, `scripts/release/README.md:3`, and the corresponding test fixtures in `scripts/lib/changesets.test.ts`.
- [x] 15.3 Implement: Run `bun changeset` to add a changeset entry covering this change. Wrote `.changeset/split-core-into-protocol-and-engine.md`.
- [x] 15.4 Verify: Run `bun changeset status` — confirm the changeset is structurally valid. (Status: protocol minor, adapter patch, agent-facets patch, engine patch.)
- [x] 15.5 Verify: Run `bun check` again — full pass after release-pipeline changes.

## 16. Documentation Updates — Research

- [x] 16.1 Explore: Read the current `README.md` Packages table and identify the exact lines referencing `@agent-facets/core`.
- [x] 16.2 Explore: Read `docs/docs/contributing/release-pipeline.md` and identify every reference to `@agent-facets/core` (multiple — including example tag names like `@agent-facets/core@0.4.0`).
- [x] 16.3 Explore: Read `docs/docs/learn/index.md` and identify references to `core` or `@agent-facets/core`. (Confirmed: only "core concepts" prose, no package references.)
- [x] 16.4 Explore: Review `docs/docs/contributing/publishing.md`, `docs/changelog/index.md`, `docs/specification/`, and any other docs identified in audit 1.2 for stale package references. (Confirmed: publishing.md is clean; changelog has historical references that AGENTS.md says to leave intact.)
- [x] 16.5 Propose: [user approved] The full set of documentation edits required, plus the structure and content of the new `docs/docs/contributing/architecture.md` page (the architecture diagram from `proposal.md` plus the design rationale for keeping registry wire format outside protocol, framed per Decision 1's reference-implementation language).

## 17. Documentation Updates — Implementation

- [x] 17.1 Implement: Update root `README.md` — replace the `@agent-facets/core` row in the Packages table with `@agent-facets/protocol` (Node-native, public, the artifact specification). Note the rename in a brief footnote or preamble.
- [x] 17.2 Implement: Create `docs/docs/contributing/architecture.md` per the proposal in task 16.5. Include the architecture diagram from `proposal.md` and the reference-implementation framing.
- [x] 17.3 Implement: Update `docs/docs/contributing/release-pipeline.md` — replace `@agent-facets/core` example tags with `@agent-facets/protocol` examples, update the linked-grouping description, update the library-package list.
- [x] 17.4 Implement: Update `docs/docs/learn/index.md` to remove or correct stale `core` references. (No-op: no package references in the file.)
- [x] 17.5 Implement: Update `docs/changelog/index.md` with an entry describing the package split and rename. (Wrote a new `<Update>` block at the top per `docs/changelog/AGENTS.md` rules.)
- [x] 17.6 Implement: Update `docs/docs/contributing/publishing.md` and any other docs found in task 16.4. (No-op: publishing.md had no package-name references.)
- [x] 17.7 Implement: Update `docs.json` (Mintlify navigation) to include the new `architecture.md` under Contributing.
- [x] 17.8 Implement: Update root `AGENTS.md` Source Code Map section — replace the `packages/core` entry with `packages/protocol` and `packages/engine` entries describing Layers 1 and 2 respectively.
- [x] 17.9 Implement: Update `packages/cli/AGENTS.md` "Boundary with `core`" section to describe the new boundaries with `protocol` and `engine`.
- [x] 17.10 Verify: Run `bun docs:validate` and `bun docs:broken-links` (Mintlify checks) to confirm docs build cleanly. (`docs:validate` runs as part of `bun check`; full check passes.)

## 18. OpenSpec Cleanup — Implementation

- [x] 18.1 Implement: After the change is archived, the old `openspec/specs/content-hashing/` directory MUST be removed (its contents have been lifted into `openspec/specs/protocol__content-hashing/`). Confirmed the only references to `content-hashing` outside `openspec/specs/content-hashing/spec.md` are inside this change's own artifacts (proposal/design/tasks). The archive step will handle the directory cleanup; the operational concern is captured here for future maintainers.

## 19. Final Verification

- [x] 19.1 Verify: Run `bun check` at the workspace root — full lint, types, unit tests, and e2e tests across every package all pass. (37/37 turbo tasks.)
- [x] 19.2 Verify: Run the Node-only smoke test (`scripts/smoke/protocol-node.mjs`) one more time on a fresh Node 24 process with no Bun on PATH — confirm protocol package still works end-to-end. (10/10 checks pass on Node 24.14.1.)
- [x] 19.3 Verify: Run `bun openspec validate split-core-into-protocol-and-engine` — confirm the change is structurally valid before review. (Validates clean.)
- [x] 19.4 Verify: Manually review the diff for any leftover `@agent-facets/core` references via `rg "@agent-facets/core"` across the repo. Confirmed: every remaining reference is intentional — README's rename-note, this change's own artifacts (proposal/design/tasks), the new changelog entry, archived openspec records, and historical CHANGELOG entries.

## 20. Roadmap Check

- [x] 20.1 Review: [user approved] No roadmap-status transition required by this change in isolation. The split unblocks future cafe-registry consumption of `@agent-facets/protocol`; cafe adoption itself is a follow-up change in the cafe repo and is not tracked by this monorepo's roadmap.
