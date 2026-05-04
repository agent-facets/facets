## ADDED Requirements

### Requirement: Version specifiers in artifacts conform to a published grammar

A version specifier appearing inside a project manifest or a lockfile SHALL conform to one of five forms: an exact version (`MAJOR.MINOR.PATCH`), a major-pinned wildcard (`MAJOR.*`), a minor-pinned wildcard (`MAJOR.MINOR.*`), a bare wildcard (`*`), or the literal tag `latest`. Any system that produces or consumes these artifacts SHALL honor the published grammar; specifiers that do not match one of the five forms SHALL be rejected as invalid.

#### Scenario: A producer writes only conforming specifiers

- **WHEN** a system writes a version specifier into a project manifest or lockfile
- **THEN** the specifier SHALL be one of: exact, major-wildcard, minor-wildcard, bare wildcard, or `latest`
- **AND** non-conforming forms (e.g., `^1.2.3`, `~1.2.3`, `>=1.0`, `1.x`) SHALL NOT be written

#### Scenario: A consumer rejects a non-conforming specifier

- **WHEN** a system reads a project manifest or lockfile containing a version specifier in a non-conforming form (e.g., `^1.2.3`)
- **THEN** the system SHALL reject the artifact as invalid
- **AND** the system SHALL surface a structured error indicating which specifier violated the grammar

#### Scenario: A consumer accepts every conforming form

- **WHEN** a system reads a project manifest or lockfile containing specifiers in any of the five conforming forms
- **THEN** the system SHALL accept each specifier as valid
- **AND** the system SHALL be able to determine whether a candidate version satisfies the specifier

### Requirement: Version-specifier resolution semantics are deterministic

For each conforming version-specifier form, the published grammar SHALL define which candidate versions satisfy the specifier. Different facet-compatible systems resolving the same specifier against the same set of candidate versions SHALL select the same version.

#### Scenario: Exact specifier matches one candidate

- **WHEN** a candidate set contains the exact version named by an exact specifier
- **THEN** every facet-compatible system SHALL resolve the specifier to that version
- **AND** if the exact version is not present, every system SHALL fail resolution

#### Scenario: Major-wildcard selects the highest matching version

- **WHEN** a major-wildcard specifier (e.g., `1.*`) is resolved against a candidate set containing multiple versions sharing the major
- **THEN** every facet-compatible system SHALL select the highest version sharing that major

#### Scenario: Minor-wildcard selects the highest matching patch

- **WHEN** a minor-wildcard specifier (e.g., `1.2.*`) is resolved against a candidate set containing multiple versions sharing the major.minor
- **THEN** every facet-compatible system SHALL select the highest version sharing that major.minor

#### Scenario: Bare wildcard selects the highest published version

- **WHEN** a bare wildcard specifier (`*`) is resolved against a non-empty candidate set
- **THEN** every facet-compatible system SHALL select the highest version in the candidate set

#### Scenario: `latest` resolves identically to bare wildcard

- **WHEN** a `latest` specifier is resolved against a non-empty candidate set
- **THEN** every facet-compatible system SHALL select the highest version in the candidate set
- **AND** the resolution SHALL be identical to that of the bare wildcard form

### Requirement: Version-specifier interpretation is independent of pre-release ordering

For the purposes of this protocol, version comparison SHALL operate on the `MAJOR.MINOR.PATCH` triple alone. Pre-release tags (e.g., `1.2.3-beta`) are out of scope for the published grammar; a facet-compatible system MAY accept or reject pre-release versions as it sees fit, but SHALL NOT claim that pre-release ordering is part of the protocol.

#### Scenario: Plain MAJOR.MINOR.PATCH versions compare deterministically

- **WHEN** two facet-compatible systems compare two plain MAJOR.MINOR.PATCH versions
- **THEN** every system SHALL produce the same ordering result
- **AND** the result SHALL be defined by numeric comparison of major, then minor, then patch
