# @agent-facets/adapter

## 0.23.0

### Minor Changes

- [#393](https://github.com/agent-facets/facets/pull/393) [`b0c0be6`](https://github.com/agent-facets/facets/commit/b0c0be6a44bbfe4c9199684180d2ba3bd66f7949) Thanks [@eXamadeus](https://github.com/eXamadeus)! - BREAKING CHANGE: Rebrand from Facet.cafe to agentfacets.io for the registry

## 0.22.3

### Patch Changes

- [#382](https://github.com/agent-facets/facets/pull/382) [`79b1d50`](https://github.com/agent-facets/facets/commit/79b1d50b9ba1721081900e0f775cd3fed8dc2767) Thanks [@dependabot](https://github.com/apps/dependabot)! - Updated tsdown from 0.22.0 to 0.22.3

## 0.19.0

### Minor Changes

- [#325](https://github.com/agent-facets/facets/pull/325) [`ef26047`](https://github.com/agent-facets/facets/commit/ef26047602d8b546dfcb19c3fcef9c4ce485beaf) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added verbose logging and updated adapters to return asset install paths (for logging purposes)

### Patch Changes

- [#328](https://github.com/agent-facets/facets/pull/328) [`dc4bbd0`](https://github.com/agent-facets/facets/commit/dc4bbd080474c2bb45f09ab2f013bd5904afc209) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Upgraded bun from 1.3.13 to 1.3.14

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

- [#236](https://github.com/agent-facets/facets/pull/236) [`cc76d43`](https://github.com/agent-facets/facets/commit/cc76d43f4ce62d706154b00071ca62448b1c329e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Allow YAML front matter in content files; merge with manifest at install time

## 0.4.6

### Patch Changes

- [#221](https://github.com/agent-facets/facets/pull/221) [`b2f92a4`](https://github.com/agent-facets/facets/commit/b2f92a45198ec5495e9f8dae414881bffa1cd8a7) Thanks [@eXamadeus](https://github.com/eXamadeus)! - `facet add <source>` now resolves, writes, and installs in one step instead of leaving the user to run `facet install` separately. Multiple sources per invocation are supported. `facets.json` rolls back byte-for-byte on failure.
  The adapter picker auto-launches when `add` runs against a project with no connected adapters in a TTY. Non-TTY exits with a clear "no adapters installed" error.
  Source grammar tightened for closed alpha: `git+` prefixes hard-rejected, `^` / `~` / `1.x` ranges hard-rejected with a fix pointing at the supported `*` wildcards (`1.*`, `1.2.*`), and bare registry names route to a registry stub that errors clearly until the real registry ships.
  The install pipeline (sources, resolvers, lockfile I/O, materialization, integrity, cache, registry stub) moved from the CLI into `@agent-facets/core`. The CLI is now display-only on top.
  `@agent-facets/adapter` fixes a blank-line asymmetry in `assembleAssetContent` that made `materialize`'s skip-if-identical check see phantom drift on every re-install. First-party adapter packages republish at the patch level so the bundled fix reaches existing installs.

## 0.4.5

### Patch Changes

- [#211](https://github.com/agent-facets/facets/pull/211) [`66b2fa3`](https://github.com/agent-facets/facets/commit/66b2fa3f70b663ba28e64e4fbc16e0eb60f4498a) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump eveything to refresh publish pipelines

## 0.4.4

### Patch Changes

- [#206](https://github.com/agent-facets/facets/pull/206) [`d42ef55`](https://github.com/agent-facets/facets/commit/d42ef55cf5ab31f34fcdbac5ce4548b918a1bde4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Use pack-then-publish mechanism to ensure no drift between packument and published tarballs

## 0.4.3

### Patch Changes

- [#204](https://github.com/agent-facets/facets/pull/204) [`bb49308`](https://github.com/agent-facets/facets/commit/bb493088ebffa2819a46b00c565b9b06c435ca32) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Get @agent-facets/common out of all deps, it's always bundled

## 0.4.2

### Patch Changes

- [#190](https://github.com/agent-facets/facets/pull/190) [`7bda63d`](https://github.com/agent-facets/facets/commit/7bda63d759955c1da0a9fa821f0cd4e2a6ba4532) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix release pipeline: `prepack` no longer attempts to rewrite `workspace:*` references in `devDependencies`. Unblocks publishing when a devDep points at a workspace-only versionless package like `@agent-facets/common`. `npm pack` strips devDependencies from the tarball anyway, so there was nothing to rewrite in the first place.

## 0.4.1

### Patch Changes

- [#183](https://github.com/agent-facets/facets/pull/183) [`c9a1a4d`](https://github.com/agent-facets/facets/commit/c9a1a4dfe7e28437d6b523c6fa83ff17ac9b9f94) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Serial deploys via CI to ensure tag and release ordering

## 0.4.0

### Minor Changes

- [#168](https://github.com/agent-facets/facets/pull/168) [`8a697b5`](https://github.com/agent-facets/facets/commit/8a697b597842bcb4d3207ca73d429f4dff2be7b4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Clean up publish failures

## 0.3.1

### Patch Changes

- [#161](https://github.com/agent-facets/facets/pull/161) [`c120f86`](https://github.com/agent-facets/facets/commit/c120f86d13b1df72e4d04356c27552df9fe0e085) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Post-alpha follow-ups from PR [#150](https://github.com/agent-facets/facets/issues/150) agent feedback.

## 0.3.0

### Minor Changes

- [#150](https://github.com/agent-facets/facets/pull/150) [`70ec72b`](https://github.com/agent-facets/facets/commit/70ec72b00cb9f679faa516dc973297d3d99b769b) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Adapter SDK + first-party adapters gain real install support.

## 0.2.3

### Patch Changes

- f673986 Thanks @eXamadeus! - Correct CircleCI deployment keys

## 0.2.2

### Patch Changes

- [#145](https://github.com/agent-facets/facets/pull/145) [`a09846b`](https://github.com/agent-facets/facets/commit/a09846bce2b449287261ed4511ff0c3ad1599d6e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - CircleCI

## 0.2.1

### Patch Changes

- [#144](https://github.com/agent-facets/facets/pull/144) [`5c235e0`](https://github.com/agent-facets/facets/commit/5c235e08126e7dd6640c921625189f6fca1b4d5d) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump em all. Test release pipeline

## 0.2.0

### Minor Changes

- [#126](https://github.com/agent-facets/facets/pull/126) [`51f8dfc`](https://github.com/agent-facets/facets/commit/51f8dfcb890fed23e64c3d944e788a20f8249567) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Add in @agent-facets/adapter and @agent-facets/common packages
- [#128](https://github.com/agent-facets/facets/pull/128) [`a350666`](https://github.com/agent-facets/facets/commit/a3506668311707d96f46d912177abd868a1e88ce) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added in an SDK for adapting the facet CLI to various systems/tools

### Patch Changes

- [#129](https://github.com/agent-facets/facets/pull/129) [`f8a5a7b`](https://github.com/agent-facets/facets/commit/f8a5a7b78f96d8269042a05caf360ee95ed76cb4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Publish all packages touched
