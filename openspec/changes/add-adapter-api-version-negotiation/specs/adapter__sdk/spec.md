## MODIFIED Requirements

### Requirement: Adapter authors can define an adapter using the SDK

An adapter author SHALL be able to create an adapter by importing the SDK and calling a factory function with a definition object. The factory SHALL validate the definition shape and return an adapter object. The definition SHALL accept a name, a function to build per-asset adapter metadata (validating and enriching with defaults), and asset install/read/delete methods.

The SDK SHALL expose `0.0` as the canonical adapter API identifier for the current positional method contract. Every adapter returned by the factory SHALL carry that identifier in a required, readonly `apiVersion` field. The factory definition SHALL NOT require or accept an author-supplied API identifier, so adapter authors cannot create a conflicting declaration and do not repeat the SDK-owned value.

#### Scenario: Author creates a valid adapter

- **WHEN** an author calls the factory function with a complete definition
- **THEN** the factory SHALL return a valid adapter object with all provided properties and methods
- **AND** the returned adapter SHALL declare the canonical adapter API `0.0`

#### Scenario: Author provides an invalid definition

- **WHEN** an author calls the factory function with a definition missing required fields
- **THEN** the factory SHALL throw an error describing which fields are missing

#### Scenario: Author does not declare the API version

- **WHEN** an author creates an adapter with the SDK factory
- **THEN** the definition SHALL NOT require the author to provide an API identifier
- **AND** the returned adapter SHALL carry the SDK's canonical API identifier

#### Scenario: Consumer reads the canonical API identifier

- **WHEN** an adapter publisher or compatibility-aware consumer imports the SDK's canonical adapter API identifier
- **THEN** the exported value SHALL be `0.0`

## ADDED Requirements

### Requirement: Adapter API compatibility uses exact contract identifiers

An adapter API identifier SHALL use the canonical `MAJOR.MINOR` decimal form without signs, suffixes, build metadata, or leading zeroes other than zero itself. Compatibility-aware consumers SHALL distinguish missing, malformed, unsupported, and supported identifiers. They SHALL determine compatibility by exact identifier equality and SHALL NOT infer compatibility from CLI versions, SDK package versions, adapter package versions, or semantic-version ordering.

#### Scenario: Exact supported identifier is compatible

- **WHEN** an adapter declares API `0.0`
- **AND** the consumer supports API `0.0`
- **THEN** the adapter API SHALL be classified as supported

#### Scenario: Different well-formed identifier is unsupported

- **WHEN** an adapter declares a well-formed API identifier that is not in the consumer's support set
- **THEN** the adapter API SHALL be classified as unsupported
- **AND** numeric proximity to a supported identifier SHALL NOT make it compatible

#### Scenario: Invalid identifier is malformed

- **WHEN** an adapter declares an identifier with a patch component, suffix, build metadata, sign, or disallowed leading zero
- **THEN** the adapter API SHALL be classified as malformed

#### Scenario: API identifier is independent of package versions

- **WHEN** the CLI, an adapter package, or the Adapter SDK package changes semantic version without changing the positional adapter call contract
- **THEN** the adapter API identifier SHALL remain `0.0`
- **AND** the package-version change SHALL NOT imply a different adapter API compatibility result
