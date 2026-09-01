# @agent-facets/protocol

## 0.31.1

### Patch Changes

- [#557](https://github.com/agent-facets/facets/pull/557) [`9a061c4`](https://github.com/agent-facets/facets/commit/9a061c41b242a9be998a9549ca662df7e8ab6cfe) Thanks [@eXamadeus](https://github.com/eXamadeus)! - **New command: `facet update` (aliased `facet upgrade`)** — moves the registry-backed facets a project declares to newer releases. It reads `facets.json` and `facets.lock`, asks the registry for each facet's range-respecting target and its latest release, and shows both alongside what is installed, so "why is this one not moving?" is answerable from the plan itself. Plain `facet update` takes every target the declared specifier already permits. `--latest` (`-L`) crosses those specifiers and rewrites them by the smallest edit that admits the new version, preserving how the intent was written: a pin stays a pin, `1.*` becomes `2.*`, `1.2.*` becomes `2.4.*`, and `*` and `latest` are left exactly as authored.
    **Previews and per-facet selection.** `--dry-run` prints the plan and writes nothing — no manifest, no lockfile, no receipt, no assets, no cache, and no adapter installation, which makes it safe on a machine with no adapter connected. `--interactive` (`-i`) opens a picker for choosing which facets move and which version each takes. Every row starts on its **latest** release with nothing selected, so walking the list and pressing `Space` takes the newest version of each facet you pick — `Space` always means "yes, this one", and a facet you never touch is left alone. `◀ ▶` (or `l`) moves a row to its range target first when that is what you want instead. `--latest` is accepted alongside `--interactive` but changes nothing there; it is how the non-interactive run asks for what this screen already offers. The picker requires a real terminal and fails immediately without one, before any registry lookup. Git and local facets are named as unsupported rather than counted as current — reporting them as up to date would claim something nothing verified.
    **Applying an update is an install.** Discovery runs read-only and takes no project lock, so reading a plan never blocks another facet operation. Application re-checks under the lock that the project has not moved since the plan was reviewed, then runs the ordinary install pipeline: the same verification, collision handling, MCP approval, rollback, and atomic manifest/lockfile/receipt write. The version you reviewed is the version installed — a release published in between does not silently change it. Recorded materialization choices survive a version change. There is no `--frozen-lockfile`: reproducing what the lockfile already records is the opposite of what this command does.
    **Breaking: `facet upgrade` is no longer a placeholder.** It previously printed a not-yet-implemented notice and exited `0` without touching a single file. It is now an alias of `facet update` — one command, one help page, one behavior — so the same invocation contacts the registry, may install adapters, takes the project lock, and rewrites `facets.json`, `facets.lock`, the install receipt, and your materialized assets. `update` is the canonical spelling, and `facet upgrade --help` prints `Usage: facet update`. If something in your automation called `facet upgrade` expecting a no-op, drop the call or make it explicit with `facet update --dry-run`.
    Neither name touches the CLI binary. That remains `facet self-update`.
    **Protocol: version components are bounded by exact integer representation.** The published version grammar now rejects a specifier or locked version whose numeric component exceeds `2^53 - 1`, with an error that names the magnitude rather than the form. Above that bound two distinct releases are the same double — `9007199254740992` and `9007199254740993` compare equal — so a comparison that decides which release is newer, or whether a locked version still satisfies a manifest range, could answer for a version that was never published. `facet update` is the first command whose whole job is that comparison, which is why the bound lands now. No real version is anywhere near it.

## 0.31.0

### Minor Changes

- [#505](https://github.com/agent-facets/facets/pull/505) [`1581764`](https://github.com/agent-facets/facets/commit/15817644d89dd94a8f041fa04892fe43ced17bbe) Thanks [@eXamadeus](https://github.com/eXamadeus)! - **Concrete MCP server declarations (pre-1.0 breaking minor).** A facet manifest's `servers` map now holds portable connection information rather than a speculative package reference. `McpServerDeclarationSchema` defines a closed tagged union — `{ type: 'stdio', command, args?, env? }` or `{ type: 'http', url }` — exported as `McpServerDeclaration` alongside `McpServerTransport` and `MCP_SERVER_TRANSPORTS`. `command` must be non-empty, `url` must be an absolute `http:`/`https:` URL, environment names must satisfy the portable ASCII grammar enforced by `validateMcpEnvironmentName`, and server names must satisfy the single-segment grammar enforced by `validateMcpServerName`. Values are literal: the schema defines no headers, credentials, OAuth, variable substitution, working directory, shell behavior, or tool-specific policy.
  **Declaration objects reject unrecognized members.** This is a deliberate exception to the manifest's general extension tolerance. A field like `headers`, `cwd`, or `shell` affects what a consumer executes, so tolerating it would let two implementations both report successful validation while configuring materially different behavior. Unrecognized fields outside the declaration objects remain tolerated and preserved.
  **A new dependency-free subpath, `@agent-facets/protocol/mcp-declaration`,** exports the declaration type on its own so the Adapter SDK can consume the contract without taking a runtime dependency on protocol. The schema here remains the single source of truth; nothing downstream redeclares the shape.
  **Server-only facets validate.** The minimum-content rule gains a `servers` disjunct: a manifest with valid identity fields and one concrete declaration is valid with no skill, agent, command, or composed facet. Declarations contribute no content-archive entry — the embedded manifest is their integrity-protected representation.
  **BREAKING: speculative server references are rejected everywhere.** The current schema rejects version-string and `{ image }` values, and `LegacyFacetManifestSchema` now rejects any `servers` member at all while continuing to accept legacy text-asset manifests without one. A manifest selected as current is never retried under legacy validation. Migration is to republish with a concrete declaration; no published artifact used the old forms.
  **BREAKING: the standalone server-manifest API is removed.** `ServerManifestSchema`, `ServerManifest`, `validateServerManifest`, and `SERVER_MANIFEST_FILE` are gone, along with the `server.json` artifact, its loader, and the source-mode/ref-mode model. That contract was speculative and had no publishing, resolution, or runtime implementation. There is no replacement: authors declare servers inside `facet.json`.
  **Canonical declaration fingerprints.** `computeMcpServerFingerprint` and `canonicalMcpServerEncoding` produce a deterministic `sha256:` fingerprint of a declaration's semantics — tagged kind preserved, argument order preserved, environment keys sorted, omitted and empty optional collections normalized to the same value, and both authored and effective names excluded. `isMcpServerFingerprint` and `McpServerFingerprint` narrow the result. This is what lets a consumer decide whether a declaration is unchanged without storing the declaration itself.
  **Project manifest `0.2`.** `CURRENT_PROJECT_MANIFEST_VERSION` advances to `0.2`, adding a `servers` materialization override group that carries the same closed alias-or-omit contract as the asset groups. The preceding schema is frozen and exported as `ProjectManifest01Schema` / `PROJECT_MANIFEST_VERSION_0_1` with its supporting types (`ProjectManifest01`, `ProjectFacetEntry01`, `FacetMaterializationOverrides01`), and it rejects a `servers` group rather than tolerating or promoting one. `MATERIALIZATION_OVERRIDE_GROUPS`, `SERVER_OVERRIDE_GROUP`, and `MaterializationOverrideGroup` name the recognized groups. Version dispatch remains exact: absent, `0.1`, and `0.2` each select exactly one schema with no cross-version fallback.
  **A domain-neutral effective-name planner.** `planEffectiveNames` extracts the deterministic single-pass planning core that assets already used, and `planServerMaterialization` plus `mcpServerKey` wrap it for MCP servers with their own identity, plan, collision, invalid-alias, and stale-override types. `AssetType` is deliberately **not** widened: servers are a separate configuration identity space, so a server never collides with a text asset.
  **No other version axis moves.** `FACET_ARCHIVE_VERSION` and the lockfile schema are untouched — the lockfile stays at `0.3` because a facet's integrity already commits to the exact embedded `facet.json` its declarations live in, so recording them again would add a second copy that can disagree.
  Release ordering: this protocol release intentionally carries **no** `@agent-facets/adapter` or `agent-facets` (CLI) bump. The adapter API `0.1`→`0.2` cutover and the CLI release that materializes declarations ship in later, separately gated cycles, so consumers of the published spec — including the registry — can adopt concrete declarations and manifest `0.2` first.

## 0.30.0

### Minor Changes

- [#475](https://github.com/agent-facets/facets/pull/475) [`e51a346`](https://github.com/agent-facets/facets/commit/e51a3460110c719b6db4df53ae4dd7f9e7eaddbf) Thanks [@eXamadeus](https://github.com/eXamadeus)! - **Materialization aliasing contracts (pre-1.0 breaking minor).** The protocol now publishes the identity model, schemas, and pure planner needed to resolve cross-facet namespace collisions before anything is materialized.
  **Materialization dispositions.** `MaterializationDisposition` is a three-arm tagged shape — `{ kind: 'authored' }`, `{ kind: 'aliased', as }`, `{ kind: 'omitted' }` — describing how a consuming project materializes one authored asset. Two narrower variants are derived from the same arms: `ProjectAssetOverride` (project intent; excludes `authored`, since absence of an override already means authored materialization) and `MaterializedDisposition` (resolved on-disk state; excludes `omitted`, which writes nothing). Aliases must satisfy the current single-segment asset-name grammar and are rejected rather than normalized. An effective name on a non-aliased arm, or an aliased arm without one, is rejected. Helpers `materializedNameOf` and `isMaterialized` are exported alongside.
  **Materialization identity.** `collisionKey(scope, type, effectiveName)` is the LOGICAL uniqueness key — it folds asset type into its namespace and folds the name portably, so a skill and a command claiming one name collide while an agent does not, and names differing only by case or Unicode normalization collide rather than silently overwriting each other. `adapterKey(scope, type, effectiveName)` is the CONCRETE addressable identity an adapter reads, writes, or deletes; it is keyed by type and by the verbatim effective name. Also new: `canonicalPrimaryPath`, `skillRootPath`, `ASSET_DIRECTORY`, `SKILL_PRIMARY_FILE`, `ASSET_TYPE_ORDER`, and `compareAssetTypes` — the single derivation of an asset's authored archive paths and of the canonical ordering every deterministic artifact sorts by. `portableCollisionKey` moved from the archive-plan module to `materialization/identity.ts`; its exported name and behavior are unchanged.
  **Materialization namespaces.** `MATERIALIZATION_NAMESPACE` publishes the design-D9 rule as data for the first time: skills and commands share one namespace, agents occupy another. `materializationNamespace` and `sharesNamespace` derive from it, and `FacetManifestSchema`'s shared-namespace constraint now derives from it too rather than restating the pairing in a hand-written condition — a new asset type can no longer escape the check by not appearing in one.
  **Materialization planner.** `planMaterialization(contributions)` is the pure, deterministic, single-pass rule turning authored contributions plus project overrides into either a collision-free `MaterializationPlan` or the complete list of `CollisionGroup`s blocking one. Every collision group is reported in one pass; alias swaps and name transfers from omitted assets are legal; duplicate alias targets remain collisions; results never depend on declaration order. `StaleOverride` (an override naming an absent asset) is a diagnostic carried on both the success and collision arms, not a failure. Temporarily colliding drafts are a first-class value, so an interactive resolver and the engine's final validation can share one implementation.
  **Project manifest is versioned.** `facets.json` gains its first explicit format version, `manifestVersion: 0.1`, with exact dispatch via `parseProjectManifestDocument`: absence of the field selects `LegacyProjectManifestSchema` (compact source strings only), exactly numeric `0.1` selects `CurrentProjectManifestSchema` (compact strings or expanded entries carrying materialization overrides), and any other declared value is a structured `unsupported-manifest-version` failure. Duplicate JSON members are rejected before dispatch so two conflicting decisions for one asset cannot collapse through last-member-wins parsing. There is no shape-based fallback in either direction. `facetEntrySource` and `facetEntryOverrides` are exported so read-only consumers handle both entry forms uniformly. `FacetsJsonSchema`/`FacetsJson` are removed in this release — see the breaking note below for what replaces them. A `materialization` object may declare only `skills`, `agents`, and `commands`; any other group key is rejected rather than accepted and ignored, including alongside a valid group, so a misspelling cannot silently discard the intent it carries.
  **Lockfile `0.3` is what a normal install writes.** `Lockfile03Schema` adds a required `materialization` disposition to every asset entry. Authored `name` and canonical authored `files` paths are unchanged by aliasing, because those identities anchor integrity; an omitted asset remains listed with its complete authored file records, since the lockfile records the resolved asset set and must stay comparable against project intent. Exact readers for `0.2` and `0.3` are preserved with no cross-version fallback: a version number names a schema rather than a position in a sequence, so dispatch is by equality and an unrecognized value fails closed. `LOCKFILE_VERSION_0_2` and `LOCKFILE_VERSION_0_3` name the schemas explicitly; `CURRENT_LOCKFILE_VERSION` and `CurrentLockfileSchema` track whichever version a normal install writes and now point at `0.3`.
  **Lockfile file records must belong to their asset.** `Lockfile02Schema` and `Lockfile03Schema` now derive ownership from the entry itself instead of only checking that paths are safe, sorted, and non-duplicate. An agent or command entry must carry exactly one record at its own canonical primary path; a skill entry must carry its canonical `SKILL.md` and nothing outside its authored root. Command `deploy` listing `README.md` previously validated, which let integrity and deletion be associated with an unrelated archive file.
  **Unrecognized lockfile fields survive reconstruction.** `preserveLockfileExtensions(previous, next)` carries extension data forward through a rewrite at every level the schema defines — document, facet entry, source (when the source kind is unchanged), asset matched by authored `(scope, type, name)`, and file record matched by `path` — including across a `0.2 → 0.3` migration. Schema-defined fields always win a name conflict, and extensions belonging to a facet, asset, or file the new state no longer contains are dropped with it. The published spec already required unrecognized fields to be preserved; only loading honored it, so any rewrite silently discarded them.
  **Two planner correctness fixes.** `overrideFor(overrides, type, authoredName)` is exported and used wherever an override map is indexed: a plain object inherits `constructor` and `__proto__`, so an asset legitimately named `constructor` could previously resolve to `Object`'s constructor and be stored as a "disposition" that vanished on serialization. And `cloneDisposition` is applied to every disposition the planner returns, so mutating the override objects you passed in cannot retroactively change a plan's `disposition` while its precomputed `effectiveName` and `adapterKey` stay keyed to the old value — the purity the planner already documented is now actually enforced.
  **BREAKING: the unpinned lockfile compatibility surface is removed.** `LockfileSchema`, `Lockfile`, `LockfileFacet`, `LockfileAssetEntry`, and `LOCKFILE_VERSION` no longer exist. That schema predated exact version dispatch: it accepted any numeric `lockfileVersion` alongside identity-only assets, so a `0.3` version paired with disposition-less entries — a document no reader would ever produce — satisfied it, and any code holding one of those types silently lost `files` and `materialization`. Replacements are explicit. Use the `Lockfile02*` and `Lockfile03*` families for a specific version, `CurrentLockfile*` for what a producer writes, and the new `SupportedLockfile`, `SupportedLockfileFacet`, `SupportedLockfileAssetEntry`, and `SupportedLockfileVersion` — each derived from `ParsedLockfile`, not hand-written — for a value that may be any readable version. Reading `files` or `materialization` off the supported union requires discriminating on the version tag, which is the point.
  **BREAKING: the closed-alpha lockfile `1` is no longer readable.** `LEGACY_LOCKFILE_VERSION`, `LegacyLockfileSchema`, `LegacyLockfile`, `LegacyLockfileFacet`, and `LegacyLockfileAssetEntry` no longer exist, and `SUPPORTED_LOCKFILE_VERSIONS` is `[0.2, 0.3]`. A `facets.lock` declaring `1` now fails as an unsupported version with delete-and-regenerate guidance instead of parsing. This is deliberate rather than deferred: numeric `1` is needed for the eventual stable v1 schema, and keeping a withdrawn alpha shape parked on that number meant every future reader had to disambiguate two unrelated formats sharing one identifier. It also removes the last state in which a locked asset carried no file records — the case that made frozen reproduction unable to reconcile a non-`project` scope. End users on `0.2` and `0.3` are unaffected; anyone still holding a `1` deletes the file and re-runs a normal install, which re-verifies every artifact from scratch.
  **BREAKING: the permissive `FacetsJsonSchema` is removed.** `FacetsJsonSchema` and `FacetsJson` no longer exist. That schema was `{ facets: Record<string, string> }` — it predated both `manifestVersion` and expanded entries, so it could not observe which generation a document belonged to and actively **rejected** every valid `0.1` manifest carrying an alias or omission. Its own deprecation note scheduled removal once engine migrated, which it has. Use `parseProjectManifestDocument` for version dispatch, `LegacyProjectManifestSchema` / `CurrentProjectManifestSchema` for a specific generation, and `facetEntrySource` / `facetEntryOverrides` to read an entry without caring which form it took.
  **Two shared refinements are now published rather than restated per consumer.** `lockedDispositionOf(asset)` returns the disposition a locked asset records, refining a `0.2` entry to an explicit `authored` — the only thing that schema could have meant — so a project on an older lockfile compares equal to one recording the default instead of reporting drift on every asset. `sameDisposition(a, b)` compares two dispositions arm-aware, since structural equality would compare `as` on arms that do not carry it. Both encode spec rules every implementation needs, and three private copies of the first had already accumulated.
  **No other version axis moves.** `FACET_ARCHIVE_VERSION`, the build-manifest schemas, and the adapter API version are untouched. Archive bytes and adapter request shapes are unchanged.

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
