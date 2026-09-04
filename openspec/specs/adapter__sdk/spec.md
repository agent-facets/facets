## Purpose

An adapter is an AI coding tool (OpenCode, Claude Code, Codex, etc.) that wraps an LLM and consumes skills, agents, and commands. Adapter authors use the Adapter SDK to describe how their tool validates per-asset metadata and where/how assets are stored, so the system can validate manifests against specific adapters and delegate every decision about what should change to the adapter that owns it, while the system performs the writes.
## Requirements
### Requirement: Adapter authors can define an adapter using the SDK

An adapter author SHALL be able to create an adapter by importing the SDK and calling a factory function with a definition object. The factory SHALL validate the definition shape and return an adapter object. The definition SHALL accept a name, a function to build per-asset adapter metadata, the required `assets` capability, and the required `mcpServers` capability.

The SDK SHALL expose `0.3` as the canonical adapter SDK API identifier for the read-only planning contract: tagged asset planning plus the MCP server planning capability. Every adapter returned by the current factory SHALL carry that identifier in a required, readonly `apiVersion` field. The factory definition SHALL NOT require or accept an author-supplied API identifier, so adapter authors cannot create a conflicting declaration and do not repeat the SDK-owned value. If a value is nonetheless supplied for `apiVersion`, such as through untyped input, the factory SHALL ignore it; the returned adapter SHALL always carry the SDK's canonical identifier and SHALL NOT reflect the author-supplied value.

#### Scenario: Author creates a valid adapter

- **WHEN** an author calls the factory function with a complete definition
- **THEN** the factory SHALL return a valid adapter object with all provided properties, methods, and capability declaration
- **AND** the returned adapter SHALL declare the canonical adapter SDK API `0.3`

#### Scenario: Author provides an invalid definition

- **WHEN** an author calls the factory function with a definition missing required fields
- **THEN** the factory SHALL throw an error describing which fields are missing

#### Scenario: Author does not declare the API version

- **WHEN** an author creates an adapter with the SDK factory
- **THEN** the definition SHALL NOT require the author to provide an API identifier
- **AND** the returned adapter SHALL carry the SDK's canonical API identifier

#### Scenario: Consumer reads the canonical API identifier

- **WHEN** an adapter publisher or compatibility-aware consumer imports the SDK's canonical adapter SDK API identifier
- **THEN** the exported value SHALL be `0.3`

### Requirement: The SDK refuses an incomplete capability rather than stubbing it

The factory function SHALL reject a capability that is present but incomplete, naming the missing operation. It SHALL NOT substitute a stub: a capability is something a consumer must know about *before* it plans a transaction, so an adapter that appears to support an operation and then refuses it would be discovered only once work had already begun. Declaring a capability as `false` SHALL remain a complete and valid answer.

#### Scenario: Author supplies an incomplete capability

- **WHEN** an author calls the factory function with a capability object missing one of its operations
- **THEN** the factory SHALL reject the definition, naming the missing operation

#### Scenario: Author declines a capability outright

- **WHEN** an author declares a capability as `false`
- **THEN** the factory SHALL return a valid adapter that reports no support for it

### Requirement: The facet manifest uses "adapters" for per-asset adapter metadata

The facet manifest schema SHALL use the field name `adapters` (not `platforms`) for per-asset adapter metadata. All validation, documentation, and tooling SHALL reference this field name.

#### Scenario: Manifest with adapters field

- **WHEN** a facet author writes a manifest with an `adapters` field containing metadata for one or more adapters
- **THEN** the system SHALL accept the manifest as valid

#### Scenario: Manifest with legacy platforms field

- **WHEN** a facet author writes a manifest with a `platforms` field
- **THEN** the system SHALL ignore the field per the unknown-field tolerance rules
- **AND** the `platforms` field SHALL NOT be used for adapter metadata

### Requirement: The build pipeline accepts adapters as inputs

The build pipeline SHALL accept an array of adapter objects as a parameter for metadata building. The pipeline SHALL delegate metadata building (validation + enrichment) to each adapter rather than maintaining an internal registry.

#### Scenario: Build metadata with matching adapter

- **WHEN** the build pipeline processes a facet manifest that includes adapter metadata for "opencode"
- **AND** an "opencode" adapter object is provided
- **THEN** the pipeline SHALL pass the metadata to the adapter's build function
- **AND** use the enriched metadata returned on success
- **AND** report any errors returned on failure

#### Scenario: Unknown adapter in manifest

- **WHEN** the build pipeline processes a facet manifest that includes adapter metadata for "cursor"
- **AND** no "cursor" adapter object is provided
- **THEN** the pipeline SHALL produce a warning that the adapter is unknown
- **AND** the pipeline SHALL NOT produce an error

### Requirement: First-party and third-party adapters use the same installation and loading mechanism

First-party adapters (for AI coding tools maintained by the project) SHALL be installed and loaded using the same mechanism as third-party adapters. There SHALL be no separate code path for first-party adapters.

#### Scenario: First-party adapter installed via CLI

- **WHEN** a user installs a first-party adapter using a built-in name
- **THEN** the system SHALL install the adapter using the same pipeline as any third-party adapter

#### Scenario: First-party adapter loaded at runtime

- **WHEN** the system loads adapters at runtime
- **THEN** first-party and third-party adapters SHALL be loaded from the same directory using the same mechanism

### Requirement: Adapter SDK API compatibility uses exact contract identifiers

An adapter SDK API identifier SHALL use the canonical `MAJOR.MINOR` decimal form without signs, suffixes, build metadata, or leading zeroes other than zero itself. Compatibility-aware consumers SHALL distinguish missing, malformed, unsupported, and supported identifiers. They SHALL determine compatibility by membership in an explicit exact-token support set and SHALL NOT infer compatibility from CLI versions, SDK package versions, adapter package versions, or semantic-version ordering.

Adapter SDK API `0.3` SHALL identify the read-only planning contract. Adapter SDK APIs `0.0`, `0.1`, and `0.2` SHALL remain identifiers of superseded contracts in which the adapter performed its own filesystem writes. Whether a consumer supports an exact contract identifier SHALL be determined solely by membership in that consumer's explicit support set; changing the set SHALL NOT change an existing token's meaning. Package metadata and runtime declarations for one adapter release SHALL still agree by exact token.

#### Scenario: Current exact identifier is compatible

- **WHEN** an adapter declares API `0.3`
- **AND** the consumer's explicit support set contains `0.3`
- **THEN** the adapter SDK API SHALL be classified as supported

#### Scenario: Previous tagged identifier is unsupported

- **WHEN** an adapter declares API `0.1` or `0.2`
- **AND** the consumer's explicit support set does not contain it
- **THEN** the adapter SDK API SHALL be classified as unsupported

#### Scenario: Superseded positional identifier is unsupported

- **WHEN** an adapter declares the positional-contract API `0.0`
- **AND** the consumer's explicit support set excludes `0.0`
- **THEN** the adapter SDK API SHALL be classified as unsupported
- **AND** numeric proximity to a supported token SHALL NOT make it compatible

#### Scenario: Different well-formed identifier is unsupported

- **WHEN** an adapter declares a well-formed API identifier that is not in the consumer's support set
- **THEN** the adapter SDK API SHALL be classified as unsupported
- **AND** numeric proximity to a supported identifier SHALL NOT make it compatible

#### Scenario: Invalid identifier is malformed

- **WHEN** an adapter declares an identifier with a patch component, suffix, build metadata, sign, or disallowed leading zero
- **THEN** the adapter SDK API SHALL be classified as malformed

#### Scenario: Package and runtime tokens must agree

- **WHEN** an adapter package declares API `0.2` in package metadata but its runtime adapter declares `0.3`
- **THEN** verification SHALL fail rather than selecting either contract

#### Scenario: API identifier is independent of package versions

- **WHEN** the CLI, an adapter package, or the Adapter SDK package changes semantic version without changing the `0.3` adapter call contract
- **THEN** the adapter SDK API identifier SHALL remain `0.3`
- **AND** the package-version change SHALL NOT imply a different adapter SDK API compatibility result

### Requirement: Adapter authors declare MCP server support as one complete capability

An adapter definition using API `0.3` SHALL declare both `assets` and `mcpServers` as either `false` or a complete capability. Each capability SHALL contain its complete set of operations; support SHALL NOT be representable as a boolean that can disagree with optional operations. A capability missing an operation SHALL be rejected when the adapter is defined and again when its bundle is verified. The field SHALL be MCP-specific, and future non-asset project-configuration features SHALL use independent capabilities.

#### Scenario: Adapter declares complete MCP support

- **WHEN** an adapter author provides a complete MCP server capability
- **THEN** the returned adapter SHALL expose it through `mcpServers`

#### Scenario: Adapter declares no MCP support

- **WHEN** an adapter author sets `mcpServers` to `false`
- **THEN** the returned adapter SHALL unambiguously report that MCP servers are unsupported

#### Scenario: Partial capability is rejected

- **WHEN** an adapter definition claims MCP support but omits a required capability operation
- **THEN** the definition SHALL fail validation or type checking rather than produce a partially supported adapter

#### Scenario: Future configuration feature remains independent

- **WHEN** a later adapter SDK API adds a different project-configuration feature
- **THEN** that feature SHALL use a separate capability without widening the MCP server contract

### Requirement: The SDK supplies reusable MCP planning scaffolding

The SDK SHALL provide default MCP planning scaffolding that an adapter author composes rather than reimplements. The scaffolding SHALL cover the parts every adapter answers identically: reading the documents an adapter selects, capturing each document's exact observed state — including the absence of one that does not exist — guarding authored literals against tool interpolation, classifying desired and owned entries, short-circuiting when nothing needs writing, and returning the exact per-document changes that realize the desired state. An adapter SHALL supply only its tool-specific parts: which documents to consider, how to parse and validate them, how to compare an existing entry, and how to render an edit.

The scaffolding SHALL support a plan that changes more than one native document, so an adapter whose tool merges several configuration layers is not forced to write its own path. It SHALL exclude from the plan any document whose rendered bytes match the state it was read in, so inspecting a document is never a reason to write it.

The scaffolding SHALL NOT write, and SHALL NOT expose an operation that writes. Concurrency detection and restoration belong to the consumer that performs the write, which applies them uniformly to every file it commits rather than once per adapter.

The SDK SHALL also provide the canonical escaped rendering for any declaration value reaching a terminal, so that an adapter's structured failure data and a consumer's display of it cannot disagree about what is safe to print.

#### Scenario: An unchanged document is excluded from the plan

- **WHEN** an adapter inspects several configuration layers and only one needs writing
- **THEN** the plan SHALL contain a change for that layer alone

#### Scenario: One escaped rendering is available to every adapter

- **WHEN** an adapter author needs to reproduce a declaration value safely
- **THEN** the SDK SHALL supply that rendering rather than requiring the author to implement one

#### Scenario: Author supplies only tool-specific parts

- **WHEN** an adapter author composes the SDK's MCP scaffolding with its document selection, parsing, comparison, and rendering
- **THEN** the resulting capability SHALL satisfy the complete planning contract without the author reimplementing state capture, no-op elimination, or change rendering

#### Scenario: Planned changes are exact file transitions

- **WHEN** an adapter's planning produces a change for a document
- **THEN** that change SHALL name an absolute path, the exact state the document was observed in, and the exact bytes to commit

### Requirement: The protocol declaration type is the adapter contract's source of truth

The SDK SHALL consume the published MCP server declaration type from the protocol contract and SHALL NOT redeclare an independent structural copy. Adapter authors SHALL receive one portable declaration shape regardless of target tool.

#### Scenario: Protocol field change cannot silently diverge

- **WHEN** the published MCP declaration contract changes in a future breaking release
- **THEN** adapter capability types SHALL reflect that authoritative declaration contract rather than retain a stale duplicate

### Requirement: An adapter without MCP support remains usable for a project without MCP servers

A selected adapter declaring no MCP server support SHALL remain usable when the desired project state contains no active MCP server declaration. When active declarations exist, every selected adapter declaring no MCP support SHALL be reported together as unable to materialize the desired state before any write.

#### Scenario: An adapter without MCP support serves a text-only project

- **WHEN** a project has no active MCP server declaration and a selected adapter declares no MCP support
- **THEN** installation SHALL proceed using its asset planning capability

#### Scenario: An adapter without MCP support cannot serve active declarations

- **WHEN** a project has an active MCP server declaration and a selected adapter declares no MCP support
- **THEN** installation SHALL fail before mutation and identify every such adapter
- **AND** the remedy SHALL be to omit the declarations or deselect the adapter, not to upgrade it
