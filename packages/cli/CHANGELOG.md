# agent-facets

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
  - **Public docs** rewritten for closed-alpha scope: `README.md` quickstart points partners at `docs/alpha/partner-onboarding.md`; `docs/cli.mdx` callout supersedes the old registry claim; install spec + openspec spec lead with closed-alpha behavior, with open-beta extensions appended.
    This is Changeset [#2](https://github.com/agent-facets/facets/issues/2) of the two-changeset install-pipeline ship — release and publish this set _after_ the adapter set so partners never pull a (new CLI × old adapter) combination. Then run the pre-ship smoke test per `docs/alpha/partner-onboarding.md`.

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
