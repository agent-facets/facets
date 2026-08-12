## Why

Facets currently accepts speculative MCP server references but only warns and skips them during installation, leaving users to configure every coding tool manually in files such as `.mcp.json`, `opencode.json`, and `.codex/config.toml`. Concrete, portable MCP connection declarations can deliver that missing value now without requiring a server registry, a Facets-owned MCP runtime, or a credential system.

## What Changes

- **BREAKING** for every manifest that uses speculative server references: replace version-string and OCI-image values in `servers` with concrete, portable MCP server definitions. Neither current nor legacy manifests SHALL accept the old reference forms. Legacy archive `0.1` remains supported for its text-asset contract.
- Define an intentionally small portable schema for project-scoped stdio and Streamable HTTP servers. The schema SHALL describe connection and launch information but SHALL NOT contain HTTP headers, secrets, OAuth credentials, portable environment-variable substitution, or tool-specific enablement and policy settings.
- Treat materializing a new or changed server declaration as an explicit consent event. Interactive installs SHALL display the command, arguments, or URL before any write and require approval; non-interactive installs SHALL require an explicit opt-in. Reproducing an unchanged declaration that was previously approved SHALL NOT prompt again.
- Materialize each declared server through every selected adapter. Adapters SHALL translate the portable definition into their tool's native project configuration rather than copying one tool's file format verbatim. If any selected adapter cannot safely materialize required MCP configuration, installation SHALL fail before mutation.
- Reconcile MCP configuration as keyed contributions inside shared tool-owned files. Desired state SHALL authorize reconciliation, including adoption or overwrite of an untracked occupied effective identity after the applicable takeover gate; machine-local receipt ownership alone SHALL authorize deletion. Installation SHALL preserve unrelated settings and unowned identities outside the desired set, detect desired-state conflicts before mutation, and participate in rollback and transactional state recording.
- Two facets that claim the same effective server name with different declarations SHALL conflict before mutation. A project MAY durably alias or omit a declared server. MCP configuration SHALL reuse the effective-name collision semantics of asset materialization without widening `AssetType`.
- Allow a facet whose only deliverables are concrete server declarations. The current requirement for at least one text asset or composed facet SHALL be broadened accordingly.
- Delegate authentication and connection lifecycle to the target tool. Facets SHALL NOT authenticate to MCP servers or persist their credentials; users MAY complete any tool-native authentication flow after configuration is materialized.
- Remove the premature standalone server artifact model, including the `server.json` schema and loaders, source-mode and ref-mode terminology, and requirements for separately authored or registry-resolved servers.
- Remove the current skip warning and report concrete MCP configuration consent, additions, updates, aliases, conflicts, omissions, takeovers, removals, and adapters that cannot materialize the declarations.
- Update user documentation to describe concrete server declarations, adapter translation, ownership, consent, security implications, and tool-native authentication.

## Non-goals

- Building an MCP client, host, proxy, supervisor, health checker, or other runtime inside Facets.
- Publishing or resolving standalone MCP server packages, versions, OCI images, or registry references.
- Installing the executable named by a stdio declaration or proving that a configured server can start.
- Defining, collecting, translating, or storing HTTP headers, secrets, OAuth credentials, tokens, or a portable environment-variable substitution grammar. Facets will not replace authentication supplied by Claude Code, OpenCode, Codex, or another target tool.
- Supporting user-wide or system-wide MCP configuration in the initial release; materialization is limited to project-owned configuration.
- Standardizing deprecated SSE, WebSocket, or adapter-specific MCP policy options in the portable schema.

## Capabilities

### New Capabilities

- `adapter__mcp-servers`: Defines how adapters translate and transactionally reconcile portable MCP server declarations with tool-owned project configuration while preserving unrelated state.

### Modified Capabilities

- `protocol__schemas`: Replace server references with concrete stdio and Streamable HTTP definitions, preserve legacy `0.1` text-asset compatibility while rejecting legacy server references, broaden the manifest's minimum-content rule, and remove the standalone server-manifest schema.
- `authoring__facets`: Allow facet authors to declare portable MCP connection configuration directly in `facet.json` and receive actionable validation errors.
- `authoring__servers`: Retire the separate server-project and server-manifest authoring contract until standalone server publishing and resolution are deliberately designed.
- `installation`: Plan, gain consent for, alias, collide, omit, materialize, reconcile, roll back, and remove MCP configuration contributions as part of the existing install transaction, including receipt `0.4` ownership and approval evidence, effective-name resolution, untracked-destination takeover, frozen reproduction, and removal-only installs.
- `adapter__sdk`: Expose the MCP-server-specific capability and its compatibility contract to first-party and third-party adapter authors. Future non-asset project-configuration features will use independent capabilities rather than widening this contract.
- `adapter__management`: Select, verify, load, list, and diagnose adapters against the widened exact supported-API set `{0.1, 0.2}` without weakening exact-token compatibility.
- `adapter__assets`: Confine the asset-methods-only storage rule to text assets so keyed configuration operations have a distinct contract boundary, while adding just-in-time confirmation before an untracked occupied asset destination is adopted or overwritten.
- `cli`: Replace skip warnings with consent prompts, untracked-destination takeover confirmation, user-visible MCP configuration outcomes, unsupported-adapter failures, and conflict reporting.

## Impact

- **Protocol:** The `facet.json` schema changes incompatibly for every manifest that uses speculative server references; those forms fail validation in both current and legacy formats, while legacy `0.1` text-asset behavior remains supported. The obsolete server-manifest API and existing server-warning event/result/UI path are removed. The machine-local receipt requires a version increment for keyed deletion authority; the lockfile is expected to remain unchanged because facet integrity already covers `facet.json`, subject to design verification.
- **Adapter ecosystem:** The Adapter SDK contract and compatibility identifier will change. Claude Code, OpenCode, and Codex adapters will need native project-configuration translation and safe read/modify/write behavior for JSON, JSONC, or TOML.
- **Install engine:** Composition, generic effective-name collision planning, machine-local ownership, removal-only installs, frozen reproduction, journaling, adapter-native equality and occupancy, just-in-time asset takeover handling, and outcome classification must account for keyed MCP contributions without widening the text-asset type.
- **CLI:** Add, install, and remove flows will obtain consent for new or changed server declarations, surface configuration and takeover outcomes, confirm untracked occupied destinations at the earliest point available without an eager asset scan, and fail before mutation when a selected adapter cannot safely materialize required MCP configuration.
- **Documentation:** This proposal is informed by `docs/specification/manifest.mdx`, `docs/specification/materialization.mdx`, `docs/specification/commit.mdx`, `docs/specification/publish.mdx`, `docs/specification/terminology.mdx`, `docs/cli/install.mdx`, and `docs/roadmap/beta.mdx`. Those pages must be updated to replace text-only or inert-reference framing and explain MCP aliasing plus asset/configuration takeover behavior. Removing the old warning also resolves the existing specification requirement for a server-status documentation pointer that the CLI never shipped.
