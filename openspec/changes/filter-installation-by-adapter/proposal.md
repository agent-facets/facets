## Why

Projects with multiple installed adapters currently materialize every facet into every compatible adapter. Users need a simple way to declare that Facet-managed project state belongs only in a chosen set of adapters for an invocation, without introducing per-adapter desired state or versioned materialization histories.

## What Changes

- The installation-manipulating CLI workflows (`facet add`, `facet install`, and `facet remove`) SHALL accept an optional, repeatable `--adapter <name>` option naming a non-empty exclusive target set.
- When `--adapter` is present, the complete desired project state SHALL be reconciled into every target adapter, and every receipt-owned project asset and MCP entry SHALL be dematerialized from every other installed materialization-capable adapter.
- Filter validation and all target/purge planning SHALL complete before mutation. If any requested or purge adapter is unavailable, incompatible, broken, or unable to perform the required operation, the complete operation MUST fail without changing project or adapter files.
- `facet add` and `facet remove` SHALL continue to update the project manifest and lockfile as project-wide desired state. Adapter targets SHALL control physical placement only.
- The install receipt SHALL remain adapter-agnostic project ownership using the existing receipt schema. It SHALL continue to describe what the project owns, not which adapters currently contain it.
- Existing machine-local MCP approval SHALL continue to gate configuration. Filtering SHALL NOT bypass or narrow consent.
- CLI feedback SHALL identify every target adapter and every adapter purged by the invocation.
- Without `--adapter`, existing behavior SHALL remain unchanged: every installed materialization-capable adapter is a target and no adapter is purged.

## Non-goals

- This change SHALL NOT add project-level adapter configuration, a `facet configure` command, or persistent adapter targets. A future change MAY use project configuration as the default target set while allowing explicit `--adapter` flags to override it.
- This change SHALL NOT add per-facet adapter placement, per-adapter versions, per-adapter aliases, or per-adapter receipt ownership.
- This change SHALL NOT filter authoring, build, publish, adapter-management, or read-only commands.
- This change SHALL NOT add comma-separated adapter syntax, exclusion grammar such as `--exclude-adapter`, or an “all except” mode.
- This change SHALL NOT alter the adapter SDK's placement or MCP translation contracts.

## Capabilities

### New Capabilities

- None. Exclusive adapter targeting extends existing product domains.

### Modified Capabilities

- `installation`: Define exclusive target/purge reconciliation while retaining adapter-agnostic receipt ownership and project-wide desired state.
- `cli`: Define the optional, repeatable `--adapter <name>` option, atomic validation, and reporting of target and purged adapters.

## Impact

- **CLI:** Shared flags and validation for `facet add`, `facet install`, and `facet remove` will resolve a non-empty exclusive target set.
- **Engine:** Installation orchestration will add a transactional purge pass for every non-target adapter before reconciling the complete desired project into target adapters.
- **Receipt:** No schema or migration change is required. Existing adapter-agnostic ownership remains authoritative.
- **Compatibility:** Invocations without `--adapter` retain existing behavior. Filtered invocations introduce intentionally destructive cleanup of non-target adapters and MUST report that scope clearly.
- **Documentation:** This proposal is informed by `docs/cli/add.mdx`, `docs/cli/install.mdx`, and `docs/cli/remove.mdx`; by `docs/specification/commit.mdx`, `docs/specification/install.mdx`, `docs/specification/materialization.mdx`, and `docs/specification/terminology.mdx`; and by `docs/guides/install-facets.mdx`. Those pages SHALL describe exclusive target semantics and adapter-agnostic receipt ownership.
