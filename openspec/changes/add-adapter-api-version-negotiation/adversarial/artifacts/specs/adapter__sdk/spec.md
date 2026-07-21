## ADDED Requirements

### Requirement: The adapter contract is identified by a discrete API version

The adapter call contract SHALL be identified by a discrete adapter API version. The current positional adapter method contract SHALL be designated adapter API `0.0`. Adapter API versions SHALL be compared for exact equality, SHALL NOT be interpreted as semantic-version ranges, and SHALL be independent of the CLI version, the adapter package version, and the Adapter SDK package's own semantic version.

#### Scenario: API versions compare by exact equality

- **WHEN** an adapter's declared API version is checked against the set of supported adapter APIs
- **THEN** the declaration SHALL be treated as supported only when it exactly equals a supported API version
- **AND** no range, ordering, or partial-match semantics SHALL be applied to the comparison

#### Scenario: API version is independent of package versions

- **WHEN** an adapter package or the Adapter SDK package publishes a new semantic version without changing the adapter call contract
- **THEN** the adapter API version those releases declare SHALL remain unchanged

### Requirement: The SDK exposes its canonical adapter API version

The Adapter SDK SHALL expose `0.0` as its canonical adapter API version so that adapter authors and release tooling can declare the API version a release targets from a single authoritative value rather than repeating it by hand.

#### Scenario: Author reads the canonical API version from the SDK

- **WHEN** an adapter author imports the Adapter SDK
- **THEN** the SDK SHALL provide the canonical adapter API version `0.0` as a readable exported value

## MODIFIED Requirements

### Requirement: Adapter authors can define an adapter using the SDK

An adapter author SHALL be able to create an adapter by importing the SDK and calling a factory function with a definition object. The factory SHALL validate the definition shape and return an adapter object. The definition SHALL accept a name, a function to build per-asset adapter metadata (validating and enriching with defaults), and asset install/read/delete methods. The factory SHALL stamp the SDK's canonical adapter API version onto every returned adapter object; adapter authors SHALL NOT be required to declare the adapter API version in their definitions.

#### Scenario: Author creates a valid adapter

- **WHEN** an author calls the factory function with a complete definition
- **THEN** the factory SHALL return a valid adapter object with all provided properties and methods

#### Scenario: Author provides an invalid definition

- **WHEN** an author calls the factory function with a definition missing required fields
- **THEN** the factory SHALL throw an error describing which fields are missing

#### Scenario: Returned adapter carries the canonical API version

- **WHEN** an author calls the factory function with a complete definition that does not mention an adapter API version
- **THEN** the returned adapter object SHALL declare the SDK's canonical adapter API version `0.0`
