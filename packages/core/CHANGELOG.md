# @agent-facets/core

## 0.6.4

### Patch Changes

- [#206](https://github.com/agent-facets/facets/pull/206) [`d42ef55`](https://github.com/agent-facets/facets/commit/d42ef55cf5ab31f34fcdbac5ce4548b918a1bde4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Use pack-then-publish mechanism to ensure no drift between packument and published tarballs

#### Updated Dependencies
- @agent-facets/adapter@0.4.4

## 0.6.3

### Patch Changes

- [#203](https://github.com/agent-facets/facets/pull/203) [`201260a`](https://github.com/agent-facets/facets/commit/201260a265aaecf7481a52b62b17da51ed29e1d3) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Properly mark @agent-facets/common as a bundled dep (via package.json)
- [#204](https://github.com/agent-facets/facets/pull/204) [`bb49308`](https://github.com/agent-facets/facets/commit/bb493088ebffa2819a46b00c565b9b06c435ca32) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Get @agent-facets/common out of all deps, it's always bundled

#### Updated Dependencies

- @agent-facets/adapter@0.4.3

## 0.6.2

### Patch Changes

- [#190](https://github.com/agent-facets/facets/pull/190) [`7bda63d`](https://github.com/agent-facets/facets/commit/7bda63d759955c1da0a9fa821f0cd4e2a6ba4532) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix release pipeline: `prepack` no longer attempts to rewrite `workspace:*` references in `devDependencies`. Unblocks publishing when a devDep points at a workspace-only versionless package like `@agent-facets/common`. `npm pack` strips devDependencies from the tarball anyway, so there was nothing to rewrite in the first place.

## 0.6.1

### Patch Changes

- [#183](https://github.com/agent-facets/facets/pull/183) [`c9a1a4d`](https://github.com/agent-facets/facets/commit/c9a1a4dfe7e28437d6b523c6fa83ff17ac9b9f94) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Serial deploys via CI to ensure tag and release ordering

## 0.6.0

### Minor Changes

- [#168](https://github.com/agent-facets/facets/pull/168) [`8a697b5`](https://github.com/agent-facets/facets/commit/8a697b597842bcb4d3207ca73d429f4dff2be7b4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Clean up publish failures

## 0.5.1

### Patch Changes

- [#161](https://github.com/agent-facets/facets/pull/161) [`c120f86`](https://github.com/agent-facets/facets/commit/c120f86d13b1df72e4d04356c27552df9fe0e085) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Post-alpha follow-ups from PR [#150](https://github.com/agent-facets/facets/issues/150) agent feedback.

## 0.5.0

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

## 0.4.3

### Patch Changes

- f673986 Thanks @eXamadeus! - Correct CircleCI deployment keys

## 0.4.2

### Patch Changes

- [#145](https://github.com/agent-facets/facets/pull/145) [`a09846b`](https://github.com/agent-facets/facets/commit/a09846bce2b449287261ed4511ff0c3ad1599d6e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - CircleCI

## 0.4.1

### Patch Changes

- [#144](https://github.com/agent-facets/facets/pull/144) [`5c235e0`](https://github.com/agent-facets/facets/commit/5c235e08126e7dd6640c921625189f6fca1b4d5d) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump em all. Test release pipeline

## 0.4.0

### Minor Changes

- [#128](https://github.com/agent-facets/facets/pull/128) [`a350666`](https://github.com/agent-facets/facets/commit/a3506668311707d96f46d912177abd868a1e88ce) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added in an SDK for adapting the facet CLI to various systems/tools

### Patch Changes

- [#129](https://github.com/agent-facets/facets/pull/129) [`f8a5a7b`](https://github.com/agent-facets/facets/commit/f8a5a7b78f96d8269042a05caf360ee95ed76cb4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Publish all packages touched

## 0.3.3

### Patch Changes

- [#85](https://github.com/agent-facets/facets/pull/85) [`aacc6cd`](https://github.com/agent-facets/facets/commit/aacc6cda49e2611de8bde1ac42144dda97e5b6cc) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump arktype from 2.1.29 to 2.2.0
- [#118](https://github.com/agent-facets/facets/pull/118) [`40b5b91`](https://github.com/agent-facets/facets/commit/40b5b912dc36c276987c0c48f016564771bb3b1d) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump comment-json from 4.5.1 to 4.6.2

## 0.3.2

### Patch Changes

- [#80](https://github.com/agent-facets/facets/pull/80) [`868cc3b`](https://github.com/agent-facets/facets/commit/868cc3b7ea36445f3b59e0a652ac0ba93a89eb78) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Revert staging dist-tag operation, since NPM doesn't support it without NPM_TOKENs

## 0.3.1

### Patch Changes

- [#78](https://github.com/agent-facets/facets/pull/78) [`b4753d1`](https://github.com/agent-facets/facets/commit/b4753d1a0d7439491ad77d9aaf968cd89c3b7da9) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix OIDC publishing and refactor publish scripts

## 0.3.0

### Minor Changes

- [#55](https://github.com/agent-facets/facets/pull/55) [`01d8ad8`](https://github.com/agent-facets/facets/commit/01d8ad8856d14546a691d45a4326276811c9ce4f) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Use tag-based release strategy

## 0.2.1

### Patch Changes

- [#46](https://github.com/agent-facets/facets/pull/46) [`a5cbb89`](https://github.com/agent-facets/facets/commit/a5cbb89a46e14e2f79749ea7eafb5aebbd3504b7) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Ensure all CI runs and provenance is managed correctly across packages

## 0.2.0

### Minor Changes

- [#35](https://github.com/agent-facets/facets/pull/35) [`6350718`](https://github.com/agent-facets/facets/commit/63507188f1bb3a7276cd4812f69f7d16d1778fd6) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Ensure proper release isolation

### Patch Changes

- [#33](https://github.com/agent-facets/facets/pull/33) [`540e126`](https://github.com/agent-facets/facets/commit/540e126e677de98a9b3d4e39542df37de8756b73) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Ensure CI runs tests before release and notify Slack when failures occur.

## 0.1.3

### Patch Changes

- [`098fd08`](https://github.com/agent-facets/facets/commit/098fd08bf5d9970babc5c57bee6a155bffcecd97) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Better CLI parameter validation

- [`5262cbe`](https://github.com/agent-facets/facets/commit/5262cbe66df02c625430309878e6061ccde183de) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix publishing by properly categorizing dev dependencies

- [`d3b9439`](https://github.com/agent-facets/facets/commit/d3b9439466e0eb65687901426e2ebd6c5a333c60) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Use better github attribution for changesets

## 0.1.2

### Patch Changes

- bb87748: This is a CI improvement so we release faster and cleaner
- 95e2f38: Migrate NPM packages from `@ex-machina` to `@agent-facets` org.

  - `@ex-machina/facet-core` is now `@agent-facets/core`
  - `@ex-machina/facet` is now `agent-facets`

## 0.1.1

### Patch Changes

- 5813b90: Small test for change set management in CI

## 0.1.0

### Minor Changes

- 2243bbf: Added basic create command to CLI

## 0.0.1

### Patch Changes

- 74e3d25: Should be 0.0.1 now
- 74e3d25: Initial publishing
