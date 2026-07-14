## MODIFIED Requirements

### Requirement: A facet manifest schema is published as part of the protocol

The shape of a facet manifest (`facet.json`) SHALL be published as a normative schema. Any system that produces a facet manifest SHALL produce one conforming to the published schema. Any system that consumes a facet manifest SHALL validate it against the published schema before treating any value as trusted. The schema SHALL define the required fields, the permitted shapes for skills/agents/commands, the accepted facet identity grammar, the accepted asset-name grammar, the supplementary-file declarations, the optional facet privacy declaration, and the rules for unrecognized fields.

A facet identity name SHALL be either an unscoped name (`<slug>`) or a scoped name (`@<scope>/<slug>`). Each `slug` and `scope` component SHALL satisfy the same component grammar: it MUST be at least 2 characters and at most 64 characters, MUST start with a lowercase ASCII letter, MUST end with a lowercase ASCII letter or ASCII digit, MUST contain only lowercase ASCII letters, ASCII digits, and hyphens, and MUST NOT contain consecutive hyphens. Uppercase letters, non-ASCII characters, underscores, dots, spaces, plus signs, tildes, emoji, and any other character outside the component grammar SHALL be rejected rather than normalized. A facet manifest whose `name` is malformed SHALL be rejected as invalid.

An asset name (skill, command, or agent) in a current-format manifest SHALL be a single segment following the Agent Skills `name` field convention, normatively interpreted as ASCII: 1–64 lowercase ASCII letters (`a-z`), digits (`0-9`), or hyphens, MUST NOT start or end with a hyphen, and MUST NOT contain consecutive hyphens. `/` SHALL be invalid in every asset name. The same grammar SHALL apply to all three asset types. Skill names and command names SHALL occupy one logical namespace: a manifest declaring a skill and a command with the same name SHALL be rejected with a structured error identifying both declarations. Agent names SHALL remain a separate namespace and MAY equal a skill or command name. Asset names SHALL remain local asset identifiers and SHALL NOT become scoped names. Published naming documentation SHALL identify the Agent Skills `name` convention as the external convention being implemented.

The schema SHALL define two supplementary-file declaration sites, each enumerating exact relative paths (no patterns):

- an optional top-level `files` list of repo-relative paths for archive-only supplementary files (for example `README.md`, `LICENSE`); entries MUST NOT resolve under `skills/`;
- an optional per-skill `files` list of paths relative to that skill's directory, declaring companion files that install and remove with the skill; entries MUST NOT name the skill's primary file and MUST resolve below the skill's directory.

The facet manifest schema SHALL define an optional top-level `private` field. When present, `private` SHALL be a boolean. A manifest with `private: true` SHALL express the author's intent that the facet is private. A manifest with `private: false`, or with no `private` field, SHALL express public-by-default behavior. Validation SHALL NOT inject `private: false` into a manifest that omits the field; omission remains omission in validated data. Values of any non-boolean type SHALL be rejected rather than treated as unknown extension data or coerced to booleans.

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

#### Scenario: A consumer accepts valid supplementary-file declarations

- **WHEN** a system receives a `facet.json` declaring top-level `files: ["README.md", "LICENSE"]` and a skill whose `files` list contains `references/api.md` and `scripts/run.ts`
- **THEN** the system SHALL accept the manifest as valid
- **AND** the accepted declarations SHALL remain exact paths without expansion or normalization

#### Scenario: A consumer rejects a slash-containing asset name in a current-format manifest

- **WHEN** a system receives a current-format `facet.json` declaring a skill, command, or agent whose name contains `/` (for example `tools/review`)
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL surface a structured error identifying the malformed asset name

#### Scenario: A consumer rejects asset names outside the single-segment grammar

- **WHEN** a system receives a current-format `facet.json` declaring an asset named `-review`, `review-`, `re--view`, `Review`, or a name longer than 64 characters
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL surface a structured error identifying the malformed asset name

#### Scenario: A consumer rejects a skill/command name collision

- **WHEN** a system receives a `facet.json` declaring both a skill named `review` and a command named `review`
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the structured error SHALL identify both colliding declarations

#### Scenario: An agent may share a name with a skill

- **WHEN** a system receives a `facet.json` declaring both a skill named `review` and an agent named `review`
- **THEN** the system SHALL accept the manifest as valid

#### Scenario: A consumer accepts omitted public privacy declaration

- **WHEN** a system receives a `facet.json` with no `private` field
- **THEN** the system SHALL accept the manifest as public by default
- **AND** validation SHALL NOT add a `private` field to the accepted manifest data

#### Scenario: A consumer accepts explicit public privacy declaration

- **WHEN** a system receives a `facet.json` with `private: false`
- **THEN** the system SHALL accept the manifest as explicitly public
- **AND** the accepted manifest SHALL preserve `private: false`

#### Scenario: A consumer accepts private privacy declaration

- **WHEN** a system receives a `facet.json` with `private: true`
- **THEN** the system SHALL accept the manifest as declaring private publish intent
- **AND** the accepted manifest SHALL preserve `private: true`

#### Scenario: A consumer rejects non-boolean privacy declaration

- **WHEN** a system receives a `facet.json` whose `private` field is a string, number, object, array, or null
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL surface a structured error indicating that `private` must be boolean

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

### Requirement: A build manifest schema is published as part of the protocol

The shape of a build manifest (`build-manifest.json`) embedded inside a `.facet` archive SHALL be published as a normative, versioned schema. Any system that produces a `.facet` archive SHALL include a build manifest conforming to the schema for the archive format version it emits. Any system that consumes a `.facet` archive SHALL validate the embedded build manifest against the schema for its declared version before trusting its values.

The current archive format version SHALL be `0.2`. A `0.2` build manifest SHALL declare `facetVersion: 0.2`, the inner archive name, the integrity hash, and a single `files` object mapping every inner-archive entry path — the facet manifest, every primary asset file, and every supplementary file — to its `sha256:<hex>` content hash. The `files` map SHALL carry hashes only: whether an entry is an asset or a supplementary file SHALL be derived from the embedded facet manifest, never from the build manifest. A `0.2` build manifest SHALL NOT contain the legacy `assets` map.

The legacy archive format version `0.1` (with its per-asset `assets` map) SHALL remain published as a legacy input format during the compatibility window. Consumers SHALL dispatch on the declared `facetVersion` exactly once: the legacy schema and rules apply to `0.1`, the current schema and rules apply to `0.2`, and any other version SHALL produce a structured unsupported-version failure carrying the observed version and the supported versions. A malformed manifest of one version SHALL NOT be reinterpreted under another version's schema.

#### Scenario: A producer embeds a conforming current-format build manifest

- **WHEN** a system produces a `.facet` archive
- **THEN** the embedded `build-manifest.json` SHALL declare `facetVersion: 0.2`
- **AND** the manifest SHALL declare the inner archive name, the integrity hash, and a `files` map covering every inner-archive entry
- **AND** the manifest SHALL NOT contain an `assets` map

#### Scenario: A consumer rejects an archive whose build manifest violates its declared schema

- **WHEN** a system receives a `.facet` archive whose `build-manifest.json` is missing a required field for its declared version or has a malformed integrity value
- **THEN** the system SHALL reject the archive as invalid
- **AND** the system SHALL surface a structured error identifying the violation
- **AND** the system SHALL NOT attempt to reinterpret the manifest under a different version's schema

#### Scenario: A consumer rejects a version-schema mismatch

- **WHEN** a system receives a `.facet` archive whose build manifest declares `facetVersion: 0.2` but contains an `assets` map, or declares `facetVersion: 0.1` but contains a `files` map
- **THEN** the system SHALL reject the archive as invalid
- **AND** the system SHALL surface a structured error identifying the violation

#### Scenario: An unsupported archive format version is a structured failure

- **WHEN** a system receives a `.facet` archive whose build manifest declares a `facetVersion` that is neither `0.1` nor `0.2`
- **THEN** the system SHALL produce a structured unsupported-version failure
- **AND** the failure SHALL carry the observed version and the versions the system supports

#### Scenario: A legacy build manifest remains valid during the compatibility window

- **WHEN** a system receives a `.facet` archive whose build manifest declares `facetVersion: 0.1` and conforms to the legacy schema
- **THEN** the system SHALL accept the build manifest under the legacy schema and rules

### Requirement: A lockfile schema is published as part of the protocol

The shape of a lockfile (`facets.lock`) SHALL be published as a normative, versioned schema. Any system that reads, writes, or interprets a lockfile SHALL conform to the published schema. The schema SHALL define the lockfile version, source-provenance fields, identity-and-integrity fields, the asset list with per-file integrity records, and the rules for unrecognized fields.

The current lockfile version SHALL be `0.2`. Version dispatch SHALL use exact equality, never numeric ordering: the legacy numeric version `1` identifies the previous schema, and `0.2` identifies the current schema. In a `0.2` lockfile, every asset entry SHALL carry its adapter-agnostic identity plus a required, deterministically sorted `files` array of `{ path, integrity }` records, where `path` is the canonical inner-archive path of a materialized file and `integrity` is the `sha256:<hex>` hash of that archive entry's exact canonical bytes. A skill entry's `files` SHALL contain the skill's primary file plus every declared companion file. An agent or command entry's `files` SHALL contain exactly its one primary file. Archive-only supplementary files SHALL NOT appear in any asset's `files`; they remain protected by the entry's facet-level integrity. Companion records SHALL NOT be independent assets: they carry no scope, no asset type, and no standalone asset tuple.

The published schema's source-provenance fields SHALL take a tagged form keyed on the source kind, so that the provenance fields meaningful for each kind are explicit. The published schema SHALL define a registry source that records the registry origin, a git source that records the repository URL and a required resolved commit, and a local source that records the resolved path. A lockfile whose entry source does not declare a recognized kind, or omits a field required for its declared kind (such as a git source without a commit), SHALL NOT satisfy the published schema. Consistent with the lockfile's tolerance of unrecognized fields, a source MAY carry additional unrecognized keys and still satisfy the published schema — forward-compatibility requires that a newer producer's extra fields not break an older consumer.

#### Scenario: A consumer interprets a lockfile written by a different system

- **WHEN** a system reads a `facets.lock` written by a different facet-compatible system
- **THEN** the system SHALL interpret every field per the published schema for the lockfile's declared version
- **AND** the system SHALL accept the lockfile as valid input for installation

#### Scenario: A producer writes a lockfile that any consumer can read

- **WHEN** a system writes a `facets.lock` after resolving facet sources
- **THEN** the resulting file SHALL declare `lockfileVersion: 0.2` and satisfy the published schema
- **AND** another facet-compatible system SHALL be able to read the file and reproduce the same install state

#### Scenario: A skill asset entry pins its primary and companion files

- **WHEN** a system writes a `0.2` lockfile entry for a facet whose skill `review` declares companion files
- **THEN** the skill's asset entry SHALL contain a `files` array listing the skill's primary file and every declared companion path with its `sha256:<hex>` integrity
- **AND** the `files` array SHALL be deterministically sorted

#### Scenario: Single-file assets pin exactly one file

- **WHEN** a system writes a `0.2` lockfile entry containing an agent or command asset
- **THEN** that asset's `files` array SHALL contain exactly one record naming the asset's primary file and its integrity

#### Scenario: Archive-only supplementary files never appear as asset file records

- **WHEN** a system writes a `0.2` lockfile entry for a facet that ships a root `README.md` or other archive-only supplementary file
- **THEN** no asset entry's `files` array SHALL contain that path
- **AND** the facet entry's facet-level integrity SHALL remain the record that pins it

#### Scenario: An asset entry missing its file records is rejected

- **WHEN** a system reads a `0.2` lockfile in which an asset entry omits its `files` array
- **THEN** the lockfile SHALL NOT satisfy the published schema
- **AND** the system SHALL reject the lockfile

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
