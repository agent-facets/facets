# `@agent-facets/core` rename map

Per-file inventory of every external reference to `@agent-facets/core`
across the repo, excluding `packages/core/` itself, this change's own
directory (`openspec/changes/split-core-into-protocol-and-engine/`),
and the standard build/cache ignore set
(`node_modules`, `.git`, `dist`, `.turbo`, `.sst`, `test-results`).

Each file is classified as:

- **→ protocol** — imports/refers only to symbols that move into
  `@agent-facets/protocol` (schemas, validators, integrity primitives,
  content-hash, front-matter, version-spec, pure build validators,
  `parseFacetArchive`, `Validated`, `ValidationError`, `AssetType`,
  `Scope`, `LOCKFILE_VERSION`, `IntegrityFailure`, `IntegrityResult`,
  `FacetManifest`, `Lockfile`, `BuildManifest`).
- **→ engine** — imports/refers only to symbols that stay in
  `@agent-facets/engine` (orchestrators, install pipeline, registry
  client, adapter machinery, scaffold, edit, self-update, manifest
  mutations, cache, source resolvers, build orchestrator +
  `writeBuildOutput`, `BUILD_STAGES`, `runBuildPipeline`, `runInstall`,
  `loadInstalledAdapters`, `getRegistryBaseUrl`, `encodeFacetName`,
  `packFacetSource`, `installAdapter`, `listInstalledAdapters`,
  `removeAdapter`, `getAdapterBaseDir`, `FIRST_PARTY_ADAPTERS`,
  `FACET_MANIFEST_FILE`, `FACETS_LOCK_FILE`, `loadFacetsJson`,
  `loadLockfile`, `emptyFacetsJson`, `upsertFacetInManifest`,
  `writeFacetsJson`, `parseFacetSource`, `loadManifest` (path-based),
  `cloneFacetGitSource`, `resolveLocalFacetSource`, `runSelfUpdate`,
  `applyEditOperations`, `buildEditContext`, `writeScaffold`,
  `previewScaffoldFiles`, `DEFAULT_VERSION`, `isValidKebabCase`,
  `parseAdapterSpecifier`, `getBuiltinAdapterNames`, `placeAdapter`,
  `verifyAdapter`, runtime types: `RunInstallResult`, `RunInstallFailure`,
  `StageEvent`, `FacetOutcome`, `FacetStage`, `BuildProgress`,
  `BuildStage`, `EditContext`, `EditResult`, `EditOperation`,
  `ReconciliationItem`, `ReconciliationResolution`, `ScaffoldOptions`,
  `FirstPartyAdapter`, `Source`, `ParseError`).
- **→ split** — file imports both protocol-bound AND engine-bound
  symbols from the same `@agent-facets/core` import; the import must be
  split into two statements, one per package.
- **→ doc-text** — descriptive prose, comment, JSON config, or test
  fixture string literal — not an actual JS/TS import. The text needs
  updating to reflect the new package name(s).

---

## Source files (real imports)

### packages/cli/package.json
- Classification: → split
- Symbols: n/a (manifest dependency declaration)
- Lines: 37
- Notes: `"@agent-facets/core": "workspace:*"` in `devDependencies` MUST be replaced with two entries — `"@agent-facets/protocol": "workspace:*"` AND `"@agent-facets/engine": "workspace:*"` — because the CLI imports symbols from both halves.

### bun.lock
- Classification: → split
- Symbols: n/a (lockfile)
- Lines: 97, 111, 168
- Notes: Auto-regenerated on `bun install` after the workspace is restructured. Do not hand-edit; once the `package.json` files are updated and `packages/core/` is removed, run `bun install` to rewrite. Three lines mention the package name (the `cli` devDep entry, the package's own header, and the workspace alias map). Listed in this map only so verification (`rg "@agent-facets/core"`) does not flag the lockfile until the regeneration step runs.

### packages/cli/src/util/registry-client.ts
- Classification: → engine
- Symbols imported: `getRegistryBaseUrl`; re-exports `encodeFacetName`, `getRegistryBaseUrl`
- Lines: 1, 8
- Notes: Both symbols are engine (registry client). Two import statements (one `import`, one `export from`) — both flip to `@agent-facets/engine`.

### packages/cli/src/tui/views/install/install-view.tsx
- Classification: → engine
- Symbols imported: `RunInstallResult` (type), `StageEvent` (type)
- Lines: 1
- Notes: Install pipeline runtime types → engine.

### packages/cli/src/tui/views/install/failure-block.tsx
- Classification: → engine
- Symbols imported: `RunInstallFailure` (type)
- Lines: 1
- Notes: Install pipeline failure type → engine.

### packages/cli/src/tui/views/install/facet-row.tsx
- Classification: → engine
- Symbols imported: `FacetOutcome` (type), `FacetStage` (type), `RunInstallFailure` (type)
- Lines: 1

### packages/cli/src/tui/views/build/build-view.tsx
- Classification: → engine
- Symbols imported: `BUILD_STAGES`, `BuildProgress` (type), `BuildStage` (type), `runBuildPipeline`, `writeBuildOutput`
- Lines: 2-8
- Notes: All build orchestration / pipeline machinery → engine.

### packages/cli/src/tui/views/edit/use-edit-session.ts
- Classification: → split
- Symbols imported: `EditContext` (type), `EditOperation` (type), `EditResult` (type), `FacetManifest` (type), `ReconciliationResolution` (type)
- Lines: 1-7
- Notes: `FacetManifest` is a schema-derived type → **protocol**. The other four are edit-feature types → **engine**. The multi-line `import type {}` block must be split into two `import type` statements, one per package.

### packages/cli/src/tui/views/edit/reconciliation-view.tsx
- Classification: → engine
- Symbols imported: `ReconciliationItem` (type), `ReconciliationResolution` (type)
- Lines: 1

### packages/cli/src/tui/views/edit/wizard.tsx
- Classification: → engine
- Symbols imported: `EditContext` (type), `EditResult` (type), `ReconciliationResolution` (type)
- Lines: 1

### packages/cli/src/tui/views/edit/edit-view.tsx
- Classification: → engine
- Symbols imported: `DEFAULT_VERSION`, `isValidKebabCase`
- Lines: 1
- Notes: Both listed as engine in the rubric.

### packages/cli/src/tui/views/edit/manifest-to-form.ts
- Classification: → protocol
- Symbols imported: `FacetManifest` (type)
- Lines: 1
- Notes: Schema-derived type → protocol. The only protocol-only file in the repo.

### packages/cli/src/tui/views/create/confirm-view.tsx
- Classification: → engine
- Symbols imported: `ScaffoldOptions` (type, aliased to `CreateOptions`), `previewScaffoldFiles`
- Lines: 1

### packages/cli/src/tui/views/create/create-view.tsx
- Classification: → engine
- Symbols imported: `DEFAULT_VERSION`, `isValidKebabCase`
- Lines: 1

### packages/cli/src/tui/views/create/wizard.tsx
- Classification: → engine
- Symbols imported: `ScaffoldOptions` (type, aliased to `CreateOptions`)
- Lines: 1

### packages/cli/src/tui/context/form-state-context.ts
- Classification: → engine
- Symbols imported: `ScaffoldOptions` (type, aliased to `CreateOptions`), `isValidKebabCase`
- Lines: 1

### packages/cli/src/commands/build.ts
- Classification: → engine
- Symbols imported: `loadInstalledAdapters`
- Lines: 1

### packages/cli/src/commands/install/index.ts
- Classification: → engine
- Symbols imported: `loadInstalledAdapters`, `RunInstallFailure` (type), `RunInstallResult` (type), `runInstall`
- Lines: 1
- Notes: Line 14 also has `@agent-facets/core` in a docblock comment — also update to `@agent-facets/engine`.

### packages/cli/src/commands/self-update.ts
- Classification: → engine
- Symbols imported: `runSelfUpdate`
- Lines: 1
- Notes: Line 11 references `@agent-facets/core` in a docblock comment — also update to `@agent-facets/engine`.

### packages/cli/src/commands/list/index.ts
- Classification: → engine
- Symbols imported: `FACETS_LOCK_FILE`, `loadFacetsJson`, `loadLockfile`
- Lines: 3

### packages/cli/src/commands/create/index.ts
- Classification: → engine
- Symbols imported: `FACET_MANIFEST_FILE`, `ScaffoldOptions` (type), `writeScaffold`
- Lines: 2
- Notes: All three are engine symbols per the rubric.

### packages/cli/src/commands/create/wizard.tsx
- Classification: → engine
- Symbols imported: `ScaffoldOptions` (type, aliased to `CreateOptions`)
- Lines: 1

### packages/cli/src/commands/edit/index.ts
- Classification: → engine
- Symbols imported: `applyEditOperations`, `buildEditContext`, `EditResult` (type)
- Lines: 1

### packages/cli/src/commands/edit/wizard.tsx
- Classification: → engine
- Symbols imported: `EditContext` (type), `EditResult` (type)
- Lines: 1

### packages/cli/src/commands/resolve-dir.ts
- Classification: → engine
- Symbols imported: `FACET_MANIFEST_FILE`
- Lines: 3

### packages/cli/src/commands/add/index.ts
- Classification: → engine
- Symbols imported (static block, lines 4-15): `emptyFacetsJson`, `loadFacetsJson`, `loadInstalledAdapters`, `ParseError` (type), `parseFacetSource`, `RunInstallResult` (type), `runInstall`, `Source` (type), `upsertFacetInManifest`, `writeFacetsJson`
- Symbols imported (dynamic, line 253): `loadManifest`
- Symbols imported (dynamic, line 257): `cloneFacetGitSource`
- Symbols imported (dynamic, line 274): `resolveLocalFacetSource`
- Lines: 4-15, 253, 257, 274
- Notes: Four total import statements — one static block plus three `await import('@agent-facets/core')` calls. All four flip to `@agent-facets/engine`. The dynamic imports are easy to miss with a non-AST find/replace.

### packages/cli/src/commands/publish/index.ts
- Classification: → engine
- Symbols imported: `encodeFacetName`, `getRegistryBaseUrl`, `packFacetSource`
- Lines: 3

### packages/cli/src/commands/adapter/index.ts
- Classification: → engine
- Symbols imported: `installAdapter`, `listInstalledAdapters`, `removeAdapter`
- Lines: 1

### packages/cli/src/commands/adapter/pick-and-install.ts
- Classification: → engine
- Symbols imported: `FirstPartyAdapter` (type), `getAdapterBaseDir`, `installAdapter`, `listInstalledAdapters`, `loadInstalledAdapters`
- Lines: 2-8

### packages/cli/src/commands/adapter/install-picker.tsx
- Classification: → engine
- Symbols imported: `FIRST_PARTY_ADAPTERS`, `FirstPartyAdapter` (type)
- Lines: 1

### packages/cli/src/commands/__tests__/self-update.test.ts
- Classification: → engine
- Symbols imported: namespace import `* as coreModule`; only `coreModule.runSelfUpdate` is used.
- Lines: 2 (and the namespace is referenced at lines 10–11)
- Notes: Quirk — uses a namespace import (`import * as coreModule`) and `spyOn(coreModule, 'runSelfUpdate')`. Only one engine symbol is accessed, so the rename is mechanical: change the package specifier to `@agent-facets/engine` and rename the alias `coreModule` → `engineModule` for clarity and to avoid leaving "core" naming in the codebase. The string literal `'runSelfUpdate'` passed to `spyOn` is unchanged.

### packages/cli/src/__tests__/install-view.test.tsx
- Classification: → split
- Symbols imported: `IntegrityFailure` (type), `RunInstallFailure` (type), `RunInstallResult` (type), `StageEvent` (type)
- Lines: 2
- Notes: `IntegrityFailure` is **protocol** (rubric: integrity primitives); the other three are **engine** (install pipeline). Single-line type-only import must be split into two `import type {}` statements.

### packages/cli/src/__tests__/edit-integration.test.ts
- Classification: → engine
- Symbols imported: `EditOperation` (type) on line 5; `applyEditOperations` (aliased `applyOperations`), `buildEditContext`, `runBuildPipeline` on line 6
- Lines: 5, 6
- Notes: Two import statements (one type-only, one runtime); both flip to `@agent-facets/engine`.

### packages/cli/src/__tests__/adapter-integration.test.ts
- Classification: → engine
- Symbols imported: `loadInstalledAdapters`, `placeAdapter`, `runBuildPipeline`, `verifyAdapter`
- Lines: 5

### packages/cli/src/__tests__/adapter-specifier.test.ts
- Classification: → engine
- Symbols imported: `getBuiltinAdapterNames`, `parseAdapterSpecifier`
- Lines: 2

### packages/cli/src/__tests__/create-build.e2e.test.ts
- Classification: → engine
- Symbols imported: `DEFAULT_VERSION`, `writeScaffold`
- Lines: 6

---

## Documentation / prose references

### README.md (root)
- Classification: → doc-text
- Symbols: n/a
- Lines: 40
- Notes: Packages table row for the legacy `core` package. Replace with a `@agent-facets/protocol` row (public, Node-native, the artifact specification) and remove the `core` row, per task 17.1.

### AGENTS.md (root)
- Classification: → doc-text
- Symbols: n/a
- Lines: 77, 118
- Notes:
  - Line 77 is a section heading `### \`packages/core\` — \`@agent-facets/core\`` in the source-code map; rewrite to describe both `@agent-facets/protocol` and `@agent-facets/engine`.
  - Line 118 says `CLI binary (\`facet\`). Thin orchestration layer over \`@agent-facets/core\`:` — update to mention both `@agent-facets/protocol` and `@agent-facets/engine`.

### packages/cli/AGENTS.md
- Classification: → doc-text
- Symbols: n/a
- Lines: 7, 62
- Notes: Two prose mentions in the CLI's agent doc (`wraps @agent-facets/core in a terminal-friendly skin` and `cli depends on @agent-facets/core for everything substantive`). Reword to reflect that the CLI now depends on both `@agent-facets/protocol` and `@agent-facets/engine`. Per the same file's "everything durable lives in `core`" framing — durable specification lives in `protocol`, durable machinery lives in `engine`. Recommend updating the boundary discussion accordingly.

### docs/changelog/index.md
- Classification: → doc-text
- Symbols: n/a
- Lines: 84, 91
- Notes: Two prose mentions in a changelog entry (description string and a list item) describing a historical publish-pipeline incident. Recommend leaving the historical text intact (it accurately describes a past event involving the v0.9.x `core` package) and letting the new `protocol` package's first changelog entry document the rename.

### docs/docs/contributing/release-pipeline.md
- Classification: → doc-text
- Symbols: n/a
- Lines: 20, 25, 30, 89
- Notes: Multiple references using `@agent-facets/core` as the canonical example library tag (`@agent-facets/core@0.3.0`, `@agent-facets/core@1.0.0`, the curl payload `@agent-facets/core@0.4.0`). Replace with `@agent-facets/protocol` per task 17.3. Line 30's library-package list (`@agent-facets/core`, `@agent-facets/brand`) — swap `core` for `protocol`.

### openspec/specs/distribution/spec.md
- Classification: → doc-text
- Symbols: n/a
- Lines: 245
- Notes: Single occurrence in a scenario as an example tag `@agent-facets/core@1.0.0`. Per the proposal, this scenario will use a different placeholder package name. Recommend `@agent-facets/brand@1.0.0` (brand is unaffected by this change).

### openspec/changes/archive/2026-04-06-platform-package-seeding/design.md
- Classification: → doc-text (archived)
- Symbols: n/a
- Lines: 132, 136
- Notes: Two mentions in archived design doc describing the publish pipeline at the time. Archived change records are historical; do NOT modify. Listed here only for completeness — verification scripts should ignore `openspec/changes/archive/**`.

### openspec/changes/archive/2026-04-06-platform-builds-ci/specs/distribution/spec.md
- Classification: → doc-text (archived)
- Symbols: n/a
- Lines: 17
- Notes: Same as above — archived spec snapshot, leave unmodified.

### scripts/README.md
- Classification: → doc-text
- Symbols: n/a
- Lines: 75
- Notes: ASCII-art diagram showing `@agent-facets/core@X.Y.Z` as a library-tag example. Update to a still-published library — `@agent-facets/protocol@X.Y.Z`.

### scripts/release/README.md
- Classification: → doc-text
- Symbols: n/a
- Lines: 3
- Notes: Sentence "Publishes `@agent-facets/core`, `@agent-facets/brand`, `@agent-facets/adapter`, ..." — drop `@agent-facets/core` and add `@agent-facets/protocol` in its place.

### .circleci/development/@config.yml
- Classification: → doc-text
- Symbols: n/a
- Lines: 8
- Notes: Comment-only mention `# (so \`@agent-facets/core@x\` and \`@agent-facets/adapter@y\` releases can run`. Update example to `@agent-facets/protocol@x`.

---

## Release-pipeline scripts (string-literal / config / fixture)

These files do not import from `@agent-facets/core` — they reference it
as a string literal in package metadata, mock data, comments, or
configuration. Each is doc-text-style: every literal occurrence must be
updated to reflect the new package layout.

### scripts/lib/changesets.ts
- Classification: → doc-text (config + comment)
- Symbols: n/a — string literals
- Lines: 64, 381
- Notes:
  - Line 64: `'@agent-facets/core': 1` — entry in a release-order priority table. Replace with `'@agent-facets/protocol': 1`. Verify the priority value against task 11.x and the linked-grouping change in task 14.2 before just renaming.
  - Line 381: comment example `// Sub-lines: indented dependency entries like "  - @agent-facets/core@0.1.2"` — update example to `@agent-facets/protocol@0.1.2`.

### scripts/lib/changesets.test.ts
- Classification: → doc-text (test fixtures)
- Symbols: n/a — string literals throughout
- Lines: 60, 65, 72, 77, 91, 93, 218, 225, 452, 460, 473, 482, 503, 518, 562, 584, 687, 716, 721, 730, 749, 758, 762, 764, 783, 788, 794, 824, 866, 868, 872, 875, 889, 891, 895
- Notes: ~35 occurrences as test-fixture package names, mock-npm registry entries, and CHANGELOG snippets. Mechanical rename to `@agent-facets/protocol`. The release-order test (lines 866, 868) should reflect the new linked group from task 14.2.

### scripts/lib/test-helpers.ts
- Classification: → doc-text (test fixture)
- Symbols: n/a — string literal in `SAMPLE_CHANGELOG`
- Lines: 23
- Notes: Sample changelog header `# @agent-facets/core` → `# @agent-facets/protocol`.

### scripts/lib/prepack.test.ts
- Classification: → doc-text (comment)
- Symbols: n/a
- Lines: 217
- Notes: Regression-test reference comment `// Regression test for CircleCI job 517: \`@agent-facets/core@0.6.1\``. Historical context — recommend leaving the historical reference and adding a parenthetical "(now `@agent-facets/protocol`)" for forward-readers.

### scripts/lib/io/circleci.ts
- Classification: → doc-text (comment)
- Symbols: n/a
- Lines: 21, 27
- Notes: Two JSDoc/comment mentions explaining per-package serialization keys. Update both `@agent-facets/core` examples to `@agent-facets/protocol`.

### scripts/lib/io/circleci.test.ts
- Classification: → doc-text (test fixtures)
- Symbols: n/a
- Lines: 97, 105, 106, 124
- Notes: Tag examples in tests. Mechanical rename to `@agent-facets/protocol`.

### scripts/release/version.test.ts
- Classification: → doc-text (test fixtures)
- Symbols: n/a
- Lines: 38, 39, 57, 71, 72, 91, 104, 126, 127, 144, 145, 173
- Notes: Package fixture entries (`{ name: '@agent-facets/core', ... }`) and PR-body assertions. Mechanical rename to `@agent-facets/protocol`.

### scripts/release/tag.test.ts
- Classification: → doc-text (test fixtures)
- Symbols: n/a
- Lines: 56, 68, 91, 112, 117, 129, 143, 147, 159, 170, 186, 213, 217, 232, 251, 257
- Notes: Package fixtures and tag assertions. Mechanical rename to `@agent-facets/protocol`.

### scripts/release/publish.ts
- Classification: → doc-text (comment)
- Symbols: n/a
- Lines: 5
- Notes: JSDoc example tag `@agent-facets/core@0.3.0`. Update to `@agent-facets/protocol@0.3.0`.

### scripts/release/publish.test.ts
- Classification: → doc-text (test fixtures)
- Symbols: n/a
- Lines: 22, 30, 31, 48, 85, 95, 97, 107, 134, 147, 160, 161, 165, 180, 192, 203, 214, 235
- Notes: Many `parseTag('@agent-facets/core@x.y.z')` calls and `process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'` setups. Mechanical rename to `@agent-facets/protocol`.

### .changeset/config.json
- Classification: → doc-text (config)
- Symbols: n/a
- Lines: 6
- Notes: `"linked": [["agent-facets", "@agent-facets/adapter", "@agent-facets/core"]]`. Per task 14.2 the new group is `["agent-facets", "@agent-facets/adapter", "@agent-facets/protocol"]` — `@agent-facets/engine` stays out because it is private. Naive find/replace would yield `@agent-facets/engine` here, which is wrong.

---

## Summary

| Bucket           | Count | Notes                                                          |
|------------------|------:|----------------------------------------------------------------|
| Total files      |    50 | Every file with at least one external `@agent-facets/core` ref (excludes the split-core change dir, `packages/core/` itself, ignored build/cache paths, and `**/CHANGELOG.md`) |
| → protocol only  |     1 | `packages/cli/src/tui/views/edit/manifest-to-form.ts`          |
| → engine only    |    29 | All other CLI source / test files importing from `@agent-facets/core` |
| → split (both)   |     4 | `packages/cli/package.json`, `bun.lock`, `packages/cli/src/tui/views/edit/use-edit-session.ts`, `packages/cli/src/__tests__/install-view.test.tsx` |
| → doc-text only  |    16 | Markdown, JSON config, comments, ASCII diagrams, archived openspec |

(50 = 1 + 29 + 4 + 16. `packages/adapter/CHANGELOG.md`, `packages/cli/CHANGELOG.md`, and the adapter package CHANGELOGs are excluded by convention — historical release notes for past versions of the old name.)

### Tricky / noteworthy cases

1. **`packages/cli/src/tui/views/edit/use-edit-session.ts`** — Mixes `FacetManifest` (protocol, schema-derived) with four edit-feature types (engine). The `import type { ... }` block must be split into two `import type` statements, one per package. Easy to miss because the file is type-only — TypeScript will still type-check if `FacetManifest` is wrongly imported from engine via a re-export, but the dependency direction would be wrong. Verify there is no engine→protocol re-export of `FacetManifest`.

2. **`packages/cli/src/__tests__/install-view.test.tsx`** — Same shape as above: `IntegrityFailure` is protocol, the other three install types are engine. Single-line type-import must be split.

3. **`packages/cli/src/commands/__tests__/self-update.test.ts`** — Uses a namespace import (`import * as coreModule from '@agent-facets/core'`) and `spyOn(coreModule, 'runSelfUpdate')`. Rename `coreModule` → `engineModule` for clarity. The string literal `'runSelfUpdate'` passed to `spyOn` does not change.

4. **`packages/cli/src/commands/add/index.ts`** — Has FOUR import statements referencing `@agent-facets/core`: one static block (lines 4-15) and three dynamic `await import('@agent-facets/core')` calls (lines 253, 257, 274). All four flip to `@agent-facets/engine`. Easy to miss the dynamic ones with a non-AST find/replace.

5. **`packages/cli/src/commands/install/index.ts` and `packages/cli/src/commands/self-update.ts`** — Each has both an `import` statement AND a docblock comment that names `@agent-facets/core`. Update the comment too (lines 14 and 11 respectively); a code-only refactor would leave stale prose.

6. **`packages/cli/src/util/registry-client.ts`** — Has both an `import { getRegistryBaseUrl }` and a separate `export { encodeFacetName, getRegistryBaseUrl }` re-export. Both lines change.

7. **`bun.lock`** — Do NOT hand-edit. Regenerated by `bun install` once the workspace structure (`packages/protocol/`, `packages/engine/`) is in place and `package.json` files are updated.

8. **`scripts/lib/changesets.ts:64`** — The release-order priority table assigns `1` to `@agent-facets/core`. The replacement key is `@agent-facets/protocol`, but verify the priority value still makes sense alongside the linked-grouping change in task 14.2 before renaming.

9. **`scripts/lib/prepack.test.ts:217` and `docs/changelog/index.md`** — Historical references to past incidents involving the old name. Pure renames lose information. Recommend leaving historical text intact and adding parentheticals where helpful.

10. **`openspec/specs/distribution/spec.md:245`** — The placeholder example `@agent-facets/core@1.0.0` is in a *spec* that the change being executed will modify (per task 14). Replace with a non-`core` example tag — `@agent-facets/brand@1.0.0` is the safest choice (brand is unaffected by this change).

11. **`.changeset/config.json`** — The linked group is NOT a string-replace target. Per task 14.2 the new group is `["agent-facets", "@agent-facets/adapter", "@agent-facets/protocol"]` — `@agent-facets/engine` stays out because it is private. A naive find/replace would yield `@agent-facets/engine` here, which is wrong.

12. **`openspec/changes/archive/**`** — Two archived change records (`2026-04-06-platform-package-seeding/design.md`, `2026-04-06-platform-builds-ci/specs/distribution/spec.md`) name `@agent-facets/core`. Archived openspec records are historical artifacts and MUST NOT be modified. Verification scripts should explicitly ignore `openspec/changes/archive/**` to avoid flagging these.

13. **CHANGELOG.md files NOT in scope of this map** — `packages/cli/CHANGELOG.md`, `packages/core/CHANGELOG.md`, `packages/adapter/CHANGELOG.md`, and the three first-party adapter changelogs all reference `@agent-facets/core` in historical entries. Per task 19.4 the legitimate post-change matches for `rg "@agent-facets/core"` are exactly: CHANGELOG entries (historical) and the changeset prose for this change. Listed here for completeness; do NOT edit.
