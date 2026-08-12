## ADDED Requirements

### Requirement: Portable MCP declarations are translated into native project configuration

An adapter that supports MCP servers SHALL translate the complete desired project server set into its tool's native project configuration rather than copying another tool's file format. Standard-input declarations SHALL preserve command, argument order, and literal environment assignments. Streamable HTTP declarations SHALL preserve the absolute URL. One project-level desired set SHALL apply to every selected adapter.

#### Scenario: Standard-input declaration is translated

- **WHEN** a desired server declares a command, ordered arguments, and environment assignments
- **THEN** each supporting adapter SHALL represent the same launch behavior in its tool's native project configuration

#### Scenario: Streamable HTTP declaration is translated

- **WHEN** a desired server declares an absolute Streamable HTTP URL
- **THEN** each supporting adapter SHALL represent that URL in its tool's native project configuration

#### Scenario: Native formats remain tool-specific

- **WHEN** two selected tools use different configuration schemas or syntaxes
- **THEN** each adapter SHALL produce its own native representation rather than copying the other tool's document shape

### Requirement: First-party MCP configuration locations are deterministic

The first-party adapters SHALL reconcile project-scoped MCP server maps at their tools' documented project locations. Claude Code SHALL use `.mcp.json`. OpenCode SHALL use an existing `opencode.jsonc` when present, otherwise an existing `opencode.json`, and SHALL create `opencode.jsonc` when neither exists; `opencode.jsonc` SHALL be canonical when both exist. Codex SHALL use trusted-project `.codex/config.toml` and its project MCP server tables.

#### Scenario: Claude Code uses its project server map

- **WHEN** the Claude Code adapter reconciles project servers
- **THEN** it SHALL update the `mcpServers` map in project `.mcp.json`

#### Scenario: OpenCode prefers JSONC

- **WHEN** both `opencode.jsonc` and `opencode.json` exist
- **THEN** the OpenCode adapter SHALL reconcile the `mcp` map in `opencode.jsonc`
- **AND** it SHALL leave `opencode.json` unchanged

#### Scenario: OpenCode falls back to existing JSON

- **WHEN** `opencode.json` exists and `opencode.jsonc` does not
- **THEN** the OpenCode adapter SHALL reconcile the existing JSON document

#### Scenario: OpenCode creates JSONC

- **WHEN** neither OpenCode project document exists
- **THEN** the OpenCode adapter SHALL create `opencode.jsonc`

#### Scenario: Codex uses trusted project configuration

- **WHEN** the Codex adapter reconciles project servers in a trusted project
- **THEN** it SHALL update the MCP server tables in project `.codex/config.toml`

#### Scenario: User-level configuration is never touched

- **WHEN** any adapter materializes MCP configuration
- **THEN** no user-wide or system-wide tool configuration file SHALL be created or modified

### Requirement: The complete MCP change is prepared without mutation

A supporting adapter SHALL be able to inspect its native project configuration and compute the complete desired MCP server change without modifying any file. Preparation SHALL report every affected document and structured per-server outcomes that distinguish absent entries, equivalent entries, divergent entries, and occupied entries whose effective identities are or are not already owned. A parse or native validation failure SHALL leave the document unchanged.

#### Scenario: Preparation reports complete outcomes

- **WHEN** desired servers include one absent entry, one equivalent entry, and one divergent entry
- **THEN** the adapter SHALL report all three outcomes in one prepared result
- **AND** it SHALL identify every native document the change can affect

#### Scenario: Invalid native document fails read-only

- **WHEN** the selected native project document cannot be parsed safely
- **THEN** preparation SHALL return structured failure data
- **AND** the document SHALL remain byte-for-byte unchanged

#### Scenario: Preparation does not write a new document

- **WHEN** the target document does not yet exist
- **THEN** preparation SHALL describe the prospective document without creating it

### Requirement: MCP changes are applied atomically per native document

A supporting adapter SHALL apply a prepared complete server set as one atomic update to each affected native document. A handled parse, validation, conflict, or write failure SHALL leave that document unchanged. A desired state already present semantically SHALL perform no write. Expected failures SHALL be returned as structured values rather than requiring callers to parse error messages.

#### Scenario: Complete server batch commits together

- **WHEN** a prepared change adds, updates, and removes several server entries in one document
- **THEN** the resulting document SHALL contain the complete desired set or the complete prior set
- **AND** it SHALL NOT expose a handled partial update

#### Scenario: No-op performs no write

- **WHEN** every desired server entry is already semantically equivalent and no owned entry is obsolete
- **THEN** the adapter SHALL report the document unchanged

#### Scenario: Handled write failure preserves prior document

- **WHEN** a write fails while applying a prepared batch
- **THEN** the adapter SHALL return structured failure data
- **AND** the prior native document SHALL remain available unchanged

### Requirement: Unrelated native configuration is preserved

MCP reconciliation SHALL preserve semantic settings outside the portable MCP model and SHALL preserve server entries whose effective names are neither desired nor owned by the project. For an owned desired entry, native fields outside the portable model SHALL survive when they can be preserved without changing the desired launch or connection behavior. Adapters SHOULD maximize comment and formatting preservation.

#### Scenario: Unrelated tool setting survives

- **WHEN** a native document contains an unrelated model, permission, or display setting
- **THEN** MCP reconciliation SHALL preserve that setting's semantic value

#### Scenario: Unowned server key survives

- **WHEN** a native document contains server `manual` and the desired set does not name or own it
- **THEN** reconciliation SHALL leave the complete `manual` entry unchanged

#### Scenario: Safe native extension survives tracked update

- **WHEN** an owned desired server has a native timeout field that does not change the portable launch or connection behavior
- **THEN** the adapter SHALL preserve the timeout where its native format permits

### Requirement: Native-rendering equality controls no-write adoption

Each supporting adapter SHALL compare an existing entry with the adapter-native rendering of the desired portable declaration. Comments, formatting, member ordering, and normalized omission versus empty optional collections SHALL NOT make entries divergent. A native value that changes launch or connection behavior SHALL make them divergent. An adapter that cannot prove semantic equality SHALL classify the entry as divergent.

#### Scenario: Formatting-only difference is equivalent

- **WHEN** an existing entry differs from the desired native rendering only in comments, whitespace, or member order
- **THEN** the adapter SHALL classify it as equivalent

#### Scenario: Behavioral difference is divergent

- **WHEN** an existing entry uses a different command, argument order, environment value, transport, or URL
- **THEN** the adapter SHALL classify it as divergent

#### Scenario: Unprovable equality fails safe

- **WHEN** an adapter cannot determine whether a native field changes the desired behavior
- **THEN** it SHALL classify the entry as divergent rather than equivalent

### Requirement: Failed operations restore tool configuration exactly

When a later failure aborts an operation after a native MCP document changed, the system SHALL restore the document's exact prior bytes, including comments, formatting, and member order. Restoration across multiple documents SHALL leave every affected document in its pre-operation state.

#### Scenario: Later adapter failure restores earlier document

- **WHEN** one adapter changes its native document and a later selected adapter fails
- **THEN** the first document SHALL be restored byte-for-byte

#### Scenario: Final state commit failure restores all documents

- **WHEN** native documents changed but the final project-state commit fails
- **THEN** every changed native document SHALL match its pre-operation bytes

### Requirement: MCP materialization does not run or authenticate servers

Configuring a declared server SHALL NOT install or launch its executable, connect to its URL, test its health, collect credentials, perform OAuth, or persist authentication data. Authentication and connection lifecycle SHALL remain the target tool's responsibility after configuration is written.

#### Scenario: Standard-input server is not launched

- **WHEN** a standard-input declaration is materialized
- **THEN** the system SHALL NOT start the command or require the executable to be installed

#### Scenario: HTTP server is not contacted

- **WHEN** a Streamable HTTP declaration is materialized
- **THEN** the system SHALL NOT connect to the URL or collect credentials
