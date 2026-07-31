## Why

Facets promise safe composition: install any set of independently published facets and get all of their assets. But asset names are validated only *within* a facet — nothing prevents two facets from both shipping a skill named `planning`, and both materialize to the same conventional path in every selected adapter. Today the install contract does not even define what happens: the effective outcome is silent overwrite or order-dependent state, which corrupts one facet's asset without any failure signal — and receipt-driven removal of one facet can then delete a file another facet still claims. As the registry grows, collisions on common names (`review`, `deploy`, `planning`) are inevitable. This is a latent correctness bug in the core install path, not a feature gap.

## What Changes

- Installation SHALL detect name collisions across the project's complete desired asset set — every facet in the manifest, not just the one being added — before any file is written. Skills and commands SHALL be evaluated in their shared namespace; agents SHALL be evaluated separately, mirroring the existing within-facet rules.
- For each asset in a collision group, the user SHALL choose exactly one resolution: **keep** its authored name, **alias** it to a different valid name, or **omit** it from materialization. The resolved effective set MUST be collision-free, including against aliases; aliases MUST satisfy the existing single-segment asset-name grammar.
- Resolutions SHALL be recorded in `facets.json` as version-controlled project intent, so a fresh clone plus install reproduces the same effective asset set with no prompting. Compact string entries SHALL remain valid and unchanged for facets needing no resolution; only facets with resolutions use an enriched entry form. **BREAKING**: a project that records resolutions SHALL require tooling that understands the enriched project-manifest and corresponding lockfile shape (string-only manifests remain readable by older tooling).
- The lockfile SHALL record the effective materialized identity alongside the authored identity, so drift detection, repair, frozen verification, receipt ownership, and removal all operate on the files actually on disk. An omitted asset — including a skill's companions — SHALL NOT be materialized, and removal SHALL delete exactly the effectively-owned files.
- Interactive add and install SHALL present each collision group (naming the facets, asset types, and names involved) and collect resolutions. Non-interactive and frozen installs with an unresolved collision SHALL fail with structured data identifying every colliding declaration, leaving manifest, lockfile, receipt, and adapter state untouched. Because facet updates can introduce new collisions, detection SHALL run on every install, not only on add.
- Integrity verification SHALL be unchanged: archives, per-file hashes, and canonical archive paths keep authored identities; aliasing is purely a materialization-time mapping. The same resolution SHALL apply to every selected adapter.
- Specification and user documentation SHALL be updated: project-manifest and lockfile schema pages, the install/commit transactional flow, and the install guide and troubleshooting page.

## Capabilities

### New Capabilities

- None. Cross-facet collision handling is install behavior within existing domains.

### Modified Capabilities

- `installation`: detect cross-facet collisions over the full desired set before materialization; collect, persist, and reproduce per-asset resolutions (keep/alias/omit); prompt interactively and fail non-interactively with structured data; extend lockfile, receipt, drift-repair, frozen-consistency, and removal semantics to distinguish authored from effective identities.
- `protocol__schemas`: enrich the project-manifest entry shape to carry resolution intent while preserving compact string entries, and extend the lockfile schema to record effective materialized identities alongside authored ones.

The interactive prompting and non-interactive failure behavior lives in `installation`, where the analogous adapter-selection prompting requirements already live; the `cli` spec governs generic argument/dispatch/help behavior and is not expected to change at the requirements level.

## Non-goals

- No automatic winner selection: the system SHALL NOT resolve a collision by install order, precedence, or any heuristic. Unresolved means fail (non-interactive) or ask (interactive).
- No per-adapter resolutions: one project-level resolution applies to every selected adapter; adapter contracts keep receiving one validated name per asset.
- No publisher-side mechanisms: no author-declared aliases, registry-level name reservations, or changes to `facet.json`, archive layout, or published identities.
- No change to within-facet collision validation at build or verify time.
- MCP servers and future asset types are out of scope.
- Renaming facet identities (the `facets.json` keys) is out of scope; only materialized asset names are affected.

## Impact

- `packages/protocol`: project-manifest and lockfile schemas, and the pure build/validate helpers that reason about asset identities. Lockfile format evolution and exact-version dispatch (the existing `0.2` exact-equality rule) need explicit design treatment.
- `packages/engine`: install planning, collision evaluation, materialization mapping, receipt ownership, frozen consistency checks, drift repair, removal, and structured failure data.
- `packages/cli`: the interactive collision-resolution flow in add/install views and rendering of the structured non-interactive failure.
- Adapters: no structural contract change expected; an adapter receives the effective (possibly aliased) name through the existing request shape.
- Documentation informing this proposal: `docs/specification/manifest.mdx` (asset-name grammar and the shared skill/command namespace), `docs/specification/project-manifest.mdx` and `docs/specification/lockfile.mdx` (intent vs. resolution split), `docs/specification/install.mdx` and `docs/specification/commit.mdx` (transactional tri-write, frozen mode, receipts), and `docs/guides/install-facets.mdx` plus `docs/guides/troubleshooting.mdx` (user-facing flow). All of these, the CLI add/install references, terminology, and the changelog SHALL be updated as scoped work.
- No new runtime dependencies.
