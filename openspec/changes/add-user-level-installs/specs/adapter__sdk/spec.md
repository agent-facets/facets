## ADDED Requirements

### Requirement: Planning requests carry an explicit installation target

Under adapter SDK API `0.4`, asset installation planning, asset removal planning, and MCP server planning SHALL each receive one planning context whose installation target is a discriminated value tagged by `scope`. A `project` target SHALL carry the absolute `projectRoot` of the project being installed into. A `user` target SHALL identify the user installation and SHALL NOT carry or require a project root. An adapter SHALL NOT accept a project target without a project root, SHALL NOT invent a project for a user target, and SHALL NOT infer the target from the process working directory, the presence or absence of files, or environment variables.

System-wide installation SHALL NOT be representable as a valid target. A request that nonetheless names an unsupported or malformed target, such as through untyped input, SHALL produce a returned structured failure identifying the requested scope rather than a thrown error or a guessed destination.

#### Scenario: User target needs no project

- **WHEN** an adapter plans a skill installation for a `user` target
- **THEN** the request SHALL contain no project root
- **AND** the adapter SHALL resolve destinations without consulting any project directory

#### Scenario: Project target identifies its project

- **WHEN** an adapter plans an agent installation for a `project` target whose `projectRoot` is `/work/app`
- **THEN** every planned destination SHALL be resolved from `/work/app`
- **AND** the result SHALL be identical whether the process working directory is `/work/app` or `/tmp`

#### Scenario: Working directory does not select the user destination

- **WHEN** the same `user`-target request is planned once from a project directory and once from an unrelated directory
- **THEN** both plans SHALL name the same destinations

#### Scenario: System target is refused as data

- **WHEN** an untyped caller submits a request whose target scope is `system`
- **THEN** the adapter SHALL return a structured unsupported-scope failure naming `system`
- **AND** it SHALL read and write no file

#### Scenario: Malformed target is rejected before inspection

- **WHEN** an untyped request supplies a user target carrying a project root, or a project target without one
- **THEN** the adapter SHALL return structured invalid-target failure data and SHALL NOT inspect any file

### Requirement: Callers supply location inputs and adapters determine native locations

Every planning context SHALL carry the user's absolute home directory and a read-only snapshot of location-related environment values. The home directory SHALL be an input to location resolution, not a materialization destination: the adapter SHALL exclusively determine its tool's storage roots and configuration document paths from the installation target, the supplied home directory, and the supplied environment values. The supplied home directory SHALL be authoritative; environment values SHALL act only as the target tool's native location overrides and SHALL NOT supply a competing home identity.

During a run, an adapter SHALL use only these supplied inputs for location resolution and SHALL NOT independently re-read the ambient working directory, home directory, or environment. A home directory that is not absolute SHALL produce a returned structured invalid-target failure without any filesystem access.

Each enabled capability SHALL declare, through `locationEnvironment`, the complete list of environment-variable names it consults during destination resolution; an empty list SHALL be valid. The supplied snapshot SHALL contain values only for the names the receiving capability declared, captured once per operation, and SHALL NOT be modifiable by the adapter. Declaring a variable SHALL NOT confer ownership of, or authority to modify, any configuration layer that variable references. The snapshot SHALL NOT be persisted or logged in its entirety.

#### Scenario: Supplied home wins over ambient home

- **WHEN** the planning context supplies home `/home/alice` while the process environment's `HOME` is `/home/other`
- **THEN** user-target destinations SHALL be resolved below `/home/alice` or below a declared native override
- **AND** no destination SHALL be resolved from `/home/other`

#### Scenario: Only declared variables reach a capability

- **WHEN** an asset capability declares `locationEnvironment` as `["XDG_CONFIG_HOME"]` and the process environment also defines `AWS_SECRET_ACCESS_KEY`
- **THEN** that capability's snapshot SHALL contain at most `XDG_CONFIG_HOME`
- **AND** it SHALL NOT contain `AWS_SECRET_ACCESS_KEY`

#### Scenario: Empty location declaration is valid

- **WHEN** an author declares a capability with an empty `locationEnvironment` list
- **THEN** the factory SHALL accept the definition
- **AND** that capability SHALL receive an empty environment snapshot

#### Scenario: Relative home is rejected before inspection

- **WHEN** a planning context supplies home directory `alice`
- **THEN** the adapter SHALL return a structured invalid-target failure
- **AND** it SHALL inspect no file

#### Scenario: Snapshot cannot be changed by the adapter

- **WHEN** an adapter attempts to assign a value in its supplied environment snapshot
- **THEN** the snapshot SHALL retain its original values for the remainder of the operation

#### Scenario: Ambient process state does not change a plan

- **WHEN** two planning runs receive identical requests and inspected filesystem state but execute with different working directories and ambient environment values
- **THEN** both SHALL produce identical plans

#### Scenario: Undeclared environment variable has no effect

- **WHEN** two planning runs have identical supplied requests and inspected filesystem state, but an undeclared environment variable is set in only one process environment
- **THEN** both SHALL produce identical plans

#### Scenario: Location snapshot is captured once

- **WHEN** a declared location variable changes in the process environment after an operation captures its snapshot
- **THEN** every subsequent capability invocation in that operation that declares the variable SHALL receive its captured value rather than the changed ambient value

### Requirement: Each enabled capability declares its supported installation scopes

Every enabled `assets` and `mcpServers` capability under API `0.4` SHALL declare a non-empty set of supported installation scopes drawn from `project` and `user`. A capability declaring an empty set, an unknown scope, or no set at all SHALL be rejected when the adapter is defined and again when its bundle is verified, with the failure naming the capability and the problem. Declaring a capability as `false` SHALL remain a complete and valid declaration of no support and SHALL NOT be treated as an SDK incompatibility. Each first-party adapter SHALL declare both `project` and `user` for both capabilities.

#### Scenario: Capability supports both scopes

- **WHEN** an author declares an asset capability supporting `project` and `user`
- **THEN** the returned adapter SHALL report both scopes as supported for assets

#### Scenario: Empty scope set is rejected

- **WHEN** an author declares an MCP capability with an empty supported-scope set
- **THEN** the factory SHALL reject the definition, naming the MCP capability and the empty set

#### Scenario: Unknown scope is rejected at verification

- **WHEN** a bundled adapter's asset capability declares supported scope `system`
- **THEN** bundle verification SHALL fail, naming the asset capability and the unsupported scope

#### Scenario: Project-only capability remains valid

- **WHEN** a third-party adapter declares its MCP capability with supported scopes `project` only
- **THEN** the factory SHALL accept the definition
- **AND** the adapter SHALL remain usable for project operations

### Requirement: Scope support is checked before mutation for the capabilities an operation needs

Before any approval prompt or mutation, every selected adapter SHALL be checked against the selected installation scope for each capability the operation actually needs. A capability SHALL be needed when the desired state contains active content for it or when owned materializations from that capability must be cleaned up. A capability the operation does not need SHALL NOT be checked against the scope and SHALL NOT be invoked: a text-only operation with no owned MCP entries SHALL NOT require MCP support.

When an implemented needed capability does not declare the selected scope, the operation SHALL fail before mutation with structured failure code `ADAPTER_SCOPE_UNSUPPORTED`. The failure SHALL identify the requested scope and every offending adapter and capability together with each one's declared supported scopes, rather than only the first. A needed capability declared as `false` SHALL retain the existing unsupported-capability failure, distinct from unsupported scope and SDK API incompatibility; it SHALL NOT be silently skipped.

#### Scenario: Project-only adapter cannot serve a user install

- **WHEN** a user installation with an active skill selects an adapter whose asset capability supports only `project`
- **THEN** the operation SHALL fail with `ADAPTER_SCOPE_UNSUPPORTED` before any file changes
- **AND** the failure SHALL name the adapter, the asset capability, scope `user`, and declared scopes `project`

#### Scenario: Every offending adapter is reported

- **WHEN** two selected adapters lack user support for a needed capability
- **THEN** one failure SHALL name both adapters and their declared scopes

#### Scenario: Unneeded capability is not consulted

- **WHEN** a user installation contains only text assets, no owned MCP entries exist, and a selected adapter's MCP capability supports only `project`
- **THEN** the operation SHALL proceed using that adapter's asset capability
- **AND** its MCP capability SHALL NOT be invoked

#### Scenario: Cleanup requires the capability

- **WHEN** a user operation must remove an owned MCP entry and the adapter that materialized it still provides MCP planning but now declares only `project` support
- **THEN** the operation SHALL fail with `ADAPTER_SCOPE_UNSUPPORTED` before mutation
- **AND** the owned entry SHALL remain unchanged

### Requirement: Scope-aware planning remains read-only and self-contained

At every installation scope, adapter planning SHALL NOT write, create, or delete files or directories, SHALL NOT make network requests, and SHALL NOT start subprocesses. Expected unsupported-scope, invalid-target, filesystem-inspection, and native-format failures SHALL be returned as structured values. The SDK's published type declarations SHALL remain self-contained, depending on no installer internals and importing no protocol runtime code through the MCP server declaration type.

#### Scenario: User-scope planning writes nothing

- **WHEN** an adapter plans a user-target skill installation whose storage root does not exist
- **THEN** no file or directory SHALL be created
- **AND** the plan SHALL describe the prospective writes

#### Scenario: User-scope planning starts no process

- **WHEN** an adapter plans user-target MCP configuration for a standard-input server
- **THEN** no subprocess SHALL be started and no network connection SHALL be opened

#### Scenario: Declarations resolve without installer internals

- **WHEN** an adapter author type-checks a project depending only on the published SDK
- **THEN** every SDK type, including the MCP declaration type, SHALL resolve without installing any unpublished package

## MODIFIED Requirements

### Requirement: Adapter authors can define an adapter using the SDK

An adapter author SHALL be able to create an adapter by importing the SDK and calling a factory function with a definition object. The factory SHALL validate the definition shape and return `Validated<Adapter>`: `{ ok: true; data: Adapter }` on success or `{ ok: false; errors: ValidationError[] }` on failure. The definition SHALL accept a name, a function to build per-asset adapter metadata, the required `assets` capability, and the required `mcpServers` capability.

Every definition-validation failure, including missing fields, malformed untyped inputs, incomplete capabilities, and invalid supported-scope or `locationEnvironment` declarations, SHALL be returned as field-addressed pure-data validation errors. A failure result SHALL contain at least one error identifying the invalid field and expected constraint; callers SHALL NOT need to parse message text to locate the problem. Invalid definitions SHALL NOT throw or be reclassified as exceptional programming errors. Only completely unknown, unhandleable internal programming errors MAY throw. The SDK SHALL NOT provide a throwing unwrap helper for expected validation failures.

The SDK SHALL expose `0.4` as the canonical adapter SDK API identifier for the scope-aware read-only planning contract: explicit project-or-user installation targets, caller-supplied location inputs, per-capability supported scopes, location disclosure, tagged asset planning, and the MCP server planning capability. Every adapter in a successful factory result SHALL carry that identifier in a required, readonly `apiVersion` field. The factory definition SHALL NOT require or accept an author-supplied API identifier, so adapter authors cannot create a conflicting declaration and do not repeat the SDK-owned value. If a value is nonetheless supplied for `apiVersion`, such as through untyped input, the factory SHALL ignore it; the adapter in `data` SHALL always carry the SDK's canonical identifier and SHALL NOT reflect the author-supplied value.

#### Scenario: Author creates a valid adapter

- **WHEN** an author calls the factory function with a complete definition
- **THEN** the factory SHALL return `ok: true` with a valid adapter in `data`, containing all provided properties, methods, and capability declarations
- **AND** that adapter SHALL declare the canonical adapter SDK API `0.4`

#### Scenario: Author provides an invalid definition

- **WHEN** an author calls the factory function with a definition missing required fields
- **THEN** the factory SHALL return `ok: false` with field-addressed validation errors identifying the missing fields
- **AND** it SHALL NOT throw

#### Scenario: Malformed untyped definition is rejected as data

- **WHEN** an untyped caller supplies `null`, an array, or a primitive instead of a definition object
- **THEN** the factory SHALL return `ok: false` with structured validation errors identifying the invalid definition shape
- **AND** it SHALL NOT throw while attempting to inspect required fields

#### Scenario: Invalid capability declarations are rejected as data

- **WHEN** a definition contains an incomplete capability, an invalid supported-scope declaration, or an invalid `locationEnvironment` declaration
- **THEN** the factory SHALL return `ok: false` with validation errors identifying the capability and invalid field
- **AND** it SHALL NOT return a partial adapter or throw

#### Scenario: Author does not declare the API version

- **WHEN** an author creates an adapter with the SDK factory
- **THEN** the definition SHALL NOT require the author to provide an API identifier
- **AND** the returned adapter SHALL carry the SDK's canonical API identifier

#### Scenario: Author-supplied project-rooted identifier is ignored

- **WHEN** an untyped definition supplies `apiVersion` `0.3`
- **THEN** the returned adapter SHALL declare `0.4`

#### Scenario: Consumer reads the canonical API identifier

- **WHEN** an adapter publisher or compatibility-aware consumer imports the SDK's canonical adapter SDK API identifier
- **THEN** the exported value SHALL be `0.4`

### Requirement: The SDK refuses an incomplete capability rather than stubbing it

The factory function SHALL reject a capability that is present but incomplete by returning `ok: false` with field-addressed validation errors naming the missing operation or declaration. It SHALL NOT throw or substitute a stub: a capability is something a consumer must know about before it plans a transaction, so an adapter that appears to support an operation and then refuses it would be discovered only once work had already begun. Declaring a capability as `false` SHALL remain a complete and valid answer.

#### Scenario: Author supplies an incomplete capability

- **WHEN** an author calls the factory function with a capability object missing one of its operations
- **THEN** the factory SHALL return `ok: false` with validation errors identifying the capability and missing operation
- **AND** it SHALL NOT throw or return a partial adapter

#### Scenario: Author declines a capability outright

- **WHEN** an author declares a capability as `false` in an otherwise valid definition
- **THEN** the factory SHALL return `ok: true` with an adapter in `data` that reports no support for that capability

### Requirement: Adapter SDK API compatibility uses exact contract identifiers

An adapter SDK API identifier SHALL use the canonical `MAJOR.MINOR` decimal form without signs, suffixes, build metadata, or leading zeroes other than zero itself. Compatibility-aware consumers SHALL distinguish missing, malformed, unsupported, and supported identifiers. They SHALL determine compatibility by membership in an explicit exact-token support set and SHALL NOT infer compatibility from CLI versions, SDK package versions, adapter package versions, lockfile versions, or semantic-version ordering.

Adapter SDK API `0.4` SHALL identify the scope-aware read-only planning contract. Adapter SDK API `0.3` SHALL remain the identifier of the superseded read-only planning contract in which every request carried a project root regardless of scope and capabilities declared no supported scopes. Adapter SDK APIs `0.0`, `0.1`, and `0.2` SHALL remain identifiers of superseded contracts in which the adapter performed its own filesystem writes. The adapter SDK API token SHALL be independent of the lockfile format version: the equality of API `0.4` and lockfile `0.4` SHALL carry no compatibility meaning in either direction. Whether a consumer supports an exact contract identifier SHALL be determined solely by membership in that consumer's explicit support set; changing the set SHALL NOT change an existing token's meaning. Package metadata and runtime declarations for one adapter release SHALL still agree by exact token.

#### Scenario: Current exact identifier is compatible

- **WHEN** an adapter declares API `0.4`
- **AND** the consumer's explicit support set contains `0.4`
- **THEN** the adapter SDK API SHALL be classified as supported

#### Scenario: Project-rooted planning identifier is unsupported by a scope-aware consumer

- **WHEN** an adapter declares API `0.3`
- **AND** the consumer's explicit support set is `{0.4}`
- **THEN** the adapter SDK API SHALL be classified as unsupported
- **AND** numeric proximity to `0.4` SHALL NOT make it compatible

#### Scenario: Previous tagged identifier is unsupported

- **WHEN** an adapter declares API `0.1` or `0.2`
- **AND** the consumer's explicit support set does not contain it
- **THEN** the adapter SDK API SHALL be classified as unsupported

#### Scenario: Superseded positional identifier is unsupported

- **WHEN** an adapter declares the positional-contract API `0.0`
- **AND** the consumer's explicit support set excludes `0.0`
- **THEN** the adapter SDK API SHALL be classified as unsupported
- **AND** numeric proximity to a supported token SHALL NOT make it compatible

#### Scenario: Different well-formed identifier is unsupported

- **WHEN** an adapter declares a well-formed API identifier that is not in the consumer's support set
- **THEN** the adapter SDK API SHALL be classified as unsupported
- **AND** numeric proximity to a supported identifier SHALL NOT make it compatible

#### Scenario: Invalid identifier is malformed

- **WHEN** an adapter declares an identifier with a patch component, suffix, build metadata, sign, or disallowed leading zero
- **THEN** the adapter SDK API SHALL be classified as malformed

#### Scenario: Package and runtime tokens must agree

- **WHEN** an adapter package declares API `0.3` in package metadata but its runtime adapter declares `0.4`
- **THEN** verification SHALL fail rather than selecting either contract

#### Scenario: API identifier is independent of package versions

- **WHEN** the CLI, an adapter package, or the Adapter SDK package changes semantic version without changing the `0.4` adapter call contract
- **THEN** the adapter SDK API identifier SHALL remain `0.4`
- **AND** the package-version change SHALL NOT imply a different adapter SDK API compatibility result

#### Scenario: API identifier is independent of the lockfile version

- **WHEN** a consumer reads lockfile format `0.4` and evaluates an adapter declaring API `0.3`
- **THEN** the lockfile version SHALL NOT affect the adapter's compatibility classification

### Requirement: Adapter authors declare MCP server support as one complete capability

An adapter definition using API `0.4` SHALL declare both `assets` and `mcpServers` as either `false` or a complete capability. Each capability SHALL contain its complete set of operations and declarations, including its supported scopes and `locationEnvironment`; support SHALL NOT be representable as a boolean that can disagree with optional operations. A capability missing an operation or declaration SHALL be rejected when the adapter is defined and again when its bundle is verified. The field SHALL be MCP-specific, and future non-asset tool-configuration features SHALL use independent capabilities.

#### Scenario: Adapter declares complete MCP support

- **WHEN** an adapter author provides a complete MCP server capability
- **THEN** the returned adapter SHALL expose it through `mcpServers`

#### Scenario: Adapter declares no MCP support

- **WHEN** an adapter author sets `mcpServers` to `false`
- **THEN** the returned adapter SHALL unambiguously report that MCP servers are unsupported

#### Scenario: Partial capability is rejected

- **WHEN** an adapter definition claims MCP support but omits a required capability operation
- **THEN** the definition SHALL fail validation or type checking rather than produce a partially supported adapter

#### Scenario: Capability without location declaration is rejected

- **WHEN** an adapter definition provides an MCP planning operation and supported scopes but omits `locationEnvironment`
- **THEN** the definition SHALL fail validation, naming the missing declaration

#### Scenario: Future configuration feature remains independent

- **WHEN** a later adapter SDK API adds a different tool-configuration feature
- **THEN** that feature SHALL use a separate capability without widening the MCP server contract

### Requirement: An adapter without MCP support remains usable for a project without MCP servers

A selected adapter declaring no MCP server support SHALL remain usable for a project or user operation when the selected collection's desired state contains no active MCP server declaration and no owned MCP entry requires cleanup through that adapter. When active declarations exist, every selected adapter declaring no MCP support SHALL be reported together as unable to materialize the desired state before any write. If recorded user claims require that adapter for cleanup, guidance SHALL require restoring a compatible adapter with the needed capability rather than bypassing the binding by deselection or omission.

#### Scenario: An adapter without MCP support serves a text-only project

- **WHEN** a project has no active MCP server declaration or owned MCP cleanup and a selected adapter declares no MCP support
- **THEN** installation SHALL proceed using its asset planning capability

#### Scenario: An adapter without MCP support serves a text-only user collection

- **WHEN** the user collection has no active MCP server declaration or owned MCP cleanup and a selected adapter declares no MCP support
- **THEN** user installation SHALL proceed using its asset planning capability

#### Scenario: An adapter without MCP support cannot serve active declarations

- **WHEN** a project or user collection has an active MCP server declaration and a selected adapter declares no MCP support
- **AND** no recorded user claims require that adapter for cleanup
- **THEN** installation SHALL fail before mutation and identify every such adapter
- **AND** the remedy SHALL be to omit the declarations or deselect the adapter, not to upgrade it
