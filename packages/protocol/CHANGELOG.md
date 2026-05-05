# @agent-facets/protocol

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
