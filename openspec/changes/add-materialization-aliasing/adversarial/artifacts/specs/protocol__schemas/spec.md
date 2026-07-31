## MODIFIED Requirements

### Requirement: A project manifest schema is published as part of the protocol

The shape of a project manifest (`facets.json`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a project manifest SHALL conform to the published schema. The schema SHALL define how facet sources are listed, how version specifiers are expressed, and how compact and selective forms are distinguished.

The schema SHALL define an explicit format-version field selected by exact equality rather than numeric ordering. A manifest that omits the field SHALL be interpreted as the legacy string-only form, in which every entry value is a compact source or version-specifier string; the legacy form SHALL remain valid input. An unsupported format version SHALL be rejected with structured data identifying the observed and supported versions.

The current versioned form SHALL permit each facet entry to be either the compact string form or an enriched form that carries the same source information plus per-asset collision resolutions. A resolution SHALL identify one declared asset of the facet and SHALL be exactly one of: an alias assigning a materialized name, or an omission excluding the asset from materialization. An alias value SHALL satisfy the published asset-name grammar. An enriched entry SHALL NOT assign more than one resolution to the same asset and SHALL NOT express adapter-specific resolutions; one resolution applies to every adapter. Compact string entries SHALL remain valid within the current form for facets that require no resolution.

#### Scenario: A consumer interprets a project manifest correctly

- **WHEN** a system reads a `facets.json` containing a list of facet sources with version specifiers
- **THEN** the system SHALL interpret each source per the published schema
- **AND** ambiguous interpretations SHALL be rejected with a structured error

#### Scenario: A producer writes a project manifest conforming to the schema

- **WHEN** a system adds a new facet to a project's `facets.json`
- **THEN** the resulting file SHALL satisfy the published schema
- **AND** another facet-compatible system SHALL accept the file after validating it

#### Scenario: A legacy unversioned manifest is accepted as legacy

- **WHEN** a system reads a `facets.json` with no format-version field whose entries are all compact strings
- **THEN** the system SHALL interpret it under the legacy string-only form
- **AND** the system SHALL NOT reject it for lacking a format version

#### Scenario: An enriched entry with a valid alias is accepted

- **WHEN** a current-format manifest entry declares a facet source and aliases one of the facet's assets to a name satisfying the asset-name grammar
- **THEN** the system SHALL accept the entry
- **AND** the system SHALL interpret the alias as the asset's effective materialized name for every adapter

#### Scenario: An alias violating the asset-name grammar is rejected

- **WHEN** an enriched entry aliases an asset to `Review--Code`, a name with a `/`, or a name exceeding the permitted length
- **THEN** the system SHALL reject the manifest
- **AND** the structured failure SHALL identify the invalid alias and the naming constraint

#### Scenario: Conflicting resolutions for one asset are rejected

- **WHEN** an enriched entry assigns the same asset both an alias and an omission, or two different aliases
- **THEN** the system SHALL reject the manifest with a structured error identifying the doubly-resolved asset

#### Scenario: Adapter-specific resolutions are rejected

- **WHEN** a manifest entry attempts to scope a resolution to a particular adapter
- **THEN** the system SHALL reject the manifest
- **AND** the failure SHALL state that resolutions are project-level

#### Scenario: An unsupported manifest format version is rejected

- **WHEN** a `facets.json` declares a format version the system does not support
- **THEN** the system SHALL reject it with structured data identifying the observed and supported versions

### Requirement: A lockfile schema is published as part of the protocol

The shape of a lockfile (`facets.lock`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a lockfile SHALL conform to the published schema. The schema SHALL define the lockfile version, source-provenance fields, identity-and-integrity fields, the asset list and its materialized-file integrity records, the representation of collision resolutions, and the rules for unrecognized fields.

Version dispatch SHALL use exact equality rather than numeric ordering. Legacy numeric `1` SHALL identify only the closed-alpha schema, numeric `0.2` SHALL identify only the preceding alpha schema, and numeric `0.3` SHALL identify the current schema. Archive-format and lockfile-format versions SHALL be interpreted independently even when they have the same numeric value. A lockfile JSON document containing duplicate object member names SHALL be rejected before schema validation.

The published schema's source-provenance fields SHALL take a tagged form keyed on the source kind, so that the provenance fields meaningful for each kind are explicit. The published schema SHALL define a registry source that records the registry origin, a git source that records the repository URL and a required resolved commit, and a local source that records the resolved path. A lockfile whose entry source does not declare a recognized kind, or omits a field required for its declared kind, SHALL NOT satisfy the published schema. A source MAY carry additional unrecognized keys and still satisfy the published schema.

Every current asset entry SHALL record the authored `scope`, `type`, and `name` plus a required `files` array sorted deterministically by canonical path. Each file record SHALL contain exactly the canonical inner-archive `path` and its `sha256:<hex>` `integrity` over canonical archive bytes. An asset entry MAY additionally record exactly one of: an effective materialized name satisfying the published asset-name grammar, or an omission marker. An entry recording neither denotes materialization under the authored name. Aliasing and omission SHALL NOT alter the `files` records, which always describe the authored archive. A skill entry SHALL list `skills/<name>/SKILL.md` and every declared companion below that skill. An agent entry SHALL list exactly `agents/<name>.md`; a command entry SHALL list exactly `commands/<name>.md`. Archive-only supplementary files SHALL NOT appear in an asset's `files` array, and companion files SHALL NOT appear as independent assets.

#### Scenario: A consumer interprets a lockfile written by a different system

- **WHEN** a system reads a `facets.lock` written by a different facet-compatible system
- **THEN** the system SHALL interpret every field per the published schema
- **AND** the system SHALL accept the lockfile as valid input for installation

#### Scenario: A producer writes a lockfile that any consumer can read

- **WHEN** a system writes a `facets.lock` after resolving facet sources and collision resolutions
- **THEN** the resulting file SHALL satisfy the published schema
- **AND** another facet-compatible system SHALL be able to read the file and reproduce the same effective install state

#### Scenario: Source provenance is tagged by kind

- **WHEN** a facet-compatible system reads an entry's source provenance from a `facets.lock`
- **THEN** the source SHALL declare its kind as registry, git, or local
- **AND** a registry source SHALL record the registry origin and SHALL NOT carry a version specifier
- **AND** a git source SHALL record the repository URL and a required resolved commit, and SHALL NOT record a symbolic ref
- **AND** a local source SHALL record the resolved path

#### Scenario: A git source missing its required commit is rejected

- **WHEN** a facet-compatible system reads a lockfile whose entry declares a git source with no commit
- **THEN** the lockfile SHALL NOT satisfy the published schema
- **AND** the system SHALL reject the lockfile

#### Scenario: A source with extra unrecognized keys is accepted

- **WHEN** a facet-compatible system reads a lockfile whose entry source declares a recognized kind with all its required fields plus unrecognized keys
- **THEN** the lockfile SHALL satisfy the published schema
- **AND** the system SHALL accept the lockfile

#### Scenario: Current skill entry lists every materialized file

- **WHEN** a `0.3` lockfile records skill `review` with companions `references/api.md` and `scripts/run.ts`
- **THEN** the skill's sorted `files` array SHALL contain `skills/review/SKILL.md`, `skills/review/references/api.md`, and `skills/review/scripts/run.ts`
- **AND** each record SHALL contain a canonical path and `sha256:<hex>` integrity

#### Scenario: Aliased asset entry distinguishes authored and effective identity

- **WHEN** a `0.3` lockfile records skill `review` materialized under the alias `review-acme`
- **THEN** the asset entry SHALL record the authored name `review` and the effective materialized name `review-acme`
- **AND** the `files` array SHALL still list canonical `skills/review/...` paths with authored-archive integrity

#### Scenario: An invalid effective name fails the schema

- **WHEN** a `0.3` asset entry records an effective materialized name that violates the published asset-name grammar
- **THEN** the lockfile SHALL NOT satisfy the published schema

#### Scenario: An entry cannot be both aliased and omitted

- **WHEN** a `0.3` asset entry records both an effective materialized name and an omission marker
- **THEN** the lockfile SHALL NOT satisfy the published schema

#### Scenario: Single-file assets list one file

- **WHEN** a `0.3` lockfile records agent `reviewer` and command `review`
- **THEN** each asset's `files` array SHALL contain exactly its conventional primary path

#### Scenario: Archive-only file is excluded from asset records

- **WHEN** a verified facet contains a declared root `README.md`
- **THEN** no current asset entry SHALL list `README.md`

#### Scenario: Legacy versions are selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 1` or numeric `lockfileVersion: 0.2`
- **THEN** the system SHALL interpret it only with the matching legacy schema
- **AND** the system SHALL NOT reinterpret its shape as `0.3`
