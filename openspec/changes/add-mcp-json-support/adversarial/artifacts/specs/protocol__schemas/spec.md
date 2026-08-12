## ADDED Requirements

### Requirement: Facet manifests declare MCP servers as concrete portable declarations

The facet manifest schema SHALL define each `servers.<name>` value as exactly one of two concrete, portable declaration forms: a stdio declaration carrying a required `type: "stdio"` tag, a required non-empty `command`, an optional `args` array of strings, and an optional `env` map of literal string values; or a Streamable HTTP declaration carrying a required `type: "http"` tag and a required `url` that MUST be an absolute `http:` or `https:` URL.

Server names SHALL satisfy the current single-segment asset-name grammar so one key is portable across JSON, JSONC, and TOML documents. Environment variable names SHALL satisfy a portable ASCII environment-name grammar; environment values are literal strings with no substitution grammar. An optional empty `args` array and an optional empty `env` map SHALL each be semantically equivalent to omission when declarations are compared.

Declaration objects SHALL reject unknown members rather than tolerating them. This is an intentional exception to the manifest's general unknown-field tolerance: silently ignoring an execution-affecting member such as `headers`, `cwd`, or `shell` would let two consumers execute different configurations while both claimed validation success. Adding a portable field SHALL require an explicit schema revision.

Speculative server-reference forms — version strings and `{ image }` objects — SHALL NOT satisfy any supported manifest schema. The legacy `0.1` facet manifest schema SHALL reject the presence of a `servers` member entirely while retaining its existing text-asset contract. An invalid current-format manifest SHALL NOT be reinterpreted under legacy rules. A manifest whose only deliverables are server declarations SHALL satisfy the current schema's minimum-content rule; the legacy schema's minimum-content rule SHALL remain unchanged.

#### Scenario: Valid stdio declaration is accepted

- **WHEN** a current manifest declares a server with `type: "stdio"`, a non-empty `command`, ordered `args`, and an `env` map of literal strings with portable ASCII names
- **THEN** the system SHALL accept the declaration
- **AND** the declared argument order SHALL be preserved in validated data

#### Scenario: Valid HTTP declaration is accepted

- **WHEN** a current manifest declares a server with `type: "http"` and an absolute `https:` URL
- **THEN** the system SHALL accept the declaration

#### Scenario: Relative or non-HTTP URL is rejected

- **WHEN** a declaration's `url` is relative, or uses a scheme other than `http:` or `https:`
- **THEN** the system SHALL reject the manifest with a structured error identifying the server and the URL constraint

#### Scenario: Unknown declaration member is rejected

- **WHEN** a server declaration carries an undeclared member such as `headers`, `cwd`, or `shell`
- **THEN** the system SHALL reject the manifest
- **AND** the system SHALL NOT accept the declaration while ignoring the unknown member

#### Scenario: Empty command is rejected

- **WHEN** a stdio declaration's `command` is empty or missing
- **THEN** the system SHALL reject the manifest with a structured error identifying the server

#### Scenario: Invalid server name is rejected

- **WHEN** a manifest declares a server named `Review`, `my/server`, `-server`, or another name outside the single-segment grammar
- **THEN** the system SHALL reject the manifest without normalizing the name

#### Scenario: Speculative reference forms fail validation

- **WHEN** a current manifest declares a server as a version string or as an `{ image }` object
- **THEN** the system SHALL reject the manifest as invalid
- **AND** the system SHALL NOT retry validation under a legacy schema

#### Scenario: Legacy manifest with servers is rejected

- **WHEN** a legacy `0.1` facet manifest contains a `servers` member of any shape
- **THEN** the system SHALL reject the manifest
- **AND** legacy manifests without `servers` SHALL remain valid under their existing text-asset contract

#### Scenario: Server-only manifest is valid

- **WHEN** a current manifest declares a name, a version, and one or more concrete server declarations but no skills, agents, commands, or composed facets
- **THEN** the system SHALL accept the manifest

#### Scenario: Empty optional collections compare as omitted

- **WHEN** two declarations differ only in that one declares `args: []` or `env: {}` and the other omits the member
- **THEN** the two declarations SHALL be treated as semantically identical

## MODIFIED Requirements

### Requirement: A project manifest schema is published as part of the protocol

The shape of a project manifest (`facets.json`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a project manifest SHALL conform to the published schema. The schema SHALL define exact format-version dispatch, how facet sources and version specifiers are expressed, how compact and expanded facet entries are distinguished, and how per-asset and per-server materialization overrides are declared.

Version selection SHALL recognize exactly three supported forms: a document without `manifestVersion` SHALL be interpreted only under the legacy unversioned schema, a document declaring numeric `manifestVersion: 0.1` SHALL be interpreted only under the previous `0.1` schema, and a document declaring numeric `manifestVersion: 0.2` SHALL be interpreted only under the current schema. Any other explicit value SHALL be rejected with structured data identifying the observed and supported versions. A document that fails its selected schema SHALL NOT be retried under another schema, and its version SHALL NOT be inferred from the remaining shape.

Every legacy unversioned facet entry MUST be a compact source string. Under the `0.1` and `0.2` schemas, an entry SHALL be either a compact source string or an expanded object containing `source` and a non-empty `materialization` object. Under `0.1`, materialization overrides SHALL be grouped into optional `skills`, `commands`, and `agents` maps keyed by authored asset name. Under the current `0.2` schema, an optional `servers` map keyed by authored server name SHALL additionally be admitted. Each value SHALL be an `aliased` or `omitted` disposition; absence of an override means materialization under the authored name. Alias values MUST satisfy the current single-segment asset-name grammar; authored keys MUST remain safe to address, including for supported legacy assets. A server override SHALL count toward the non-empty expanded-entry rule exactly as an asset override does.

A materialization object SHALL NOT declare any group other than those its schema version defines. An undeclared group SHALL be rejected rather than retained and ignored, including when declared alongside recognized groups, so a misspelled group name cannot silently discard the intent it carries. A `0.1` document declaring a `servers` group SHALL be rejected rather than silently dropped.

The compact string SHALL be canonical when a facet has no overrides. A producer SHALL preserve sources and overrides it does not intentionally change, SHALL preserve overrides when changing a facet's source, and SHALL collapse an expanded entry to its compact source only after its final override is removed. An override naming an asset or server absent from a resolved facet SHALL remain schema-valid because document validation SHALL NOT require source resolution.

Readers SHALL continue to accept legacy unversioned and `0.1` documents. A normal write SHALL emit the current `0.2` version; frozen operation SHALL read earlier supported versions without migrating them.

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
- **AND** the system SHALL NOT reinterpret it as a versioned document

#### Scenario: Previous manifest version is selected exactly

- **WHEN** a manifest declares numeric `manifestVersion: 0.1`
- **THEN** the system SHALL validate it only under the `0.1` schema
- **AND** a normal write SHALL migrate the document to `0.2`

#### Scenario: Current manifest version is selected exactly

- **WHEN** a manifest declares numeric `manifestVersion: 0.2`
- **THEN** the system SHALL validate it only under the current schema

#### Scenario: Unsupported manifest version is structured

- **WHEN** a manifest declares `manifestVersion: 0.3`
- **THEN** the system SHALL reject it with structured data identifying `0.3` and the supported versions

#### Scenario: Expanded entry records typed overrides

- **WHEN** a current manifest records an alias for skill `review`, an omission for command `deploy`, and an alias for server `filesystem`
- **THEN** the system SHALL associate each override with its facet, group, and authored name

#### Scenario: Server alias override is recorded

- **WHEN** a current manifest's expanded entry declares `servers.filesystem` as `{ "kind": "aliased", "as": "project-filesystem" }`
- **THEN** the system SHALL accept the document
- **AND** the alias target SHALL be required to satisfy the single-segment asset-name grammar

#### Scenario: Server override in a previous-version document is rejected

- **WHEN** a `0.1` document's materialization object declares a `servers` group
- **THEN** the system SHALL reject the manifest
- **AND** the system SHALL NOT accept the document while ignoring the group

#### Scenario: Undeclared override group is rejected

- **WHEN** a materialization object declares a `skillz` group, whether alone or alongside a valid `skills` group
- **THEN** the system SHALL reject the manifest
- **AND** the system SHALL NOT accept the document while ignoring the undeclared group

#### Scenario: Compact entry is canonical without overrides

- **WHEN** a current manifest producer emits a facet with no materialization override
- **THEN** the facet value SHALL be its compact source string
- **AND** the document SHALL declare `manifestVersion: 0.2`

#### Scenario: Source update preserves overrides

- **WHEN** a producer changes the source of a facet whose expanded entry has overrides
- **THEN** the new entry SHALL preserve every existing override for that facet

#### Scenario: Absent authored asset or server does not invalidate the document

- **WHEN** an override names an asset or server absent from the resolved facet version
- **THEN** the project manifest SHALL still satisfy its schema

#### Scenario: Duplicate members are rejected

- **WHEN** a `facets.json` document contains a duplicate facet or override member
- **THEN** the system SHALL reject it before version dispatch and schema validation

## REMOVED Requirements

### Requirement: A server manifest schema is published as part of the protocol

**Reason**: The standalone server artifact model — the server manifest schema, source-mode and ref-mode reference forms, and separately authored or registry-resolved servers — was speculative and never implemented by any resolver. Concrete MCP server declarations now live directly inside the facet manifest, and no standalone server artifact exists to describe.

**Migration**: Declare servers as concrete stdio or Streamable HTTP declarations in `facet.json` under `servers`, per the facet manifest schema. Any manifest using version-string or `{ image }` server references must be republished with concrete declarations; those forms now fail validation in every supported manifest format.
