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

The shape of a project manifest (`facets.json`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a project manifest SHALL conform to the published schema. The schema SHALL define exact format-version dispatch, how facet sources and version specifiers are expressed, how compact and expanded facet entries are distinguished, and how per-contribution materialization overrides are declared.

Version selection SHALL recognize exactly three supported forms: a document without `manifestVersion` SHALL be interpreted only under the legacy unversioned schema, numeric `manifestVersion: 0.1` SHALL be interpreted only under the preceding schema, and numeric `manifestVersion: 0.2` SHALL be interpreted only under the current schema. Any other explicit value SHALL be rejected with structured data identifying the observed and supported versions. A document that fails its selected schema SHALL NOT be retried under another schema, and its version SHALL NOT be inferred from the remaining shape.

Every legacy unversioned facet entry MUST be a compact source string. Under the supported versioned schemas, an entry SHALL be either a compact source string or an expanded object containing `source` and a non-empty `materialization` object. Materialization overrides SHALL be grouped into optional `skills`, `commands`, `agents`, and, in `0.2`, `servers` maps keyed by authored name. Each value SHALL be an `aliased` or `omitted` disposition. Alias values MUST satisfy the current single-segment asset-name grammar; authored keys MUST remain safe to address, including for supported legacy assets.

A materialization object SHALL NOT declare any group outside the set recognized by its selected version. An undeclared group SHALL be rejected rather than retained and ignored, including when declared alongside recognized groups, so a misspelled group name cannot silently discard the intent it carries.

The compact string SHALL be canonical when a facet has no overrides. A producer SHALL preserve `manifestVersion`, sources, and overrides it does not intentionally change, SHALL preserve overrides when changing a facet's source, and SHALL collapse an expanded entry to its compact source only after its final override is removed. An override naming an asset or server absent from a resolved facet SHALL remain schema-valid because document validation SHALL NOT require source resolution.

A project-manifest JSON document containing duplicate object member names SHALL be rejected before version dispatch and schema validation.

#### Scenario: A consumer interprets a project manifest correctly

- **WHEN** a system reads a `facets.json` containing facet sources and version specifiers
- **THEN** the system SHALL interpret each source under the selected schema
- **AND** ambiguous interpretations SHALL be rejected with a structured error

#### Scenario: A producer writes a project manifest conforming to the schema

- **WHEN** a system adds a new facet to a project's `facets.json`
- **THEN** the resulting file SHALL satisfy the current schema
- **AND** it SHALL declare `manifestVersion: 0.2`
- **AND** another facet-compatible system SHALL accept it after validation

#### Scenario: Legacy unversioned compact manifest is accepted

- **WHEN** a manifest omits `manifestVersion` and every facet value is a source string
- **THEN** the system SHALL accept it under the legacy unversioned schema

#### Scenario: Expanded legacy entry is rejected

- **WHEN** a manifest omits `manifestVersion` and contains an expanded facet entry
- **THEN** the system SHALL reject it
- **AND** the system SHALL NOT reinterpret it as current

#### Scenario: Current manifest version is selected exactly

- **WHEN** a manifest declares numeric `manifestVersion: 0.2`
- **THEN** the system SHALL validate it only under the current schema

#### Scenario: Previous manifest version remains readable

- **WHEN** a manifest declares numeric `manifestVersion: 0.1`
- **THEN** the system SHALL validate it only under the preceding schema
- **AND** the system SHALL NOT infer current server dispositions from its shape

#### Scenario: Unsupported manifest version is structured

- **WHEN** a manifest declares `manifestVersion: 0.3`
- **THEN** the system SHALL reject it with structured data identifying `0.3` and the supported versions

#### Scenario: Expanded entry records typed overrides

- **WHEN** a current manifest records an alias for skill `review`, an omission for command `deploy`, and an alias for server `filesystem`
- **THEN** the system SHALL associate each override with its facet, contribution kind, and authored name

#### Scenario: Undeclared override group is rejected

- **WHEN** a materialization object declares a `serverz` group, whether alone or alongside a valid `servers` group
- **THEN** the system SHALL reject the manifest
- **AND** the system SHALL NOT accept the document while ignoring the undeclared group

#### Scenario: Previous-version server group is rejected

- **WHEN** a `manifestVersion: 0.1` document declares `materialization.servers`
- **THEN** the system SHALL reject the manifest
- **AND** it SHALL NOT accept the document while ignoring the group

#### Scenario: Compact entry is canonical without overrides

- **WHEN** a current manifest producer emits a facet with no materialization override
- **THEN** the facet value SHALL be its compact source string
- **AND** the document SHALL retain `manifestVersion: 0.2`

#### Scenario: Source update preserves overrides

- **WHEN** a producer changes the source of a facet whose expanded entry has overrides
- **THEN** the new entry SHALL preserve every existing override for that facet

#### Scenario: Absent authored contribution does not invalidate the document

- **WHEN** an override names an asset or server absent from the resolved facet version
- **THEN** the project manifest SHALL still satisfy its schema

#### Scenario: Duplicate members are rejected

- **WHEN** a `facets.json` document contains a duplicate facet or override member
- **THEN** the system SHALL reject it before version dispatch and schema validation

### Requirement: A lockfile schema is published as part of the protocol

The shape of a lockfile (`facets.lock`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a lockfile SHALL conform to the published schema. The schema SHALL define the lockfile version, source-provenance fields, identity-and-integrity fields, the complete authored asset list, each asset's materialization disposition and canonical file-integrity records, and the rules for unrecognized fields.

Version dispatch SHALL use exact equality. Numeric `0.2` SHALL identify only the preceding schema, and numeric `0.3` SHALL identify only the current schema. Numeric `1` SHALL NOT identify any readable schema: it named a withdrawn closed-alpha shape and is reserved for a future stable v1, so a document declaring it SHALL be rejected as unsupported rather than reinterpreted from its remaining shape. A malformed document SHALL NOT be retried under another version, and an unsupported version SHALL be rejected with structured observed and supported values. Project-manifest, lockfile, archive, and adapter-contract versions SHALL be interpreted independently. Duplicate lockfile members SHALL be rejected before schema validation.

The published API SHALL expose each supported lockfile version through its exact schema and type plus a closed union derived from those exact readers. It SHALL NOT expose an unpinned numeric-version schema or identity-only compatibility type as a substitute for the supported union: such a type would admit mixed states whose declared version and asset shape disagree. Current writer types SHALL describe only `0.3`.

The published source provenance SHALL remain tagged by source kind: registry records the registry origin, git records the repository URL and required resolved commit, and local records the resolved path. A source missing a required field SHALL NOT satisfy the schema; a source MAY carry unrecognized keys.

Every `0.3` asset entry SHALL record `scope`, `type`, authored `name`, a required materialization disposition, and a required `files` array sorted by canonical path. Each file record SHALL contain exactly the canonical inner-archive path derived from the authored name and its `sha256:<hex>` integrity. Aliased and omitted dispositions SHALL NOT change those paths or hashes. An omitted asset SHALL remain in the lockfile with all authored file records. Skill companions SHALL remain subordinate records, and archive-only supplementary files SHALL NOT appear in an asset's files.

Every `0.2` asset entry SHALL retain its preceding `{ scope, type, name, files }` shape and SHALL be understood as materialized under its authored name. Materialization dispositions SHALL be recognized only in `0.3`.

In both `0.2` and `0.3`, an asset's file records SHALL be derived from its own authored type and name rather than merely being safe, sorted paths. An agent or command entry SHALL contain exactly one record, whose path is that asset's canonical primary path. A skill entry SHALL contain its canonical `SKILL.md` record, and every record it contains SHALL lie beneath that skill's authored root. A record that no derivation from the asset's authored identity could produce SHALL be rejected, so ownership and integrity can never be associated with an unrelated archive file.

Unrecognized fields SHALL be tolerated and SHALL survive reconstruction, not merely loading. A producer rewriting a lockfile SHALL carry forward the unrecognized fields of every top-level document, facet entry, source value of unchanged kind, asset entry matched by authored identity, and file record matched by path. Where a schema-defined field and an unrecognized field share a name, the schema-defined value SHALL win. Unrecognized fields belonging to a facet, asset, or file record that the new state no longer contains SHALL be dropped with it.

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

#### Scenario: Unrelated file path is rejected

- **WHEN** a `0.2` or `0.3` lockfile records command `deploy` with a safe, sorted file record for `README.md`
- **THEN** the lockfile SHALL NOT satisfy the published schema
- **AND** the rejection SHALL identify the record as not derived from the asset's authored identity

#### Scenario: Extra file on a single-file asset is rejected

- **WHEN** an agent entry records its canonical primary path plus a second file record
- **THEN** the lockfile SHALL NOT satisfy the published schema

#### Scenario: Companion outside the authored skill root is rejected

- **WHEN** skill `review` records a file under another skill's root, or omits its canonical `SKILL.md`
- **THEN** the lockfile SHALL NOT satisfy the published schema

#### Scenario: Unrecognized fields survive a rewrite

- **WHEN** a producer rewrites a lockfile whose document, facet entry, source, asset entry, and file record each carry an unrecognized field
- **THEN** every unrecognized field SHALL be present in the rewritten document
- **AND** an unrecognized field sharing a schema-defined field's name SHALL NOT displace the schema-defined value
- **AND** unrecognized fields of a facet, asset, or file record the new state no longer contains SHALL be dropped with it

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

#### Scenario: Withdrawn alpha version is rejected

- **WHEN** a lockfile declares numeric `lockfileVersion: 1`
- **THEN** the system SHALL reject it as an unsupported version
- **AND** the system SHALL NOT interpret it under any readable schema
- **AND** the system SHALL NOT reinterpret its shape as `0.2` or `0.3`

#### Scenario: Previous version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.2`
- **THEN** it SHALL be interpreted only under the preceding schema
- **AND** every asset SHALL be understood as materialized under its authored name
- **AND** the system SHALL NOT reinterpret its shape as `0.3`

#### Scenario: Malformed current lockfile is not reinterpreted

- **WHEN** a lockfile declares `lockfileVersion: 0.3` but violates the current schema
- **THEN** it SHALL be rejected without fallback to `0.2`

#### Scenario: Supported aggregate remains version-discriminated

- **WHEN** a protocol consumer accepts any supported lockfile
- **THEN** its declared version SHALL discriminate the corresponding previous `0.2` or current `0.3` payload
- **AND** a `0.3` version paired with identity-only or disposition-less assets SHALL NOT be representable as validated supported state

#### Scenario: Unsupported version is structured

- **WHEN** a lockfile declares an unsupported version
- **THEN** it SHALL be rejected with structured observed and supported versions

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

### Requirement: Facet manifests declare MCP servers as concrete connection definitions

The published facet-manifest schema SHALL accept project-scoped MCP server declarations as a closed tagged union. A standard-input declaration SHALL require `type: "stdio"` and a non-empty `command`, MAY contain an ordered `args` array and a map of literal-string `env` assignments, and SHALL NOT contain fields from the HTTP arm. A Streamable HTTP declaration SHALL require `type: "http"` and an absolute `http:` or `https:` `url`, and SHALL NOT contain fields from the standard-input arm. Server names SHALL satisfy the current portable single-segment name grammar and SHALL occupy a namespace separate from text assets.

Environment names SHALL use a portable ASCII environment-name grammar that starts with an ASCII letter or underscore and continues with ASCII letters, digits, or underscores. Declaration values SHALL remain literal; the schema SHALL NOT define headers, credentials, OAuth, variable substitution, working directories, shell behavior, or tool-specific policy.

#### Scenario: Valid standard-input declaration is accepted

- **WHEN** a current facet manifest declares server `filesystem` with `type: "stdio"`, a non-empty command, ordered arguments, and literal environment assignments
- **THEN** the system SHALL accept the declaration and preserve the argument order and environment values

#### Scenario: Valid Streamable HTTP declaration is accepted

- **WHEN** a current facet manifest declares server `docs` with `type: "http"` and an absolute `https:` URL
- **THEN** the system SHALL accept the declaration

#### Scenario: Cross-arm declaration is rejected

- **WHEN** an HTTP declaration also contains `command` or a standard-input declaration contains `url`
- **THEN** the system SHALL reject the declaration with a structured error identifying the server and conflicting field

#### Scenario: Invalid command and URL are rejected

- **WHEN** a standard-input declaration has an empty command or an HTTP declaration uses a relative, `file:`, `ws:`, or `wss:` URL
- **THEN** the system SHALL reject the declaration and identify the invalid field

#### Scenario: Invalid server or environment name is rejected

- **WHEN** a server name contains uppercase letters, a slash, an underscore, or an invalid hyphen placement, or an environment name begins with a digit or contains a hyphen
- **THEN** the system SHALL reject the manifest without normalizing the invalid name

#### Scenario: Server and text asset may share a name

- **WHEN** a manifest declares both a server and a skill named `review`
- **THEN** the system SHALL accept the shared name because their materialization identities are separate

### Requirement: MCP server declaration objects reject unrecognized members

The published schema SHALL reject every member not defined by the selected MCP server declaration arm. This closed-object rule SHALL be an explicit exception to the manifest's general unrecognized-field tolerance so execution-affecting values cannot be ignored by one consumer and interpreted by another.

#### Scenario: Unsupported execution field is rejected

- **WHEN** a server declaration contains `headers`, `cwd`, `shell`, or another unrecognized member
- **THEN** the system SHALL reject the manifest and identify the server and unsupported member

#### Scenario: Top-level extension remains tolerated

- **WHEN** the same manifest contains an unrecognized top-level field but every server declaration contains only recognized members
- **THEN** the system SHALL accept and preserve the top-level extension

### Requirement: Concrete MCP declarations may be a facet's only deliverable

A current facet manifest SHALL satisfy its minimum-content rule when it declares at least one concrete MCP server, even when it declares no skill, agent, command, or composed facet. MCP declarations SHALL contribute no content-archive entry of their own because the embedded facet manifest is their integrity-protected representation.

#### Scenario: Server-only facet is valid

- **WHEN** a current facet manifest contains valid identity fields and one concrete MCP server but no text asset or composed facet
- **THEN** the system SHALL accept the manifest
- **AND** building it SHALL add no server-specific archive entry

### Requirement: Speculative server references are rejected in every manifest format

The published current schema SHALL reject version-string and `{ image }` server references. The legacy `0.1` facet-manifest schema SHALL explicitly reject any `servers` member while continuing to accept legacy text-asset manifests that do not contain one. A manifest selected as current SHALL NOT be retried under legacy validation.

#### Scenario: Current string reference is rejected

- **WHEN** a current facet manifest declares a server as a version string
- **THEN** the system SHALL reject the manifest without legacy fallback

#### Scenario: Current image reference is rejected

- **WHEN** a current facet manifest declares a server as an object containing `image`
- **THEN** the system SHALL reject the manifest

#### Scenario: Legacy archive with servers is rejected

- **WHEN** a legacy `0.1` archive embeds a facet manifest containing any `servers` member
- **THEN** the system SHALL reject the archive as invalid rather than installing with a warning

#### Scenario: Legacy text-only archive remains supported

- **WHEN** a valid legacy `0.1` archive contains text assets and no `servers` member
- **THEN** the system SHALL continue validating it under the legacy text-asset contract

### Requirement: MCP server declarations have a canonical semantic fingerprint

The protocol SHALL define a deterministic semantic fingerprint for an MCP server declaration. The fingerprint SHALL preserve the tagged declaration kind and argument order, sort environment keys, and treat omitted `args` or `env` collections as equivalent to empty collections. Authored and effective server names SHALL NOT be part of the declaration fingerprint.

#### Scenario: Environment order does not change the fingerprint

- **WHEN** two standard-input declarations differ only in the order of their environment members
- **THEN** the system SHALL produce the same fingerprint for both declarations

#### Scenario: Empty optional collections equal omission

- **WHEN** one declaration omits `args` and `env` and another declares `args: []` and `env: {}`
- **THEN** the system SHALL produce the same fingerprint for both declarations

#### Scenario: Argument order changes the fingerprint

- **WHEN** two declarations contain the same arguments in different orders
- **THEN** the system SHALL produce different fingerprints

#### Scenario: Names do not change the declaration fingerprint

- **WHEN** the same declaration is authored or materialized under different server names
- **THEN** its declaration fingerprint SHALL remain unchanged

### Requirement: MCP declarations and dispositions remain outside the lockfile

The lockfile schema SHALL remain at `0.3` and SHALL NOT record MCP declarations, effective server names, server materialization dispositions, or server approval evidence. A facet's integrity SHALL continue committing to its embedded manifest, including concrete declarations. A server-only facet SHALL remain representable with an empty authored asset list.

#### Scenario: Server-only facet uses the unchanged lockfile shape

- **WHEN** a server-only facet is installed successfully
- **THEN** its lockfile entry SHALL record source, version, integrity, and an empty asset list
- **AND** the entry SHALL contain no server declaration or disposition

#### Scenario: Declaration drift changes facet integrity

- **WHEN** an integrity-protected declaration changes
- **THEN** the facet SHALL no longer reproduce the previously recorded integrity

### Requirement: Materialization dispositions use one published tagged shape

The protocol SHALL publish a materialization disposition with exactly three arms: `authored`, meaning the asset is materialized under its authored name; `aliased`, which MUST carry the effective name; and `omitted`, meaning the asset is not materialized. An aliased effective name MUST satisfy the current single-segment asset-name grammar and SHALL NOT change the asset's authored scope, type, archive paths, or integrity values.

An artifact that records project intent SHALL admit only the `aliased` and `omitted` arms because absence of an override means authored materialization.

An artifact that records the resolved asset set SHALL require one of all three arms, because that set stays comparable against project intent and therefore still lists what was deliberately not materialized. An artifact that records materialized on-disk state SHALL admit only the `authored` and `aliased` arms, because an omitted asset puts no bytes on disk; `omitted` SHALL be unrepresentable there rather than merely unused.

Illegal combinations, including an alias without an effective name or an effective name on another arm, SHALL be rejected.

#### Scenario: Valid aliased disposition

- **WHEN** a disposition declares `aliased` with effective name `vendor-review`
- **THEN** the disposition SHALL satisfy the published schema
- **AND** the authored asset identity SHALL remain unchanged

#### Scenario: Valid omitted disposition

- **WHEN** a disposition declares `omitted` without an effective name
- **THEN** the disposition SHALL satisfy the published schema

#### Scenario: Materialized-state artifact rejects omitted

- **WHEN** an artifact recording materialized on-disk state declares an `omitted` disposition
- **THEN** the disposition SHALL NOT satisfy that artifact's schema
- **AND** the same `omitted` disposition SHALL remain valid in an artifact recording the resolved asset set

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
