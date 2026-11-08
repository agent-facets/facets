## ADDED Requirements

### Requirement: MCP planning is confined to the explicitly selected scope

Every MCP planning request SHALL carry the explicit installation target of its planning context, the selected collection's complete desired server set, and the server names previously owned by that collection at that scope. Effective server identities SHALL be separated by scope: a project entry and a user entry with the same name SHALL be different identities, and ownership of one SHALL NOT authorize changes to the other.

User-target planning SHALL inspect, change, and remove entries only in the adapter's user-level documents; project-target planning SHALL inspect, change, and remove entries only in the adapter's project-level documents. A plan SHALL NOT remove or rewrite an entry in another scope's document, including a shadowed copy, a fallback layer, or a document the target tool merges at runtime. The target tool's precedence between scopes SHALL NOT confer cross-scope ownership.

#### Scenario: Same-name servers coexist across scopes

- **WHEN** the user collection and a project collection each desire server `docs`
- **AND** neither collection's native documents already contain that server
- **THEN** the user-target plan SHALL write `docs` only to the user-level document
- **AND** the project-target plan SHALL write `docs` only to the project-level document

#### Scenario: User cleanup leaves the project entry

- **WHEN** the user collection removes owned server `docs` and a project document also defines `docs`
- **THEN** the user-target plan SHALL remove `docs` only from user-level documents
- **AND** the project document SHALL be absent from the plan's changes

#### Scenario: Project cleanup leaves the user fallback

- **WHEN** a project removes owned server `docs` and the user-level document also defines `docs`
- **THEN** the project-target plan SHALL NOT change the user-level document

#### Scenario: Project occupancy is not user occupancy

- **WHEN** a user plan desires server `docs`, its user documents contain no such entry, and a project document defines `docs`
- **THEN** the user outcome SHALL be absent rather than occupied, equivalent, or divergent because of the project entry; the project document SHALL NOT be a candidate in the user plan

#### Scenario: Equivalent other-scope entry does not satisfy installation

- **WHEN** the selected scope lacks desired server `docs` while the other scope contains an equivalent declaration
- **THEN** the plan SHALL add the server in the selected scope and SHALL NOT treat the other scope's entry as satisfying its desired state or modify that entry

### Requirement: First-party adapters reconcile native user-level MCP configuration

For a user target, each first-party adapter SHALL reconcile the selected collection's desired servers in its tool's native user-level configuration:

- Claude Code SHALL use the top-level `mcpServers` map in `<CLAUDE_CONFIG_DIR>/.claude.json` when `CLAUDE_CONFIG_DIR` is set, otherwise in `~/.claude.json`.
- Codex SHALL use the `mcp_servers` tables in `config.toml` under the Codex home, which SHALL be `CODEX_HOME` when set, otherwise `~/.codex`.
- OpenCode SHALL use the `opencode.json` and `opencode.jsonc` documents in its global configuration directory, `$XDG_CONFIG_HOME/opencode` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/opencode`.

A location override used for user configuration SHALL be absolute. A relative, malformed, or unsupported override SHALL produce a structured failure before mutation; the adapter SHALL NOT ignore it and plan to a guessed default. A native layout or document shape whose behavior in the target tool has not been established SHALL fail before mutation rather than guess a destination or omit a server.

#### Scenario: Claude Code defaults to the home user-state document

- **WHEN** Claude Code plans a user target with home `/home/alice` and no override
- **THEN** it SHALL plan changes only to the top-level `mcpServers` map in `/home/alice/.claude.json`

#### Scenario: Claude Code override selects the document inside it

- **WHEN** Claude Code plans a user target with `CLAUDE_CONFIG_DIR` set to `/home/alice/.claude`
- **THEN** it SHALL plan changes to `/home/alice/.claude/.claude.json`
- **AND** it SHALL NOT change `/home/alice/.claude.json`

#### Scenario: Codex honours its home override

- **WHEN** Codex plans a user target with `CODEX_HOME` set to `/opt/codex-alice`
- **THEN** it SHALL plan changes to the `mcp_servers` tables in `/opt/codex-alice/config.toml`

#### Scenario: OpenCode uses the global configuration directory

- **WHEN** OpenCode plans a user target with home `/home/alice` and no `XDG_CONFIG_HOME`
- **THEN** every planned change SHALL be to `opencode.json` or `opencode.jsonc` in `/home/alice/.config/opencode`

#### Scenario: Relative override fails closed

- **WHEN** a user target is planned with `XDG_CONFIG_HOME` set to `relative/config`
- **THEN** the OpenCode adapter SHALL return a structured failure
- **AND** it SHALL plan no change at the default location

### Requirement: Claude Code user-state reconciliation preserves unrelated state

At user scope, the Claude Code adapter SHALL edit only the top-level `mcpServers` map of its user-state document. It SHALL preserve the `projects` map, project-local servers recorded inside it, sign-in and account state, and every unrelated setting, and SHALL NOT grant Claude Code's own project trust. When a concurrency conflict involves this document, the failure SHALL suggest retrying after closing Claude Code, and the operation SHALL NOT retry by overwriting the newer document.

When the user-state document is absent, the adapter SHALL plan a new document containing only `mcpServers` only where supported Claude Code releases are verified to accept such a document; otherwise it SHALL return a structured native-state failure directing the user to start Claude Code once to initialize it. A malformed existing document SHALL produce a structured parse failure and SHALL NOT be treated as absent.

#### Scenario: Projects and sign-in state survive

- **WHEN** the user-state document contains a `projects` map with a project-local server, an account sign-in record, and a theme setting, and one user server is added
- **THEN** the written document SHALL retain the `projects` map, the sign-in record, and the theme setting with their semantic values unchanged
- **AND** only the top-level `mcpServers` map SHALL differ

#### Scenario: Project-local server is not treated as a user entry

- **WHEN** an owned user server `docs` is removed while `projects` contains a project-local server `docs`
- **THEN** the project-local `docs` entry SHALL remain unchanged

#### Scenario: Concurrent Claude Code edit suggests a retry

- **WHEN** the user-state document changes between planning and commit
- **THEN** the operation SHALL write nothing to it
- **AND** the failure SHALL suggest closing Claude Code and retrying

#### Scenario: Malformed user-state document is not absent

- **WHEN** the user-state document exists but cannot be parsed
- **THEN** the adapter SHALL return a structured parse failure
- **AND** it SHALL NOT plan a replacement document

#### Scenario: Missing state uses a verified minimal layout

- **WHEN** the Claude Code user-state document is absent and the supported native layout is verified to accept a document containing only `mcpServers`
- **THEN** the plan SHALL describe that minimal document with the desired server map
- **AND** it SHALL NOT invent sign-in state, project trust, or unrelated settings

#### Scenario: Missing state requiring native initialization is actionable

- **WHEN** the Claude Code user-state document is absent and the supported native layout does not accept that minimal document
- **THEN** planning SHALL return a structured native-state failure directing the user to initialize Claude Code
- **AND** it SHALL NOT create or replace any file

### Requirement: Codex user configuration preserves trust and profile settings

At user scope, the Codex adapter SHALL edit only the `mcp_servers` tables of the Codex home `config.toml` using syntax-preserving edits. It SHALL preserve project trust entries, profiles, and every unrelated table and setting.

#### Scenario: Trust entries survive a user server addition

- **WHEN** the Codex home `config.toml` contains a project trust entry and a profile, and one user server is added
- **THEN** the written document SHALL retain the trust entry and the profile unchanged

### Requirement: OpenCode server maps use one V2-aware representation at both scopes

At both project and user scope, the OpenCode adapter SHALL read and write server maps with one representation that recognizes the native `mcp.servers` map and supported legacy flat server entries directly under `mcp`. It SHALL apply OpenCode's documented normalization in which a native entry wins over a legacy entry of the same name, and SHALL preserve unrelated MCP control members, never mistaking a control member for a server name. A newly created server map in either scope SHALL use `mcp.servers`. An existing valid legacy map SHALL remain supported and SHALL NOT be migrated as a whole document. A document whose mix of native and legacy shapes cannot be interpreted unambiguously SHALL produce a structured failure before mutation.

Within the selected scope, OpenCode SHALL disclose its complete supported candidate document set and SHALL select its write target as the highest-precedence document already defining a server map, otherwise the highest-precedence existing document, otherwise a newly created `opencode.jsonc` in that scope's default location. Precedence between same-directory `opencode.json` and `opencode.jsonc` SHALL follow OpenCode's verified native ordering and SHALL NOT be assumed. An obsolete owned name SHALL be removed from every managed representation and candidate document within the selected scope that defines it, so no shadowed copy is promoted.

#### Scenario: New user document uses the native server map

- **WHEN** no OpenCode user document exists and a user server is desired
- **THEN** the plan SHALL create `opencode.jsonc` in the global configuration directory with the server under `mcp.servers`

#### Scenario: Legacy flat map remains supported

- **WHEN** an existing OpenCode document defines a server directly under `mcp`
- **THEN** the adapter SHALL recognize that server
- **AND** an unrelated edit SHALL NOT rewrite the remaining legacy entries into `mcp.servers`

#### Scenario: Control member is not a server

- **WHEN** an OpenCode document contains `mcp.timeout: { "startup": 45000 }` alongside `mcp.servers`
- **THEN** the adapter SHALL NOT report `timeout` as a server
- **AND** it SHALL preserve the timeout object unchanged

#### Scenario: Obsolete name is removed from both representations

- **WHEN** an owned obsolete server is defined both in `mcp.servers` and as a legacy flat entry within the selected scope
- **THEN** the plan SHALL remove it from both representations

#### Scenario: Ambiguous mixed shape fails closed

- **WHEN** an OpenCode document's `mcp` member cannot be unambiguously classified as native, legacy, or controls
- **THEN** the adapter SHALL return a structured failure
- **AND** the document SHALL be absent from any planned change

### Requirement: OpenCode user configuration excludes custom and inline layers

For a user target, OpenCode's write boundary SHALL be its canonical global configuration directory. `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, inline configuration, and project or ancestor layers SHALL NOT be treated as user destinations, SHALL NOT be modified by user planning, and SHALL confer no ownership. Their runtime precedence relative to the global configuration SHALL NOT be asserted until verified against OpenCode evidence.

#### Scenario: Custom configuration file is untouched

- **WHEN** `OPENCODE_CONFIG` names `/home/alice/custom.json` defining owned user server name `docs` and the user collection removes `docs`
- **THEN** the plan SHALL NOT change `/home/alice/custom.json`

#### Scenario: Custom directory is not a destination

- **WHEN** `OPENCODE_CONFIG_DIR` is set and a user server is desired
- **THEN** every planned change SHALL be within the global configuration directory

### Requirement: User-scope MCP planning retains every project-scope guarantee

Planning at user scope SHALL provide the same guarantees as planning at project scope: semantic native equality, literal-value persistence with interpolation checks, exact observed preimages including absence, no-write outcomes for equivalent state, syntax-preserving edits, preservation of unrelated configuration and unowned entries, batch commit, concurrency detection, and exact restoration on failure. Planning SHALL NOT launch, install, probe, or authenticate a server, and diagnostics SHALL NOT include unrelated native configuration.

#### Scenario: Interpolated literal is a conflict at user scope

- **WHEN** a user-target Claude Code plan includes an argument containing `${HOME}`
- **THEN** the adapter SHALL return an interpolation conflict naming the server and value
- **AND** it SHALL plan no change

#### Scenario: Equivalent user configuration is not rewritten

- **WHEN** every desired user server is already equivalent in the Codex home `config.toml`
- **THEN** the plan SHALL report nothing to write
- **AND** the document's bytes and modification time SHALL be unchanged

#### Scenario: Failed user operation restores the user document

- **WHEN** an operation changed the OpenCode user document and a later step fails
- **THEN** that document SHALL be restored to its exact prior bytes

#### Scenario: Diagnostic omits unrelated settings

- **WHEN** a user-target plan fails on a divergent entry in a document containing unrelated provider settings
- **THEN** the failure SHALL NOT include those provider settings

## MODIFIED Requirements

### Requirement: Portable MCP declarations are translated into native project configuration

An adapter that supports MCP servers SHALL translate the complete desired server set of the selected collection into its tool's native configuration at the selected project or user scope rather than copying another tool's file format. Standard-input declarations SHALL preserve command, argument order, and literal environment assignments. Streamable HTTP declarations SHALL preserve the absolute URL. One desired set per selected collection SHALL apply to every selected adapter.

#### Scenario: Standard-input declaration is translated

- **WHEN** a desired server declares a command, ordered arguments, and environment assignments
- **THEN** each supporting adapter SHALL represent the same launch behavior in its tool's native configuration at the selected scope

#### Scenario: Streamable HTTP declaration is translated

- **WHEN** a desired server declares an absolute Streamable HTTP URL
- **THEN** each supporting adapter SHALL represent that URL in its tool's native configuration at the selected scope

#### Scenario: Native formats remain tool-specific

- **WHEN** two selected tools use different configuration schemas or syntaxes
- **THEN** each adapter SHALL produce its own native representation rather than copying the other tool's document shape

#### Scenario: Server-only facet is translated at user scope

- **WHEN** the user collection contains a facet declaring only a Streamable HTTP server
- **THEN** each selected supporting adapter SHALL represent that server in its native user-level configuration

### Requirement: First-party MCP configuration locations are deterministic

The first-party adapters SHALL reconcile project-scoped MCP server maps at their tools' documented project locations. Claude Code SHALL use `.mcp.json`. Codex SHALL use trusted-project `.codex/config.toml` and its project MCP server tables. User-scoped locations SHALL be those of the native user-level configuration requirement.

The OpenCode adapter SHALL treat the four project-root candidates `.opencode/opencode.jsonc`, `.opencode/opencode.json`, `opencode.jsonc`, and `opencode.json` as one configuration and SHALL inspect all four, planning a change only for the documents it actually changes. It SHALL classify occupancy and equality against the merged per-key view in which the highest-precedence document defining a key wins. Precedence SHALL follow verified native behavior, including same-directory JSON/JSONC ordering; an unestablished ordering SHALL fail before mutation rather than be inferred from the filename or a legacy assumption.

The OpenCode adapter SHALL choose one write target per run: the highest-precedence document that already defines a server map — a native `mcp.servers` map or a legacy flat `mcp` map — otherwise the highest-precedence document that exists, otherwise `.opencode/opencode.jsonc`, which it SHALL create with a native `mcp.servers` map. A document defining an empty server map SHALL count as defining one. It SHALL write every desired server to that target. It SHALL leave a definition of a desired server in a lower-precedence document unchanged, since the target's definition already wins. It SHALL remove an obsolete owned key from every project document and representation that defines it, so that no shadowed definition is promoted by the removal. It SHALL leave entries it neither desires nor owns untouched in every document. Project planning SHALL NOT change OpenCode's user-level documents.

#### Scenario: Claude Code uses its project server map

- **WHEN** the Claude Code adapter reconciles project servers
- **THEN** it SHALL update the `mcpServers` map in project `.mcp.json`

#### Scenario: OpenCode writes where the project already keeps its servers

- **WHEN** `.opencode/opencode.jsonc` exists without a server map and `opencode.json` defines one
- **THEN** the OpenCode adapter SHALL write the desired server into the server map of `opencode.json`
- **AND** it SHALL NOT plan a change for the unchanged `.opencode/opencode.jsonc`

#### Scenario: OpenCode prefers the highest-precedence server map

- **WHEN** more than one OpenCode document defines a server map
- **THEN** the OpenCode adapter SHALL write the desired server into the highest-precedence one

#### Scenario: OpenCode falls back to the highest-precedence existing document

- **WHEN** no OpenCode document defines a server map and at least one exists
- **THEN** the OpenCode adapter SHALL write the desired server into the highest-precedence existing document

#### Scenario: OpenCode creates its default document

- **WHEN** no OpenCode project document exists
- **THEN** the OpenCode adapter SHALL create `.opencode/opencode.jsonc` with the desired server under `mcp.servers`
- **AND** it SHALL NOT create any other OpenCode project document

#### Scenario: OpenCode leaves a shadowed definition alone

- **WHEN** a desired server is written to the target while a lower-precedence document also defines that key
- **THEN** the OpenCode adapter SHALL leave the lower-precedence definition unchanged

#### Scenario: OpenCode removes an obsolete entry from every document

- **WHEN** an obsolete owned server is defined in more than one OpenCode project document
- **THEN** the OpenCode adapter SHALL remove that entry from every project document that defines it

#### Scenario: OpenCode leaves unowned entries alone

- **WHEN** an OpenCode document defines a server the project neither desires nor owns
- **THEN** the adapter SHALL leave that entry unchanged

#### Scenario: Codex uses trusted project configuration

- **WHEN** the Codex adapter reconciles project servers in a trusted project
- **THEN** it SHALL update the MCP server tables in project `.codex/config.toml`

#### Scenario: User-level configuration is touched only by user operations

- **WHEN** any adapter materializes MCP configuration for a project target
- **THEN** no user-wide or system-wide tool configuration file SHALL be created or modified

#### Scenario: System-wide configuration is never touched

- **WHEN** any adapter materializes MCP configuration for a project or user target
- **THEN** no system-wide tool configuration file SHALL be created or modified

### Requirement: The complete MCP change is planned without mutation

A supporting adapter SHALL be able to inspect its native configuration at the selected scope and compute the complete desired MCP server change without modifying any file. A plan SHALL report structured per-server outcomes that distinguish absent entries, equivalent entries, divergent entries, and occupied entries whose effective identities are or are not already owned. A parse or native validation failure SHALL leave the document unchanged.

A plan SHALL report either that nothing needs writing, or the complete set of document changes that realizes the desired state. Each planned change SHALL name an absolute path, the exact state that document was observed in — including the absence of a document that does not yet exist — and the exact bytes to commit. A document the plan does not change SHALL NOT be among its changes: inspecting a file is not a reason to own it, and a file this run leaves alone is one no later restoration may overwrite.

Separately from its changes, a plan SHALL name the complete set of candidate configuration documents for the selected scope that it was computed from, including absent and unchanged candidates and including when it changes none of them. That disclosure SHALL confer no ownership: a document named there and not changed SHALL NOT be recorded as changed, written, or restored. Its disclosed location SHALL remain available for target-binding validation without treating its bytes as modified state. The disclosure SHALL allow a caller to determine, before anything is approved or written, that no two selected adapters reconcile one file and that the plan's locations match those previously recorded for the selected collection.

#### Scenario: A plan reports complete outcomes

- **WHEN** desired servers include one absent entry, one equivalent entry, and one divergent entry
- **THEN** the adapter SHALL report all three outcomes in one plan

#### Scenario: An inspected but unchanged document is not part of the plan

- **WHEN** an adapter inspects several configuration layers and only one needs writing
- **THEN** the plan SHALL contain a change for that layer alone
- **AND** the plan SHALL still name both layers as documents it was computed from

#### Scenario: A plan that changes nothing still says what it read

- **WHEN** every desired server is already present and equivalent
- **THEN** the plan SHALL report that nothing needs writing
- **AND** it SHALL still name the documents it reached that conclusion from

#### Scenario: Absent candidates are disclosed

- **WHEN** OpenCode plans a user target and neither `opencode.json` nor `opencode.jsonc` exists in the global configuration directory
- **THEN** the plan SHALL name both candidate paths as documents it was computed from

#### Scenario: A planned change states what it was computed from

- **WHEN** a plan would write a document that already exists
- **THEN** that change SHALL carry the exact state the document was observed in

#### Scenario: Invalid native document fails read-only

- **WHEN** the selected native document cannot be parsed safely
- **THEN** preparation SHALL return structured failure data
- **AND** the document SHALL remain byte-for-byte unchanged

#### Scenario: Planning does not write a new document

- **WHEN** the target document does not yet exist
- **THEN** the plan SHALL describe the prospective document without creating it
- **AND** it SHALL record the document's absence as the state the change was computed from

#### Scenario: Candidate disclosure remains stable across no-op planning

- **WHEN** the same adapter plans a user target with unchanged location inputs and physical path layout, first with missing candidate documents and later with equivalent desired configuration present
- **THEN** both plans SHALL disclose the same complete canonical candidate-document set, including when the later plan contains no changes

### Requirement: Unrelated native configuration is preserved

MCP reconciliation SHALL preserve semantic settings outside the portable MCP model and SHALL preserve server entries whose effective names are neither desired nor owned by the selected collection at the selected scope. For an owned desired entry, native fields outside the portable model SHALL survive when they can be preserved without changing the desired launch or connection behavior. Adapters SHOULD maximize comment and formatting preservation.

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

#### Scenario: Manually added user server survives

- **WHEN** a user-level document contains server `manual` that the user collection neither desires nor owns
- **THEN** user reconciliation SHALL leave the complete `manual` entry unchanged

#### Scenario: Safe native extension survives tracked update

- **WHEN** an owned desired server has a native timeout field that does not change the portable launch or connection behavior
- **THEN** the adapter SHALL preserve the timeout where its native format permits

### Requirement: Failed operations restore tool configuration exactly

When a later failure aborts an operation after a native MCP document changed, the system SHALL restore the document's exact prior bytes, including comments, formatting, and member order. Restoration across multiple documents SHALL leave every affected document in its pre-operation state. An adapter SHALL NOT be asked to undo its own edit: restoration works from the exact prior state the plan recorded, so it never depends on an adapter reproducing formatting it never saw.

A document the operation did not change SHALL NOT be restored, rewritten, or have its modification time touched.

#### Scenario: Later adapter failure restores earlier document

- **WHEN** one adapter changes its native document and a later selected adapter fails
- **THEN** the first document SHALL be restored byte-for-byte

#### Scenario: Final state commit failure restores all documents

- **WHEN** native documents changed but the final commit of the selected collection's state fails
- **THEN** every changed native document SHALL match its pre-operation bytes
