## Why

Independently published facets can declare assets with the same name, but the current install contract does not resolve cross-facet collisions before materialization; the resulting order-dependent state can silently overwrite one facet's asset, and receipt-driven removal can delete a path another facet still claims. Because skills and commands share one namespace while agents occupy another, arbitrary facets cannot be composed safely without an explicit, reproducible way for users to keep, alias, or omit each colliding asset.

## What Changes

- Before any materialization write, the system SHALL evaluate the complete desired asset set for collisions across facets on every add, install, update, repair, and frozen-reproduction path. This check SHALL detect collisions introduced by facet updates; a frozen install that encounters an unresolved collision SHALL fail without rewriting any state. Skills and commands SHALL be checked together, while agents SHALL be checked separately.
- For every collision group, each asset SHALL receive exactly one resolution: preserve its authored name, assign a valid materialized alias, or omit it from materialization. A resolution MAY alias multiple assets or omit every asset in the group, but the resulting materialized set MUST be collision-free.
- Interactive add and install flows SHALL identify the colliding facets and assets and collect the user's choices. A non-interactive install with an unresolved collision SHALL fail with structured, actionable information and SHALL leave project and adapter state unchanged.
- Collision resolutions SHALL be recorded as project intent and resolved installation state so teammates, CI, frozen installs, repairs, updates, and removals reproduce the same effective asset set without prompting again. Existing compact string entries in `facets.json` SHALL remain valid for facets that require no explicit resolution.
- Aliases SHALL satisfy the existing asset-name grammar and namespace rules. One project-level resolution SHALL apply consistently to every selected adapter; adapter-specific aliases or exclusions SHALL NOT be introduced.
- Integrity verification SHALL continue to use the facet's authored archive identities and canonical archive paths. Aliasing SHALL change only the effective materialized identity, while omission SHALL prevent the selected asset and its owned companion files from being written.
- Lockfile, receipt, drift-repair, and removal behavior SHALL distinguish authored identities from effective materialized identities and SHALL delete or repair exactly the files recorded as owned.
- **BREAKING** Every successful non-frozen operation SHALL migrate lockfile and machine-local receipt state to their exact current `0.3` formats, even when the project uses no collision resolution. Older string-only project-manifest entries SHALL remain supported as legacy input, while an older CLI that cannot read `0.3` SHALL fail closed rather than reinterpret current state.
- The project manifest SHALL gain an explicit format-version field with exact dispatch. Existing unversioned string-only manifests SHALL remain valid legacy input; successful normal operations SHALL migrate them transactionally, while frozen installation SHALL retain them without rewriting.
- The published protocol surface SHALL expose explicit schemas and types for legacy `1`, previous `0.2`, and current `0.3` lockfiles plus a closed supported-format union. Deprecated unpinned lockfile schemas and identity-only compatibility aliases that admit cross-version mixed shapes SHALL be removed rather than retained as transitional API.
- User and specification documentation SHALL be updated to explain namespace collisions, available resolutions, persisted intent, and the resulting on-disk layout.

## Capabilities

### New Capabilities

- None. Materialization collision resolution is part of the existing installation product domain.

### Modified Capabilities

- `installation`: Detect cross-facet namespace collisions transactionally, apply aliases and omissions, reproduce persisted choices, and reconcile the effective asset set during install, repair, frozen operation, drift removal, and facet removal.
- `protocol__schemas`: Extend the published project-manifest and lockfile schemas to represent collision-resolution intent and distinguish authored asset identities from effective materialized identities without weakening archive integrity.
- `cli`: Present collision groups and resolution choices interactively, and render actionable structured failures when unresolved collisions occur in non-interactive use.

## Non-goals

- Resolving collisions for MCP servers or future asset types is not included.
- Publishers SHALL NOT define consumer aliases, and installation SHALL NOT modify `facet.json`, archive paths, or published asset identities.
- The system SHALL NOT silently choose a winner, infer precedence from install order, or overwrite one facet's asset with another.
- Per-adapter resolution, adapter-specific materialized asset sets, and adapter API shape changes are not included.
- This change SHALL NOT alter existing validation for collisions within a single facet.
- This change SHALL NOT rename facet identities or `facets.json` keys; only materialized asset names may change.
- This change SHALL NOT add schema-format version fields to `facet.json` or `server.json`; archive compatibility remains governed by the versioned build manifest.

## Impact

- Protocol consumers and producers will encounter enriched `facets.json` entries, exact lockfile `0.3`, and removal of the deprecated unpinned lockfile API. Compatibility is expressed only through explicit exact-version readers for legacy `1` and previous `0.2`; current producers write one canonical `0.3` shape.
- Installation planning, materialization, reconciliation, receipts, frozen consistency checks, and structured failure data in `packages/engine` will be affected. CLI install views and failure rendering in `packages/cli` will gain the interactive resolution flow.
- Adapter contracts are expected to remain structurally unchanged: adapters will continue receiving a validated asset name, but that name may be the project's effective alias. The same resolved asset set will continue to be applied to every selected adapter.
- This proposal was informed by `docs/specification/manifest.mdx` (asset grammar and namespaces), `docs/specification/install.mdx` and `docs/specification/commit.mdx` (transactional materialization and receipts), `docs/specification/project-manifest.mdx` and `docs/specification/lockfile.mdx` (intent and resolved state), and `docs/guides/install-facets.mdx` (the user-facing install flow). Those pages, the CLI add/install references, troubleshooting guidance, terminology, and the changelog will require corresponding updates.
- No new runtime dependency is expected.
