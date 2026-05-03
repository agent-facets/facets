# `packages/core/src` — Protocol vs. Engine Inventory

Classification of every non-test source file under `packages/core/src/`
according to the rule:

> A piece of code belongs in `@agent-facets/protocol` if and only if a
> third-party system MUST honor it to be facet-compatible. The litmus
> test: would this code change if engine were re-implemented in another
> language? If no — protocol. If yes — engine.

Layer values:
- **protocol**: third-party-binding spec; would not change in another
  language implementation.
- **engine**: implementation detail of THIS CLI; would be rewritten in
  another language.
- **split**: file contains both protocol-bound and engine-bound code;
  must be split across the two packages.

## Root files

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `front-matter.ts` | protocol | none | none |
| `index.ts` | rewritten in both | none | re-exports from every subdirectory (see "Files exported via index.ts" section below) |

## `schemas/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `schemas/build-manifest.ts` | protocol | none | none |
| `schemas/facet-manifest.ts` | protocol | none | none |
| `schemas/lockfile.ts` | protocol | none | none |
| `schemas/project-manifest.ts` | protocol | none | none |
| `schemas/server-manifest.ts` | protocol | none | none |

## `loaders/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `loaders/facet.ts` | split (path-based `loadManifest`/`resolvePrompts` are engine; `FACET_MANIFEST_FILE` constant + the JSON-bytes/schema-validation core is protocol — needs a future bytes-validator extraction) | `Bun.file` (twice — once in `loadManifest` via `validate.ts`, once in `resolveAssetPrompt` for prompt files) | `../schemas/facet-manifest.ts`, `./validate.ts` |
| `loaders/server.ts` | split (path-based `loadServerManifest` is engine; the JSON-bytes/schema-validation core is protocol) | `Bun.file` (via `validate.ts`) | `../schemas/server-manifest.ts`, `./validate.ts` |
| `loaders/validate.ts` | split (`mapArkErrors` and `parseJson` are protocol; `readFile` is engine) | `Bun.file` (in `readFile`) | none |

## `integrity/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `integrity/index.ts` | protocol | none | `./types.ts`, `./verify.ts` |
| `integrity/types.ts` | protocol | none | none |
| `integrity/verify.ts` | protocol | none | `./types.ts` |

## `build/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `build/content-hash.ts` | split (everything except `compressArchive` is protocol; `compressArchive` uses gzip — not part of the hashed integrity contract — and is engine) | `Bun.CryptoHasher.hash` (in `computeContentHash`), `Bun.gzipSync` (in `compressArchive`) | `../loaders/facet.ts` |
| `build/detect-collisions.ts` | protocol | none | `../schemas/facet-manifest.ts` |
| `build/validate-content.ts` | protocol | none | `../loaders/facet.ts` |
| `build/validate-facets.ts` | protocol | none | `../schemas/facet-manifest.ts` |
| `build/validate-adapters.ts` | engine (runs adapter code) | none | `../schemas/facet-manifest.ts` |
| `build/pipeline.ts` | engine (orchestrator with progress callbacks) | `Bun.file` (reads manifest content) | `../loaders/facet.ts`, `./content-hash.ts`, `./detect-collisions.ts`, `./validate-adapters.ts`, `./validate-content.ts`, `./validate-facets.ts` |
| `build/write-output.ts` | engine (FS mutation) | `Bun.write` (twice) | `./pipeline.ts` |

## `cache/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `cache/index.ts` | engine | none | `./integrity.ts`, `./operations.ts`, `./paths.ts`, `./types.ts` |
| `cache/integrity.ts` | engine | none | none |
| `cache/operations.ts` | engine | none | `../build/content-hash.ts`, `../integrity/types.ts`, `../schemas/build-manifest.ts`, `./integrity.ts`, `./paths.ts`, `./types.ts` |
| `cache/paths.ts` | engine | none | `./types.ts` |
| `cache/types.ts` | engine | none | none |

## `manifest/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `manifest/mutations.ts` | engine (CLI-shaped semantics for `facets.json`) | none | `../loaders/validate.ts`, `../schemas/project-manifest.ts` |
| `manifest/project-files.ts` | engine (disk bridge) | none | `../schemas/project-manifest.ts`, `./mutations.ts` |

## `registry/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `registry/describe.ts` | engine (display formatter for engine error paths) | none | `../sources/facet/types.ts` |
| `registry/download.ts` | engine | none | `./types.ts` |
| `registry/http.ts` | engine | none | none |
| `registry/index.ts` | engine | none | `./describe.ts`, `./download.ts`, `./http.ts`, `./pack.ts`, `./resolve-metadata.ts`, `./types.ts` |
| `registry/pack.ts` | engine (CLI packs to upload) | `Bun.gzipSync` | none |
| `registry/resolve-metadata.ts` | engine | none | `./describe.ts`, `./http.ts`, `./types.ts` |
| `registry/types.ts` | engine | none | `../sources/facet/types.ts` |

## `install/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `install/journal.ts` | engine | none | none |
| `install/lockfile-guard.ts` | engine | none | none |
| `install/lockfile-io.ts` | engine | none | `../schemas/lockfile.ts` |
| `install/materialize.ts` | engine | none | `../loaders/facet.ts`, `../schemas/lockfile.ts`, `./journal.ts` |
| `install/run-install.ts` | engine (orchestrator) | none | `../build/pipeline.ts`, `../cache/index.ts`, `../integrity/index.ts`, `../loaders/facet.ts`, `../manifest/project-files.ts`, `../registry/download.ts`, `../registry/resolve-metadata.ts`, `../schemas/build-manifest.ts`, `../schemas/lockfile.ts`, `../schemas/project-manifest.ts`, `../sources/facet/parse-source.ts`, `../sources/facet/resolve-git.ts`, `../sources/facet/resolve-local.ts`, `./journal.ts`, `./lockfile-guard.ts`, `./lockfile-io.ts`, `./materialize.ts`, `./types.ts` |
| `install/types.ts` | engine | none | `../integrity/index.ts`, `../registry/index.ts`, `../schemas/lockfile.ts`, `../sources/facet/types.ts` |

## `sources/facet/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `sources/facet/parse-source.ts` | engine (parser; produces engine-shaped `Source`/`ParseError`) | none | `./parse-version.ts`, `./types.ts` |
| `sources/facet/parse-version.ts` | engine (parser; emits the `VersionSpec` whose grammar is protocol but the implementation is engine — see note on `types.ts`) | none | `./types.ts` |
| `sources/facet/resolve-git.ts` | engine (clones via `git` binary) | `Bun.spawnSync` (in `runGit`) | none |
| `sources/facet/resolve-local.ts` | engine | none | none |
| `sources/facet/types.ts` | split (`VersionSpec` type + grammar + `resolvesToLatest` are protocol; `Source`, `ParseError`, `ParseErrorCode`, `ParseResult` are engine) | none | none |

## `sources/adapter/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `sources/adapter/git.ts` | engine | `Bun.spawnSync` | none |
| `sources/adapter/local.ts` | engine | `Bun.file` (twice) | none |
| `sources/adapter/npm.ts` | engine | `Bun.write` | none |
| `sources/adapter/specifier.ts` | engine | none | none |

## `adapters/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `adapters/bundler.ts` | engine | `Bun.spawnSync` (twice — `bun install` and retry), `Bun.build`, `Bun.file` (multiple — `package.json` resolution and disk fallback existence checks) | none |
| `adapters/first-party.ts` | engine | none | none |
| `adapters/install-service.ts` | engine | `Bun.file` (in `resolveSourceEntry`) | `../sources/adapter/git.ts`, `../sources/adapter/local.ts`, `../sources/adapter/npm.ts`, `../sources/adapter/specifier.ts`, `./bundler.ts`, `./placement.ts`, `./verify.ts` |
| `adapters/loader.ts` | engine | none | `./placement.ts` |
| `adapters/placement.ts` | engine | `Bun.file` (multiple — `arrayBuffer`, `exists` checks), `Bun.write` | none |
| `adapters/verify.ts` | engine | none | none |

## `edit/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `edit/context.ts` | engine | none | `../loaders/facet.ts`, `./reconcile.ts`, `./scanner.ts`, `./types.ts` |
| `edit/manifest-writer.ts` | engine | `Bun.write` | `../loaders/facet.ts`, `../schemas/facet-manifest.ts` |
| `edit/operations.ts` | engine | `Bun.write` (three times — skill, agent, command scaffolding) | `../scaffold/index.ts`, `../schemas/facet-manifest.ts`, `./manifest-writer.ts`, `./types.ts` |
| `edit/reconcile.ts` | engine | none | `../schemas/facet-manifest.ts`, `./scanner.ts` |
| `edit/scanner.ts` | engine | `Glob` from `bun` (three glob scans) | none |
| `edit/types.ts` | engine | none | `../schemas/facet-manifest.ts`, `./scanner.ts` |

## `scaffold/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `scaffold/index.ts` | engine | `Bun.write` (multiple — manifest + scaffold templates) | `../edit/scanner.ts`, `../loaders/facet.ts` |

## `self-update/`

| File | Layer | Bun APIs used | Internal imports |
|---|---|---|---|
| `self-update/detect.ts` | engine | `Bun.spawn` (in `defaultSpawn`) | `./methods/types.ts` |
| `self-update/index.ts` | engine | none | `./detect.ts`, `./registry.ts`, `./version-check.ts` |
| `self-update/registry.ts` | engine | none | `./methods/bun.ts`, `./methods/curl.ts`, `./methods/local-dev.ts`, `./methods/npm.ts`, `./methods/pnpm.ts`, `./methods/types.ts`, `./methods/unknown.ts`, `./methods/yarn.ts` |
| `self-update/version-check.ts` | engine | none | none |
| `self-update/methods/bun.ts` | engine | none | `./spawn-inherit.ts`, `./types.ts` |
| `self-update/methods/curl.ts` | engine | `Bun.spawn` (streams installer body into bash) | `./types.ts` |
| `self-update/methods/local-dev.ts` | engine | none | `./types.ts` |
| `self-update/methods/npm.ts` | engine | none | `./spawn-inherit.ts`, `./types.ts` |
| `self-update/methods/pnpm.ts` | engine | none | `./spawn-inherit.ts`, `./types.ts` |
| `self-update/methods/spawn-inherit.ts` | engine | `Bun.spawn` | none |
| `self-update/methods/types.ts` | engine | none | none |
| `self-update/methods/unknown.ts` | engine | `Bun.which` (PATH-shadow check) | `./curl.ts`, `./types.ts` |
| `self-update/methods/yarn.ts` | engine | none | `./spawn-inherit.ts`, `./types.ts` |

---

## Summary

- **Total file count**: 75 (non-test source files; `index.ts` counted as a re-export hub that gets rewritten in both packages)
- **Protocol-bound count**: 11
  - `front-matter.ts`
  - all 5 schemas (`schemas/build-manifest.ts`, `schemas/facet-manifest.ts`, `schemas/lockfile.ts`, `schemas/project-manifest.ts`, `schemas/server-manifest.ts`)
  - all 3 integrity files (`integrity/index.ts`, `integrity/types.ts`, `integrity/verify.ts`)
  - 2 build validators (`build/detect-collisions.ts`, `build/validate-content.ts`, `build/validate-facets.ts`) — actually 3, see below
- **Engine-bound count**: 59
- **Split-file count**: 5
  - `loaders/facet.ts` (path-based loaders → engine; bytes-validator + manifest-file constant → protocol)
  - `loaders/server.ts` (path-based loader → engine; bytes-validator → protocol)
  - `loaders/validate.ts` (`readFile` → engine; `mapArkErrors`, `parseJson` → protocol)
  - `build/content-hash.ts` (everything except `compressArchive` → protocol; `compressArchive` → engine)
  - `sources/facet/types.ts` (`VersionSpec` + grammar + `resolvesToLatest` → protocol; `Source`, `ParseError`, `ParseErrorCode`, `ParseResult` → engine)
- **Plus `index.ts`** which is rewritten in both packages (counted separately)

Recount of protocol-bound files (pure protocol, no split):
1. `front-matter.ts`
2. `schemas/build-manifest.ts`
3. `schemas/facet-manifest.ts`
4. `schemas/lockfile.ts`
5. `schemas/project-manifest.ts`
6. `schemas/server-manifest.ts`
7. `integrity/index.ts`
8. `integrity/types.ts`
9. `integrity/verify.ts`
10. `build/detect-collisions.ts`
11. `build/validate-content.ts`
12. `build/validate-facets.ts`

= **12 pure-protocol files**

Final tallies:
- **75 total**
- **12 pure-protocol**
- **57 pure-engine**
- **5 split**
- **1 hub** (`index.ts`, rewritten in both)

(12 + 57 + 5 + 1 = 75 ✓)

### Top-level directories that are entirely protocol-bound

- `schemas/` — all 5 files are protocol
- `integrity/` — all 3 files are protocol

### Top-level directories that are entirely engine-bound

- `cache/` — all 5 files are engine
- `manifest/` — both files are engine
- `registry/` — all 7 files are engine
- `install/` — all 6 files are engine
- `adapters/` — all 6 files are engine
- `edit/` — all 6 files are engine
- `scaffold/` — single file is engine
- `self-update/` — all 13 files are engine
- `sources/adapter/` — all 4 files are engine

### Mixed top-level directories (have both protocol and engine code)

- `loaders/` — 3 files, all currently mixed; bytes-validators belong in protocol, path wrappers in engine
- `build/` — 7 files: 3 protocol (`detect-collisions`, `validate-content`, `validate-facets`), 1 split (`content-hash`), 3 engine (`validate-adapters`, `pipeline`, `write-output`)
- `sources/facet/` — 5 files: 1 split (`types.ts`), 4 engine

### Files exported via `core/src/index.ts`

Parsed from the `export ...` lines in `index.ts` (re-exports both type-only and value):

- `./adapters/bundler.ts` — `BundleResult`, `ResolvedEntryPoint`, `bundleAdapter`, `rebundleAdapter`, `resolveEntryPoint`
- `./adapters/first-party.ts` — `FirstPartyAdapter`, `FIRST_PARTY_ADAPTERS`
- `./adapters/install-service.ts` — `AdapterInstallOptions`, `AdapterInstallResult`, `AdapterInstallStage`, `installAdapter`, `locateAndVerifyAdapter`
- `./adapters/loader.ts` — `loadInstalledAdapters`
- `./adapters/placement.ts` — `getAdapterBaseDir`, `getAdapterBundlePath`, `getAdapterDir`, `listInstalledAdapters`, `placeAdapter`, `removeAdapter`
- `./adapters/verify.ts` — `verifyAdapter`
- `./build/content-hash.ts` — `ArchiveEntry`, `assembleOuterTar`, `assembleTar`, `BUILD_MANIFEST_NAME`, `collectArchiveEntries`, `compressArchive`, `computeAssetHashes`, `computeContentHash`, `INNER_ARCHIVE_NAME`
- `./build/detect-collisions.ts` — `detectNamingCollisions`
- `./build/pipeline.ts` — `BuildFailure`, `BuildProgress`, `BuildResult`, `BuildStage`, `BUILD_STAGES`, `runBuildPipeline`
- `./build/validate-adapters.ts` — `AdapterValidationResult`, `validateAdapterMetadata`
- `./build/validate-facets.ts` — `validateCompactFacets`
- `./build/write-output.ts` — `WriteBuildOutputOptions`, `writeBuildOutput`
- `./cache/index.ts` — `CacheIdentity`, `CacheIntegrity`, `CacheLookup`, `CachePutResult`, `CachePutVerifiedResult`, `CacheSlotCorruption`, `CACHE_INTEGRITY_FILE`, `CacheIntegritySchema`, `cacheGet`, `cachePath`, `cachePut`, `cachePutVerified`, `cacheSlot`, `cacheSlotIsDir`, `cacheStagingDir`, `readCachedIntegrity`, `resolveCacheRoot`
- `./edit/context.ts` — `buildEditContext`
- `./edit/manifest-writer.ts` — `writeManifest`
- `./edit/operations.ts` — `applyEditOperations`
- `./edit/reconcile.ts` — `MatchedAsset`, `MissingAsset`, `ReconciliationResult`, `reconcile`
- `./edit/scanner.ts` — `AssetManifestKey`, `DiscoveredAsset`, `KEBAB_CASE`, `scanAssets`
- `./edit/types.ts` — `EditContext`, `EditOperation`, `EditResult`, `ReconciliationItem`, `ReconciliationResolution`
- `./front-matter.ts` — `FrontMatterResult`, `extractFrontMatter`, `hasFrontMatter`
- `./install/journal.ts` — `JournalEntry`, `JournalRollbackOptions`, `JournalRollbackResult`, `InstallJournal`
- `./install/lockfile-guard.ts` — `AcquireLockError`, `AcquireLockResult`, `InstallLock`, `acquireInstallLock`
- `./install/lockfile-io.ts` — `LoadLockfileResult`, `emptyLockfile`, `FACETS_LOCK_FILE`, `loadLockfile`, `writeLockfile`
- `./install/materialize.ts` — `MaterializeOptions`, `MaterializeResult`, `computeAssetList`, `diffAssetsForDeletion`, `materialize`
- `./install/run-install.ts` — `runInstall`
- `./install/types.ts` — `FacetOutcome`, `FacetStage`, `InstallSummary`, `RunInstallFailure`, `RunInstallOptions`, `RunInstallResult`, `StageEvent`
- `./integrity/index.ts` — `AssetIntegrityFailure`, `FacetIntegrityCheck`, `FacetIntegrityFailure`, `IntegrityFailure`, `IntegrityResult`, `verifyGitOneCheck`, `verifyHash`, `verifyRegistryThreeCheck`
- `./loaders/facet.ts` — `ResolvedFacetManifest`, `FACET_MANIFEST_FILE`, `loadManifest`, `resolvePrompts`
- `./loaders/server.ts` — `loadServerManifest`
- `./manifest/mutations.ts` — `emptyFacetsJson`, `FACETS_JSON_FILE`, `parseFacetsJson`, `removeFacetFromManifest`, `serializeFacetsJson`, `upsertFacetInManifest`
- `./manifest/project-files.ts` — `LoadFacetsJsonResult`, `loadFacetsJson`, `writeFacetsJson`
- `./registry/index.ts` — `RegistryError`, `RegistryMetadata`, `RegistryResult`, `RegistrySpec`, `describeVersionSpec`, `downloadAndExtractFacet`, `encodeFacetName`, `getRegistryBaseUrl`, `packFacetSource`, `resolveRegistryMetadataBatch`
- `./scaffold/index.ts` — `ScaffoldOptions`, `agentTemplate`, `commandTemplate`, `DEFAULT_VERSION`, `generateScaffoldManifest`, `isValidKebabCase`, `isValidSemVer`, `previewScaffoldFiles`, `SEMVER`, `skillTemplate`, `writeScaffold`
- `./schemas/build-manifest.ts` — `BuildManifest`, `BuildManifestSchema`
- `./schemas/facet-manifest.ts` — `FacetManifest`, `FacetManifestSchema`
- `./schemas/lockfile.ts` — `Lockfile`, `LockfileAssetEntry`, `LockfileFacet`, `LOCKFILE_VERSION`, `LockfileSchema`
- `./schemas/project-manifest.ts` — `FacetsJson`, `FacetsJsonSchema`
- `./schemas/server-manifest.ts` — `ServerManifest`, `ServerManifestSchema`
- `./self-update/detect.ts` — `DetectDependencies`, `detectInstallMethod`
- `./self-update/index.ts` — `RunSelfUpdateOptions`, `runSelfUpdate`
- `./self-update/methods/curl.ts` — `runCurlInstaller`
- `./self-update/methods/spawn-inherit.ts` — `spawnInherit`
- `./self-update/methods/types.ts` — `InstallMethod`, `MethodKind`, `UpdateOptions`
- `./self-update/registry.ts` — `installMethods`
- `./self-update/version-check.ts` — `getLatestVersion`
- `./sources/adapter/git.ts` — `cloneAdapterGitRepository`
- `./sources/adapter/local.ts` — `resolveLocalAdapterPath`
- `./sources/adapter/npm.ts` — `assertInsideTempDir`, `downloadNpmPackage`, `verifyTarballIntegrity`
- `./sources/adapter/specifier.ts` — `ResolvedAdapterSpecifier`, `getBuiltinAdapterNames`, `parseAdapterSpecifier`
- `./sources/facet/parse-source.ts` — `parseFacetSource`
- `./sources/facet/parse-version.ts` — `parseVersionSpec`
- `./sources/facet/resolve-git.ts` — `ResolveFacetGitResult`, `cloneFacetGitSource`
- `./sources/facet/resolve-local.ts` — `ResolveLocalFacetResult`, `resolveLocalFacetSource`
- `./sources/facet/types.ts` — `ParseError`, `ParseErrorCode`, `ParseResult`, `Source`, `VersionSpec`, `resolvesToLatest`

This is **51 distinct internal modules** referenced directly from `index.ts`. (`index.ts` does not re-export from `cache/integrity.ts`, `cache/operations.ts`, `cache/paths.ts`, `cache/types.ts`, `loaders/validate.ts`, `integrity/types.ts`, `integrity/verify.ts`, `registry/describe.ts`, `registry/download.ts`, `registry/http.ts`, `registry/pack.ts`, `registry/resolve-metadata.ts`, `registry/types.ts`, `build/content-hash.ts` *internal only* — wait, it does export from content-hash. Let me re-check.) Cross-check: `index.ts` exports from 51 modules. Files NOT directly exported (internal-use only via the re-exporting subdirectory `index.ts` files, or only consumed internally): `cache/integrity.ts`, `cache/operations.ts`, `cache/paths.ts`, `cache/types.ts` (re-exported via `cache/index.ts`); `integrity/types.ts`, `integrity/verify.ts` (re-exported via `integrity/index.ts`); `loaders/validate.ts` (internal helper); `registry/describe.ts`, `registry/download.ts`, `registry/http.ts`, `registry/pack.ts`, `registry/resolve-metadata.ts`, `registry/types.ts` (re-exported via `registry/index.ts`); `self-update/methods/bun.ts`, `self-update/methods/local-dev.ts`, `self-update/methods/npm.ts`, `self-update/methods/pnpm.ts`, `self-update/methods/unknown.ts`, `self-update/methods/yarn.ts` (registered via `registry.ts`).
