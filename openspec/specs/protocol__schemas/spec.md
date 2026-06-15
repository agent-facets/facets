## Purpose

Defines the published, normative schemas for the artifacts a facet-compatible system produces and consumes: facet manifest, project manifest, lockfile, build manifest, and server manifest.

## Requirements

### Requirement: A facet manifest schema is published as part of the protocol

The shape of a facet manifest (`facet.json`) SHALL be published as a normative schema. Any system that produces a facet manifest SHALL produce one conforming to the published schema. Any system that consumes a facet manifest SHALL validate it against the published schema before treating any value as trusted. The schema SHALL define the required fields, the permitted shapes for skills/agents/commands, the accepted facet identity grammar, and the rules for unrecognized fields.

A facet identity name SHALL be either an unscoped name (`<slug>`) or a scoped name (`@<scope>/<slug>`). Each `slug` and `scope` component SHALL satisfy the same component grammar: it MUST be at least 2 characters and at most 64 characters, MUST start with a lowercase ASCII letter, MUST end with a lowercase ASCII letter or ASCII digit, MUST contain only lowercase ASCII letters, ASCII digits, and hyphens, and MUST NOT contain consecutive hyphens. Uppercase letters, non-ASCII characters, underscores, dots, spaces, plus signs, tildes, emoji, and any other character outside the component grammar SHALL be rejected rather than normalized. A facet manifest whose `name` is malformed SHALL be rejected as invalid. Asset names SHALL remain independently validated as local asset identifiers and SHALL NOT become scoped names.

The facet manifest schema SHALL NOT document unsupported composition or server-reference fields as part of the current user-facing manifest contract. Current user-facing manifest documentation SHALL describe only supported manifest behavior and SHALL use the manifest specification page as the canonical place for facet-name grammar.

#### Scenario: A producer emits a manifest conforming to the published schema

- **WHEN** a system produces a `facet.json` for distribution
- **THEN** the produced manifest SHALL satisfy every requirement of the published schema
- **AND** another facet-compatible system SHALL accept the manifest after validating it

#### Scenario: A consumer accepts valid unscoped facet identities

- **WHEN** a system receives a `facet.json` whose `name` is `ab`, `cowsay`, `julian`, `admin-tester`, `apple-b34r`, or `f-o-s-s-o`
- **THEN** the system SHALL accept the facet identity as valid
- **AND** the accepted identity SHALL remain the facet's canonical name without normalization

#### Scenario: A consumer accepts a valid scoped facet identity

- **WHEN** a system receives a `facet.json` whose `name` is `@julian/cowsay`
- **THEN** the system SHALL accept the facet identity as valid
- **AND** both scoped identity components SHALL satisfy the same component grammar as unscoped facet names
- **AND** the scoped identity SHALL remain the facet's canonical name

#### Scenario: A consumer rejects invalid slug components

- **WHEN** a system receives a `facet.json` whose `name` is empty, `a`, `z`, `A`, `Cowsay`, `1abc`, `-abc`, `abc-`, `abc--def`, `abc_def`, `abc.def`, `abc def`, `éclair`, `gооgle` with Cyrillic homoglyphs, or any component longer than 64 characters
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL surface a structured error indicating that the facet identity is malformed

#### Scenario: A consumer rejects malformed scoped facet identities

- **WHEN** a system receives a `facet.json` whose `name` is `@scope`, `@/name`, `@scope/`, `@scope/name/extra`, or `scope/name`
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL surface a structured error indicating that the facet identity is malformed

#### Scenario: A consumer rejects a manifest that violates the published schema

- **WHEN** a system receives a `facet.json` that omits a required field or contains a field with the wrong type
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL surface a structured error indicating which constraint was violated

#### Scenario: A consumer tolerates unrecognized fields

- **WHEN** a system receives a `facet.json` containing a field not defined in the schema
- **THEN** the system SHALL accept the manifest as valid
- **AND** the system SHALL preserve the unknown field if it later re-emits the manifest

### Requirement: A project manifest schema is published as part of the protocol

The shape of a project manifest (`facets.json`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a project manifest SHALL conform to the published schema. The schema SHALL define how facet sources are listed, how version specifiers are expressed, and how compact and selective forms are distinguished.

#### Scenario: A consumer interprets a project manifest correctly

- **WHEN** a system reads a `facets.json` containing a list of facet sources with version specifiers
- **THEN** the system SHALL interpret each source per the published schema
- **AND** ambiguous interpretations SHALL be rejected with a structured error

#### Scenario: A producer writes a project manifest conforming to the schema

- **WHEN** a system adds a new facet to a project's `facets.json`
- **THEN** the resulting file SHALL satisfy the published schema
- **AND** another facet-compatible system SHALL accept the file after validating it

### Requirement: A lockfile schema is published as part of the protocol

The shape of a lockfile (`facets.lock`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a lockfile SHALL conform to the published schema. The schema SHALL define the lockfile version, source-provenance fields, identity-and-integrity fields, the asset list, and the rules for unrecognized fields.

The published schema's source-provenance fields SHALL take a tagged form keyed on the source kind, so that the provenance fields meaningful for each kind are explicit. The published schema SHALL define a registry source that records the registry origin, a git source that records the repository URL and a required resolved commit, and a local source that records the resolved path. A lockfile whose entry source does not declare a recognized kind, or omits a field required for its declared kind (such as a git source without a commit), SHALL NOT satisfy the published schema. Consistent with the lockfile's tolerance of unrecognized fields, a source MAY carry additional unrecognized keys and still satisfy the published schema — forward-compatibility requires that a newer producer's extra fields not break an older consumer.

#### Scenario: A consumer interprets a lockfile written by a different system

- **WHEN** a system reads a `facets.lock` written by a different facet-compatible system
- **THEN** the system SHALL interpret every field per the published schema
- **AND** the system SHALL accept the lockfile as valid input for installation

#### Scenario: A producer writes a lockfile that any consumer can read

- **WHEN** a system writes a `facets.lock` after resolving facet sources
- **THEN** the resulting file SHALL satisfy the published schema
- **AND** another facet-compatible system SHALL be able to read the file and reproduce the same install state

#### Scenario: Source provenance is tagged by kind

- **WHEN** a facet-compatible system reads an entry's source provenance from a `facets.lock`
- **THEN** the source SHALL declare its kind (registry, git, or local)
- **AND** a registry source SHALL record the registry origin and SHALL NOT carry a version specifier
- **AND** a git source SHALL record the repository URL and a required resolved commit, and SHALL NOT record a symbolic ref
- **AND** a local source SHALL record the resolved path

#### Scenario: A git source missing its required commit is rejected

- **WHEN** a facet-compatible system reads a lockfile whose entry declares a git source with no commit
- **THEN** the lockfile SHALL NOT satisfy the published schema
- **AND** the system SHALL reject the lockfile

#### Scenario: A source with extra unrecognized keys is accepted

- **WHEN** a facet-compatible system reads a lockfile whose entry source declares a recognized kind with all its required fields, plus one or more unrecognized keys
- **THEN** the lockfile SHALL satisfy the published schema
- **AND** the system SHALL accept the lockfile (forward-compatibility with newer producers)

### Requirement: A build manifest schema is published as part of the protocol

The shape of a build manifest (`build-manifest.json`) embedded inside a `.facet` archive SHALL be published as a normative schema. Any system that produces a `.facet` archive SHALL include a build manifest conforming to the schema. Any system that consumes a `.facet` archive SHALL validate the embedded build manifest against the schema before trusting its values.

#### Scenario: A producer embeds a conforming build manifest

- **WHEN** a system produces a `.facet` archive
- **THEN** the embedded `build-manifest.json` SHALL conform to the published schema
- **AND** the manifest SHALL declare the protocol version, the inner archive name, the integrity hash, and the per-asset hash table

#### Scenario: A consumer rejects an archive whose build manifest violates the schema

- **WHEN** a system receives a `.facet` archive whose `build-manifest.json` is missing a required field or has a malformed integrity value
- **THEN** the system SHALL reject the archive as invalid
- **AND** the system SHALL surface a structured error identifying the violation

### Requirement: A server manifest schema is published as part of the protocol

The shape of a server manifest SHALL be published as a normative schema. Any system that declares an MCP server reference within a facet manifest SHALL conform to the published shape. Any system that interprets a server reference SHALL conform to the published rules for source-mode versus ref-mode declarations.

#### Scenario: A producer declares servers in source-mode and ref-mode

- **WHEN** a system writes a facet manifest containing both source-mode (floor version) and ref-mode (image reference) server declarations
- **THEN** the resulting declarations SHALL each satisfy the published schema for their respective form

#### Scenario: A consumer interprets server declarations consistently

- **WHEN** a system reads a facet manifest with mixed-mode server declarations
- **THEN** the system SHALL interpret each declaration per the published schema
- **AND** ambiguous declarations SHALL be rejected with a structured error
