# @agent-facets/protocol

## 0.14.1

### Patch Changes

- [#287](https://github.com/agent-facets/facets/pull/287) [`ad4e75a`](https://github.com/agent-facets/facets/commit/ad4e75a9b5360e056611ccd7622ae3660d4476cb) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Record lockfile source provenance as a tagged, per-kind shape so an entry can never disagree with itself.
    The lockfile's `source` field was a single overloaded string — a registry version specifier, a git URL, or a local path depending on the facet. For registry facets this let an unresolved specifier (`latest`, `1.*`) leak into the lockfile next to a resolved `version`, an entry that contradicted itself. `source` is now a discriminated union keyed on `kind`:
    -   **`registry`** — records the registry origin (base URL) and never a version. The resolved version lives in the entry's `version` field, so there is no slot for `latest` or a wildcard to leak into.
    -   **`git`** — records the repository URL and a **required** resolved commit SHA. A git clone that cannot be pinned to a commit now fails the install rather than writing a non-reproducible entry. The requested ref is no longer recorded in the lockfile — it belongs to `facets.json`.
    -   **`local`** — records the resolved path.
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
