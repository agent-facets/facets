## ADDED Requirements

### Requirement: Materialization dispositions use one published tagged shape

The protocol SHALL publish a materialization disposition with exactly three arms: `authored`, meaning the asset is materialized under its authored name; `aliased`, which MUST carry the effective name; and `omitted`, meaning the asset is not materialized. An aliased effective name MUST satisfy the current single-segment asset-name grammar and SHALL NOT change the asset's authored scope, type, archive paths, or integrity values.

An artifact that records project intent SHALL admit only the `aliased` and `omitted` arms because absence of an override means authored materialization. An artifact that records resolved state SHALL require one of all three arms. Illegal combinations, including an alias without an effective name or an effective name on another arm, SHALL be rejected.

#### Scenario: Valid aliased disposition

- **WHEN** a disposition declares `aliased` with effective name `vendor-review`
- **THEN** the disposition SHALL satisfy the published schema
- **AND** the authored asset identity SHALL remain unchanged

#### Scenario: Valid omitted disposition

- **WHEN** a disposition declares `omitted` without an effective name
- **THEN** the disposition SHALL satisfy the published schema

#### Scenario: Alias without an effective name is rejected

- **WHEN** a disposition declares `aliased` but omits its effective name
- **THEN** the disposition SHALL NOT satisfy the published schema

#### Scenario: Non-aliased disposition carrying a name is rejected

- **WHEN** an `authored` or `omitted` disposition also carries an effective name
- **THEN** the disposition SHALL NOT satisfy the published schema

#### Scenario: Invalid effective name is rejected

- **WHEN** an aliased disposition uses `Review`, `review/code`, `-review`, or another name outside the current asset-name grammar
- **THEN** the disposition SHALL NOT satisfy the published schema
- **AND** the name SHALL NOT be normalized or sanitized

#### Scenario: Authored is not a project override

- **WHEN** a project-manifest override explicitly declares `authored`
- **THEN** the override SHALL NOT satisfy the published project-manifest schema
- **AND** authored materialization SHALL be expressed by omitting the override

## MODIFIED Requirements

### Requirement: A project manifest schema is published as part of the protocol

The shape of a project manifest (`facets.json`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a project manifest SHALL conform to the published schema. The schema SHALL define exact format-version dispatch, how facet sources and version specifiers are expressed, how compact and expanded facet entries are distinguished, and how per-asset materialization overrides are declared.

Version selection SHALL recognize exactly two supported forms: a document without `manifestVersion` SHALL be interpreted only under the legacy unversioned schema, and a document declaring numeric `manifestVersion: 0.1` SHALL be interpreted only under the current schema. Any other explicit value SHALL be rejected with structured data identifying the observed and supported versions. A document that fails its selected schema SHALL NOT be retried under another schema, and its version SHALL NOT be inferred from the remaining shape.

Every legacy unversioned facet entry MUST be a compact source string. Under the current `0.1` schema, an entry SHALL be either a compact source string or an expanded object containing `source` and a non-empty `materialization` object. Materialization overrides SHALL be grouped into optional `skills`, `commands`, and `agents` maps keyed by authored asset name. Each value SHALL be an `aliased` or `omitted` disposition. Alias values MUST satisfy the current single-segment asset-name grammar; authored keys MUST remain safe to address, including for supported legacy assets.

The compact string SHALL be canonical when a facet has no overrides. A producer SHALL preserve `manifestVersion`, sources, and overrides it does not intentionally change, SHALL preserve overrides when changing a facet's source, and SHALL collapse an expanded entry to its compact source only after its final override is removed. An override naming an asset absent from a resolved facet SHALL remain schema-valid because document validation SHALL NOT require source resolution.

A project-manifest JSON document containing duplicate object member names SHALL be rejected before version dispatch and schema validation.

#### Scenario: A consumer interprets a project manifest correctly

- **WHEN** a system reads a `facets.json` containing facet sources and version specifiers
- **THEN** the system SHALL interpret each source under the selected schema
- **AND** ambiguous interpretations SHALL be rejected with a structured error

#### Scenario: A producer writes a project manifest conforming to the schema

- **WHEN** a system adds a new facet to a project's `facets.json`
- **THEN** the resulting file SHALL satisfy the current schema
- **AND** it SHALL declare `manifestVersion: 0.1`
- **AND** another facet-compatible system SHALL accept it after validation

#### Scenario: Legacy unversioned compact manifest is accepted

- **WHEN** a manifest omits `manifestVersion` and every facet value is a source string
- **THEN** the system SHALL accept it under the legacy unversioned schema

#### Scenario: Expanded legacy entry is rejected

- **WHEN** a manifest omits `manifestVersion` and contains an expanded facet entry
- **THEN** the system SHALL reject it
- **AND** the system SHALL NOT reinterpret it as current

#### Scenario: Current manifest version is selected exactly

- **WHEN** a manifest declares numeric `manifestVersion: 0.1`
- **THEN** the system SHALL validate it only under the current schema

#### Scenario: Unsupported manifest version is structured

- **WHEN** a manifest declares `manifestVersion: 0.2`
- **THEN** the system SHALL reject it with structured data identifying `0.2` and the supported versions

#### Scenario: Expanded entry records typed overrides

- **WHEN** a current manifest records an alias for skill `review` and an omission for command `deploy`
- **THEN** the system SHALL associate each override with its facet, asset type, and authored name

#### Scenario: Compact entry is canonical without overrides

- **WHEN** a current manifest producer emits a facet with no materialization override
- **THEN** the facet value SHALL be its compact source string
- **AND** the document SHALL retain `manifestVersion: 0.1`

#### Scenario: Source update preserves overrides

- **WHEN** a producer changes the source of a facet whose expanded entry has overrides
- **THEN** the new entry SHALL preserve every existing override for that facet

#### Scenario: Absent authored asset does not invalidate the document

- **WHEN** an override names an asset absent from the resolved facet version
- **THEN** the project manifest SHALL still satisfy its schema

#### Scenario: Duplicate members are rejected

- **WHEN** a `facets.json` document contains a duplicate facet or override member
- **THEN** the system SHALL reject it before version dispatch and schema validation

### Requirement: A lockfile schema is published as part of the protocol

The shape of a lockfile (`facets.lock`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a lockfile SHALL conform to the published schema. The schema SHALL define the lockfile version, source-provenance fields, identity-and-integrity fields, the complete authored asset list, each asset's materialization disposition and canonical file-integrity records, and the rules for unrecognized fields.

Version dispatch SHALL use exact equality. Numeric `1` SHALL identify only the earliest alpha schema, numeric `0.2` SHALL identify only the preceding schema, and numeric `0.3` SHALL identify only the current schema. A malformed document SHALL NOT be retried under another version, and an unsupported version SHALL be rejected with structured observed and supported values. Project-manifest, lockfile, archive, and adapter-contract versions SHALL be interpreted independently. Duplicate lockfile members SHALL be rejected before schema validation.

The published API SHALL expose each supported lockfile version through its exact schema and type plus a closed union derived from those exact readers. It SHALL NOT expose an unpinned numeric-version schema or identity-only compatibility type as a substitute for the supported union: such a type would admit mixed states whose declared version and asset shape disagree. Current writer types SHALL describe only `0.3`.

The published source provenance SHALL remain tagged by source kind: registry records the registry origin, git records the repository URL and required resolved commit, and local records the resolved path. A source missing a required field SHALL NOT satisfy the schema; a source MAY carry unrecognized keys.

Every `0.3` asset entry SHALL record `scope`, `type`, authored `name`, a required materialization disposition, and a required `files` array sorted by canonical path. Each file record SHALL contain exactly the canonical inner-archive path derived from the authored name and its `sha256:<hex>` integrity. Aliased and omitted dispositions SHALL NOT change those paths or hashes. An omitted asset SHALL remain in the lockfile with all authored file records. Skill companions SHALL remain subordinate records, and archive-only supplementary files SHALL NOT appear in an asset's files.

Every `0.2` asset entry SHALL retain its preceding `{ scope, type, name, files }` shape and SHALL be understood as materialized under its authored name. Materialization dispositions SHALL be recognized only in `0.3`.

#### Scenario: A consumer interprets a lockfile written by a different system

- **WHEN** a system reads a `facets.lock` written by another facet-compatible system
- **THEN** it SHALL interpret every field under the declared schema
- **AND** it SHALL accept the lockfile as valid installation input

#### Scenario: A producer writes a reproducible lockfile

- **WHEN** a system writes `facets.lock` after resolving sources and materialization intent
- **THEN** the file SHALL satisfy the published schema
- **AND** another conforming system SHALL reproduce the same effective asset set

#### Scenario: Source provenance is tagged by kind

- **WHEN** a system reads source provenance from a lockfile entry
- **THEN** the source SHALL declare its kind as registry, git, or local
- **AND** a registry source SHALL record the registry origin and SHALL NOT carry a version specifier
- **AND** a git source SHALL record the repository URL and a required resolved commit, and SHALL NOT record a symbolic ref
- **AND** a local source SHALL record the resolved path

#### Scenario: Git source without a commit is rejected

- **WHEN** a git source records a URL but no resolved commit
- **THEN** the lockfile SHALL NOT satisfy the published schema
- **AND** the system SHALL reject the lockfile

#### Scenario: Source with unrecognized keys is accepted

- **WHEN** a recognized source carries every required field plus unrecognized keys
- **THEN** the lockfile SHALL satisfy the published schema
- **AND** the system SHALL accept the lockfile

#### Scenario: Current skill entry lists every authored file

- **WHEN** a `0.3` lockfile records skill `review` with companions `references/api.md` and `scripts/run.ts`
- **THEN** its sorted `files` array SHALL contain `skills/review/SKILL.md`, `skills/review/references/api.md`, and `skills/review/scripts/run.ts`
- **AND** each record SHALL contain a canonical authored path and `sha256:<hex>` integrity
- **AND** the entry SHALL declare a materialization disposition

#### Scenario: Single-file assets list one file

- **WHEN** a `0.3` lockfile records agent `reviewer` and command `review`
- **THEN** each asset's `files` array SHALL contain exactly its authored conventional primary path

#### Scenario: Aliased asset retains authored records

- **WHEN** skill `review` is recorded as aliased to `vendor-review`
- **THEN** its `name` SHALL remain `review`
- **AND** its files SHALL remain under canonical `skills/review/` paths
- **AND** its disposition SHALL record `vendor-review`

#### Scenario: Omitted asset remains recorded

- **WHEN** command `deploy` is recorded as omitted
- **THEN** its lockfile asset entry SHALL remain present with `commands/deploy.md` and its integrity

#### Scenario: Missing current disposition is rejected

- **WHEN** a `0.3` asset entry omits its materialization disposition
- **THEN** the lockfile SHALL NOT satisfy the published schema

#### Scenario: Archive-only file is excluded

- **WHEN** a verified facet contains root `README.md`
- **THEN** no `0.2` or `0.3` asset entry SHALL list it

#### Scenario: Legacy alpha is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 1`
- **THEN** it SHALL be interpreted only under the earliest alpha schema
- **AND** the system SHALL NOT reinterpret its shape as `0.3`

#### Scenario: Previous version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.2`
- **THEN** it SHALL be interpreted only under the preceding schema
- **AND** every asset SHALL be understood as materialized under its authored name
- **AND** the system SHALL NOT reinterpret its shape as `0.3`

#### Scenario: Malformed current lockfile is not reinterpreted

- **WHEN** a lockfile declares `lockfileVersion: 0.3` but violates the current schema
- **THEN** it SHALL be rejected without fallback to `0.2` or `1`

#### Scenario: Supported aggregate remains version-discriminated

- **WHEN** a protocol consumer accepts any supported lockfile
- **THEN** its declared version SHALL discriminate the corresponding legacy `1`, previous `0.2`, or current `0.3` payload
- **AND** a `0.3` version paired with identity-only or disposition-less assets SHALL NOT be representable as validated supported state

#### Scenario: Unsupported version is structured

- **WHEN** a lockfile declares an unsupported version
- **THEN** it SHALL be rejected with structured observed and supported versions
