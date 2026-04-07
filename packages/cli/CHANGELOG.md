# agent-facets

## 0.3.4

### Patch Changes

- [#76](https://github.com/agent-facets/facets/pull/76) [`a151e60`](https://github.com/agent-facets/facets/commit/a151e600a6b795a0bfdbb21b3b342ba2e92aed9e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fix release pipeline:
    -   support keyless promotion inspired by Nuxt's OIDC JWT exchange
    -   use a matrix release workflow (because the key exchange is per-package and the builds are resource intense)
    -   use custom notifications for failures to the dev team's Slack

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
