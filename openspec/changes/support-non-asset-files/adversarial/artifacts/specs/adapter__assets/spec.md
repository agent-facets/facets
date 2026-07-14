## MODIFIED Requirements

### Requirement: Adapters provide asset installation

An adapter SHALL accept a request to install an asset at a given scope. The request SHALL be tagged by asset type, and each type's payload SHALL carry exactly the data that type can hold:

- a **skill** request carries the skill's primary content plus a map of companion paths (relative to the skill's root) to file bytes; an empty map is the valid representation of a companion-less skill;
- an **agent** or **command** request carries a single content string and structurally cannot carry companion files.

The adapter SHALL receive the scope, asset name, per-asset metadata, and the type-tagged payload. The adapter SHALL handle all storage concerns internally — including path resolution, directory creation, metadata assembly, and file format. Companion paths SHALL be confined to the skill's resolved storage root; a companion path that would escape it SHALL be rejected as a structured failure before any write. Metadata and front-matter conventions SHALL apply only to the primary content; companion bytes SHALL be written verbatim.

A skill installation SHALL be all-or-nothing: the adapter SHALL install the complete bundle — primary file plus every companion — and SHALL remove previously installed companion paths absent from the new bundle, committing the result as one operation. On failure the adapter SHALL leave no partial bundle: either the prior state or the complete new state remains. Installation SHALL be idempotent: installing an asset whose name already exists at that scope SHALL overwrite the existing asset, replacing its companion set with the new bundle. Expected failures SHALL be structured results, not thrown errors.

#### Scenario: Install a skill asset with companions

- **WHEN** the system requests an adapter to install a skill whose payload carries primary content and two companion files at a given scope
- **THEN** the adapter SHALL store the primary file and both companions at the locations appropriate for that scope
- **AND** the adapter SHALL incorporate the metadata into the stored primary asset according to its tool's conventions
- **AND** the companion bytes SHALL be stored verbatim without metadata or front-matter processing

#### Scenario: Install a companion-less skill

- **WHEN** the system requests an adapter to install a skill whose companion map is empty
- **THEN** the adapter SHALL store the primary file
- **AND** the operation SHALL be valid without any companion writes

#### Scenario: An agent or command request cannot carry companions

- **WHEN** the system constructs an install request for an agent or command
- **THEN** the request's payload SHALL carry only the single content string
- **AND** no companion data SHALL be expressible in that request

#### Scenario: Install an asset at the user scope

- **WHEN** the system requests an adapter to install an asset at the user scope
- **THEN** the adapter SHALL store the asset using the adapter's user-level storage root

#### Scenario: Reinstalling a skill replaces its companion set

- **WHEN** the system requests an adapter to install a skill whose name already exists at the given scope
- **AND** the previously installed skill included a companion the new bundle omits
- **THEN** the adapter SHALL overwrite the primary file and install the new companions
- **AND** the adapter SHALL remove the omitted previously-installed companion
- **AND** the adapter SHALL NOT produce an error for the name collision

#### Scenario: A failed skill install leaves no partial bundle

- **WHEN** an adapter fails partway through installing a skill bundle (for example a companion write fails)
- **THEN** the adapter SHALL report a structured failure
- **AND** the skill's storage location SHALL NOT contain a mixture of old and new bundle files

#### Scenario: An escaping companion path is rejected

- **WHEN** an install request carries a companion path that would resolve outside the skill's storage root (for example via `..` segments)
- **THEN** the adapter SHALL reject the request with a structured failure identifying the path
- **AND** the adapter SHALL NOT write any file

### Requirement: Adapters provide asset reading

An adapter SHALL accept a request to read an asset from a given scope. The adapter SHALL receive the scope, asset type, and asset name. The result SHALL be tagged by asset type: a skill read SHALL return the primary content plus the companion files present in the skill's storage, and an agent or command read SHALL return the single content string. Returned primary content SHALL be the canonical logical content — the adapter SHALL project any tool-specific storage encoding back to the content the system installed — so that callers can compare it against canonical recorded hashes. Companion bytes SHALL be returned verbatim. The adapter SHALL also return any adapter-specific metadata stored alongside the asset.

#### Scenario: Read an existing skill with companions

- **WHEN** the system requests an adapter to read a skill whose storage contains a primary file and companion files
- **THEN** the adapter SHALL return the primary content, the companion files, and the stored metadata

#### Scenario: Read returns canonical logical content

- **WHEN** an adapter stores primary content in a tool-specific format that differs from the installed canonical content
- **AND** the system reads that asset back
- **THEN** the returned primary content SHALL equal the canonical logical content the system installed, absent user modification
- **AND** a caller comparing it against the canonical recorded hash SHALL observe a match

#### Scenario: Read a non-existent asset

- **WHEN** the system requests an adapter to read an asset that does not exist at the given scope
- **THEN** the adapter SHALL indicate that the asset was not found

### Requirement: Adapters provide asset deletion

An adapter SHALL accept a request to delete an asset from a given scope. The adapter SHALL receive the scope, asset type, and asset name — and, for a skill, the set of owned companion paths to remove. Skill deletion SHALL remove the primary file and every owned companion as one operation, and SHALL NOT delete files in the skill's storage location that are not in the owned set. Deletion SHALL NOT remove an entire directory wholesale when unowned files remain in it. Expected failures SHALL be structured results.

#### Scenario: Delete a skill and its owned companions

- **WHEN** the system requests an adapter to delete a skill, providing its owned companion paths
- **THEN** the adapter SHALL remove the primary file and every owned companion from that scope

#### Scenario: Deletion preserves unowned files in the skill's location

- **WHEN** a skill's storage location contains a file that is not the primary file and not in the owned companion set
- **AND** the system requests deletion of that skill
- **THEN** the adapter SHALL NOT delete the unowned file

#### Scenario: Delete a non-existent asset

- **WHEN** the system requests an adapter to delete an asset that does not exist at the given scope
- **THEN** the adapter SHALL indicate that the asset was not found

## ADDED Requirements

### Requirement: Adapters never receive archive-only supplementary files

Install, read, and delete requests SHALL have no representation for archive-only supplementary files (files that ship in a facet's archive but do not belong to any asset). The only non-asset file data an adapter ever receives is a skill's companion map inside a skill-tagged payload. A facet's root `README.md`, `LICENSE`, or other archive-only files SHALL never appear in any adapter request.

#### Scenario: Installing a facet with archive-only files sends adapters only assets

- **WHEN** the system installs a facet that ships a root `README.md` alongside its assets
- **THEN** every adapter request issued during the install SHALL describe an asset (skill, agent, or command)
- **AND** no request SHALL reference `README.md`

#### Scenario: No request shape can carry a supplementary file

- **WHEN** an install, read, or delete request is constructed
- **THEN** its type-tagged payload SHALL be one of the asset variants
- **AND** no variant SHALL exist for archive-only supplementary files
