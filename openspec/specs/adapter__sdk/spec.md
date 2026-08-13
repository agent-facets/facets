## Purpose

An adapter is an AI coding tool (OpenCode, Claude Code, Codex, etc.) that wraps an LLM and consumes skills, agents, and commands. Adapter authors use the Adapter SDK to describe how their tool validates per-asset metadata and where/how assets are stored, so the system can validate manifests against specific adapters and delegate all asset I/O to the adapter that owns it.
## Requirements
### Requirement: Adapter authors can define an adapter using the SDK

An adapter author SHALL be able to create an adapter by importing the SDK and calling a factory function with a definition object. The factory SHALL validate the definition shape and return an adapter object. The definition SHALL accept a name, a function to build per-asset adapter metadata, asset install/read/delete methods, and the required `mcpServers` support field.

The SDK SHALL expose `0.2` as the canonical adapter API identifier for the tagged asset contract plus the MCP server capability. Every adapter returned by the current factory SHALL carry that identifier in a required, readonly `apiVersion` field. The factory definition SHALL NOT require or accept an author-supplied API identifier, so adapter authors cannot create a conflicting declaration and do not repeat the SDK-owned value. If a value is nonetheless supplied for `apiVersion`, such as through untyped input, the factory SHALL ignore it; the returned adapter SHALL always carry the SDK's canonical identifier and SHALL NOT reflect the author-supplied value.

#### Scenario: Author creates a valid adapter

- **WHEN** an author calls the factory function with a complete definition
- **THEN** the factory SHALL return a valid adapter object with all provided properties, methods, and capability declaration
- **AND** the returned adapter SHALL declare the canonical adapter API `0.2`

#### Scenario: Author provides an invalid definition

- **WHEN** an author calls the factory function with a definition missing required fields
- **THEN** the factory SHALL throw an error describing which fields are missing

#### Scenario: Author does not declare the API version

- **WHEN** an author creates an adapter with the SDK factory
- **THEN** the definition SHALL NOT require the author to provide an API identifier
- **AND** the returned adapter SHALL carry the SDK's canonical API identifier

#### Scenario: Consumer reads the canonical API identifier

- **WHEN** an adapter publisher or compatibility-aware consumer imports the SDK's canonical adapter API identifier
- **THEN** the exported value SHALL be `0.2`

### Requirement: The SDK provides default behavior for missing methods

The factory function SHALL provide default behavior for asset methods that an adapter author has omitted. When an adapter author omits `installAsset`, `readAsset`, or `deleteAsset`, the factory SHALL provide a throw-on-call stub in its place so the returned adapter always satisfies the interface shape. This is a defensive runtime check for non-TypeScript consumers; TypeScript consumers receive a compile-time error when asset methods are missing.

#### Scenario: Author omits an asset method

- **WHEN** an author calls the factory function without providing one or more of `installAsset`, `readAsset`, or `deleteAsset`
- **THEN** the factory SHALL return a valid adapter object
- **AND** the omitted method SHALL throw a clear error when invoked, naming the method that was not implemented

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

### Requirement: Adapter API compatibility uses exact contract identifiers

An adapter API identifier SHALL use the canonical `MAJOR.MINOR` decimal form without signs, suffixes, build metadata, or leading zeroes other than zero itself. Compatibility-aware consumers SHALL distinguish missing, malformed, unsupported, and supported identifiers. They SHALL determine compatibility by membership in an explicit exact-token support set and SHALL NOT infer compatibility from CLI versions, SDK package versions, adapter package versions, or semantic-version ordering.

Adapter API `0.2` SHALL identify the tagged asset request/result contract plus the MCP server capability. Adapter API `0.1` SHALL continue identifying the tagged asset-only contract. The earlier positional method contract SHALL remain identified by `0.0`. Whether a consumer supports `0.1`, `0.2`, or another exact contract identifier SHALL be determined solely by membership in that consumer's explicit support set; widening the set SHALL NOT change an existing token's meaning. Package metadata and runtime declarations for one adapter release SHALL still agree by exact token.

#### Scenario: Current exact identifier is compatible

- **WHEN** an adapter declares API `0.2`
- **AND** the consumer's explicit support set contains `0.2`
- **THEN** the adapter API SHALL be classified as supported

#### Scenario: Previous tagged identifier remains compatible

- **WHEN** an adapter declares API `0.1`
- **AND** the consumer's explicit support set contains `0.1`
- **THEN** the adapter API SHALL be classified as supported
- **AND** the adapter SHALL retain the asset-only `0.1` contract

#### Scenario: Superseded positional identifier is unsupported

- **WHEN** an adapter declares the positional-contract API `0.0`
- **AND** the consumer's explicit support set excludes `0.0`
- **THEN** the adapter API SHALL be classified as unsupported
- **AND** numeric proximity to `0.1` SHALL NOT make it compatible

#### Scenario: Different well-formed identifier is unsupported

- **WHEN** an adapter declares a well-formed API identifier that is not in the consumer's support set
- **THEN** the adapter API SHALL be classified as unsupported
- **AND** numeric proximity to a supported identifier SHALL NOT make it compatible

#### Scenario: Invalid identifier is malformed

- **WHEN** an adapter declares an identifier with a patch component, suffix, build metadata, sign, or disallowed leading zero
- **THEN** the adapter API SHALL be classified as malformed

#### Scenario: Package and runtime tokens must agree

- **WHEN** an adapter package declares API `0.1` in package metadata but its runtime adapter declares `0.2`
- **THEN** verification SHALL fail rather than selecting either contract

#### Scenario: API identifier is independent of package versions

- **WHEN** the CLI, an adapter package, or the Adapter SDK package changes semantic version without changing the `0.2` adapter call contract
- **THEN** the adapter API identifier SHALL remain `0.2`
- **AND** the package-version change SHALL NOT imply a different adapter API compatibility result

### Requirement: Adapter authors declare MCP server support as one complete capability

An adapter definition using API `0.2` SHALL declare `mcpServers` as either `false` or a complete MCP server capability. The capability SHALL contain the complete read-only preparation and atomic application contract; support SHALL NOT be representable as a boolean that can disagree with optional operations. The field SHALL be MCP-specific, and future non-asset project-configuration features SHALL use independent capabilities.

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

- **WHEN** a later adapter API adds a different project-configuration feature
- **THEN** that feature SHALL use a separate capability without widening the MCP server contract

### Requirement: The protocol declaration type is the adapter contract's source of truth

The SDK SHALL consume the published MCP server declaration type from the protocol contract and SHALL NOT redeclare an independent structural copy. Adapter authors SHALL receive one portable declaration shape regardless of target tool.

#### Scenario: Protocol field change cannot silently diverge

- **WHEN** the published MCP declaration contract changes in a future breaking release
- **THEN** adapter capability types SHALL reflect that authoritative declaration contract rather than retain a stale duplicate

### Requirement: Adapter API `0.1` remains usable without active MCP declarations

A selected adapter implementing API `0.1` SHALL remain usable when the desired project state contains no active MCP server declaration. When active declarations exist, every selected `0.1` adapter and every selected `0.2` adapter declaring `mcpServers: false` SHALL be reported together as unable to materialize the desired state before any write.

#### Scenario: Previous adapter serves a text-only project

- **WHEN** a project has no active MCP server declaration and a selected adapter implements API `0.1`
- **THEN** installation SHALL proceed using its tagged asset contract

#### Scenario: Previous adapter cannot serve active MCP declarations

- **WHEN** a project has an active MCP server declaration and a selected adapter implements API `0.1`
- **THEN** installation SHALL fail before mutation and identify the adapter as requiring upgrade

#### Scenario: Current adapter may explicitly lack MCP support

- **WHEN** a project has an active MCP declaration and a selected `0.2` adapter declares `mcpServers: false`
- **THEN** the adapter SHALL appear in the same complete unsupported-adapter failure
