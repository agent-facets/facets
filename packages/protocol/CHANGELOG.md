# @agent-facets/protocol

## 0.29.0

### Minor Changes

- [#437](https://github.com/agent-facets/facets/pull/437) [`5a837c5`](https://github.com/agent-facets/facets/commit/5a837c5a35d74c3fa129c90ce3d5c5dd375dd4a9) Thanks [@eXamadeus](https://github.com/eXamadeus)! - **Consumer support for archive format `0.2` (pre-1.0 breaking minor).** The protocol now verifies both legacy `0.1` and current `0.2` `.facet` archives with strict, exact `facetVersion` dispatch and no fallback between versions. This is the consumer-first release: verification support ships before any producer emits `0.2`.
    **Breaking API — `validateFacetArchive`.** The result shape is now `{ ok: true; data: VerifiedFacetArchive } | { ok: false; failure: ArchiveVerificationFailure }`. The previous `{ ok: false; errors: ValidationError[] }` arm is replaced by a single tagged `failure`. The success payload type `VerifiedArchive` is renamed to `VerifiedFacetArchive` and is now a discriminated union on `archiveVersion`: the legacy `0.1` arm keeps the flat `assets: VerifiedAsset[]` list, while the current `0.2` arm exposes `entries: VerifiedEntry[]` (each tagged `manifest` \| `primary-asset` \| `skill-companion` \| `archive-only`). Consumers that read `.assets` unconditionally should migrate to the version-agnostic helpers `listVerifiedFiles(archive)` and `verifiedFileHashes(archive)`.
    **Structured failures.** `ArchiveVerificationFailure` is a tagged union (`container`, `invalid-json`, `duplicate-members`, `unsupported-facet-version`, `schema-violation`, `decompression`, `integrity`, `entry-integrity`, `validation`); classify on `failure.code` rather than parsing messages. No expected failure mode throws.
    **New public API.** `VerifiedFacetArchive`, `VerifiedEntry`, `ArchiveVerificationFailure`, `ValidateFacetArchiveResult`, `listVerifiedFiles`, `verifiedFileHashes`; versioned build-manifest and lockfile schemas plus their exact-dispatch parsers `parseBuildManifestDocument` and `parseLockfileDocument`; the shared archive plan (`planArchiveEntries`, `validateSupplementaryPath`, `portableCollisionKey`); strict raw tar-header validation (`validateRawTarEntries`, `RawTarValidationOptions`); and the archive-format constants `FACET_ARCHIVE_VERSION` (`0.2`), `LEGACY_FACET_ARCHIVE_VERSION` (`0.1`), and `SUPPORTED_FACET_VERSIONS`. `parseFacetArchive` now returns a version-tagged parsed build manifest and a structured `failure`.
    **Transitional exports retained.** `BuildManifestSchema`/`BuildManifest`, `LockfileSchema`/`Lockfile`, and `LOCKFILE_VERSION` (which equals the legacy value `1`, not the current `0.2`) remain exported and `@deprecated` for the compatibility window; they are removed once the engine lockfile-migration and producer work lands. Prefer the versioned parsers and `CURRENT_LOCKFILE_VERSION` in new code.
    This release intentionally carries **no** `@agent-facets/adapter` or `agent-facets` (CLI) version bump: the adapter API `0.0`→`0.1` cutover and the CLI `0.2` producer ship in later, separately gated releases. Other implementations of the spec (e.g. the registry) adopt this published package to gain dual-format verification.

## 0.25.0

### Minor Changes

- [#418](https://github.com/agent-facets/facets/pull/418) [`3ef7a65`](https://github.com/agent-facets/facets/commit/3ef7a6572a3b4c8ab834e3f27c8e9cbd4957af85) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Enforce the Agent Skills name grammar for skill, command, and agent names everywhere names enter the system.
  `@agent-facets/protocol` gains a canonical asset-name grammar (`schemas/asset-name.ts`) modeled on the [Agent Skills spec](https://agentskills.io/specification#name-field). New exports: `parseAssetName`, `parseAssetNameSegment`, `validateAssetName`, and `validateAssetNameSegment`, along with the `AssetNameResult` and `AssetNameSegmentResult` types. A single segment is 1–64 characters of lowercase ASCII letters, digits, and hyphens, must not start or end with a hyphen, and must not contain consecutive hyphens. Full asset names may carry `/`-separated namespace segments (`viper-plans/planning`), each validated independently; the parsers return discriminated-union results instead of throwing.
  BREAKING CHANGE: `FacetManifestSchema` now validates every asset name against this grammar instead of the previous path-safety-only check. Manifests declaring non-conforming asset names (uppercase like `MySkill`, underscores like `foo_bar`, leading/trailing or consecutive hyphens, names over 64 characters) now fail at build **and** install — the schema validates fetched manifests too — rather than passing silently. Digit-start names (`2fa`) are now valid, diverging from the stricter facet-identity slug grammar. Lockfile asset names intentionally keep the weaker path-safety guard so existing installs continue to load and can be removed.
  The `agent-facets` CLI routes `facet create` (wizard and headless), the create/edit TUI views, and `facet modify` (`--add` and `--rename`) through the shared validator, surfacing the grammar's own reason strings in errors. `facet modify --update`/`--remove` still accept legacy non-conforming names so users can fix or remove them.

## 0.24.1

### Patch Changes

- [#404](https://github.com/agent-facets/facets/pull/404) [`ba747bd`](https://github.com/agent-facets/facets/commit/ba747bdcf1884ff82e397b21e9897a32eac8055c) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Widen the `typescript` peerDependency range to `^5 || ^6 || ^7` so the
  package installs cleanly for consumers on TypeScript 7. Consumers on
  TypeScript 5 or 6 are unaffected.

## 0.23.0

### Minor Changes

- [#393](https://github.com/agent-facets/facets/pull/393) [`b0c0be6`](https://github.com/agent-facets/facets/commit/b0c0be6a44bbfe4c9199684180d2ba3bd66f7949) Thanks [@eXamadeus](https://github.com/eXamadeus)! - BREAKING CHANGE: Rebrand from Facet.cafe to agentfacets.io for the registry

## 0.22.3

### Patch Changes

- [#382](https://github.com/agent-facets/facets/pull/382) [`79b1d50`](https://github.com/agent-facets/facets/commit/79b1d50b9ba1721081900e0f775cd3fed8dc2767) Thanks [@dependabot](https://github.com/apps/dependabot)! - Updated tsdown from 0.22.0 to 0.22.3

## 0.22.0

### Minor Changes

- [#353](https://github.com/agent-facets/facets/pull/353) [`5d78611`](https://github.com/agent-facets/facets/commit/5d786119970546d9f008052fa3cfd02266321893) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Add in private facet support

## 0.21.0

### Minor Changes

- [#338](https://github.com/agent-facets/facets/pull/338) [`b663d3c`](https://github.com/agent-facets/facets/commit/b663d3c4b50ec0bb9a288c3b0f0d0382acf69d0c) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Tighten `parseSlug` to 2-64 chars, reject consecutive hyphens, and refresh manifest spec docs to document canonical facet-name grammar

## 0.20.0

### Minor Changes

- [#331](https://github.com/agent-facets/facets/pull/331) [`644f53b`](https://github.com/agent-facets/facets/commit/644f53b8757ac5a882e01c7b77cc0e2e753684de) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Add a facet identity grammar to the public API and enforce it in `FacetManifestSchema`.
  New exports: `parseFacetName`, `parseSlug`, and `validateFacetName`, along with the `FacetName`, `FacetNameResult`, and `SlugResult` types. A facet identity is either an unscoped slug (`cowsay`) or a scoped `@scope/name` (`@julian/cowsay`), where every segment is a lowercase kebab slug. The parsers return discriminated-union results instead of throwing, and `parseSlug` is exported on its own so other facet-spec implementations (e.g. a registry enforcing scope ownership) validate scopes with the exact same grammar.
  `FacetManifestSchema` now validates the manifest `name` field against this grammar. This tightens the previous `name: string` behavior: malformed facet identities (uppercase, leading/trailing hyphens, traversal segments, extra path depth, missing slash after `@scope`, etc.) now fail at manifest validation instead of deferring failure to build, publish, or install. Asset names remain governed separately by `validateAssetName` — asset names stay local path-safe identifiers while facet identities may carry a registry scope.

## 0.19.0

### Patch Changes

- [#328](https://github.com/agent-facets/facets/pull/328) [`dc4bbd0`](https://github.com/agent-facets/facets/commit/dc4bbd080474c2bb45f09ab2f013bd5904afc209) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Upgraded bun from 1.3.13 to 1.3.14

## 0.18.0

### Patch Changes

- [`d3169a8`](https://github.com/agent-facets/facets/commit/d3169a8da74b6b2ac38ce3a86720a00ba182c4bc) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Refactor the install pipeline into a plan/commit architecture with delta-based flow
  **`facet add` with an exact version and a warm cache no longer contacts the registry.** Previously, `facet add cowsay@0.0.1` always fetched from the registry (~1.45s) because the add flow wrote `facets.json` first and then ran install, making an explicit add indistinguishable from reproduction. Now the cache is keyed on the fully-qualified version — a warm cache serves the content directly with no download.
  ### Plan/commit split
  `add`, `remove`, and `install` now share a single commit path. The plan phase produces a delta (additions with the user's specifier verbatim, removals by name; `install` produces an empty delta) with no network I/O, no lockfile reads, and no cache reads. The commit phase owns all resolution, materialization, and a transactional tri-write of `facets.json`, `facets.lock`, and the machine-local receipt — a failure at any point rolls back all three files plus assets.
  The write-ahead manifest mutation and snapshot/restore in `facet add` and `facet remove` are removed. The manifest is never written before install succeeds.
  ### Structural discriminator
  Whether the lockfile is trusted for version resolution depends on where an entry comes from:
  - **In additions** (explicit request): the lockfile is not trusted. An exact specifier needs no version resolution; a non-exact specifier (`bare`, `latest`, `*`, `0.*`) always re-resolves to the newest matching version, even when the lockfile already satisfies it.
  - **From the manifest, not in additions** (reproduction): the lockfile is trusted. A satisfying recorded version needs no resolution; only absent or stale entries trigger it.
    A bare add is pinned to the resolved exact version in `facets.json`; an explicit specifier is written verbatim and floats.
  ### Cache audit and integrity chain
  Cache hits are no longer taken at face value. Every materialization from cache recomputes per-asset and canonical-archive hashes against the integrity sidecar. A tampered slot is evicted and re-fetched — tampered content is never installed and never seeds a lockfile entry. After self-audit, the content is anchored: against the locked integrity when pinned (hard failure on mismatch), or via registry integrity confirmation when creating a new lockfile entry (fails offline rather than writing an unconfirmed entry).
  ### Registry metadata: `contentFingerprint`
  `RegistryMetadata` now carries both `transportHash` (sha256 of the uploaded `.facet` tarball, used for download verification) and `contentFingerprint` (sha256 of the canonical archive, used for lockfile integrity and confirmation). Previously only `expectedIntegrity` was mapped, conflating the two domains.
  ### Machine-local install receipt
  A per-project receipt under `$FACET_DIR/receipts/` tracks what this machine has materialized, keyed by a truncated SHA-256 of the project's canonical path. Drift removal compares the desired set against the receipt — not the on-disk lockfile — so a `git pull` that drops a lockfile entry no longer orphans assets: the receipt still describes them and removal cleans them up offline with no cache or network access. The receipt is untrusted input; every asset path is resolved and must fall inside the project's adapter trees before deletion.
  ### Frozen lockfile
  A frozen commit with a non-empty delta is rejected immediately. Bidirectional consistency checks run before materialization. The receipt is rewritten during drift removal; the lockfile and manifest are never written.
  ### `@agent-facets/protocol`
  Doc comments on `IntegrityFailure` Check A and `RegistryIntegrityInput.cachedIntegrity` updated to reflect the audited-hit model (content is re-hashed against the sidecar, not trusted post-write).

## 0.16.0

### Minor Changes

- [#293](https://github.com/agent-facets/facets/pull/293) [`918cdcc`](https://github.com/agent-facets/facets/commit/918cdccc634da08feb5e5b897c78447645a3061a) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix CLI to honor its own archive format and upload/parse pure .facet archives

## 0.14.1

### Patch Changes

- [#287](https://github.com/agent-facets/facets/pull/287) [`ad4e75a`](https://github.com/agent-facets/facets/commit/ad4e75a9b5360e056611ccd7622ae3660d4476cb) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Record lockfile source provenance as a tagged, per-kind shape so an entry can never disagree with itself.
  The lockfile's `source` field was a single overloaded string — a registry version specifier, a git URL, or a local path depending on the facet. For registry facets this let an unresolved specifier (`latest`, `1.*`) leak into the lockfile next to a resolved `version`, an entry that contradicted itself. `source` is now a discriminated union keyed on `kind`:
  - **`registry`** — records the registry origin (base URL) and never a version. The resolved version lives in the entry's `version` field, so there is no slot for `latest` or a wildcard to leak into.
  - **`git`** — records the repository URL and a **required** resolved commit SHA. A git clone that cannot be pinned to a commit now fails the install rather than writing a non-reproducible entry. The requested ref is no longer recorded in the lockfile — it belongs to `facets.json`.
  - **`local`** — records the resolved path.
    This is a breaking change to the published lockfile schema. There is no migration and no `lockfileVersion` bump: an older flat-`source` lockfile is simply invalid under the new shape and fails install in **every** mode (frozen and non-frozen alike), rather than being silently regenerated. Delete `facets.lock` and re-run install to regenerate it in the new shape. Extra unrecognized keys on a source remain tolerated for forward-compatibility.

## 0.14.0

### Minor Changes

- [#283](https://github.com/agent-facets/facets/pull/283) [`2ed9672`](https://github.com/agent-facets/facets/commit/2ed967206d24a63e9db251605b69302d0bab9097) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Honor edited versions in `facets.json` and add `facet install --frozen-lockfile`.
  `facet install` now re-resolves a lockfile entry whose version no longer satisfies the manifest (e.g. a hand-edited bump), and fails if the requested version doesn't exist instead of silently keeping the old one. The new `--frozen-lockfile` flag treats the lockfile as authoritative and fails on any manifest/lockfile drift, for reproducible CI installs.

## 0.12.0

### Patch Changes

- [#258](https://github.com/agent-facets/facets/pull/258) [`6f47953`](https://github.com/agent-facets/facets/commit/6f47953f41a135afdb1057f4eb50f5276d4e86cb) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Release dependency updates

## 0.11.0

### Minor Changes

- [#256](https://github.com/agent-facets/facets/pull/256) [`ce4861f`](https://github.com/agent-facets/facets/commit/ce4861f08193aa80e7c82452284b6d51fb179429) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Generate the registry client from the registry's published OpenAPI spec.
  The registry server (`facet-cafe`) auto-generates an OpenAPI specification from its actual route handlers; the CLI now consumes that spec as its source of truth. A vendored snapshot of the OpenAPI lives in `@agent-facets/engine`, and TypeScript types are generated from it via `openapi-typescript`. Path strings, params, and response shapes are type-checked end-to-end at every call site through `openapi-fetch`. A registry response field that is renamed, removed, or changes shape now surfaces as a build-time error in a CLI pull request — not a runtime "unexpected response" in front of a user.
  Run `bun run --cwd packages/engine codegen:registry` to refresh the snapshot. A CI job warns when the snapshot is more than 7 days behind the live registry (configurable via `STALENESS_THRESHOLD_DAYS`).
  User-visible: `facet search` results now include a one-line asset-count summary per result (e.g., `1 agent, 2 commands, 1 server`) — surfacing data the registry has been returning all along.
  Behavior corrections during the migration off `registryFetch`:
  - POST requests no longer auto-retry on network error (could re-issue an upload that was already received).
  - The 10s deadline is now per-call instead of per-attempt — a fully-failing call no longer blocks for up to 16s.
  - Caller-supplied abort signals are composed with the deadline via `AbortSignal.any` instead of being silently overwritten.
  - Retries honor the server's `Retry-After` header, capped at 5s.
  - Non-network errors now surface as `UNEXPECTED_ERROR` instead of being mislabeled as network failures.
  - Retry-exhausted errors carry an `attempts` count so user-facing messages can show retry history.

## 0.10.1

### Patch Changes

- [#242](https://github.com/agent-facets/facets/pull/242) [`03e9604`](https://github.com/agent-facets/facets/commit/03e9604df207627bf1d5fc5cd2f212bc909239c5) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump it all, upgraded CI config need to verify release machinery

## 0.10.0

### Minor Changes

- [#238](https://github.com/agent-facets/facets/pull/238) [`1e4e1a1`](https://github.com/agent-facets/facets/commit/1e4e1a1a68b6696718f0a91f7db6b572aeb694c3) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Split `@agent-facets/core` into two layers:
  - **`@agent-facets/protocol`** (NEW, public, Node-native) — the TypeScript reference implementation of the facet artifact specification: schemas, bytes-validators, integrity verification, deterministic archive format, hash algorithm, version-spec grammar, front-matter encoding, and build validators. Runs on Node 22+ with no Bun dependency, so registry servers (Lambda) and other third-party tooling can consume it.
  - **`@agent-facets/engine`** (RENAMED from `@agent-facets/core`, made private) — the Bun-native CLI machinery: install pipeline, registry client, adapter machinery, scaffold, edit, self-update, source resolvers, manifest mutations, cache, build pipeline orchestrator, gzip compression. Internal to the monorepo; never published.
    `@agent-facets/core` is no longer published; the legacy package is frozen at v0.9.1.
    CLI behavior is unchanged. The split is a structural refactor: every `@agent-facets/core` import in the CLI was redirected to either `@agent-facets/protocol` (data primitives) or `@agent-facets/engine` (orchestrators).
