## MODIFIED Requirements

### Requirement: A lockfile schema is published as part of the protocol

The shape of a lockfile (`facets.lock`) SHALL be published as a normative schema. Any system that reads, writes, or interprets a lockfile SHALL conform to the published schema. The schema SHALL define the lockfile version, source-provenance fields, identity-and-integrity fields, the complete authored asset list, each asset's materialization disposition and canonical file-integrity records, the complete authored server inventory for formats that support it, and the rules for unrecognized fields.

Version dispatch SHALL use exact equality. Numeric `0.2`, `0.3`, and `0.4` SHALL each identify only their own schema, with `0.4` the current writer format. Numeric `1` SHALL NOT identify any readable schema: it named a withdrawn closed-alpha shape and is reserved for a future stable v1, so a document declaring it SHALL be rejected as unsupported rather than reinterpreted from its remaining shape. A malformed document SHALL NOT be retried under another version, and an unsupported version SHALL be rejected with structured observed and supported values. Project-manifest, lockfile, archive, and adapter-contract versions SHALL be interpreted independently. Duplicate lockfile members SHALL be rejected before schema validation.

The published API SHALL expose each supported lockfile version through its exact schema and type plus a closed union derived from those exact readers. It SHALL NOT expose an unpinned numeric-version schema or identity-only compatibility type as a substitute for the supported union: such a type would admit documents whose version and fields disagree. Current writer types SHALL describe only `0.4`.

The published source provenance SHALL remain tagged by source kind: registry records the registry origin, git records the repository URL and required resolved commit, and local records the resolved path. A source missing a required field SHALL NOT satisfy the schema; a source with every required field and unrecognized keys SHALL remain valid.

Every `0.3` and `0.4` asset entry SHALL record `scope`, `type`, authored `name`, a required materialization disposition, and a required `files` array sorted by canonical path. Each file record SHALL contain exactly the canonical inner-archive path derived from the authored name and its `sha256:<hex>` integrity. Aliased and omitted dispositions SHALL NOT change those paths or hashes. An omitted asset SHALL remain in the lockfile with all authored file records. Skill companions SHALL remain subordinate records, and archive-only supplementary files SHALL NOT appear in an asset's files.

Every `0.2` asset entry SHALL retain its preceding `{ scope, type, name, files }` shape and SHALL be understood as materialized under its authored name. Asset materialization dispositions SHALL be recognized in exactly `0.3` and `0.4`. Server inventories and server dispositions SHALL be recognized only in `0.4`; a legacy extension with the same field name SHALL NOT change the format's capabilities.

In `0.2`, `0.3`, and `0.4`, an asset's file records SHALL be derived from its own authored type and name rather than merely being safe, sorted paths. An agent or command entry SHALL contain exactly one record, whose path is that asset's canonical primary path. A skill entry SHALL contain its canonical `SKILL.md` record, and every record it contains SHALL lie beneath that skill's authored root. A record that no derivation from the asset's authored identity could produce SHALL be rejected, so ownership and integrity can never be associated with an unrelated archive file.

Unrecognized fields SHALL be tolerated and SHALL survive reconstruction, not merely loading. A producer rewriting a lockfile SHALL carry forward the unrecognized fields of every retained top-level document, facet entry, source value of unchanged kind, asset entry matched by authored identity, file record matched by path, and `0.4` server record matched by authored name within its facet. Where a schema-defined field and an unrecognized field share a name, the schema-defined value SHALL win. Unrecognized fields belonging to a facet, asset, file record, or server record that the new state no longer contains SHALL be dropped with it. A `servers` extension in a `0.2` or `0.3` facet entry SHALL be replaced by the verified `0.4` field during migration; its contents SHALL NOT be interpreted as server records or server-record extensions.

#### Scenario: A consumer interprets a lockfile written by a different system

- **WHEN** a system reads a valid `facets.lock` written by another facet-compatible system
- **THEN** it SHALL interpret every field under the declared schema
- **AND** it SHALL accept the lockfile as valid installation input

#### Scenario: A producer writes a reproducible lockfile

- **WHEN** a system writes `facets.lock` after resolving sources and materialization intent
- **THEN** the file SHALL satisfy the published `0.4` schema
- **AND** another conforming system SHALL derive the same effective asset and server sets

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

- **WHEN** an otherwise valid lockfile's recognized source carries every required field plus unrecognized keys
- **THEN** the lockfile SHALL satisfy the published schema
- **AND** the system SHALL accept the lockfile

#### Scenario: Current skill entry lists every authored file

- **WHEN** a `0.3` or `0.4` lockfile records skill `review` with companions `references/api.md` and `scripts/run.ts`
- **THEN** its sorted `files` array SHALL contain `skills/review/SKILL.md`, `skills/review/references/api.md`, and `skills/review/scripts/run.ts`
- **AND** each record SHALL contain a canonical authored path and `sha256:<hex>` integrity
- **AND** the entry SHALL declare a materialization disposition

#### Scenario: Single-file assets list one file

- **WHEN** a `0.3` or `0.4` lockfile records agent `reviewer` and command `review`
- **THEN** each asset's `files` array SHALL contain exactly its authored conventional primary path

#### Scenario: Unrelated file path is rejected

- **WHEN** a `0.2`, `0.3`, or `0.4` lockfile records command `deploy` with a safe, sorted file record for `README.md`
- **THEN** the lockfile SHALL NOT satisfy the published schema
- **AND** the rejection SHALL identify the record as not derived from the asset's authored identity

#### Scenario: Extra file on a single-file asset is rejected

- **WHEN** an agent entry records its canonical primary path plus a second file record
- **THEN** the lockfile SHALL NOT satisfy the published schema

#### Scenario: Companion outside the authored skill root is rejected

- **WHEN** skill `review` records a file under another skill's root, or omits its canonical `SKILL.md`
- **THEN** the lockfile SHALL NOT satisfy the published schema

#### Scenario: Unrecognized fields survive a rewrite

- **WHEN** a producer rewrites a lockfile whose retained document, facet entry, source, asset entry, and file record each carry an unrecognized field
- **THEN** every unrecognized field not superseded by a schema-defined field SHALL be present in the rewritten document
- **AND** an unrecognized field sharing a schema-defined field's name SHALL NOT displace the schema-defined value
- **AND** unrecognized fields of a facet, asset, file record, or server record the new state no longer contains SHALL be dropped with it

#### Scenario: Server extensions follow authored identity

- **WHEN** a `0.4` rewrite retains a server's facet and authored name but changes its alias
- **THEN** unrecognized fields on that server record SHALL survive
- **AND** its newly recorded materialization and fingerprint SHALL take precedence over previous values

#### Scenario: A legacy servers extension is not interpreted

- **WHEN** a `0.2` or `0.3` facet entry carries a `servers` extension resembling `0.4` records with additional fields
- **AND** verified migration writes `0.4`
- **THEN** the canonical verified inventory SHALL replace that extension
- **AND** no field inside the legacy extension SHALL be imported as a server-record extension
- **AND** unrelated retained extension fields SHALL survive

#### Scenario: Aliased asset retains authored records

- **WHEN** skill `review` is recorded as aliased to `vendor-review`
- **THEN** its `name` SHALL remain `review`
- **AND** its files SHALL remain under canonical `skills/review/` paths
- **AND** its disposition SHALL record `vendor-review`

#### Scenario: Omitted asset remains recorded

- **WHEN** command `deploy` is recorded as omitted
- **THEN** its lockfile asset entry SHALL remain present with `commands/deploy.md` and its integrity

#### Scenario: Missing current disposition is rejected

- **WHEN** a `0.3` or `0.4` asset entry omits its materialization disposition
- **THEN** the lockfile SHALL NOT satisfy the published schema

#### Scenario: Archive-only file is excluded

- **WHEN** a verified facet contains root `README.md`
- **THEN** no `0.2`, `0.3`, or `0.4` asset entry SHALL list it

#### Scenario: Withdrawn alpha version is rejected

- **WHEN** a lockfile declares numeric `lockfileVersion: 1`
- **THEN** the system SHALL reject it as an unsupported version
- **AND** the system SHALL NOT interpret it under any readable schema
- **AND** the system SHALL NOT reinterpret its shape as `0.2`, `0.3`, or `0.4`

#### Scenario: Previous version is selected exactly

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.2`
- **THEN** it SHALL be interpreted only under the `0.2` schema
- **AND** every asset SHALL be understood as materialized under its authored name
- **AND** the system SHALL NOT reinterpret its shape as `0.3` or `0.4`

#### Scenario: Disposition-bearing legacy version remains readable

- **WHEN** a lockfile declares numeric `lockfileVersion: 0.3` and satisfies that schema
- **THEN** the system SHALL retain its asset dispositions and interpret it only as `0.3`
- **AND** it SHALL NOT require or infer a server inventory

#### Scenario: Malformed current lockfile is not reinterpreted

- **WHEN** a lockfile declares `lockfileVersion: 0.4` but violates that schema
- **THEN** it SHALL be rejected without fallback to `0.2` or `0.3`

#### Scenario: Supported aggregate remains version-discriminated

- **WHEN** a consumer accepts any supported lockfile
- **THEN** its declared version SHALL discriminate the corresponding `0.2`, `0.3`, or `0.4` payload
- **AND** a `0.3` or `0.4` version paired with identity-only or disposition-less assets SHALL NOT be representable as validated supported state
- **AND** a `0.4` facet entry without server inventory SHALL NOT be representable as validated supported state

#### Scenario: Unsupported version is structured

- **WHEN** a lockfile declares an unsupported version
- **THEN** it SHALL be rejected with structured observed and supported versions

### Requirement: MCP server declarations have a canonical semantic fingerprint

The system SHALL define a deterministic semantic fingerprint for an MCP server declaration. The fingerprint SHALL preserve the tagged declaration kind and argument order, sort environment keys, and treat omitted `args` or `env` collections as equivalent to empty collections. Authored and effective server names SHALL NOT be part of the declaration fingerprint.

The encoding SHALL be published under the identifier `facets:mcp-server:v1`, and the published API SHALL expose that identifier. Within one encoding identifier, an unchanged declaration SHALL produce the same fingerprint across releases. A revision SHALL use a new identifier rather than alter an existing encoding's results. Fingerprinting SHALL cover complete literal declaration values, including environment values, without redaction, salting, or source-dependent variation. A fingerprint SHALL NOT be presented as a secrecy guarantee for those values.

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

#### Scenario: Encoding identifier is published

- **WHEN** a consumer reads the published identifier for the encoding used by lockfile `0.4`
- **THEN** it SHALL equal `facets:mcp-server:v1`

#### Scenario: Fingerprint is stable across releases

- **WHEN** two releases compute fingerprints for the same standard-input and HTTP declarations under `facets:mcp-server:v1`
- **THEN** their fingerprints SHALL agree for each declaration

#### Scenario: Source does not change the fingerprint

- **WHEN** the same declaration is delivered through registry, git, and local sources
- **THEN** all three SHALL produce the same fingerprint

### Requirement: Materialization dispositions use one published tagged shape

The system SHALL publish a materialization disposition with exactly three arms for text assets and MCP servers: `authored`, meaning the contribution is materialized under its authored name; `aliased`, which MUST carry the effective name; and `omitted`, meaning the contribution is not materialized. An aliased effective name MUST satisfy the portable single-segment name grammar for the contribution's kind and SHALL NOT change a text asset's authored scope, type, archive paths, or integrity values, or a server's authored name, declaration fingerprint, or enclosing facet integrity.

An artifact that records project intent SHALL admit only the `aliased` and `omitted` arms because absence of an override means authored materialization.

An artifact that records a resolved contribution set SHALL require one of all three arms, because that set stays comparable against project intent and therefore still lists what was deliberately not materialized. This includes asset records in `0.3` and `0.4` lockfiles and server records in `0.4`. An artifact that records materialized on-disk state SHALL admit only the `authored` and `aliased` arms; `omitted` SHALL be unrepresentable there rather than merely unused.

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

## REMOVED Requirements

### Requirement: MCP declarations and dispositions remain outside the lockfile

**Reason**: Lockfile `0.4` adds complete fingerprint-only server inventory and materialization dispositions. The prohibition on recording any server metadata no longer expresses the supported contract.

**Migration**: Retain exact `0.2` and `0.3` readers and migrate through verified definitions. Record authored names, fingerprints, and dispositions under the new server-inventory requirements, while leaving declaration bodies and approval evidence out of generated records. Facet integrity continues to protect embedded declarations.

## ADDED Requirements

### Requirement: Current lockfile facet entries record complete authored server inventories

Every `0.4` facet entry SHALL contain a required `servers` array with exactly one record per authored MCP server. Each record SHALL contain `name` as the authored name, `fingerprint` as a canonical MCP declaration fingerprint, and `materialization` as the published three-arm disposition. An alias SHALL record its target only in the disposition; it SHALL NOT replace the authored name. Records SHALL be strictly ascending by authored name under code-unit ordering. Duplicate names, names outside the portable authored-server grammar, fingerprints outside `sha256:` followed by 64 lowercase hexadecimal digits, and invalid or missing dispositions SHALL be rejected.

Empty arrays SHALL positively represent facets with no servers. Server-only facets SHALL retain source, version, facet integrity, an empty `assets` array, and their complete `servers` array. Omitted servers SHALL remain recorded. Standard generated server records SHALL carry no declaration bodies, commands, URLs, arguments, environment data, per-adapter representation, or approval evidence; opaque extension tolerance SHALL NOT cause extension values to be interpreted as declaration content. The enclosing facet entry SHALL remain the source of origin identity, version, provenance, and facet integrity. Generated server records SHALL NOT duplicate facet identity, source provenance, version, or facet integrity; public origin metadata SHALL come only from the enclosing facet entry.

#### Scenario: Server-only facet has a complete lock entry

- **WHEN** a verified facet declares only server `filesystem`
- **THEN** its `0.4` entry SHALL contain source, version, facet integrity, `assets: []`, and the `filesystem` server record
- **AND** that server record SHALL contain only canonical metadata plus any preserved opaque extensions, not a generated declaration body

#### Scenario: Explicit empty server inventory is valid

- **WHEN** a `0.4` facet entry contains `servers: []` and otherwise satisfies its schema
- **THEN** the system SHALL accept it as an explicitly empty server inventory

#### Scenario: Missing inventory is not empty inventory

- **WHEN** a `0.4` facet entry omits `servers`
- **THEN** the system SHALL reject the document rather than supply an empty array

#### Scenario: Alias retains authored identity

- **WHEN** authored server `filesystem` is recorded as aliased to `project-filesystem`
- **THEN** its name SHALL remain `filesystem` and its disposition SHALL carry `project-filesystem`
- **AND** its declaration fingerprint SHALL remain unchanged

#### Scenario: Omission retains the authored record

- **WHEN** a facet's server `docs` is omitted
- **THEN** its record SHALL remain in `servers` with its authored name, fingerprint, and omitted disposition

#### Scenario: Unsorted or duplicate names are rejected

- **WHEN** a `0.4` server array is not strictly ascending by authored name, including when a name appears twice
- **THEN** the system SHALL reject the document

#### Scenario: Invalid metadata is rejected

- **WHEN** a server record has an invalid authored name, malformed fingerprint, missing disposition, or invalid alias
- **THEN** the system SHALL return schema-violation data identifying the invalid field

#### Scenario: Server metadata does not weaken facet integrity

- **WHEN** an embedded declaration changes its bytes without reproducing the locked facet integrity
- **THEN** the artifact SHALL fail facet-integrity verification regardless of the server fingerprint recorded alongside it

#### Scenario: Unrecognized declaration-shaped member remains opaque

- **WHEN** an otherwise valid `0.4` server record carries an unrecognized member named `command`
- **THEN** validation SHALL accept it under the extension-tolerance rule
- **AND** inventory derivation SHALL exclude that member from public output
- **AND** installation SHALL NOT use it as a declaration value

### Requirement: Lockfile 0.4 fixes the MCP fingerprint encoding

Server fingerprints in lockfile `0.4` SHALL use the existing `facets:mcp-server:v1` canonical encoding and SHA-256 digest. The standard-input preimage SHALL be the UTF-8 JSON encoding of `["facets:mcp-server:v1", "stdio", command, args, environmentPairs]`, with absent `args` represented by `[]` and environment pairs sorted by name using code-unit ordering. An absent environment map SHALL produce `[]`. The HTTP preimage SHALL be the UTF-8 JSON encoding of `["facets:mcp-server:v1", "http", url]`. JSON encoding SHALL be compact, without added whitespace. Values SHALL remain literal and names SHALL remain outside the declaration preimage.

The published reference API SHALL expose both the encoder identifier and the `0.4` schema's fixed identifier. The `0.4` identifier SHALL remain `facets:mcp-server:v1` even if a later schema introduces another encoding. A future encoding revision SHALL require a new lockfile version and SHALL NOT reinterpret stored `0.4` fingerprints. Per-record encoding selection SHALL NOT alter the `0.4` contract.

#### Scenario: Standard-input encoding is pinned

- **WHEN** a declaration has `type: "stdio"`, `command: "npx"`, and omitted `args` and `env`
- **THEN** its `0.4` fingerprint preimage SHALL be exactly `["facets:mcp-server:v1","stdio","npx",[],[]]`
- **AND** its fingerprint SHALL be the lowercase SHA-256 digest of those UTF-8 bytes prefixed by `sha256:`

#### Scenario: HTTP encoding is pinned

- **WHEN** a declaration has `type: "http"` and `url: "https://example.com/mcp"`
- **THEN** its `0.4` fingerprint preimage SHALL be exactly `["facets:mcp-server:v1","http","https://example.com/mcp"]`

#### Scenario: A future encoding does not redefine old inventory

- **WHEN** a reader supports both `0.4` and a later format with a different fingerprint encoding
- **THEN** fingerprints in `0.4` SHALL continue to be interpreted under `facets:mcp-server:v1`

### Requirement: Consumers can derive complete MCP provenance from locked inventory

The published API SHALL provide lockfile-only MCP inventory derivation from a validated supported lockfile. It SHALL discriminate capability by the document's exact version. For `0.2` and `0.3`, it SHALL return a structured `inventory-unavailable` result with the observed version and required inventory format `0.4`, even if the document is empty or carries an extension named `servers`.

For `0.4`, derivation SHALL expose an `authored` view containing every server record, including omissions, with facet identity, tagged source provenance, resolved version, facet integrity, authored server name, declaration fingerprint, and recorded disposition. A successful result SHALL additionally expose selected `servers`, each with effective name, fingerprint, and a non-empty list of all contributing origins. Selected origins SHALL include only active records and SHALL preserve distinct `(facet, authoredName)` claims. Derivation SHALL use recorded dispositions, not accept project-manifest overrides, and SHALL NOT report machine-local installation or approval as a consequence of reading a lockfile.

Claims at one portable effective identity with equal fingerprints SHALL compose into one selected server retaining every origin. Unequal fingerprints at one identity SHALL return complete collision groups and the complete authored view, with no selected winner or partial selected set. Equal fingerprints at distinct effective identities SHALL remain separate.

#### Scenario: Identical declarations retain two facet origins

- **WHEN** two locked facets at different resolved versions and integrities claim the same effective server name with equal fingerprints
- **THEN** derivation SHALL return one selected server with both facets' complete origin metadata
- **AND** neither facet SHALL be identified as a winning origin

#### Scenario: Two authored names from one facet remain distinct origins

- **WHEN** two authored servers from one facet have equal fingerprints and aliases targeting one effective identity
- **THEN** that selected server SHALL retain both authored names as separate origins

#### Scenario: Omitted claim is authored but not selected

- **WHEN** two facets record the same server fingerprint and one claim is omitted
- **THEN** both records SHALL appear in authored inventory
- **AND** only the active claim SHALL contribute to selected origins

#### Scenario: All servers are omitted

- **WHEN** a valid `0.4` lockfile records only omitted servers
- **THEN** derivation SHALL succeed with an empty selected array and every record in its authored view

#### Scenario: Alias determines the selected name

- **WHEN** locked server `filesystem` is aliased to `workspace-files`
- **THEN** selection SHALL use `workspace-files`
- **AND** provenance SHALL still name authored server `filesystem`

#### Scenario: Conflicts retain evidence without partial success

- **WHEN** a valid `0.4` document contains differing fingerprints at one effective identity and also contains an unrelated non-conflicting server
- **THEN** derivation SHALL report every conflicting claimant and the complete authored inventory
- **AND** it SHALL NOT return a partial selected set containing the unrelated server

#### Scenario: Equal fingerprints under different names do not collapse

- **WHEN** two active locked records share a fingerprint but have distinct portable effective identities
- **THEN** derivation SHALL return two selected servers

#### Scenario: Legacy lookalike remains unavailable

- **WHEN** a `0.2` or `0.3` document carries a `servers` extension that resembles current records
- **THEN** derivation SHALL return `inventory-unavailable` with required version `0.4`
- **AND** it SHALL NOT inspect that extension as inventory

#### Scenario: Empty legacy document remains unavailable

- **WHEN** a legacy lockfile contains no facets
- **THEN** derivation SHALL report unavailable inventory rather than an empty current-format success

#### Scenario: Recorded intent is independent of another manifest

- **WHEN** a consumer derives inventory from a valid `0.4` lockfile while a separate project manifest has unrecorded alias changes
- **THEN** the result SHALL describe the lockfile's recorded names and dispositions only

#### Scenario: Empty current inventory is available

- **WHEN** a valid `0.4` lockfile has no facets, or every facet records `servers: []`
- **THEN** derivation SHALL succeed with empty authored and selected arrays
- **AND** it SHALL NOT report unavailable inventory

#### Scenario: Derivation reports recorded values without verifying content

- **WHEN** the fingerprint of the only active server in a valid `0.4` lockfile is replaced by another syntactically valid fingerprint
- **THEN** derivation SHALL report the replacement fingerprint as recorded
- **AND** it SHALL NOT acquire content or assert that the fingerprint matches the facet's definitions

### Requirement: Fingerprint-only server planning preserves materialization semantics

The published API SHALL offer a separate pure planning operation over complete per-facet authored names and canonical fingerprints plus optional materialization overrides. It SHALL NOT require concrete declarations or a fabricated lockfile. Absence of an override SHALL mean authored materialization. The operation SHALL follow the same naming, alias, omission, portable-collision, equivalence, ordering, and stale-intent rules as declaration-based server planning.

A successful plan SHALL expose every authored record with its planned disposition, selected configurations with every claimant, and stale overrides. Invalid aliases SHALL be a distinct structured failure. Collisions SHALL return all conflicting groups and retain stale-override diagnostics, without a winner or partial configuration set. Facets with no servers SHALL still participate in stale-override detection. Planning from supplied fingerprints SHALL NOT assert that their preimages or enclosing artifacts were verified.

#### Scenario: Fingerprint planning agrees with declaration planning

- **WHEN** the same authored contributions and overrides are planned once from declarations and once from their canonical fingerprints
- **THEN** both results SHALL agree on dispositions, effective identities, fingerprints, claimants, collisions, invalid-alias problems, and stale overrides

#### Scenario: Missing override means authored

- **WHEN** fingerprint-only planning receives an authored server without an override
- **THEN** it SHALL select the authored name rather than inherit an alias from another document

#### Scenario: Alias swaps are planned in one pass

- **WHEN** server `alpha` aliases to `beta` and server `beta` aliases to `alpha`
- **THEN** the plan SHALL select both requested effective identities without depending on input order

#### Scenario: Empty facet still reports stale server intent

- **WHEN** a supplied facet has no servers but an override names `gone`
- **THEN** the plan SHALL report that override as stale

#### Scenario: Invalid alias is not a collision

- **WHEN** an override supplies an alias outside the portable server-name grammar
- **THEN** planning SHALL return an invalid-alias failure rather than a collision or successful selection

#### Scenario: Collision preserves unrelated stale diagnostics

- **WHEN** supplied claims conflict at an effective identity and an override separately names an absent authored server
- **THEN** the failure SHALL include both the complete collision groups and the stale-override diagnostics

### Requirement: Public MCP inventory operations are deterministic and independent of installation state

Public locked-inventory derivation and fingerprint-only planning SHALL run without filesystem access, private cache access, archive parsing, network access, server execution, or installed adapters. The published TypeScript package SHALL support these operations on Node 22+ with Bun unavailable. Expected unavailable-inventory, collision, and invalid-alias outcomes SHALL be represented as discriminated result data under their respective contracts.

Results SHALL be independent of facet-member and contribution ordering. Authored records and origin lists SHALL be ordered by facet then authored name using code-unit comparison; selected identities and collision groups SHALL use the existing portable identity order. Public inventory output SHALL expose only defined metadata, SHALL be typed readonly, and SHALL NOT share mutable arrays, dispositions, or source objects with the input or expose opaque extension objects.

#### Scenario: Public consumer verifies exports offline

- **WHEN** a Node consumer parses a `0.4` lockfile, derives inventory, and fingerprints its exported portable declarations using only public package exports
- **THEN** it SHALL be able to compare the complete effective-name/fingerprint sets without Bun, cache, archives, network, or server contact
- **AND** changing argument order, dropping a selected server, or adding an unexpected server SHALL make that comparison disagree

#### Scenario: Input ordering does not change output

- **WHEN** equivalent valid lockfiles differ in facet-member order, or equivalent planner inputs differ in facet and server order
- **THEN** the corresponding ordered result data SHALL be identical

#### Scenario: Input mutation does not change a returned inventory

- **WHEN** a caller mutates source metadata, dispositions, or arrays in an input after deriving inventory
- **THEN** the previously returned authored, selected, and collision data SHALL remain unchanged

#### Scenario: Opaque extensions are not public provenance fields

- **WHEN** a valid lockfile contains arbitrary facet, source, or server-record extensions
- **THEN** derivation SHALL omit those extension values from its public provenance output

#### Scenario: Inventory is not an installation receipt

- **WHEN** a consumer derives inventory on a machine with no prior installation or approval record
- **THEN** success SHALL mean only that the recorded selection can be derived
- **AND** it SHALL NOT assert native configuration, machine-local approval, ownership, or independent authenticity of the lockfile
