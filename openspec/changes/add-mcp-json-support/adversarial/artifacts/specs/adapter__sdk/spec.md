## ADDED Requirements

### Requirement: Adapters declare MCP server support through a single capability field

A current adapter SHALL declare its MCP server support as exactly one field whose value is either `false` — the adapter does not support MCP configuration — or an MCP server capability object. The two states SHALL be mutually exclusive by construction: there SHALL be no separate boolean that can disagree with the presence of capability operations. The capability SHALL be deliberately MCP-specific; future non-asset project-configuration features SHALL receive their own independent capabilities rather than widening this one.

The capability SHALL operate on the complete desired MCP server batch for a project, not one server at a time, through two operations: a read-only preparation that receives the project root, the complete desired contribution set, and the previously owned effective identities, and returns structured per-key outcomes, the affected native document path(s), and an opaque prepared plan; and an application that consumes the prepared plan, performs one atomic native-file update, and reports whether the document changed and which path(s) were affected. Adapters SHALL NOT supply inverse operations; rollback is byte-exact restoration performed outside the adapter. Expected parse, validation, conflict, write, and rollback failures SHALL be discriminated result values, and the consumer SHALL NOT inspect the opaque plan or edit the native file itself.

#### Scenario: Capability presence is unambiguous

- **WHEN** an adapter declares MCP support
- **THEN** its declaration SHALL be a capability object in the single MCP field
- **AND** an adapter declaring `false` SHALL carry no MCP operations that could contradict it

#### Scenario: Preparation is read-only and batch-scoped

- **WHEN** the capability prepares a desired MCP server change
- **THEN** it SHALL receive the complete desired set in one request
- **AND** it SHALL modify no file
- **AND** it SHALL return per-key outcomes, affected document paths, and an opaque plan

#### Scenario: Application is atomic and plan-driven

- **WHEN** a prepared plan is applied
- **THEN** the adapter SHALL perform one atomic update to its native document
- **AND** it SHALL report an unchanged result or the affected path(s)

#### Scenario: Expected failures are structured results

- **WHEN** preparation or application encounters a parse error, conflict, or write failure it can handle
- **THEN** the operation SHALL return a discriminated failure value rather than throwing
- **AND** the adapter's native file SHALL remain unchanged for a handled failure

## MODIFIED Requirements

### Requirement: Adapter authors can define an adapter using the SDK

An adapter author SHALL be able to create an adapter by importing the SDK and calling a factory function with a definition object. The factory SHALL validate the definition shape and return an adapter object. The definition SHALL accept a name, a function to build per-asset adapter metadata (validating and enriching with defaults), asset install/read/delete methods, and an MCP server support declaration that is either `false` or an MCP server capability.

The SDK SHALL expose `0.2` as the canonical adapter API identifier for the current contract: the tagged request/result asset methods plus the single-field MCP server capability declaration. Every adapter returned by the factory SHALL carry that identifier in a required, readonly `apiVersion` field. The factory definition SHALL NOT require or accept an author-supplied API identifier, so adapter authors cannot create a conflicting declaration and do not repeat the SDK-owned value. If a value is nonetheless supplied for `apiVersion`, such as through untyped input, the factory SHALL ignore it; the returned adapter SHALL always carry the SDK's canonical identifier and SHALL NOT reflect the author-supplied value.

The MCP declaration types consumed by the capability SHALL be the types published by the protocol schema, consumed without redeclaration, so the SDK and the manifest schema cannot drift apart.

#### Scenario: Author creates a valid adapter

- **WHEN** an author calls the factory function with a complete definition
- **THEN** the factory SHALL return a valid adapter object with all provided properties and methods
- **AND** the returned adapter SHALL declare the canonical adapter API `0.2`

#### Scenario: Author creates an adapter without MCP support

- **WHEN** an author declares MCP support as `false`
- **THEN** the factory SHALL return a valid adapter that consumers recognize as MCP-server-unsupported

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

### Requirement: Adapter API compatibility uses exact contract identifiers

An adapter API identifier SHALL use the canonical `MAJOR.MINOR` decimal form without signs, suffixes, build metadata, or leading zeroes other than zero itself. Compatibility-aware consumers SHALL distinguish missing, malformed, unsupported, and supported identifiers. They SHALL determine compatibility by exact identifier equality against their supported set and SHALL NOT infer compatibility from CLI versions, SDK package versions, adapter package versions, or semantic-version ordering. Widening a consumer's supported set SHALL never weaken any individual check: each classification remains exact-token equality against a set of exact tokens.

The tagged request/result asset method contract SHALL remain identified by adapter API `0.1`. The contract adding the single-field MCP server capability SHALL be identified by adapter API `0.2`. The earlier positional method contract SHALL remain identified by `0.0`; a consumer whose supported set contains only tagged contracts SHALL classify `0.0` as a well-formed but unsupported identifier and SHALL NOT treat its numeric proximity to a supported token as compatibility.

#### Scenario: Exact supported identifier is compatible

- **WHEN** an adapter declares API `0.2`
- **AND** the consumer's supported set contains `0.2`
- **THEN** the adapter API SHALL be classified as supported

#### Scenario: Earlier tagged identifier is supported only when in the set

- **WHEN** an adapter declares API `0.1`
- **AND** the consumer's supported set is exactly `{0.1, 0.2}`
- **THEN** the adapter API SHALL be classified as supported by exact membership
- **AND** the classification SHALL NOT rely on numeric ordering

#### Scenario: Superseded positional identifier is unsupported

- **WHEN** an adapter declares the positional-contract API `0.0`
- **AND** the consumer supports only tagged-contract APIs
- **THEN** the adapter API SHALL be classified as unsupported
- **AND** numeric proximity to a supported identifier SHALL NOT make it compatible

#### Scenario: Different well-formed identifier is unsupported

- **WHEN** an adapter declares a well-formed API identifier that is not in the consumer's support set
- **THEN** the adapter API SHALL be classified as unsupported
- **AND** numeric proximity to a supported identifier SHALL NOT make it compatible

#### Scenario: Invalid identifier is malformed

- **WHEN** an adapter declares an identifier with a patch component, suffix, build metadata, sign, or disallowed leading zero
- **THEN** the adapter API SHALL be classified as malformed

#### Scenario: API identifier is independent of package versions

- **WHEN** the CLI, an adapter package, or the Adapter SDK package changes semantic version without changing the adapter call contract
- **THEN** the adapter API identifier SHALL remain unchanged
- **AND** the package-version change SHALL NOT imply a different adapter API compatibility result
