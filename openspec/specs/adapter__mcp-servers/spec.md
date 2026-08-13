## Purpose

Defines the adapter contract for translating portable MCP server declarations into safe, tool-native project configuration. It ensures adapters can plan and apply changes atomically, preserve unrelated configuration, compare native entries semantically, restore prior state after failure, and configure servers without launching or contacting them.

## Requirements

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

The first-party adapters SHALL reconcile project-scoped MCP server maps at their tools' documented project locations. Claude Code SHALL use `.mcp.json`. Codex SHALL use trusted-project `.codex/config.toml` and its project MCP server tables.

OpenCode merges `opencode.json` and `opencode.jsonc`, so the OpenCode adapter SHALL treat both as one configuration and SHALL inspect and disclose both. It SHALL classify occupancy and equality against the merged per-key view in which a key defined in `opencode.jsonc` wins. It SHALL create a new entry in `opencode.jsonc` when that document exists, otherwise in an existing `opencode.json`, and SHALL create `opencode.jsonc` when neither exists. It SHALL update an existing entry in the layer where that key currently wins. When one owned key is defined in both layers, it SHALL update the `opencode.jsonc` definition and remove the shadowed `opencode.json` definition in the same change. It SHALL remove an obsolete owned key from every layer that defines it. It SHALL leave entries it neither desires nor owns untouched in both layers.

#### Scenario: Claude Code uses its project server map

- **WHEN** the Claude Code adapter reconciles project servers
- **THEN** it SHALL update the `mcpServers` map in project `.mcp.json`

#### Scenario: OpenCode prefers JSONC for a new entry

- **WHEN** both `opencode.jsonc` and `opencode.json` exist and a desired server is absent from both
- **THEN** the OpenCode adapter SHALL create the entry in the `mcp` map of `opencode.jsonc`
- **AND** it SHALL disclose both documents

#### Scenario: OpenCode falls back to existing JSON

- **WHEN** `opencode.json` exists and `opencode.jsonc` does not
- **THEN** the OpenCode adapter SHALL reconcile the existing JSON document

#### Scenario: OpenCode creates JSONC

- **WHEN** neither OpenCode project document exists
- **THEN** the OpenCode adapter SHALL create `opencode.jsonc`

#### Scenario: OpenCode removes an obsolete entry from the lower layer

- **WHEN** an obsolete owned server is defined only in `opencode.json` while `opencode.jsonc` also exists
- **THEN** the OpenCode adapter SHALL remove that entry from `opencode.json`

#### Scenario: OpenCode collapses a shadowed owned entry

- **WHEN** one owned server is defined in both OpenCode documents and its declaration changed
- **THEN** the adapter SHALL update the `opencode.jsonc` definition
- **AND** it SHALL remove the shadowed `opencode.json` definition in the same change

#### Scenario: OpenCode leaves unowned lower-layer entries alone

- **WHEN** `opencode.json` defines a server the project neither desires nor owns
- **THEN** the adapter SHALL leave that entry unchanged

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

A prepared plan SHALL carry the exact prior text of every document it would write, including the absence of a document that does not yet exist. Immediately before writing, application SHALL re-read each such document and compare it with that recorded prior text. When any of them differs, application SHALL write nothing at all and SHALL return a structured conflict identifying the document. No locking, merging, or rebasing is required: a document another process changed after preparation is reported rather than overwritten.

Conflicts SHALL be distinguishable by reason, and each reason SHALL carry only the facts that reason has. A concurrent-modification conflict SHALL identify the document it drifted on. A conflict arising because the native format cannot represent the desired state SHALL identify the document and the format-specific detail. An interpolation conflict SHALL identify the server and the offending value and SHALL NOT name a document, because it is decided before any write target is selected. No conflict SHALL carry preformatted display text in place of these fields.

#### Scenario: Concurrent modification is distinguishable from an unrepresentable change

- **WHEN** a caller receives a conflict
- **THEN** it SHALL be able to tell a document that changed after inspection from a native format that cannot represent the desired state
- **AND** each SHALL carry the document it concerns

#### Scenario: Complete server batch commits together

- **WHEN** a prepared change adds, updates, and removes several server entries in one document
- **THEN** the resulting document SHALL contain the complete desired set or the complete prior set
- **AND** it SHALL NOT expose a handled partial update

#### Scenario: No-op performs no write

- **WHEN** every desired server entry is already semantically equivalent and no owned entry is obsolete
- **THEN** the adapter SHALL report the document unchanged

#### Scenario: Concurrent edit is reported instead of overwritten

- **WHEN** a native document a prepared plan would write differs from the text preparation recorded for it
- **THEN** application SHALL write no document
- **AND** it SHALL return a structured conflict identifying that document

#### Scenario: Handled write failure preserves prior document

- **WHEN** a write fails while applying a prepared batch
- **THEN** the adapter SHALL return structured failure data
- **AND** the prior native document SHALL remain available unchanged

### Requirement: Unrelated native configuration is preserved

MCP reconciliation SHALL preserve semantic settings outside the portable MCP model and SHALL preserve server entries whose effective names are neither desired nor owned by the project. For an owned desired entry, native fields outside the portable model SHALL survive when they can be preserved without changing the desired launch or connection behavior. Adapters SHOULD maximize comment and formatting preservation.

A document's encoding preamble is part of that document. An adapter whose parser cannot accept a leading byte-order mark SHALL remove it before parsing and restore it when writing, per document, so a marked document stays marked and an unmarked one stays unmarked. An adapter SHALL infer a document's indentation from the shallowest level that document actually uses, so that an edit does not re-lay-out lines it was not asked to change.

#### Scenario: A byte-order mark survives an edit

- **WHEN** a native document begins with a byte-order mark and one entry is written
- **THEN** the written document SHALL still begin with that mark

#### Scenario: One layer's mark does not spread to another

- **WHEN** a tool merges two configuration documents and only one of them carries a byte-order mark
- **THEN** a change writing both SHALL leave each document's mark exactly as it found it

#### Scenario: A deeply indented line does not set the document's indentation

- **WHEN** the first indented line of a document is nested more deeply than the member being edited
- **THEN** the edit SHALL preserve the indentation of the member it writes rather than adopting the deeper line's width

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

Each supporting adapter SHALL compare an existing entry with the adapter-native rendering of the desired portable declaration. Comments, formatting, and member ordering SHALL NOT make entries divergent. An omitted optional collection and an empty one SHALL be treated as equal only where the adapter knows its tool's native format gives the two representations identical behavior; where a native representation changes launch or connection semantics, the entries SHALL remain divergent. A native value that changes launch or connection behavior SHALL make them divergent. An adapter that cannot prove semantic equality SHALL classify the entry as divergent.

#### Scenario: Formatting-only difference is equivalent

- **WHEN** an existing entry differs from the desired native rendering only in comments, whitespace, or member order
- **THEN** the adapter SHALL classify it as equivalent

#### Scenario: Behavioral difference is divergent

- **WHEN** an existing entry uses a different command, argument order, environment value, transport, or URL
- **THEN** the adapter SHALL classify it as divergent

#### Scenario: Unprovable equality fails safe

- **WHEN** an adapter cannot determine whether a native field changes the desired behavior
- **THEN** it SHALL classify the entry as divergent rather than equivalent

#### Scenario: Behavior-changing empty collection stays divergent

- **WHEN** an adapter's native format gives an omitted optional collection and an empty one different launch or connection behavior
- **THEN** the adapter SHALL NOT treat the two representations as equal

### Requirement: Authored literal values are persisted as supplied

A portable declaration's values are literal, so an adapter SHALL write each authored command, argument, environment name, environment value, and URL to tool-native configuration exactly as supplied. Facets does not collect, synthesize, or manage authentication, and it SHALL NOT attempt secret detection, redaction, substitution, or any other rewriting of an authored literal.

Several target tools expand their own configuration values. Before writing, an adapter whose tool performs such expansion SHALL check every authored literal for that tool's interpolation syntax, and SHALL return a structured conflict identifying the server and value rather than write a literal its tool would replace. That conflict SHALL carry the offending value exactly as authored, and SHALL NOT attribute the failure to any native document: the declaration is unwritable for that tool wherever it would land.

The check SHALL NOT depend on state carried by the pattern an adapter supplies, so that a guard cannot report a clean result for a value it would otherwise reject.

#### Scenario: Authored environment value is written verbatim

- **WHEN** a declaration carries a literal environment value that resembles a credential
- **THEN** the adapter SHALL write that exact value into tool-native configuration
- **AND** it SHALL NOT redact, mask, or relocate it

#### Scenario: Interpolated literal is a conflict

- **WHEN** an authored command, argument, environment value, or URL contains syntax the target tool would expand rather than use literally
- **THEN** the adapter SHALL return a structured conflict naming the server and the offending value
- **AND** that conflict SHALL name no native document
- **AND** it SHALL write nothing

#### Scenario: Every interpolated declaration in a batch is rejected

- **WHEN** several desired servers each carry a value the target tool would expand
- **THEN** each one checked SHALL be reported as a conflict rather than passing the guard

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
