## Purpose

Defines what it means for a system to be facet-compatible. The protocol is the published surface a system claiming compatibility must honor; specific contracts (manifest schemas, integrity verification, front-matter encoding, version-spec grammar, content hashing) are defined in the `protocol__*` sub-specs.
## Requirements
### Requirement: A facet-compatible system honors the full set of artifact contracts

A system claiming facet compatibility SHALL validate every facet artifact format it accepts or produces, verify integrity using the published verification algorithm, honor the encoding rules for asset-file front matter, and interpret version specifiers per the published grammar. Partial conformance — honoring some artifact contracts but not others — SHALL NOT be claimed as facet compatibility.

#### Scenario: Full conformance is required for compatibility claim

- **WHEN** a system validates manifests, verifies integrity, parses front matter, and interprets version specifiers per the published rules
- **THEN** the system MAY claim facet compatibility
- **AND** artifacts the system produces SHALL be expected to interoperate with other facet-compatible systems

#### Scenario: Partial conformance is rejected as compatibility

- **WHEN** a system validates manifests and verifies integrity but does not honor front-matter encoding
- **THEN** the system SHALL NOT claim facet compatibility
- **AND** artifacts the system produces SHALL NOT be expected to interoperate

#### Scenario: A consumer that only validates is not a producer

- **WHEN** a system only validates uploaded artifacts (e.g., a registry server) and never produces them
- **THEN** the system SHALL be facet-compatible if it honors every contract relevant to validation
- **AND** the system SHALL NOT be required to honor producer-only contracts (e.g., archive assembly), because it never produces artifacts

### Requirement: Protocol requirements evolve under semantic-versioning discipline

The protocol's published surface SHALL evolve under semantic versioning. While the published protocol remains pre-1.0, backward-incompatible changes SHALL be released in the next minor version, and patch releases SHALL NOT remove, tighten, or incompatibly change requirements from their minor release. At and after 1.0, backward-incompatible changes SHALL be released only in a new major version. Within any compatible release line, requirements MAY be added only when previously conforming systems remain conforming. Release notes for every breaking release SHALL describe the behavior that previously conformed and is no longer accepted.

#### Scenario: Adding a new optional field is backward-compatible

- **WHEN** a new optional field is added to an artifact schema without changing the meaning of existing fields
- **THEN** systems built against the previous compatible release SHALL continue to be conforming
- **AND** the new field SHALL NOT be required for conformance until a breaking release

#### Scenario: A pre-1.0 constraint tightening uses a minor release

- **WHEN** a pre-1.0 release rejects a value accepted by the preceding minor release
- **THEN** the change SHALL be released in the next minor version rather than a patch version
- **AND** the release notes SHALL describe the value that is no longer accepted

#### Scenario: A post-1.0 constraint tightening uses a major release

- **WHEN** a release at or after 1.0 rejects a value accepted by the preceding major release
- **THEN** the change SHALL be released only in a new major version
- **AND** the major-version release notes SHALL describe the value that is no longer accepted

#### Scenario: Removing a requirement is a breaking change

- **WHEN** an existing protocol requirement is removed
- **THEN** the removal SHALL use the applicable pre-1.0 minor or post-1.0 major breaking-release rule
- **AND** the previous compatibility level SHALL remain available for existing consumers

#### Scenario: Removing legacy artifact support is breaking

- **WHEN** a release stops accepting an artifact format accepted by the preceding release line
- **THEN** the removal SHALL be released under the applicable pre-1.0 minor or post-1.0 major breaking-change rule
- **AND** the preceding release line SHALL remain available for consumers that still require the legacy format

### Requirement: The published reference implementation conforms to the protocol

The TypeScript reference implementation of the protocol SHALL implement every requirement defined under any protocol sub-spec. Divergence between the reference implementation's behavior and the published requirements SHALL be treated as a defect in the implementation, not in the requirements. The implementation SHALL pass tests that exercise every published requirement.

#### Scenario: Implementation behavior matches every published requirement

- **WHEN** an automated test exercises a published protocol requirement against the reference implementation
- **THEN** the implementation's behavior SHALL match the requirement
- **AND** any test failure SHALL be treated as a bug in the implementation

#### Scenario: Spec drift is treated as an implementation defect

- **WHEN** the reference implementation produces an artifact that does not satisfy a published requirement
- **THEN** the implementation SHALL be corrected
- **AND** the published requirement SHALL NOT be relaxed to match the implementation's behavior

#### Scenario: A new published requirement requires a corresponding implementation change

- **WHEN** a new requirement is added to a protocol sub-spec
- **THEN** the reference implementation SHALL be updated to satisfy it before that requirement is published
- **AND** the implementation's tests SHALL include coverage for the new requirement

### Requirement: Protocol implementations in other languages are recognized as conforming

A facet-compatible implementation in any programming language SHALL be recognized as conforming if it satisfies every published requirement. Implementations SHALL NOT be required to use TypeScript or to depend on the published reference implementation. Conformance is determined by behavior, not by which library a system links against.

#### Scenario: A non-TypeScript implementation conforms via behavior

- **WHEN** an implementation in a different programming language produces and consumes artifacts that satisfy every published requirement
- **THEN** the implementation SHALL be recognized as facet-compatible
- **AND** artifacts the implementation produces SHALL interoperate with the reference implementation

#### Scenario: A TypeScript implementation that does not depend on the published package conforms via behavior

- **WHEN** a TypeScript implementation reimplements the protocol from the published requirements without depending on the reference package
- **THEN** the implementation SHALL be recognized as facet-compatible if its behavior matches every requirement
- **AND** artifacts the implementation produces SHALL interoperate with the reference implementation

