## Purpose

Facet authors declare portable MCP server connections; each AI coding tool consumes MCP configuration from its own native project file. This capability defines how declared servers are translated into every selected tool's native project configuration and reconciled as keyed contributions inside shared, tool-owned files — preserving everything in those files that Facets does not own.

## ADDED Requirements

### Requirement: Declared MCP servers are translated into each tool's native project configuration

Each selected adapter SHALL translate portable stdio and Streamable HTTP server declarations into its tool's native project configuration file, format, and terminology. Translation SHALL NOT copy another tool's file format verbatim, and materialization SHALL target project-owned configuration only — never user-level or system-level configuration.

The first-party translations SHALL be:

- Claude Code: the project `.mcp.json` document's `mcpServers` map.
- OpenCode: the project's `opencode.jsonc` when it exists; otherwise `opencode.json` when it exists; when neither exists, a new `opencode.jsonc` SHALL be created. When both exist, `opencode.jsonc` SHALL be canonical. The selected document's `mcp` map is reconciled.
- Codex: the trusted-project `.codex/config.toml` document's `mcp_servers` tables.

#### Scenario: Stdio declaration reaches every selected tool

- **WHEN** a facet declares a stdio server with a command, arguments, and environment assignments and three adapters are selected
- **THEN** each selected tool's native project configuration SHALL contain an entry for that server expressed in that tool's own format and terminology
- **AND** the entry SHALL preserve the declared command, argument order, and environment assignments

#### Scenario: Streamable HTTP declaration reaches every selected tool

- **WHEN** a facet declares an HTTP server with an absolute URL
- **THEN** each selected tool's native project configuration SHALL contain an entry connecting to that URL

#### Scenario: OpenCode configuration file is selected deterministically

- **WHEN** MCP configuration is materialized for OpenCode
- **THEN** `opencode.jsonc` SHALL be used when it exists
- **AND** `opencode.json` SHALL be used when only it exists
- **AND** a new `opencode.jsonc` SHALL be created when neither exists
- **AND** `opencode.jsonc` SHALL be canonical when both exist

#### Scenario: User-level configuration is never touched

- **WHEN** MCP configuration is materialized
- **THEN** no user-wide or system-wide tool configuration file SHALL be created or modified

### Requirement: Unrelated native configuration is preserved

Reconciling MCP configuration inside a shared tool-owned file SHALL preserve every unrelated setting and every server entry the desired state does not name. Edits SHALL be syntax-aware for the document's format (JSON, JSONC, or TOML). Unrelated semantic values MUST survive every edit; comment and formatting preservation SHALL be maximized but MAY vary by format. For a tracked server entry, updates SHALL change the fields the portable declaration models and SHALL preserve native fields outside that model where safely possible.

#### Scenario: Unrelated settings survive reconciliation

- **WHEN** a tool's configuration file contains non-MCP settings alongside its MCP section
- **AND** a declared server is added, updated, or removed
- **THEN** every unrelated setting SHALL remain semantically unchanged

#### Scenario: Unowned server entries are untouched

- **WHEN** a tool's MCP section contains a server entry no desired declaration names and no ownership record covers
- **THEN** reconciliation SHALL leave that entry unchanged

#### Scenario: Native-only fields survive a tracked update

- **WHEN** a tracked server entry carries a tool-specific field the portable declaration does not model
- **AND** the declaration's portable fields change
- **THEN** the update SHALL rewrite the portable fields
- **AND** the tool-specific field SHALL be preserved where it can be preserved safely

### Requirement: Native configuration changes are prepared read-only before any file changes

Each selected adapter SHALL prepare its complete desired MCP server change as a read-only operation before any file is modified anywhere. Preparation SHALL parse the native document once, detect parse conflicts, compare every desired entry with existing state, and classify each effective server identity with a structured per-key outcome — absent, equivalent, divergent, tracked, or untracked-occupied — and SHALL disclose every native document path the change would affect. A native document that cannot be parsed SHALL fail the operation before any mutation.

#### Scenario: Unparseable native document blocks installation before mutation

- **WHEN** a selected tool's configuration file contains a syntax error
- **THEN** the operation SHALL fail during read-only preparation
- **AND** no configuration file, asset, manifest, lockfile, or receipt SHALL be modified

#### Scenario: Occupancy is known before anything is written

- **WHEN** a desired effective server identity already has an entry in a tool's configuration
- **THEN** preparation SHALL classify that identity as tracked or untracked-occupied and as equivalent or divergent
- **AND** the classification SHALL be available before any write occurs

### Requirement: Equivalent native entries are adopted without rewriting

Equality between a desired declaration and an existing native entry SHALL be judged semantically in the tool's native rendering: differences in comments, formatting, and ordering SHALL NOT make entries unequal, while any native value that changes the effective launch or connection behavior SHALL. An entry whose equality cannot be proven SHALL be classified as divergent. An equivalent entry SHALL be adopted without rewriting the file.

#### Scenario: Formatting-only difference is adopted without a write

- **WHEN** an existing native entry differs from the desired rendering only in whitespace, ordering, or comments
- **THEN** the entry SHALL be classified as equivalent
- **AND** the file SHALL NOT be rewritten for that entry

#### Scenario: Unprovable equality is treated as divergence

- **WHEN** an existing native entry cannot be proven equivalent to the desired declaration
- **THEN** the entry SHALL be classified as divergent

### Requirement: Native configuration changes apply atomically and roll back byte-exactly

Each adapter's prepared MCP configuration change SHALL be applied as one atomic update to its native document, reporting whether the document changed. A handled failure inside preparation or application SHALL leave that adapter's file unchanged. When a later failure rolls the operation back, every native document modified by the operation SHALL be restored to its exact prior bytes — including comments and formatting — and rollback fidelity SHALL NOT depend on recomputing an inverse edit.

#### Scenario: Handled apply failure leaves the file unchanged

- **WHEN** applying a prepared configuration change fails in a handled way
- **THEN** that tool's configuration file SHALL be byte-identical to its state before the apply

#### Scenario: Rollback restores exact prior bytes

- **WHEN** the operation fails after one tool's configuration document has been updated
- **THEN** that document SHALL be restored to its exact pre-operation bytes
- **AND** its comments and formatting SHALL be exactly as they were
