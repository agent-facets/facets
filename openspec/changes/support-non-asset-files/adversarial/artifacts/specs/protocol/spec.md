## MODIFIED Requirements

### Requirement: Protocol requirements evolve under semantic-versioning discipline

The protocol's published surface SHALL evolve under semantic-versioning discipline, with the pre-1.0 exception below. Within a compatibility level, requirements MAY be added, but existing requirements SHALL NOT be removed, made stricter, or changed in any way that would cause a previously-conforming system to become non-conforming.

While a published protocol package remains pre-1.0, a backward-incompatible change SHALL be released in a new **minor** version of that package, and the minor-version release notes SHALL describe what behavior is no longer accepted. From 1.0 onward, backward-incompatible changes SHALL only be made in a new **major** version. In both regimes, the previous compatibility level SHALL remain available so existing consumers continue to function.

#### Scenario: Adding a new optional field within a major version

- **WHEN** a new optional field is added to a manifest schema within a minor or patch release
- **THEN** systems built against the previous version SHALL continue to be conforming
- **AND** the new field SHALL NOT be required for conformance until a future breaking release

#### Scenario: Tightening a constraint requires a breaking release

- **WHEN** a previously-permitted value is rejected by a new requirement (e.g., a previously valid name pattern is narrowed)
- **THEN** the change SHALL be released only as part of a breaking release — a new minor version while the package is pre-1.0, or a new major version from 1.0 onward
- **AND** the release notes SHALL describe what behavior is no longer accepted

#### Scenario: Removing a requirement is a breaking change

- **WHEN** an existing requirement is removed from the protocol
- **THEN** the removal SHALL only occur in a breaking release (pre-1.0 minor, or 1.0+ major)
- **AND** the previous compatibility level SHALL remain available so existing consumers continue to function

#### Scenario: A pre-1.0 breaking change ships in a minor release

- **WHEN** a backward-incompatible protocol change (such as a new archive format version) is published while the protocol package is pre-1.0
- **THEN** the change SHALL ship in the package's next minor release rather than a major release
- **AND** the release notes SHALL identify the breaking change and the migration path
