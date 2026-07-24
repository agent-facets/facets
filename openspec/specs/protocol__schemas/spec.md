## Purpose

Defines the published, normative schemas for the artifacts a facet-compatible system produces and consumes: facet manifest, project manifest, lockfile, build manifest, and server manifest.
## Requirements
### Requirement: A facet manifest schema is published as part of the protocol

The shape of a facet manifest (`facet.json`) SHALL be published as a normative schema. Any system that produces a facet manifest SHALL produce one conforming to the published schema. Any system that consumes a facet manifest SHALL validate it against the published schema before treating any value as trusted. The schema SHALL define the required fields, the permitted shapes for skills, agents, and commands, exact supplementary-file declarations, the accepted facet and asset identity grammars, the optional facet privacy declaration, and the rules for unrecognized fields.

A facet identity name SHALL be either an unscoped name (`<slug>`) or a scoped name (`@<scope>/<slug>`). Each `slug` and `scope` component SHALL satisfy the same component grammar: it MUST be at least 2 characters and at most 64 characters, MUST start with a lowercase ASCII letter, MUST end with a lowercase ASCII letter or ASCII digit, MUST contain only lowercase ASCII letters, ASCII digits, and hyphens, and MUST NOT contain consecutive hyphens. Uppercase letters, non-ASCII characters, underscores, dots, spaces, plus signs, tildes, emoji, and any other character outside the component grammar SHALL be rejected rather than normalized. A facet manifest whose `name` is malformed SHALL be rejected as invalid.

Current-format skill, agent, and command names SHALL implement the [Agent Skills `name` field convention](https://agentskills.io/specification#name-field) with the following normative ASCII interpretation: each name MUST contain 1–64 lowercase ASCII letters, digits, or hyphens; MUST NOT begin or end with a hyphen; MUST NOT contain consecutive hyphens; and MUST be a single segment without `/`. Skills and commands SHALL share one logical namespace and MUST NOT use the same name. Agents SHALL occupy a separate namespace and MAY share a name with a skill or command. Legacy `0.1` archives SHALL retain their legacy asset-name and namespace validation; an invalid current-format manifest SHALL NOT be reinterpreted under legacy rules.

The manifest schema SHALL define optional exact-path supplementary declarations at two sites. A top-level `files` array SHALL contain repository-relative paths for archive-only files and MUST NOT resolve under `skills/`. A skill descriptor's `files` array SHALL contain paths relative to that skill's directory, MUST NOT name `SKILL.md`, and MUST resolve below the skill directory. Both arrays SHALL contain exact paths only; glob or pattern declarations SHALL NOT be accepted.

Every declared supplementary path MUST be non-empty, relative, and canonical. It MUST NOT contain empty, `.` or `..` segments, backslashes, NUL bytes, or absolute, drive, or URL-like prefixes. Every path segment MUST be portable across supported filesystems: it MUST NOT contain control bytes or the characters `<`, `>`, `:`, `"`, `|`, `?`, `*`; MUST NOT equal a Windows-reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) case-insensitively, with or without an extension; and MUST NOT end with a dot or a space. The exact root path `facet.json` MUST NOT be declared, while that basename MAY be used below another directory. Supplementary paths MUST NOT collide with conventional primary-asset paths. The complete declared set MUST be free of exact duplicates, Unicode-normalization aliases, portable case-fold aliases, and file/directory prefix conflicts.

A consumer validating a facet manifest SHALL reject a JSON document containing duplicate object member names before schema validation, rather than allowing parser-dependent last-member-wins collapse to select which declaration is validated.

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

#### Scenario: Current-format asset names use one ASCII segment

- **WHEN** a current-format manifest declares assets named `review`, `review-2`, and `a`
- **THEN** the system SHALL accept those asset names

#### Scenario: Invalid current-format asset name is rejected

- **WHEN** a current-format manifest declares an asset named `review/code`, `-review`, `review-`, `review--code`, `Review`, or a name longer than 64 characters
- **THEN** the system SHALL reject the manifest
- **AND** the system SHALL identify the invalid asset declaration and naming constraint

#### Scenario: Skill and command names collide

- **WHEN** a current-format manifest declares both a skill named `review` and a command named `review`
- **THEN** the system SHALL reject the manifest
- **AND** the structured failure SHALL identify both declarations

#### Scenario: Agent may share a name with a skill

- **WHEN** a current-format manifest declares a skill named `review` and an agent named `review`
- **THEN** the system SHALL accept the shared name

#### Scenario: Supplementary declaration sites are disjoint

- **WHEN** a manifest declares `skills/review/references/api.md` in top-level `files`
- **THEN** the system SHALL reject the manifest
- **AND** the failure SHALL direct the declaration to the owning skill's `files` array

#### Scenario: Unsafe supplementary path is rejected

- **WHEN** a manifest declares `../secret`, `/absolute`, `C:\secret`, or `docs//guide.md`
- **THEN** the system SHALL reject the manifest
- **AND** the structured failure SHALL identify the unsafe path

#### Scenario: Portable declaration collision is rejected

- **WHEN** a manifest declares both `Docs/guide.md` and `docs/guide.md`, or both `docs` as a file and `docs/guide.md`
- **THEN** the system SHALL reject the manifest as colliding on supported filesystems

#### Scenario: Windows-reserved path component is rejected

- **WHEN** a manifest declares `references/con`, `aux.txt`, `notes:draft.md`, `report.` , or `draft `
- **THEN** the system SHALL reject the manifest
- **AND** the structured failure SHALL identify the non-portable path segment

#### Scenario: Duplicate manifest members are rejected

- **WHEN** a `facet.json` document contains the same object member name twice
- **THEN** the system SHALL reject the document before schema validation
- **AND** the system SHALL NOT silently validate whichever member a parser retains

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

The shape of a lockfile (`facets.lock`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a lockfile SHALL conform to the published schema. The schema SHALL define the lockfile version, source-provenance fields, identity-and-integrity fields, the asset list and its materialized-file integrity records, and the rules for unrecognized fields.

Version dispatch SHALL use exact equality rather than numeric ordering. Legacy numeric `1` SHALL identify only the previous alpha schema, and numeric `0.2` SHALL identify the current schema. Archive-format and lockfile-format versions SHALL be interpreted independently even when they have the same numeric value. A lockfile JSON document containing duplicate object member names SHALL be rejected before schema validation.

The published schema's source-provenance fields SHALL take a tagged form keyed on the source kind, so that the provenance fields meaningful for each kind are explicit. The published schema SHALL define a registry source that records the registry origin, a git source that records the repository URL and a required resolved commit, and a local source that records the resolved path. A lockfile whose entry source does not declare a recognized kind, or omits a field required for its declared kind, SHALL NOT satisfy the published schema. A source MAY carry additional unrecognized keys and still satisfy the published schema.

Every `0.2` asset entry SHALL record `scope`, `type`, and `name` plus a required `files` array sorted deterministically by canonical path. Each file record SHALL contain exactly the canonical inner-archive `path` and its `sha256:<hex>` `integrity` over canonical archive bytes. A skill entry SHALL list `skills/<name>/SKILL.md` and every declared companion below that skill. An agent entry SHALL list exactly `agents/<name>.md`; a command entry SHALL list exactly `commands/<name>.md`. Archive-only supplementary files SHALL NOT appear in an asset's `files` array, and companion files SHALL NOT appear as independent assets.

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

- **WHEN** a `0.2` lockfile records skill `review` with companions `references/api.md` and `scripts/run.ts`
- **THEN** the skill's sorted `files` array SHALL contain `skills/review/SKILL.md`, `skills/review/references/api.md`, and `skills/review/scripts/run.ts`
- **AND** each record SHALL contain a canonical path and `sha256:<hex>` integrity

#### Scenario: Single-file assets list one file

- **WHEN** a `0.2` lockfile records agent `reviewer` and command `review`
- **THEN** each asset's `files` array SHALL contain exactly its conventional primary path

#### Scenario: Archive-only file is excluded from asset records

- **WHEN** a verified facet contains a declared root `README.md`
- **THEN** no `0.2` asset entry SHALL list `README.md`

#### Scenario: Legacy alpha version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 1`
- **THEN** the system SHALL interpret it only with the previous alpha schema
- **AND** the system SHALL NOT reinterpret its shape as `0.2`

### Requirement: A build manifest schema is published as part of the protocol

The shape of a build manifest (`build-manifest.json`) embedded inside a `.facet` archive SHALL be published as a normative schema. Any system that produces a `.facet` archive SHALL include a build manifest conforming to the schema. Any system that consumes a `.facet` archive SHALL validate the embedded build manifest against the schema before trusting its values.

The build-manifest schema SHALL be selected by exact `facetVersion` equality. Legacy `0.1` manifests SHALL retain their legacy `assets` hash map. Current `0.2` manifests SHALL declare numeric `facetVersion: 0.2` exactly, SHALL declare `archive` with the exact literal value `"archive.tar.gz"`, and SHALL contain `integrity` and a `files` map from every canonical inner-archive path to its `sha256:<hex>` content hash; they SHALL NOT contain an `assets` map. Any other `archive` value SHALL fail schema validation, so producers and consumers cannot disagree about which outer-tar entry is authoritative. A build-manifest JSON document containing duplicate object member names SHALL be rejected before schema validation. The `files` key set SHALL exactly equal the observed inner-archive entry set and SHALL include the embedded `facet.json`, every primary asset, and every supplementary file. Entry classification SHALL be derived from the embedded facet manifest rather than the hash map.

A `files` key in a `0.1` build manifest or an `assets` key in a `0.2` build manifest SHALL fail schema validation. A malformed current manifest SHALL NOT be reinterpreted under a legacy schema. An unsupported version SHALL produce structured failure data containing the observed version and the supported versions.

#### Scenario: A producer embeds a conforming current build manifest

- **WHEN** a system produces a current `.facet` archive
- **THEN** the embedded `build-manifest.json` SHALL declare `facetVersion: 0.2`, `archive: "archive.tar.gz"`, the archive integrity, and one `files` hash for every inner-archive entry

#### Scenario: A consumer accepts a legacy build manifest

- **WHEN** a system receives a valid `0.1` build manifest with its legacy `assets` map
- **THEN** the system SHALL validate it under the `0.1` schema

#### Scenario: Current manifest rejects legacy hash-map shape

- **WHEN** a `0.2` build manifest contains an `assets` map instead of `files`
- **THEN** the system SHALL reject the manifest
- **AND** the system SHALL NOT retry validation as `0.1`

#### Scenario: Current file-hash set must be complete

- **WHEN** a `0.2` build manifest omits an observed inner-archive path or records a path absent from the inner archive
- **THEN** the system SHALL reject the archive as invalid

#### Scenario: Unsupported build-manifest version is structured

- **WHEN** a system receives a build manifest with `facetVersion: 0.3`
- **THEN** the system SHALL return structured failure data containing `0.3` and the supported versions

#### Scenario: Non-canonical archive entry name is rejected

- **WHEN** a `0.2` build manifest declares `archive: "payload.tar.gz"`
- **THEN** the system SHALL reject the manifest as violating the schema

#### Scenario: Duplicate build-manifest members are rejected

- **WHEN** a `build-manifest.json` document contains two `files` members
- **THEN** the system SHALL reject the document before schema validation
- **AND** the system SHALL NOT select either member's hash map

#### Scenario: A consumer rejects an archive whose build manifest violates the schema

- **WHEN** a system receives a `.facet` archive whose `build-manifest.json` is missing a required field or has malformed integrity
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

