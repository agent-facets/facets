# agent-facets

## 0.22.0

### Minor Changes

- [#353](https://github.com/agent-facets/facets/pull/353) [`5d78611`](https://github.com/agent-facets/facets/commit/5d786119970546d9f008052fa3cfd02266321893) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Add in private facet support

## 0.21.1

### Patch Changes

- [#342](https://github.com/agent-facets/facets/pull/342) [`3314057`](https://github.com/agent-facets/facets/commit/3314057512906a0494240086dcfcd55cc07ee1c9) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Add in registry URL to `facet whoami`

## 0.21.0

### Minor Changes

- [#338](https://github.com/agent-facets/facets/pull/338) [`b663d3c`](https://github.com/agent-facets/facets/commit/b663d3c4b50ec0bb9a288c3b0f0d0382acf69d0c) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Tighten `parseSlug` to 2-64 chars, reject consecutive hyphens, and refresh manifest spec docs to document canonical facet-name grammar

### Patch Changes

- [#334](https://github.com/agent-facets/facets/pull/334) [`c44c321`](https://github.com/agent-facets/facets/commit/c44c321c168ee05d827dc33284fb6d5fed650d77) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Route scoped facet publish, resolve, and download through two-segment `{scope}/{name}` registry paths to avoid `%2F`-encoding rejection
- [#335](https://github.com/agent-facets/facets/pull/335) [`2861755`](https://github.com/agent-facets/facets/commit/28617556e84f5edd82dec1d4b1d7127e526c64fd) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix `writeBuildOutput` to create parent directories for scoped (`@scope/name`) and slash-containing archive paths, and accept scoped facet names in create/edit views

## 0.19.0

### Minor Changes

- [#325](https://github.com/agent-facets/facets/pull/325) [`ef26047`](https://github.com/agent-facets/facets/commit/ef26047602d8b546dfcb19c3fcef9c4ce485beaf) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added verbose logging and updated adapters to return asset install paths (for logging purposes)

### Patch Changes

- [#328](https://github.com/agent-facets/facets/pull/328) [`dc4bbd0`](https://github.com/agent-facets/facets/commit/dc4bbd080474c2bb45f09ab2f013bd5904afc209) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Upgraded bun from 1.3.13 to 1.3.14
- [#327](https://github.com/agent-facets/facets/pull/327) [`b9a1477`](https://github.com/agent-facets/facets/commit/b9a14772e88e9b2a83dc002cf93c29a2e9188b9e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Make `OnLog` accept a lazy builder thunk, remove `foo` facet, and drop skipped TTY adapter-picker tests
- [#323](https://github.com/agent-facets/facets/pull/323) [`6d5767b`](https://github.com/agent-facets/facets/commit/6d5767b3e3bdc1319d1ee8cf1b08039824197b15) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Sort lockfile facet keys alphabetically on write for deterministic diffs

## 0.18.2

### Patch Changes

- [#321](https://github.com/agent-facets/facets/pull/321) [`44f1f35`](https://github.com/agent-facets/facets/commit/44f1f35c48a90b4fc3da52756b7f671f90d8abed) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Share `ensureAdapters` with `install`, and skip unpilotable TTY adapter-picker test

## 0.18.1

### Patch Changes

- [#318](https://github.com/agent-facets/facets/pull/318) [`e168b9c`](https://github.com/agent-facets/facets/commit/e168b9ceaf49b384601f3b0343bb080009cd0b4d) Thanks [@eXamadeus](https://github.com/eXamadeus)! - UI changes for the CLI

## 0.18.0

### Minor Changes

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

## 0.17.0

### Minor Changes

- [#303](https://github.com/agent-facets/facets/pull/303) [`92adbf8`](https://github.com/agent-facets/facets/commit/92adbf8c78c9235c361f8f1142154add34cedffb) Thanks [@eXamadeus](https://github.com/eXamadeus)! - UI updates for all facet management commands and `remove` will now silently ignore undeclared facets
- [#305](https://github.com/agent-facets/facets/pull/305) [`da47e09`](https://github.com/agent-facets/facets/commit/da47e0931dad076174b7c263edb8603d0f4ea547) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Update CLI to match snake_case API values

## 0.16.1

### Patch Changes

- [#299](https://github.com/agent-facets/facets/pull/299) [`982eafd`](https://github.com/agent-facets/facets/commit/982eafda525fa318ea8c41582c7541f552f34962) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Minor CI caching improvement

## 0.16.0

### Minor Changes

- [#293](https://github.com/agent-facets/facets/pull/293) [`918cdcc`](https://github.com/agent-facets/facets/commit/918cdccc634da08feb5e5b897c78447645a3061a) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix CLI to honor its own archive format and upload/parse pure .facet archives

## 0.15.0

### Minor Changes

- [#289](https://github.com/agent-facets/facets/pull/289) [`d2f3946`](https://github.com/agent-facets/facets/commit/d2f39467d25c4b5d9d429bb18dd348865b186646) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Add the `facet remove` command (aliased `rm`) — the inverse of `facet add`.
  `facet remove <facet> [more facets...]` takes one or more facets back out of a project in a single command: it removes them from `facets.json`, deletes their assets from every connected adapter, and rewrites `facets.lock` without them.
  - **Transactional** — removal reuses the same install pipeline as `facet add`, so any failure restores `facets.json` byte-for-byte and leaves the project unchanged.
  - **All-or-nothing** — when removing multiple facets, if any name is not declared in `facets.json`, nothing is removed.
  - **Strict** — removing a facet that is not declared fails with a clear error instead of silently succeeding. Every facet you don't name is left untouched.
  - **`--verbose`** — emits detailed step output on stderr, matching `facet add`/`facet install`.

## 0.14.1

### Patch Changes

- [#286](https://github.com/agent-facets/facets/pull/286) [`f85cf3c`](https://github.com/agent-facets/facets/commit/f85cf3c6af1bd02b14879261b7805f05c925a264) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Make `facet install --frozen-lockfile` reproduce the lockfile exactly.
  Frozen mode now guarantees the installed project matches the lockfile bit-for-bit — no extra facets, no missing facets, no source changes, and no content changes:
  - **Source drift** — a git or local facet whose manifest source string (URL, ref, or path) no longer matches the locked source now fails the preflight (`source-changed`) before any clone or build, instead of silently building from the unlocked origin.
  - **Local content drift** — a local facet is now verified against its locked integrity in frozen mode, exactly like git. Editing a local source's content fails the install rather than rebuilding and overwriting the entry.
  - **Cache correctness (frozen and non-frozen)** — a git facet whose manifest URL changed bypasses the content-addressed cache entirely (the cache key carries no source provenance), so a changed URL re-resolves from the new source instead of reusing cached bytes from the old one.
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

### Patch Changes

- [#283](https://github.com/agent-facets/facets/pull/283) [`2ed9672`](https://github.com/agent-facets/facets/commit/2ed967206d24a63e9db251605b69302d0bab9097) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Make `facet install --frozen-lockfile` fail on orphaned lockfile entries.
  A frozen install now reports a facet that is pinned in `facets.lock` but no longer declared in `facets.json` as drift (`orphaned`) and fails before touching the project. Previously the preflight only checked manifest entries, so an orphaned entry slipped through and the drift-removal pass pruned its assets while skipping the lockfile write — mutating adapter state and leaving a stale lockfile. The drift report's per-facet shape is now a discriminated union on its reason, so an `unsatisfied` entry always carries its locked version and an `orphaned` entry carries no manifest specifier.

## 0.13.0

### Minor Changes

- [#281](https://github.com/agent-facets/facets/pull/281) [`e48aadf`](https://github.com/agent-facets/facets/commit/e48aadf76a0eff5bdcf36dfff612d0a1647cca38) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Migrate the CLI to the registry's Bearer-token `/v0/facets/*` contract.
  **Breaking:** the `FACET_REGISTRY_API_KEY` environment variable is removed with no fallback. Authenticate with a personal access token instead — set `FACET_TOKEN`, or run the new `facet login` to verify and save one to `~/.facet/credentials`.
  Also adds `facet whoami` and `facet logout`; renders registry errors using the registry's own message and suggested fix; lets `facet publish` take an optional directory argument; and treats a queued-for-review publish as success.

### Patch Changes

- [#282](https://github.com/agent-facets/facets/pull/282) [`2e49722`](https://github.com/agent-facets/facets/commit/2e497226bc5d0a843696b271b11007c64a080bc8) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix `facet add` to write resolved versions instead of the facet name
- [#276](https://github.com/agent-facets/facets/pull/276) [`c3f0357`](https://github.com/agent-facets/facets/commit/c3f03572c4d46913a4af0d2e0b0d94252751c38b) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump ink from 7.0.2 to 7.0.5

## 0.12.0

### Minor Changes

- [#260](https://github.com/agent-facets/facets/pull/260) [`16cd45a`](https://github.com/agent-facets/facets/commit/16cd45ae260e299eb3b7a1943c843c9998a7859a) Thanks [@eXamadeus](https://github.com/eXamadeus)! - **Breaking:** Consolidate every directory env var into a single
  `FACET_DIR`, rename the launcher binary override, and move the install
  advisory lock out of the project root.
  ## What changed
  One env var, `FACET_DIR` (default `~/.facet`), now controls every
  directory the facet CLI writes to disk. Everything lives under it:
  - `$FACET_DIR/bin/` — curl-installed binary
  - `$FACET_DIR/cache/` — content-addressed cache for fetched payloads
  - `$FACET_DIR/adapters/` — installed adapter bundles
  - `$FACET_DIR/locks/` — install advisory locks (one file per project,
    keyed by `<basename>-<sha256(realpath)[:16]>.lock`)
    The launcher's binary override is renamed:
  - `FACET_BIN_PATH` → `FACET_BIN_OVERRIDE`
    The name carries the semantics: setting it overrides which binary the
    launcher executes, and `facet self-update` continues to refuse while
    it's set because overriding means you've taken control of binary
    placement.
    The install advisory lock moves out of the project root. Previously it
    was `<projectRoot>/.facets/.install.lock` (a directory `facet install`
    silently materialized in every project). Now it lives at
    `$FACET_DIR/locks/<basename>-<hash>.lock`, keyed by the project's
    canonical path. The project root stays clean — `facet install` writes
    nothing next to `facets.json`.
  ## Removed env vars
  Hard rename, no aliases. Old names are silently ignored; values fall
  back to defaults until users rename in their shell rc files or CI configs:
  - `FACETS_CACHE_DIR`
  - `FACETS_ADAPTERS_DIR`
  - `FACET_CACHE_DIR`
  - `FACET_ADAPTERS_DIR`
  - `FACET_INSTALL_DIR`
  - `FACET_BIN_PATH`
    `FACET_CLI_REGISTRY` and `FACET_VERSION` (used by `install.sh`) are
    unchanged.
  ## No migration
  Existing cached payloads and adapters at `~/.facets/` are not detected,
  copied, or warned about. The new code reads `$FACET_DIR` only.
  Users may delete `~/.facets/` at any time; the new code will rebuild
  cache and adapters on first use.

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

### Patch Changes

- [#238](https://github.com/agent-facets/facets/pull/238) [`1e4e1a1`](https://github.com/agent-facets/facets/commit/1e4e1a1a68b6696718f0a91f7db6b572aeb694c3) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Split `@agent-facets/core` into two layers:
  - **`@agent-facets/protocol`** (NEW, public, Node-native) — the TypeScript reference implementation of the facet artifact specification: schemas, bytes-validators, integrity verification, deterministic archive format, hash algorithm, version-spec grammar, front-matter encoding, and build validators. Runs on Node 22+ with no Bun dependency, so registry servers (Lambda) and other third-party tooling can consume it.
  - **`@agent-facets/engine`** (RENAMED from `@agent-facets/core`, made private) — the Bun-native CLI machinery: install pipeline, registry client, adapter machinery, scaffold, edit, self-update, source resolvers, manifest mutations, cache, build pipeline orchestrator, gzip compression. Internal to the monorepo; never published.
    `@agent-facets/core` is no longer published; the legacy package is frozen at v0.9.1.
    CLI behavior is unchanged. The split is a structural refactor: every `@agent-facets/core` import in the CLI was redirected to either `@agent-facets/protocol` (data primitives) or `@agent-facets/engine` (orchestrators).

## 0.9.1

### Patch Changes

- [#235](https://github.com/agent-facets/facets/pull/235) [`acdb171`](https://github.com/agent-facets/facets/commit/acdb171d94b0fe8a22789021e4b0e9f4b2b1e039) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Wire CLI to live registry: add `facet search`, `facet list`, registry resolution in install pipeline, and InstallView marketing aesthetic
- [#236](https://github.com/agent-facets/facets/pull/236) [`cc76d43`](https://github.com/agent-facets/facets/commit/cc76d43f4ce62d706154b00071ca62448b1c329e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Allow YAML front matter in content files; merge with manifest at install time

## 0.9.0

### Minor Changes

- [#221](https://github.com/agent-facets/facets/pull/221) [`b2f92a4`](https://github.com/agent-facets/facets/commit/b2f92a45198ec5495e9f8dae414881bffa1cd8a7) Thanks [@eXamadeus](https://github.com/eXamadeus)! - `facet add <source>` now resolves, writes, and installs in one step instead of leaving the user to run `facet install` separately. Multiple sources per invocation are supported. `facets.json` rolls back byte-for-byte on failure.
  The adapter picker auto-launches when `add` runs against a project with no connected adapters in a TTY. Non-TTY exits with a clear "no adapters installed" error.
  Source grammar tightened for closed alpha: `git+` prefixes hard-rejected, `^` / `~` / `1.x` ranges hard-rejected with a fix pointing at the supported `*` wildcards (`1.*`, `1.2.*`), and bare registry names route to a registry stub that errors clearly until the real registry ships.
  The install pipeline (sources, resolvers, lockfile I/O, materialization, integrity, cache, registry stub) moved from the CLI into `@agent-facets/core`. The CLI is now display-only on top.
  `@agent-facets/adapter` fixes a blank-line asymmetry in `assembleAssetContent` that made `materialize`'s skip-if-identical check see phantom drift on every re-install. First-party adapter packages republish at the patch level so the bundled fix reaches existing installs.

## 0.8.0

### Minor Changes

- [#223](https://github.com/agent-facets/facets/pull/223) [`3126e57`](https://github.com/agent-facets/facets/commit/3126e57dc18c0d80c047b0277600281282494fe3) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Add `facet self-update` (alias `facet self-upgrade`) to update the CLI in-band.
  The command detects how the running binary was installed — curl installer,
  `npm` / `yarn` / `pnpm` / `bun` global, dev mode, or unclassified — and
  dispatches to a matching update mechanism. Reuses the existing curl
  installer at `agentfacets.io/install` and the user's package manager
  rather than duplicating download/integrity logic. Honors
  `FACET_CLI_REGISTRY` for version metadata.
  Two flags: `--version <x.y.z>` to pin a release and `--dry-run` to print
  the plan without executing it. Refuses gracefully in dev mode (when
  `FACET_BIN_PATH` is set) with a clear stderr message.
  Also adds a generic `aliases` field to the `Command` type so future
  commands can declare alternate names without duplicating registrations.

## 0.7.3

### Patch Changes

- [#211](https://github.com/agent-facets/facets/pull/211) [`66b2fa3`](https://github.com/agent-facets/facets/commit/66b2fa3f70b663ba28e64e4fbc16e0eb60f4498a) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump eveything to refresh publish pipelines

## 0.7.2

### Patch Changes

- [#204](https://github.com/agent-facets/facets/pull/204) [`bb49308`](https://github.com/agent-facets/facets/commit/bb493088ebffa2819a46b00c565b9b06c435ca32) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Get @agent-facets/common out of all deps, it's always bundled

## 0.7.1

### Patch Changes

- [#183](https://github.com/agent-facets/facets/pull/183) [`c9a1a4d`](https://github.com/agent-facets/facets/commit/c9a1a4dfe7e28437d6b523c6fa83ff17ac9b9f94) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Serial deploys via CI to ensure tag and release ordering

## 0.7.0

### Minor Changes

- [#168](https://github.com/agent-facets/facets/pull/168) [`8a697b5`](https://github.com/agent-facets/facets/commit/8a697b597842bcb4d3207ca73d429f4dff2be7b4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Clean up publish failures

## 0.6.1

### Patch Changes

- [#161](https://github.com/agent-facets/facets/pull/161) [`c120f86`](https://github.com/agent-facets/facets/commit/c120f86d13b1df72e4d04356c27552df9fe0e085) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Post-alpha follow-ups from PR [#150](https://github.com/agent-facets/facets/issues/150) agent feedback.

## 0.6.0

### Minor Changes

- [#151](https://github.com/agent-facets/facets/pull/151) [`d2aa6a2`](https://github.com/agent-facets/facets/commit/d2aa6a25a3c58eb71164168c3a2f48328309c751) Thanks [@eXamadeus](https://github.com/eXamadeus)! - `facet add` and `facet install` land for closed-alpha dogfood.
  - **`facet add <source>`** — parses github/git+/file: specifiers, resolves (git clone with `GIT_TERMINAL_PROMPT=0` + SHA support, or local path with project-tree containment), reads the source's `facet.json`, and atomically edits `facets.json` (comment-preserving via `comment-json`).
  - **`facet install`** — runs the build pipeline against each source tree (closed-alpha "repo root as facet source" per design), computes a drift-proof diff vs. the prior lockfile, and materializes assets through every adapter with `supportsInstall: true`. Adapter-agnostic `facets.lock` with an `assets: [{scope, type, name}]` list per facet — the same asset set applies to every selected adapter.
  - **Best-effort rollback** — in-memory journal replays inverse ops on adapter error or SIGINT; rollback failures report a clear "partial state; re-run to reconcile" message.
  - **`--verbose`** — `[verbose] <step>` lines to stderr for partner bug reports.
  - **`--dry-run`** — prints the would-be plan and exits 0 without touching disk.
  - **Shared install picker** — Ink multi-select shown in both `facet adapter install` (no-arg) and `facet install` zero-adapter paths; codex row is rendered dimmed + non-selectable until it flips `supportsInstall`.
  - **Atomic parallel-install lock** — `.facets/.install.lock` via `O_CREAT|O_EXCL` with stale-pid recovery.
  - **Stub commands** (`info`, `list`, `publish`, `remove`, `upgrade`) are hidden from `facet --help` but stay invocable so typos still get "did you mean…" suggestions.
  - **Core**: new adapter-agnostic `LockfileSchema`, `FacetsJsonSchema`, and pure manifest mutations (`parseFacetsJson`, `serializeFacetsJson`, `upsertFacetInManifest`, `removeFacetFromManifest`). Comments in hand-edited `facets.json` survive round-trips.

## 0.5.3

### Patch Changes

- f673986 Thanks @eXamadeus! - Correct CircleCI deployment keys

## 0.5.2

### Patch Changes

- [#145](https://github.com/agent-facets/facets/pull/145) [`a09846b`](https://github.com/agent-facets/facets/commit/a09846bce2b449287261ed4511ff0c3ad1599d6e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - CircleCI

## 0.5.1

### Patch Changes

- [#142](https://github.com/agent-facets/facets/pull/142) [`2c74835`](https://github.com/agent-facets/facets/commit/2c74835443d78f16e0c4cc8effc8d7f0b01e593f) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fixed bundling of adapters
- [#144](https://github.com/agent-facets/facets/pull/144) [`5c235e0`](https://github.com/agent-facets/facets/commit/5c235e08126e7dd6640c921625189f6fca1b4d5d) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump em all. Test release pipeline

## 0.5.0

### Minor Changes

- [#126](https://github.com/agent-facets/facets/pull/126) [`51f8dfc`](https://github.com/agent-facets/facets/commit/51f8dfcb890fed23e64c3d944e788a20f8249567) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Add in @agent-facets/adapter and @agent-facets/common packages
- [#128](https://github.com/agent-facets/facets/pull/128) [`a350666`](https://github.com/agent-facets/facets/commit/a3506668311707d96f46d912177abd868a1e88ce) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added in an SDK for adapting the facet CLI to various systems/tools

### Patch Changes

- [#129](https://github.com/agent-facets/facets/pull/129) [`f8a5a7b`](https://github.com/agent-facets/facets/commit/f8a5a7b78f96d8269042a05caf360ee95ed76cb4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Publish all packages touched

## 0.4.0

### Minor Changes

- [#94](https://github.com/agent-facets/facets/pull/94) [`24a2e99`](https://github.com/agent-facets/facets/commit/24a2e999a483edfcf478946263e42b28a7da2f4f) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Build should result in a single-file facet archive that contains the manifest and integrity-checked assets.
- [#94](https://github.com/agent-facets/facets/pull/94) [`24a2e99`](https://github.com/agent-facets/facets/commit/24a2e999a483edfcf478946263e42b28a7da2f4f) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Reset facetVersion in manifest to `0.1` since `1` was premature and should be used for general availability

### Patch Changes

- [#85](https://github.com/agent-facets/facets/pull/85) [`aacc6cd`](https://github.com/agent-facets/facets/commit/aacc6cda49e2611de8bde1ac42144dda97e5b6cc) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump arktype from 2.1.29 to 2.2.0
- [#96](https://github.com/agent-facets/facets/pull/96) [`e136a5b`](https://github.com/agent-facets/facets/commit/e136a5b6937a03817931ee0f0a43f1895ba51674) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix bun dev script: broken relative paths and no TTY passthrough

## 0.3.6

### Patch Changes

- [#80](https://github.com/agent-facets/facets/pull/80) [`868cc3b`](https://github.com/agent-facets/facets/commit/868cc3b7ea36445f3b59e0a652ac0ba93a89eb78) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Revert staging dist-tag operation, since NPM doesn't support it without NPM_TOKENs

## 0.3.5

### Patch Changes

- [#78](https://github.com/agent-facets/facets/pull/78) [`b4753d1`](https://github.com/agent-facets/facets/commit/b4753d1a0d7439491ad77d9aaf968cd89c3b7da9) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix OIDC publishing and refactor publish scripts

## 0.3.4

### Patch Changes

- [#76](https://github.com/agent-facets/facets/pull/76) [`a151e60`](https://github.com/agent-facets/facets/commit/a151e600a6b795a0bfdbb21b3b342ba2e92aed9e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix release pipeline:
  - support keyless promotion inspired by Nuxt's OIDC JWT exchange
  - use a matrix release workflow (because the key exchange is per-package and the builds are resource intense)
  - use custom notifications for failures to the dev team's Slack

## 0.3.3

### Patch Changes

- [#73](https://github.com/agent-facets/facets/pull/73) [`c31b057`](https://github.com/agent-facets/facets/commit/c31b057c98e5f8d70c3b1ace3e176b09a0060763) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added contributing docs and fixed publishing pipeline

## 0.3.2

### Patch Changes

- [#70](https://github.com/agent-facets/facets/pull/70) [`319889c`](https://github.com/agent-facets/facets/commit/319889c1c8dfbb492be4a89ee520563ef8da1a39) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Force CI tag cycle

## 0.3.1

### Patch Changes

- [#65](https://github.com/agent-facets/facets/pull/65) [`4cc6051`](https://github.com/agent-facets/facets/commit/4cc605110dee69741718be53c6c008599888eb8a) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Ensure all binary packages are built and published safely and simultaneously

## 0.3.0

### Minor Changes

- [#55](https://github.com/agent-facets/facets/pull/55) [`01d8ad8`](https://github.com/agent-facets/facets/commit/01d8ad8856d14546a691d45a4326276811c9ce4f) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Use tag-based release strategy
- [#53](https://github.com/agent-facets/facets/pull/53) [`48bce8d`](https://github.com/agent-facets/facets/commit/48bce8da30ffefd961868ccd53ca364e9027ceec) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Platform specific package seeding
- [#51](https://github.com/agent-facets/facets/pull/51) [`8280bba`](https://github.com/agent-facets/facets/commit/8280bba66d5ab6a132e1b6792bcccce03037a6de) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Support 12 platform binaries (linux, windows, mac and common variants)

### Patch Changes

- [#51](https://github.com/agent-facets/facets/pull/51) [`8280bba`](https://github.com/agent-facets/facets/commit/8280bba66d5ab6a132e1b6792bcccce03037a6de) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Support dev platform "dev" mode via `bun dev` removing the complex build -> link flow

## 0.2.2

### Patch Changes

- [#39](https://github.com/agent-facets/facets/pull/39) [`f380b7b`](https://github.com/agent-facets/facets/commit/f380b7bc5115acec1f974ef1401eba199a2f90fb) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Ensure release CI works in isolation
- [#46](https://github.com/agent-facets/facets/pull/46) [`a5cbb89`](https://github.com/agent-facets/facets/commit/a5cbb89a46e14e2f79749ea7eafb5aebbd3504b7) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Ensure all CI runs and provenance is managed correctly across packages

## 0.2.1

### Patch Changes

- [#39](https://github.com/agent-facets/facets/pull/39) [`f380b7b`](https://github.com/agent-facets/facets/commit/f380b7bc5115acec1f974ef1401eba199a2f90fb) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Ensure release CI works in isolation

## 0.2.0

### Minor Changes

- [#35](https://github.com/agent-facets/facets/pull/35) [`6350718`](https://github.com/agent-facets/facets/commit/63507188f1bb3a7276cd4812f69f7d16d1778fd6) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Ensure proper release isolation

### Patch Changes

- [#37](https://github.com/agent-facets/facets/pull/37) [`1c48260`](https://github.com/agent-facets/facets/commit/1c48260ab77fd27e64be6c5884aa6c447e3639e0) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Better dev & ci dependency management via mise
- [#33](https://github.com/agent-facets/facets/pull/33) [`540e126`](https://github.com/agent-facets/facets/commit/540e126e677de98a9b3d4e39542df37de8756b73) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Ensure CI runs tests before release and notify Slack when failures occur.

## 0.1.4

### Patch Changes

- [`098fd08`](https://github.com/agent-facets/facets/commit/098fd08bf5d9970babc5c57bee6a155bffcecd97) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Better CLI parameter validation

- [`5262cbe`](https://github.com/agent-facets/facets/commit/5262cbe66df02c625430309878e6061ccde183de) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix publishing by properly categorizing dev dependencies

- [`d3b9439`](https://github.com/agent-facets/facets/commit/d3b9439466e0eb65687901426e2ebd6c5a333c60) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Use better github attribution for changesets

## 0.1.3

### Patch Changes

- 66b179f: Wire up the facet edit command

## 0.1.2

### Patch Changes

- bb87748: This is a CI improvement so we release faster and cleaner
- 95e2f38: Migrate NPM packages from `@ex-machina` to `@agent-facets` org.

  - `@ex-machina/facet-core` is now `@agent-facets/core`
  - `@ex-machina/facet` is now `agent-facets`

- Updated dependencies [bb87748]
- Updated dependencies [95e2f38]
  - @agent-facets/brand@0.1.1
  - @agent-facets/core@0.1.2

## 0.1.1

### Patch Changes

- 5813b90: Small test for change set management in CI
- Updated dependencies [5813b90]
  - @agent-facets/core@0.1.1

## 0.1.0

### Minor Changes

- 2243bbf: Added basic create command to CLI

### Patch Changes

- Updated dependencies [2243bbf]
  - @agent-facets/core@0.1.0

## 0.0.1

### Patch Changes

- 74e3d25: Should be 0.0.1 now
- 74e3d25: Initial publishing
- Updated dependencies [74e3d25]
- Updated dependencies [74e3d25]
  - @agent-facets/core@0.0.1
