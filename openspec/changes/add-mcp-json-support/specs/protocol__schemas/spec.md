## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: A server manifest schema is published as part of the protocol

**Reason**: The standalone server artifact, source-mode, and ref-mode contract was speculative and had no publishing, resolution, or runtime implementation.

**Migration**: Authors SHALL declare concrete project-scoped MCP server connections inside a facet's `servers` map. There is no standalone `server.json` replacement in this release.
