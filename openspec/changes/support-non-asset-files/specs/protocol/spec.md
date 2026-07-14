## MODIFIED Requirements

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
