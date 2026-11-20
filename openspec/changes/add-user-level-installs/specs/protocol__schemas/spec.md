## MODIFIED Requirements

### Requirement: Facet manifests declare MCP servers as concrete connection definitions

The published facet-manifest schema SHALL accept installation-scope-neutral MCP server declarations as a closed tagged union. A standard-input declaration SHALL require `type: "stdio"` and a non-empty `command`, MAY contain an ordered `args` array and a map of literal-string `env` assignments, and SHALL NOT contain fields from the HTTP arm. A Streamable HTTP declaration SHALL require `type: "http"` and an absolute `http:` or `https:` `url`, and SHALL NOT contain fields from the standard-input arm. Server names SHALL satisfy the current portable single-segment name grammar and SHALL occupy a namespace separate from text assets. A valid declaration SHALL be equally valid for project and user installation; no authored installation-scope member SHALL be required or accepted.

An HTTP `url` SHALL NOT carry embedded user information. A URL whose username or password component is non-empty SHALL be rejected, because a portable declaration carries no credentials and the URL is reproduced verbatim in an integrity-protected, publishable artifact.

Environment names SHALL use a portable ASCII environment-name grammar that starts with an ASCII letter or underscore and continues with ASCII letters, digits, or underscores. Declaration values SHALL remain literal; the schema SHALL NOT define headers, credentials, OAuth, variable substitution, working directories, shell behavior, or tool-specific policy.

A rejection SHALL identify the invalid field structurally rather than only in prose, so a caller need not parse a message to locate it. A rejected `command` SHALL be reported at the declaration's `command` member, a rejected `url` at its `url` member, and a rejected environment name at that exact key within the declaration's `env` map.

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

#### Scenario: URL with embedded credentials is rejected

- **WHEN** an HTTP declaration uses a URL carrying a username or password component, such as `https://user:token@example.com/mcp`
- **THEN** the system SHALL reject the declaration and identify the `url` field

#### Scenario: Invalid server or environment name is rejected

- **WHEN** a server name contains uppercase letters, a slash, an underscore, or an invalid hyphen placement, or an environment name begins with a digit or contains a hyphen
- **THEN** the system SHALL reject the manifest without normalizing the invalid name

#### Scenario: Environment-name failure identifies its key

- **WHEN** a standard-input declaration's `env` map contains one invalid environment name among valid ones
- **THEN** the structured error SHALL locate the failure at that key within the declaration's `env` map

#### Scenario: Server and text asset may share a name

- **WHEN** a manifest declares both a server and a skill named `review`
- **THEN** the system SHALL accept the shared name because their materialization identities are separate

#### Scenario: Installation scope is not an authored server field

- **WHEN** an otherwise valid server declaration adds `scope: "user"` or `scope: "project"`
- **THEN** validation SHALL reject that unrecognized declaration member
- **AND** the same declaration without that member SHALL be usable for either selected installation scope

### Requirement: Materialization dispositions use one published tagged shape

The system SHALL publish a materialization disposition with exactly three arms for text assets and MCP servers: `authored`, meaning the contribution is materialized under its authored name; `aliased`, which MUST carry the effective name; and `omitted`, meaning the contribution is not materialized. An aliased effective name MUST satisfy the portable single-segment name grammar for the contribution's kind and SHALL NOT change a text asset's installation scope, type, authored archive paths, or integrity values, or a server's authored name, declaration fingerprint, or enclosing facet integrity.

An artifact that records project or user collection intent SHALL admit only the `aliased` and `omitted` arms because absence of an override means authored materialization.

An artifact that records a resolved contribution set SHALL require one of all three arms, because that set stays comparable against the selected collection's intent and therefore still lists what was deliberately not materialized. This includes asset records in `0.3` and `0.4` lockfiles and server records in `0.4`. An artifact that records materialized on-disk state SHALL admit only the `authored` and `aliased` arms; `omitted` SHALL be unrepresentable there rather than merely unused.

Illegal combinations, including an alias without an effective name or an effective name on another arm, SHALL be rejected.

#### Scenario: Valid aliased disposition

- **WHEN** a disposition declares `aliased` with effective name `vendor-review`
- **THEN** the disposition SHALL satisfy the published schema
- **AND** the authored contribution identity SHALL remain unchanged

#### Scenario: Valid omitted disposition

- **WHEN** a disposition declares `omitted` without an effective name
- **THEN** the disposition SHALL satisfy the published schema

#### Scenario: Materialized-state artifact rejects omitted

- **WHEN** an artifact recording materialized on-disk state declares an `omitted` disposition
- **THEN** the disposition SHALL NOT satisfy that artifact's schema
- **AND** the same `omitted` disposition SHALL remain valid in an artifact recording the resolved contribution set

#### Scenario: Alias without an effective name is rejected

- **WHEN** a disposition declares `aliased` but omits its effective name
- **THEN** the disposition SHALL NOT satisfy the published schema

#### Scenario: Non-aliased disposition carrying a name is rejected

- **WHEN** an `authored` or `omitted` disposition also carries an effective name
- **THEN** the disposition SHALL NOT satisfy the published schema

#### Scenario: Invalid effective name is rejected

- **WHEN** an aliased disposition uses `Review`, `review/code`, `-review`, or another name outside the portable single-segment name grammar for its contribution kind
- **THEN** the disposition SHALL NOT satisfy the published schema
- **AND** the name SHALL NOT be normalized or sanitized

#### Scenario: Authored is not a project override

- **WHEN** a project-manifest override explicitly declares `authored`
- **THEN** the override SHALL NOT satisfy the published project-manifest schema
- **AND** authored materialization SHALL be expressed by omitting the override

#### Scenario: User alias preserves installation scope and authored content

- **WHEN** a user collection aliases skill `review` to `personal-review`
- **THEN** the resolved asset SHALL retain `scope: "user"` and its authored `skills/review/` paths and hashes
- **AND** only its materialization disposition SHALL select `personal-review`

## ADDED Requirements

### Requirement: User collections reuse the published dependency-manifest format

The published `facets.json` schema SHALL describe both project and user collection declarations. New user declarations SHALL use manifest `0.2` with the same compact and expanded sources, typed alias/omit overrides, unknown-field rules, and exact version dispatch as project declarations. Selecting user scope SHALL NOT require a new manifest version or a scope member in the document, and SHALL NOT relax validation of an otherwise invalid document.

#### Scenario: User declarations retain the same override grammar

- **WHEN** a user collection declares a valid `manifestVersion: 0.2` document with a skill alias and server omission
- **THEN** the document SHALL validate under the same published schema as project declarations
- **AND** neither override SHALL require an installation-scope field

#### Scenario: User selection cannot bypass exact version validation

- **WHEN** a user collection document declares `manifestVersion: 0.1` with a `servers` override group
- **THEN** validation SHALL reject that unsupported group under `0.1`
- **AND** user selection SHALL NOT cause fallback to another schema

### Requirement: Lockfile asset scope identifies installation scope

A lockfile asset's `scope` SHALL describe its installation scope, not a publisher-selected property of the content archive. A producer recording a user collection SHALL use `scope: "user"`; a producer recording a project collection SHALL use `scope: "project"`. Scope projection SHALL NOT alter authored asset names, types, archive paths, file hashes, facet integrity, or companion membership, including for aliased and omitted assets. Current writers SHALL continue to use lockfile `0.4`.

Generic schema validation SHALL retain the published `system`, `user`, and `project` scope vocabulary. Agreement with a selected installation collection SHALL be an additional contextual check, not an inference from document shape or permission to perform system-wide installation.

#### Scenario: Same verified content has different installed scopes

- **WHEN** the same facet is recorded independently in project and user lockfiles
- **THEN** the corresponding asset scopes SHALL be `project` and `user` respectively
- **AND** their authored file records and facet integrity SHALL be identical
- **AND** both lockfiles SHALL remain format `0.4`

#### Scenario: Omitted user skill remains fully inventoried

- **WHEN** a user collection omits a skill with declared companions
- **THEN** its lockfile SHALL retain the skill at user scope with the omitted disposition and every authored primary and companion record

#### Scenario: Generic validation does not authorize an installation target

- **WHEN** a consumer validates an otherwise valid lockfile containing an asset with scope `system`
- **THEN** that scope SHALL remain schema-valid
- **AND** validation SHALL NOT authorize a system-wide installation

#### Scenario: User placement does not introduce another lockfile format

- **WHEN** the user collection writes a lockfile
- **THEN** it SHALL declare `lockfileVersion: 0.4`, validate under the same published schema as a project lockfile, and generate no user-specific schema-defined member; existing opaque-extension preservation SHALL remain unchanged

### Requirement: MCP materialization planning separates scope from declaration identity

Public declaration-based and fingerprint-only MCP materialization planning SHALL accept an explicit project or user installation scope and SHALL distinguish effective identities by that scope. Existing calls that omit the newly available scope SHALL retain project behavior. Naming, equivalence composition, aliases, omissions, complete collision reporting, ordering, and stale-intent behavior SHALL be the same within either selected scope.

Selecting scope SHALL NOT change a declaration's `facets:mcp-server:v1` fingerprint or authored provenance, and SHALL NOT add generated scope fields to lockfile server records. Those records SHALL retain the standard `name`, `fingerprint`, and `materialization` shape with existing opaque-extension preservation.

#### Scenario: Equal declarations have scoped identities and unchanged fingerprints

- **WHEN** the same authored declaration is planned once at project scope and once at user scope
- **THEN** the selected effective identities SHALL differ by scope
- **AND** the declaration fingerprints and authored origins SHALL remain equal

#### Scenario: Both public planning forms agree at user scope

- **WHEN** user-scoped planning receives the same contributions and overrides once as declarations and once as canonical fingerprints
- **THEN** the plans SHALL agree on scoped effective identities, dispositions, claimants, collisions, and stale overrides

#### Scenario: Existing project callers retain their behavior

- **WHEN** a caller uses the preceding project-only planning form without a scope argument
- **THEN** its result SHALL retain project-scoped materialization semantics

#### Scenario: Scope changes identities without changing composition

- **WHEN** identical complete authored server contributions and overrides are planned once at project scope and once at user scope
- **THEN** effective identities SHALL differ only in their scope component; effective names, dispositions, fingerprints, claimant membership, collision-group membership, ordering, and stale overrides SHALL otherwise agree

### Requirement: Locked MCP inventory remains collection-relative

Public lockfile-only MCP inventory derivation SHALL remain usable from a validated supported document alone, for either collection. It SHALL NOT require a home directory, installation target, environment, native configuration, or separate scope argument. Its authored and selected views SHALL describe that document's recorded names, fingerprints, dispositions, and complete provenance rather than global machine identities. Consumers combining inventories from separate collections SHALL distinguish their collection identities rather than merge them by server name.

User lockfiles SHALL retain exact-version dispatch, explicit empty inventories, complete omitted records, legacy `inventory-unavailable` outcomes, and the distinction between recorded metadata and verified content. Reading either collection's lockfile SHALL NOT confer ownership or MCP approval for either collection.

#### Scenario: User inventory can be derived offline

- **WHEN** a consumer derives inventory from a valid user lockfile `0.4` on a machine without installed adapters or native tool configuration
- **THEN** it SHALL receive the recorded authored and selected inventories without supplying an installation target or home directory
- **AND** the result SHALL NOT claim that any server is configured or approved

#### Scenario: Separate lockfiles do not establish a cross-collection collision

- **WHEN** user and project lockfiles each record server `docs` with different fingerprints
- **THEN** deriving each inventory separately SHALL return that document's selected server
- **AND** the shared name SHALL NOT make either derivation fail

#### Scenario: Legacy user inventory is still unavailable

- **WHEN** a validated `0.3` lockfile is considered for a user collection and carries a `servers` extension
- **THEN** inventory derivation SHALL return `inventory-unavailable` requiring format `0.4`
- **AND** user selection SHALL NOT turn the extension into inventory or approval
