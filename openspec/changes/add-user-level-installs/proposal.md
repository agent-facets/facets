## Why

Users need a personal collection of facets available across projects without repeatedly installing them into each checkout or adding personal tooling to team dependencies. First-party adapters contain user-scoped text-asset planners with basic adapter tests, but the engine and MCP planners remain project-only; lockfile 0.4 supplies the complete MCP inventory baseline.

## What Changes

- Users SHALL manage an independent user-level collection with its own plain-file declarations and lockfile, materialization choices, machine-local ownership, and MCP approvals. Declarations SHALL be user-editable; both files SHALL be readable and version-controllable, while the lockfile remains installer-generated. Identity SHALL remain stable across invocation directories. Project scope SHALL remain the default; a missing project manifest SHALL NOT implicitly select user scope. Neither collection's operations SHALL manage the other. The same facet MAY exist independently in both.
- User installation SHALL cover every currently installable facet content type: skills with all declared companions, agents, commands, and standard-input or Streamable HTTP MCP declarations, including server-only facets. Claude Code, Codex, and OpenCode SHALL support the complete set at their native user-level destinations. Existing facet packages SHALL work without republishing or author-declared installation scope.
- **BREAKING (Adapter SDK API):** Introduce an explicitly versioned, scope-aware planning contract for text assets and MCP configuration, usable by first-party and third-party adapters without inventing a project for a user installation. Each capability SHALL declare its supported scopes. Unsupported capabilities or scopes SHALL fail before mutation rather than silently omit content. Adapters SHALL remain read-only planners; the engine SHALL retain responsibility for writes and restoration. Compatibility selection and diagnostics SHALL recognize the new exact contract identifier.
- The CLI SHALL provide explicit `--user` targeting for add, install, update, remove, list, and outdated, usable without a project manifest. Output and approval prompts SHALL identify the selected scope. Existing source kinds, version-selection behavior, aliases, omissions, frozen reproduction, and applicable preview/non-interactive modes SHALL remain available. Local-source references SHALL retain their meaning across invocation directories under an explicit resolution and containment policy.
- User installs SHALL build on lockfile 0.4: complete authored server inventories, including omissions and explicit empty inventories, with the existing `facets:mcp-server:v1` fingerprints. Scope selection SHALL NOT change authored archive paths, content hashes, facet integrity, or declaration fingerprints. Exact-version dispatch, legacy inventory-unavailable results, verified migration, and inventory-versus-content checks SHALL remain intact; a locked fingerprint SHALL NOT substitute for a verified declaration.
- Ownership, locking, and MCP consent SHALL be isolated between collections. Project approval SHALL NOT authorize user-wide configuration. Each operation SHALL preserve existing bounded-write, concurrency, takeover, and rollback guarantees across assets, native configuration, and collection state. Shared user configuration SHALL preserve unrelated settings and entries neither desired nor owned by the selected collection; removing one collection's facet SHALL NOT delete the other's materializations. Target-tool precedence SHALL NOT confer cross-scope ownership.
- User-wide tool configuration SHALL be modified only by an explicitly selected user operation; MCP configuration SHALL additionally require user-collection approval. This deliberately replaces the published blanket prohibition with a scope-specific safety boundary.

### Delivery sequence

1. **SDK and adapter foundation.** Deliver the scope-aware contracts, necessary protocol planning changes, all first-party adapters, compatibility integration for existing project operations, and conformance coverage for both scopes. User-level assets, companion cleanup, and MCP planning SHALL be covered together. SDK/adapters SHALL be released before a CLI requires their new contract. This delivery SHALL preserve working project installs but SHALL NOT claim complete user-facing CLI support.
2. **Complete user lifecycle.** Deliver independent collection persistence and coordination, engine lifecycle support, CLI targeting and presentation, and end-to-end verification. The first user-facing release SHALL include MCP alongside text assets so existing facets are not refused solely because they declare a server. Each delivery SHALL include documentation for the surfaces it ships.

## Non-goals

- System-wide or administrator installs, or projects declaring shared user-level outputs.
- Automatically moving, synchronizing, or deduplicating facets between project and user collections, or replacing target tools' native precedence rules.
- New asset types, facet composition, materializing archive-only supplementary files, or launching, installing, authenticating, or managing credentials for MCP servers.
- Reimplementing the completed lockfile 0.4 migration/inventory work, changing its fingerprint encoding, or requiring a new facet archive format.

## Capabilities

### New Capabilities

None. User scope extends existing product domains.

### Modified Capabilities

- `installation`: Independent user collection lifecycle, scope-isolated intent and authority, and safe reconciliation using the current locked inventory contracts.
- `cli`: Explicit collection targeting, scope-aware output and consent, and lifecycle commands outside projects.
- `adapter__sdk`: Scope-aware asset and MCP planning, support validation, and a new Adapter SDK API contract identifier.
- `adapter__assets`: User-target requests independent of project identity, with complete companion and removal guarantees.
- `adapter__mcp-servers`: Native user-level configuration planning, layer handling, preservation, and scope-restricted cleanup for all first-party adapters.
- `adapter__management`: Compatible installation/loading and actionable migration diagnostics for the new SDK contract.
- `protocol__schemas`: Scope-neutral MCP declaration wording and explicit lockfile asset `scope` semantics, preserving existing format shapes, authored integrity, and fingerprint meaning.
- `authoring__facets`: Scope-neutral wording for portable facet contents and MCP declarations; no new author opt-in, declaration syntax, or republishing.

## Impact

Affected packages are `protocol`, `adapter`, `engine`, `cli`, all three first-party adapters, and `adapter-test-kit`, with coordinated SDK/adapter/CLI releases. Protocol changes remain pure contracts and planning; filesystem ownership and coordination remain engine responsibilities. The lockfile prerequisite is complete, not a delivery in this change.

Documentation informing this proposal includes `README.md`, `docs/guides/install-facets.mdx`, `docs/docs/learn/adapters.mdx`, `docs/reference/adapter-sdk.mdx`, `docs/guides/custom-adapters.mdx`, `docs/specification/project-manifest.mdx`, `docs/specification/lockfile.mdx`, `docs/specification/install.mdx`, `docs/specification/materialization.mdx`, `docs/reference/lockfile-inventory.mdx`, `docs/cli/env.mdx`, and `docs/changelog/index.mdx`. These surfaces and the affected command references SHALL distinguish project and user behavior where applicable. New release notes SHALL announce the revised safety boundary; historical changelog entries SHALL remain unchanged.

Design SHALL settle user-state placement, local-source resolution/containment, native configuration layers and environment overrides, same-name coexistence, SDK rollout compatibility, collection identity without a project path, and lockfile asset `scope` semantics before implementation. Lockfile 0.4 is the baseline; additional persisted scope information, including machine-local receipt changes, SHALL require explicit justification and compatibility analysis rather than an assumed format bump.
