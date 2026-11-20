## ADDED Requirements

### Requirement: User collection operations retain the project lifecycle guarantees

Except where a requirement specifies scope-specific behavior, every installation requirement stated for project collections SHALL apply to the user collection with the user declarations, user lockfile, user receipt, and user collection lock in place of the project manifest, project lockfile, project receipt, and project install lock. This SHALL include source kinds and specifier forms, version selection and resolution gating, explicit add resolution, caching and integrity verification, lockfile format selection and migration, frozen reproduction, complete-set collision evaluation with Keep, Alias, and Omit resolution, durable and stale materialization intent, ownership reconciliation, transactional commit and exact restoration, adapter compatibility checks, MCP approval and takeover, update discovery and application, and lockfile `0.4` server inventory, fingerprint, inventory-versus-content, and legacy-inventory guarantees. Installation scope SHALL NOT change authored archive paths, content hashes, facet integrity, or declaration fingerprints, and a locked fingerprint SHALL NOT substitute for a verified declaration in either collection. Recovery guidance that names a command SHALL name the command that targets the same collection.

#### Scenario: Frozen user reproduction follows frozen rules

- **WHEN** a frozen user collection install finds a user declaration with no lockfile entry
- **THEN** it SHALL fail identifying that facet before fetching content
- **AND** it SHALL leave the user declarations, lockfile, receipt, assets, and native configuration unchanged

#### Scenario: User collisions are resolved within the user collection

- **WHEN** two user facets contribute skill `review`
- **THEN** the system SHALL require a Keep, Alias, or Omit resolution recorded in the user declarations before materialization

#### Scenario: User inventory guarantees match project guarantees

- **WHEN** a user lockfile entry at unchanged facet integrity records a server fingerprint that differs from its verified declaration
- **THEN** the operation SHALL fail with the same inventory-reconciliation data as a project collection before approval, cleanup, or mutation

#### Scenario: Failed user operation restores everything

- **WHEN** a user collection operation fails after writing user-level assets and configuration
- **THEN** every changed file SHALL be restored under the existing restoration rules
- **AND** the user declarations, lockfile, and receipt SHALL match their pre-operation contents

#### Scenario: Recovery guidance keeps the selected collection

- **WHEN** user update discovery finds a registry facet without usable local resolution state
- **THEN** its guidance SHALL direct the user to the install command that targets the user collection

### Requirement: Users can manage an independent user collection

The system SHALL provide one user collection per Facets metadata root, managed only when the user explicitly selects it. The collection SHALL have its own machine-local receipt and lifecycle lock. Project scope SHALL remain the default; a missing project manifest SHALL NOT select the user collection. The user collection's identity SHALL NOT depend on the invocation directory.

A user operation with a relative Facets metadata root SHALL fail before reading or writing collection state and SHALL require an absolute root. A project operation whose manifest or lockfile resolves to the user collection's declarations or lockfile SHALL fail before mutation rather than interpret user state as project state. Collections under different Facets metadata roots SHALL remain independent without cross-root coordination. System-wide installation SHALL NOT be offered.

#### Scenario: The same user collection is selected from any directory

- **WHEN** a user adds a facet to the user collection from one directory
- **AND** later lists or removes user facets from an unrelated directory
- **THEN** the later operation SHALL observe and act on the same user declarations, lockfile, and receipt

#### Scenario: Omitting the selection keeps project behavior

- **WHEN** a user runs an install without selecting the user collection in a directory with no project manifest
- **THEN** the system SHALL report the project manifest problem
- **AND** it SHALL NOT read or modify the user collection

#### Scenario: Relative metadata root is rejected for user operations

- **WHEN** a user operation runs with the Facets metadata root configured as a relative path
- **THEN** the operation SHALL fail before reading or writing any collection state
- **AND** the failure SHALL direct the user to configure an absolute path

#### Scenario: Project operation inside the user state directory is refused

- **WHEN** a project operation runs in the directory holding the user collection's declarations
- **THEN** it SHALL fail before mutation
- **AND** it SHALL NOT read the user declarations or lockfile as project state

### Requirement: The user collection reuses the portable declaration and lockfile formats

User-editable declarations SHALL live at `$FACET_DIR/user/facets.json` and the installer-generated lockfile at `$FACET_DIR/user/facets.lock`, using the existing Facets metadata-root selection. The declarations SHALL reuse the current project-manifest format, preserve user comments on rewrite, and follow the same generated-JSON formatting as the project manifest. The lockfile SHALL use the current lockfile format. Both files SHALL be readable and suitable for version control.

#### Scenario: Hand-edited comments survive a user add

- **WHEN** `user/facets.json` contains a user comment and existing declarations, and a later user add succeeds
- **THEN** the rewritten declarations SHALL retain the comment and every existing declaration value the operation did not intentionally change

### Requirement: User collections reuse shared facilities without sharing authority

The user collection SHALL share the machine's existing facet content cache and installed adapters. Sharing cached content SHALL NOT share installation ownership or approval, and removing a facet from one collection SHALL NOT evict cached content.

#### Scenario: Shared cache content is reused

- **WHEN** an exact facet version already cached by a project install is added to the user collection
- **THEN** the system SHALL use the verified cached content without downloading it again

### Requirement: The user collection installs every installable content type

A user collection operation SHALL support every content type a project collection installs: skills with every declared companion, agents, commands, and standard-input and Streamable HTTP MCP server declarations, including facets whose only deliverable is a server declaration. Existing facet packages SHALL install in the user collection without republishing and without any publisher-declared installation scope. Authored names, canonical archive paths, file integrity, facet integrity, and declaration fingerprints SHALL be identical in both collections.

Each adapter SHALL determine its own user-level destinations from the installation scope, the user's home directory, and the environment values the adapter declares it consults. The system SHALL supply the home directory as a location input, not as a destination, and SHALL NOT substitute the home directory or the Facets metadata root for a project root. When an adapter cannot establish a supported destination, including a malformed or unsupported location override, the operation SHALL fail before mutation rather than guess a destination or omit content. A missing tool directory SHALL be created only within the operation's bounded write handling; a missing or unusable ancestor outside that boundary SHALL produce an actionable failure rather than broaden the write boundary.

The first successful user operation that records a facet SHALL create the user declarations and lockfile in its commit. No read-only operation SHALL create them. An install, update, or removal that targets a user collection with no declarations file SHALL fail as missing collection state before mutation and without creating any file. An existing declarations file that declares no facets SHALL remain valid.

#### Scenario: First user add works without a project

- **WHEN** a user explicitly adds a registry facet to the user collection from a directory that contains no project manifest
- **AND** at least one compatible adapter is installed
- **THEN** the system SHALL create the user declarations and lockfile in the successful commit
- **AND** it SHALL materialize the facet at user-level destinations
- **AND** it SHALL NOT create a project manifest or project lockfile in the working directory

#### Scenario: Missing user collection state blocks install

- **WHEN** a user installs, updates, or removes user facets and no user declarations file exists
- **THEN** the operation SHALL fail as missing collection state
- **AND** no declarations, lockfile, receipt, or materialized state SHALL be created

#### Scenario: Skill bundle installs at the user level

- **WHEN** the user collection installs a facet whose skill has a binary companion
- **THEN** every selected adapter SHALL materialize the primary and every companion at its user-level skill destination
- **AND** the user lockfile SHALL record the same authored file paths and integrity values a project lockfile would record

#### Scenario: Server-only facet installs at the user level

- **WHEN** the user collection installs a facet with one active server declaration and no text assets
- **THEN** the operation SHALL configure the server in every selected adapter's user-level configuration and succeed with zero materialized assets

#### Scenario: Unestablished destination fails without writing

- **WHEN** an adapter reports that a configured location override is malformed or unsupported for user placement
- **THEN** the operation SHALL fail before any asset, configuration, or collection state is written

#### Scenario: Missing outer ancestor is reported

- **WHEN** a user-level destination's parent outside the authorized write boundary is missing or unusable
- **THEN** the operation SHALL fail before mutation with an actionable failure identifying the location
- **AND** it SHALL NOT create directories above the authorized boundary

#### Scenario: Created user skill directory is cleaned up on rollback

- **WHEN** a user install creates a missing skills directory beneath an existing authorized parent, later fails, and the created directory is empty after rollback of owned files with no external changes
- **THEN** rollback SHALL remove that operation-created directory and preserve the pre-existing parent and shared roots

### Requirement: User local sources keep their meaning across invocation directories

When a local source is added to the user collection, the system SHALL interpret the argument relative to the invocation directory, expand a leading `~/` after source-prefix parsing against the user's home directory, resolve the canonical absolute directory, validate it as a facet source, and persist that absolute path in both the declarations and the locked provenance. Existing materialization overrides for that facet SHALL survive the normalization. Every later user operation SHALL resolve the stored path independently of the invocation directory.

A persisted user local source that is relative, including one beginning with `~/`, SHALL be rejected with guidance to re-add the facet or declare an absolute source; the system SHALL NOT resolve it against a new base. User local sources MAY lie outside the Facets metadata root. The selected facet directory SHALL remain the boundary for authored files and companions, and existing traversal and link-escape checks SHALL apply. When a persisted canonical source now resolves through a link to a different directory, the operation SHALL report source identity drift rather than silently follow it. Project local sources SHALL retain their existing project containment and tilde handling.

#### Scenario: Relative add argument is stored as an absolute path

- **WHEN** a user adds `./my-facet` to the user collection from `/work/tools`
- **THEN** the user declarations and lockfile SHALL record the canonical absolute path of `/work/tools/my-facet`
- **AND** a later user install run from `/tmp` SHALL build from that same directory

#### Scenario: Tilde argument is expanded at add time

- **WHEN** a user adds `~/facets/review` to the user collection
- **THEN** the stored source SHALL be the canonical absolute path beneath the user's home directory
- **AND** it SHALL NOT be stored with a leading `~/`

#### Scenario: Persisted relative user source is rejected

- **WHEN** the user declarations contain a relative local source
- **THEN** a user operation SHALL fail before building that source
- **AND** the failure SHALL direct the user to re-add the facet or declare an absolute source

#### Scenario: Retargeted local source is reported as drift

- **WHEN** a persisted canonical local source now resolves through a link to a different directory
- **THEN** the operation SHALL report source identity drift
- **AND** it SHALL NOT build from the new target

#### Scenario: Project local source handling is unchanged

- **WHEN** a project collection adds a local source
- **THEN** the system SHALL apply the existing project containment rules
- **AND** it SHALL NOT apply user-collection tilde expansion

### Requirement: Selected adapters must support the operation's installation scope

Before collision prompting, approval, or mutation, the system SHALL determine which adapter capabilities the operation requires: the asset capability is required when any active text asset is desired or any receipt-owned text asset needs reconciliation or deletion, and MCP configuration is required under the existing active-declaration and owned-cleanup conditions. For every required capability, every selected adapter providing it SHALL declare support for the selected collection's installation scope. A capability the operation does not require SHALL NOT be invoked and SHALL NOT cause a scope failure.

When any required capability does not support the requested scope, the operation SHALL fail before mutation with a structured `ADAPTER_SCOPE_UNSUPPORTED` failure identifying the requested scope and every offending adapter and capability together with its declared scopes. This failure SHALL be distinct from adapter API incompatibility and from an adapter declaring no MCP support at all, which retain their existing failures. The system SHALL NOT silently omit content an adapter cannot place. System-scope installation SHALL NOT be requested by any supported operation, and an invalid or direct system-scope request SHALL return a structured failure.

#### Scenario: Adapter without user asset support blocks a user install

- **WHEN** a user collection install desires a skill and a selected adapter's asset capability declares support only for project scope
- **THEN** the operation SHALL fail before prompting or mutation with `ADAPTER_SCOPE_UNSUPPORTED`
- **AND** the failure SHALL name the adapter, the asset capability, its declared scopes, and the requested user scope

#### Scenario: Every offending adapter is reported together

- **WHEN** two selected adapters lack user-scope support for required capabilities
- **THEN** one failure SHALL identify both adapters and every offending capability

#### Scenario: Unused capability does not block

- **WHEN** a user collection operation has only text assets and the receipt owns no MCP configuration
- **AND** a selected adapter does not support MCP configuration at user scope
- **THEN** the operation SHALL NOT fail for that reason

#### Scenario: Owned cleanup still requires scope support

- **WHEN** no active MCP declaration remains in the user collection but the user receipt owns an effective server identity this operation must delete
- **AND** a selected adapter's MCP capability does not support user scope
- **THEN** the operation SHALL fail before mutation with `ADAPTER_SCOPE_UNSUPPORTED`

### Requirement: Locked asset scopes must agree with the selected collection

Before locked or receipt-recorded data is used for placement, refinement, or cleanup, the system SHALL verify that every recorded asset scope equals the selected collection's installation scope. A disagreement SHALL produce a structured `LOCKFILE_SCOPE_MISMATCH` result carrying the collection scope and each offending facet and asset scope. Generic lockfile validation SHALL continue to accept every published scope value; this check is an additional collection-consistency check.

Frozen installation SHALL report the mismatch before fetching content and SHALL write nothing. A non-frozen operation SHALL NOT use a mismatched entry for placement, removal refinement, or deletion authority; it SHALL regenerate target-consistent inventory from verified content under the existing source and version-selection rules, report the mismatch, and commit the corrected lockfile only on success. Update discovery SHALL treat a mismatched entry as unusable local resolution state. A mismatched entry SHALL never authorize deleting any file or configuration entry.

#### Scenario: Frozen user install rejects project-scoped entries

- **WHEN** a frozen user collection install finds a locked asset recording scope `project`
- **THEN** it SHALL fail with `LOCKFILE_SCOPE_MISMATCH` before fetching facet content
- **AND** the user declarations, lockfile, receipt, assets, and native configuration SHALL remain unchanged

#### Scenario: Normal install regenerates a consistent lockfile

- **WHEN** a non-frozen user collection install finds a locked asset recording scope `project`
- **AND** resolution, verification, and materialization otherwise succeed
- **THEN** the committed user lockfile SHALL record scope `user` for every asset
- **AND** the output SHALL report that the mismatched entry was regenerated

#### Scenario: Mismatched entry is not deletion authority

- **WHEN** a lockfile entry with a mismatched scope names an asset that no current receipt record covers
- **THEN** the system SHALL NOT delete any file on the strength of that entry

#### Scenario: Discovery reports the mismatch

- **WHEN** user update discovery finds a mismatched locked scope for a registry facet
- **THEN** discovery SHALL fail naming that facet and direct the user to run a normal user install

### Requirement: User receipts bind ownership to the adapters and native locations that materialized it

A user collection receipt SHALL retain one semantic ownership and approval inventory and SHALL additionally record the materializing adapters together with, for the capabilities participating in reconciliation, the canonical storage root of every asset type materialized and the complete canonical set of candidate MCP configuration documents. These locations SHALL come from the adapters' read-only plans, without invoking an otherwise unused capability solely to disclose locations. The receipt SHALL NOT record declaration contents, environment snapshots or raw override assignments, raw deletion instructions, or adapter-encoded content hashes.

A user collection mutation SHALL include every bound adapter that still has recorded claims. When a bound adapter is unavailable, incompatible, or not selected, the operation SHALL fail before mutation and identify the adapter to restore. Adding an adapter SHALL be permitted: the complete desired collection SHALL reconcile through the bound adapters and the new adapter together. A newly added adapter SHALL gain no deletion authority from another adapter's binding; content already occupying its destinations SHALL be untracked and subject to the existing takeover disclosure and MCP approval before its binding is recorded.

Before presenting approval or applying any change, the system SHALL compare the canonical locations each plan discloses with the recorded bindings, including for unchanged and absent outcomes. When a bound adapter's locations resolve to a different physical root or candidate document set, the system SHALL discard the plan and fail before approval or mutation. It SHALL NOT reinterpret the recorded ownership at the new location, overwrite the binding, or abandon the previous ownership. The failure SHALL direct the user to restore the previous location or compatible adapter, remove the old materializations, and then reinstall at the new location. Every replanning before commit SHALL repeat this comparison. A user collection with no recorded claims MAY establish fresh bindings. An absent or unreadable user receipt SHALL bind nothing, and no locked fingerprint or scan of native files SHALL reconstruct a binding.

#### Scenario: Changed location override stops the operation

- **WHEN** a user receipt binds an adapter's user-level skill root
- **AND** a changed location override makes that adapter disclose a different root
- **THEN** the operation SHALL fail before approval or mutation
- **AND** the failure SHALL describe the restore, remove, and reinstall recovery
- **AND** the receipt and both locations SHALL remain unchanged

#### Scenario: Unavailable bound adapter blocks a user mutation

- **WHEN** a user receipt records claims materialized by an adapter that is no longer installed
- **THEN** a user add, install, update, or removal SHALL fail before mutation
- **AND** the failure SHALL name that adapter as one to restore

#### Scenario: Newly added adapter reconciles the whole collection

- **WHEN** an adapter is installed after the user collection already bound another adapter
- **AND** the next user install succeeds
- **THEN** every desired effective identity SHALL be reconciled in both adapters
- **AND** the receipt SHALL record bindings for both adapters
- **AND** untracked content at the new adapter's destinations SHALL require the existing takeover disclosure before it is replaced or adopted

#### Scenario: Location change during an operation is detected

- **WHEN** a plan is recomputed before commit and its disclosed locations differ from the recorded binding
- **THEN** the operation SHALL fail without committing collection or native configuration changes

#### Scenario: Bindings do not persist environment assignments

- **WHEN** a successful user operation records adapter bindings
- **THEN** the receipt SHALL contain canonical locations but no saved environment-variable assignments

#### Scenario: Equivalent content does not bypass binding validation

- **WHEN** a bound adapter resolves a different storage root that already contains equivalent desired content, so its candidate plan proposes no file changes
- **THEN** the operation SHALL still reject the location mismatch before approval or commit and preserve the receipt and both locations

#### Scenario: Failed operation records no new binding

- **WHEN** a normal user add fails after planning a previously unbound adapter
- **THEN** the receipt SHALL retain its pre-operation bindings and SHALL add no binding from that operation

### Requirement: Project and user collections are isolated

Ownership, approval, intent, and locking SHALL be independent for each collection. Deletion SHALL be authorized only by the selected collection's own receipt, and MCP approval SHALL come only from the selected collection's matching receipt claims or explicit approval for the current operation. Approval recorded for a project collection SHALL NOT authorize user-level configuration, and user approval SHALL NOT authorize project configuration. Fingerprints in a lockfile or shared cache SHALL NOT substitute for approval or verified declarations.

Removing a facet from one collection SHALL NOT delete another collection's materializations, even when both collections install the same facet or the same effective name. A target tool's precedence between its project and user configuration SHALL NOT confer cross-scope ownership: user planning SHALL NOT clean project-level layers, and project planning SHALL NOT clean user-level layers. Facets SHALL NOT resolve or report cross-collection shadowing.

Operations on one collection SHALL NOT consume another collection's declarations, lockfile, or receipt as operation input, and SHALL NOT modify them or reconcile that other collection's materializations. Filesystem metadata inspection needed to reject physically aliased destinations SHALL NOT confer cross-collection ownership. The same facet MAY be declared independently in a project collection and in the user collection, at the same or different versions.

#### Scenario: Project and user declare the same facet independently

- **WHEN** a project collection declares `cowsay@1.0.0` and the user collection declares `cowsay@2.0.0`
- **THEN** each collection SHALL install, lock, and track its own version
- **AND** changing one collection SHALL leave the other collection's declarations, lockfile, receipt, and materializations unchanged

#### Scenario: Project approval does not authorize the user collection

- **WHEN** a project receipt approves a server declaration
- **AND** the same declaration is added to the user collection
- **THEN** the user operation SHALL require user-collection approval before writing user-level configuration

#### Scenario: Removing a user facet keeps the project copy

- **WHEN** a project collection and the user collection both install facet `cowsay` with skill `cowsay`
- **AND** the user removes `cowsay` from the user collection
- **THEN** only the user-level materialization SHALL be deleted
- **AND** the project materialization, declarations, lockfile, and receipt SHALL remain unchanged

#### Scenario: Shadowed project entry is not cleaned by a user operation

- **WHEN** a target tool's project configuration defines a server the user collection also configures
- **AND** the user removes that server's facet from the user collection
- **THEN** the project configuration entry SHALL remain unchanged

#### Scenario: Project removal preserves the user server entry

- **WHEN** the user collection owns server `docs` in user configuration and a project removes its own `docs` claim
- **THEN** the user-level `docs` entry SHALL remain unchanged

### Requirement: User-wide tool configuration changes only through explicit user operations

Project collection operations SHALL write only project-scoped destinations and SHALL NOT create or modify user-level or system-wide tool configuration or assets. User-level tool assets and configuration SHALL be created, modified, or deleted only by an operation that explicitly selects the user collection, and user-level MCP configuration SHALL additionally require user-collection approval. No operation SHALL modify system-wide tool configuration.

When a user operation edits a shared user-level configuration document, it SHALL change only entries the user collection desires or owns and SHALL preserve unrelated semantic settings and entries neither desired nor owned by the user collection. Existing syntax-preserving editing, exact-preimage, concurrency-conflict, and restoration guarantees SHALL apply to user-level documents without weakening their comment and formatting preservation.

#### Scenario: Project install leaves user configuration alone

- **WHEN** a project collection installs a facet with an active server declaration
- **THEN** no user-level tool configuration document SHALL be created or modified

#### Scenario: User install preserves unrelated configuration

- **WHEN** a user collection install adds a server to a user-level configuration document that contains unrelated settings and servers
- **THEN** the unrelated settings and servers SHALL retain their semantic values
- **AND** the edit SHALL preserve their unrelated comments and member order under the existing native-format preservation rules

#### Scenario: User-level document changed concurrently is not overwritten

- **WHEN** a user-level configuration document changes after the user operation planned against it
- **THEN** the operation SHALL fail and name the changed document
- **AND** it SHALL NOT overwrite the newer content

### Requirement: Project and user destinations must not physically alias

Before approval or mutation, the system SHALL reject known project and user destinations for the same adapter that resolve to the same physical file or storage root under the supplied target, home directory, and location inputs. This SHALL include a project rooted at the user's home directory and a project tool directory redirected to its user-level directory. The system SHALL also reject known collection state paths that resolve to another collection's declarations, lockfile, receipt, or lock. This check SHALL be a location-safety check only; it SHALL NOT read another collection's receipt or establish persistent reservations. A user operation without a project target SHALL NOT invent a project root or discover arbitrary projects to perform this check.

When a project rooted at the user's home directory is refused, the failure SHALL explain that materializations previously installed that way must be removed with the previous release before the user collection is adopted.

#### Scenario: Project rooted at home is refused

- **WHEN** a project operation runs with the user's home directory as the project root
- **AND** an adapter's project destination resolves to its user-level destination
- **THEN** the operation SHALL fail before approval or mutation as an unsupported layout
- **AND** the failure SHALL explain the cleanup required before adopting the user collection

#### Scenario: Redirected project tool directory is refused

- **WHEN** a project's tool directory is a link to that tool's user-level directory
- **THEN** a project operation materializing into it SHALL fail before mutation as an unsupported layout

### Requirement: User removal refinement additionally requires binding agreement

In the user collection, removal-only refinement SHALL apply only when every existing refinement condition holds and the participating adapters and their disclosed locations agree with the user receipt's bindings. Every bound adapter needed for cleanup SHALL be available even when removing every facet. Removing every user facet SHALL NOT fetch removed content. A binding disagreement or an unavailable bound adapter SHALL fail the removal before mutation rather than fall back to ordinary resolution, because ordinary resolution is subject to the same binding requirements. Every other refinement disqualification SHALL fall back to ordinary verified resolution as for a project collection. A failed user removal SHALL leave the user declarations, lockfile, receipt, bindings, assets, and native configuration unchanged.

#### Scenario: Witnessed user removal completes offline

- **WHEN** a user removes one facet from the user collection
- **AND** every remaining facet satisfies the existing complete-inventory and local-witness conditions
- **AND** every bound adapter is available and discloses its recorded locations
- **THEN** removal SHALL succeed without fetching, rebuilding, or reverifying remaining facets

#### Scenario: Removing every user facet still needs bound adapters

- **WHEN** a user removes every facet from the user collection while a bound adapter is unavailable
- **THEN** removal SHALL fail before deleting anything
- **AND** it SHALL name the adapter to restore
- **AND** it SHALL NOT fetch removed content

#### Scenario: Binding drift fails removal without fallback

- **WHEN** a user removal finds that a bound adapter now discloses a different location
- **THEN** removal SHALL fail before mutation
- **AND** it SHALL NOT resolve remaining facets in an attempt to proceed

### Requirement: User collection discovery and preview are read-only

Listing, outdated reporting, update discovery, interactive selection, cancelled selection, and dry runs that target the user collection SHALL NOT create the user state directory, declarations, lockfile, receipt, or persistent lock state, SHALL NOT migrate a lockfile or receipt, SHALL NOT fetch facet content merely to inspect versions, SHALL NOT install or select adapters, and SHALL NOT write materialized assets or native configuration. With no user declarations file, listing and outdated reporting SHALL report an empty user collection. Malformed or unsupported user state SHALL retain the operation's existing failure or warning behavior rather than be treated as absent. User-targeted discovery SHALL read only the user collection, and project-targeted discovery SHALL NOT read or report the user collection.

#### Scenario: Listing an uninitialized user collection is empty

- **WHEN** a user lists the user collection before any user facet was added
- **THEN** the result SHALL report an empty collection
- **AND** no user state directory or file SHALL be created

#### Scenario: User outdated report writes nothing

- **WHEN** a user requests the outdated report for the user collection
- **THEN** the user declarations, lockfile, receipt, cache, materialized assets, and native configuration SHALL remain byte-for-byte unchanged

#### Scenario: Legacy receipt is not migrated by discovery

- **WHEN** user or project discovery runs while a receipt uses an earlier version
- **THEN** the receipt SHALL remain byte-for-byte unchanged

#### Scenario: Project discovery ignores the user collection

- **WHEN** a user requests the project outdated report while the user collection declares facets
- **THEN** the report SHALL contain only the project's facets

## MODIFIED Requirements

### Requirement: Each facet entry lists its assets, adapter-agnostically

Every current facet entry SHALL include an `assets` array. Each member SHALL record installation `scope`, authored `type` and `name`, a required materialization disposition, and a required `files` array sorted deterministically by canonical authored path. `scope` SHALL be `system`, `user`, or `project`; `type` SHALL be `skill`, `agent`, or `command`. Each file record SHALL contain canonical inner-archive `path` and `sha256:<hex>` `integrity` over canonical archive bytes. The lockfile SHALL contain no schema-defined adapter-specific fields, hashes, or dispositions.

`scope` SHALL describe the installation scope of the collection containing the lockfile, not a publisher-selected archive property: a project collection's lockfile SHALL record `project` and the user collection's lockfile SHALL record `user`. No supported operation SHALL write `system`, which SHALL remain readable under the published scope vocabulary. Installation scope SHALL NOT change authored names, canonical paths, file integrity, facet integrity, or companions.

The disposition SHALL state authored, aliased with a valid effective name, or omitted. Omitted assets SHALL remain listed with every authored file record. A skill's file records SHALL include `skills/<name>/SKILL.md` and every declared companion. An agent or command SHALL contain exactly its conventional primary file record. Skill companions SHALL remain subordinate to their owning skill, follow its disposition, and SHALL NOT become independent assets or receive their own scopes. Archive-only supplementary files SHALL NOT appear in an asset's files.

Every file record SHALL be derived from its own asset's authored type and name, not merely be a safe, sorted, non-duplicate path. An agent or command entry SHALL contain exactly one record at its canonical primary path; every record in a skill entry SHALL lie beneath that skill's authored root and SHALL include its canonical primary file. A record that no derivation from the owning asset's authored identity could produce SHALL be rejected, so ownership and integrity are never associated with an unrelated archive file. These rules SHALL apply to `0.2`, `0.3`, and `0.4` entries.

#### Scenario: Valid multi-file skill entry

- **WHEN** a skill owns `SKILL.md` and two companions
- **THEN** its current entry SHALL contain three sorted authored file records and a disposition

#### Scenario: Valid single-file asset entry

- **WHEN** an agent entry records scope, type, and authored name `reviewer`
- **THEN** its files SHALL contain exactly `agents/reviewer.md` and its integrity

#### Scenario: Missing files array is rejected

- **WHEN** a `0.3` or `0.4` asset entry omits `files`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Missing disposition is rejected

- **WHEN** a `0.3` or `0.4` asset entry omits materialization
- **THEN** the system SHALL reject the lockfile

#### Scenario: Aliased asset keeps authored files

- **WHEN** skill `review` is aliased to `vendor-review`
- **THEN** its name and paths SHALL remain authored as `review`
- **AND** its disposition SHALL record the alias

#### Scenario: Omitted asset remains listed

- **WHEN** command `deploy` is omitted
- **THEN** its entry SHALL retain `commands/deploy.md` and its integrity

#### Scenario: Companion is not an independent asset

- **WHEN** skill `review` owns companion `references/api.md`
- **THEN** the companion SHALL appear only in the skill's files
- **AND** it SHALL NOT appear as another asset entry

#### Scenario: Archive-only path is excluded

- **WHEN** an archive contains root `README.md`
- **THEN** no asset's files SHALL contain it

#### Scenario: File record unrelated to its asset is rejected

- **WHEN** a command entry records a safe, sorted file record whose path is not that command's canonical primary path
- **THEN** the system SHALL reject the lockfile
- **AND** the rejection SHALL apply equally to `0.2`, `0.3`, and `0.4` entries

#### Scenario: Unknown asset scope

- **WHEN** an asset scope is `global`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Unknown asset type

- **WHEN** an asset type is `hook`
- **THEN** the system SHALL reject the lockfile

#### Scenario: User lockfile records installation scope without changing integrity

- **WHEN** the same facet version is installed in a project collection and in the user collection
- **THEN** the project lockfile's assets SHALL record scope `project` and the user lockfile's assets SHALL record scope `user`
- **AND** both entries SHALL record identical authored names, file paths, file integrity values, facet integrity, and server records

### Requirement: A machine-local record tracks what each project has materialized

The system SHALL maintain a machine-local receipt describing the asset, file, and configuration ownership successfully materialized for each collection: every project collection and the user collection. Where this requirement refers to a project, its rules SHALL apply to the selected collection unless a rule names project collections specifically. The receipt SHALL be separate from version-controlled state, identified by a collection identity that distinguishes project collections from the user collection — the canonical project location for a project collection, and the canonical user collection root, never the invocation directory, for the user collection — and sufficient to delete the assets and configuration entries it records without cache or network access. Each collection SHALL have its own receipt; two collections SHALL never share one, and concurrent operations in different collections SHALL NOT contend on the same receipt. Existing project receipt locations SHALL remain unchanged. The receipt SHALL survive lockfile changes made outside the system. Current receipts SHALL use schema version `0.5` and record only assets actually materialized, with authored identity, authored owned-file paths, and the authored-or-aliased materialization disposition needed to address the effective adapter identity, without storing adapter-encoded hashes. Omitted assets SHALL NOT appear. Receipt `1`, `0.2`, `0.3`, and `0.4` assets SHALL refine losslessly to authored or recorded materialization. A legacy receipt that predates companion ownership MAY be refined to primary-only ownership because legacy installation could not materialize companions. Each receipt version SHALL be selected by exact version. Receipts earlier than `0.5` SHALL refine only as project receipts, retaining exactly their established authority, and SHALL NOT be interpreted as user receipts or gain authority through refinement. The next successful receipt write SHALL emit `0.5`; loading a receipt, discovery, preview, a failed operation, or upgrading the CLI SHALL NOT rewrite it.

A current receipt SHALL additionally record one configuration claim per active, successfully reconciled MCP server declaration, carrying the authored server name, its authored-or-aliased disposition, a content fingerprint of the declaration's canonical semantic form, and the facet integrity that witnessed the claim. Configuration claims SHALL be simultaneously keyed deletion authority and this machine's evidence of prior approval for that effective declaration within the receipt's own collection; omitted declarations SHALL be unrepresentable as claims. Claims SHALL never store commands, arguments, URLs, environment names, or environment values. Receipt `0.4` configuration claims SHALL refine to equivalent claims retaining their ownership and approval evidence for the same project. Receipts earlier than `0.4` SHALL retain their asset ownership but SHALL confer no configuration ownership and no approval evidence; the loader SHALL represent that distinction explicitly rather than synthesizing an empty witnessed configuration record.

The receipt SHALL be the sole authority for materialized ownership. A receipt that cannot be loaded — absent, corrupt, or path-mismatched, including one identifying a different collection — SHALL confer no ownership, and the system SHALL NOT derive ownership from the lockfile in its place, because the lockfile is shared, version-controlled state that describes intended rather than local materialization. A corrupt or path-mismatched receipt SHALL be reported, because it silently withdraws deletion authority the collection previously had; an absent receipt SHALL NOT be, being the ordinary first-operation state. An asset the receipt records SHALL be a **tracked materialization**; an asset on disk that no receipt record covers SHALL be an **untracked materialization**. Desired collection state SHALL authorize writes and tracked ownership SHALL authorize deletion: the system SHALL reconcile every desired effective adapter identity, including one an untracked file already occupies, recording it as tracked thereafter, and SHALL leave untracked files at identities the desired state does not name untouched. Reconciling an identity SHALL mean establishing that its rendered content, metadata, and owned companion set match the desired state before ownership is recorded. Whether that state is established by writing or by determining that it already holds SHALL be an implementation concern, because reconciliation is defined by the state it leaves behind rather than by the operations used to reach it. The same rule SHALL govern MCP configuration identities: desired declarations authorize reconciliation, and recorded configuration claims alone authorize deletion.

For a project collection, receipt ownership SHALL be adapter-agnostic project ownership. A recorded identity SHALL be managed in every selected adapter, and selecting an adapter SHALL delegate management of the identities the project's receipt records within that adapter's storage. The system SHALL NOT record project ownership per adapter, SHALL NOT require separate evidence per adapter before reconciling or deleting a recorded identity, and SHALL NOT fabricate native-location bindings for project receipts. A user collection receipt SHALL retain one adapter-agnostic semantic inventory and SHALL additionally bind it to the adapters and native locations that materialized it, as the user receipt binding requirement specifies.

In non-frozen operations, the receipt, lockfile, collection declarations, materialized assets, and native MCP configuration SHALL commit together: within one operation, handled failures SHALL roll back all of them, and an interruption that prevents rollback SHALL be recoverable by re-running installation, whose per-file integrity reconciliation converges disk, lockfile, and receipt without deleting unowned files. Receipt-driven deletion SHALL aggregate duplicate historical claims by effective adapter identity, delete each obsolete identity at most once, and pass each skill's validated authored companion ownership into the adapter deletion request so removal after a pulled lockfile drops an entry deletes exactly the recorded owned files without cache or network access. Deletion SHALL be limited to state the operation can restore. Every recorded owned file SHALL be removable on its own terms: each is inspected individually and its exact prior bytes recorded, so a recorded skill whose primary file is already gone SHALL still have its recorded companions removed, and a later failure SHALL restore them byte for byte. The receipt SHALL determine what is currently materialized when pulled version-control changes remove lockfile entries. In frozen-lockfile mode, receipt-driven cleanup SHALL begin only after the frozen consistency check passes. If that check rejects an orphaned lockfile entry, installation SHALL fail before cleanup changes any materialized state. Receipt data SHALL be treated as untrusted: collection identity, record shape, and path containment within the selected adapter's storage SHALL be validated before deletion. Invalid or escaping records SHALL be reported and SHALL NOT cause deletion; files not recorded as owned SHALL never be deleted. Frozen reproduction SHALL follow its explicit receipt-persistence exception: a reported receipt-only persistence failure SHALL NOT be treated as an operation-fatal commit failure.

#### Scenario: Pulled change cleans up a multi-file skill

- **WHEN** pulled state removes a facet but the receipt records its effective skill and companions
- **AND** that skill's primary is present on disk
- **THEN** install SHALL supply the validated recorded companion paths in the adapter deletion request
- **AND** it SHALL delete every recorded owned file from each selected adapter
- **AND** no network or cache content SHALL be required

#### Scenario: Pulled change cleans up an owned server entry

- **WHEN** pulled state removes a facet whose receipt configuration claim covers an effective server identity no remaining claim uses
- **THEN** the next operation SHALL remove that complete server entry from every selected adapter
- **AND** no network or cache content SHALL be required for the deletion

#### Scenario: A recorded bundle whose primary is gone still has its companions removed

- **WHEN** an obsolete recorded skill's primary is absent and its recorded companions are present
- **THEN** the system SHALL remove each present recorded companion
- **AND** a later failure in the same operation SHALL restore each of them to its exact prior bytes

#### Scenario: Interrupted install converges on re-run

- **WHEN** installation is interrupted after some skill-bundle writes but before lockfile and receipt commit
- **THEN** re-running SHALL compare locked per-file integrity against disk and complete or repair the bundle
- **AND** the re-run SHALL NOT delete any file not recorded as owned

#### Scenario: Deleting a tracked asset needs neither cache nor network

- **WHEN** an unwanted facet is uncached and its registry unavailable
- **AND** the receipt records its materialization
- **THEN** the system SHALL delete the recorded files using the receipt alone
- **AND** whether the surrounding operation completes offline SHALL depend on the remaining desired state, not on this deletion

#### Scenario: Project without a receipt owns nothing yet

- **WHEN** a project has a lockfile but no receipt
- **THEN** the next operation SHALL treat every materialization as untracked
- **AND** it SHALL NOT delete any file on the strength of a lockfile entry alone
- **AND** it SHALL record ownership only for the identities it reconciles

#### Scenario: Omitted contributions are excluded from receipt

- **WHEN** a desired asset or server declaration is omitted
- **THEN** the system SHALL NOT record it as materialized

#### Scenario: Untracked desired identity is reconciled and tracked

- **WHEN** an untracked asset or MCP entry already occupies an effective identity the desired state names
- **AND** its applicable takeover gate permits continuation
- **THEN** installation SHALL reconcile that identity to the desired state
- **AND** the committed receipt SHALL record that identity as tracked

#### Scenario: Selecting an adapter delegates management of recorded identities

- **WHEN** an adapter is selected after a project already recorded ownership of an effective identity
- **AND** that adapter's storage already contains state at the same identity
- **THEN** reconciliation SHALL manage that identity in the newly selected adapter
- **AND** deletion of that identity SHALL apply to every selected adapter, because ownership is recorded per project rather than per adapter

#### Scenario: Untracked identity outside desired state is left alone

- **WHEN** an untracked asset or MCP entry occupies an effective identity no desired contribution names and no receipt record covers
- **THEN** the system SHALL NOT address or delete it

#### Scenario: Earlier receipts refine directly to current state

- **WHEN** the system loads receipt version `1`, `0.2`, or `0.3`
- **THEN** it SHALL refine each asset to its recorded materialization in the in-memory current `0.5` project receipt shape
- **AND** version `1` SHALL refine to primary-only ownership while `0.2` and `0.3` SHALL retain their complete owned-path sets
- **AND** the refined receipt SHALL carry no configuration claims and confer no MCP approval evidence
- **AND** the next successful receipt write SHALL emit `0.5`, never an intermediate writer format

#### Scenario: Receipt 0.4 keeps its established authority

- **WHEN** the system loads a project's receipt version `0.4`
- **THEN** it SHALL refine to a current `0.5` project receipt retaining the same asset ownership and configuration claims
- **AND** those claims SHALL remain deletion authority and approval evidence for that project only
- **AND** no native-location binding SHALL be fabricated
- **AND** the next successful receipt write SHALL emit `0.5`

#### Scenario: Legacy receipt is never a user receipt

- **WHEN** a receipt earlier than `0.5` is encountered for the user collection
- **THEN** it SHALL confer no user ownership, binding, or approval
- **AND** the system SHALL report that the receipt could not be used

#### Scenario: Reading a receipt does not migrate it

- **WHEN** an operation loads a receipt earlier than `0.5` and then fails, previews, or only discovers versions
- **THEN** the receipt SHALL remain byte-for-byte unchanged

#### Scenario: Pre-current receipt confers no configuration authority

- **WHEN** a project's receipt predates configuration claims
- **AND** desired state declares MCP servers whose entries already exist in a tool's configuration
- **THEN** those entries SHALL be treated as untracked occupancy subject to disclosure
- **AND** every desired declaration SHALL require consent as unapproved

#### Scenario: Escaping receipt path is not deleted

- **WHEN** a receipt companion path resolves outside its selected adapter's storage through traversal, an absolute path, or a link
- **THEN** the system SHALL NOT delete that path
- **AND** it SHALL report the invalid record while continuing to process valid owned paths safely

#### Scenario: Mismatched project receipt confers no ownership

- **WHEN** receipt project identity differs from the active project
- **THEN** the system SHALL NOT delete anything based on that receipt
- **AND** it SHALL NOT recreate ownership from the lockfile in its place
- **AND** it SHALL report that the receipt could not be used
- **AND** it SHALL record ownership only for the identities it reconciles

#### Scenario: Receipt for another collection kind confers no ownership

- **WHEN** a user collection operation loads a receipt identifying a project collection, or a project operation loads a receipt identifying the user collection
- **THEN** the system SHALL NOT delete or approve anything based on that receipt
- **AND** it SHALL report that the receipt could not be used

#### Scenario: Unreadable receipt confers no ownership

- **WHEN** a receipt file exists but cannot be parsed or fails validation
- **THEN** the system SHALL treat every materialization as untracked
- **AND** it SHALL NOT delete any file
- **AND** it SHALL report that the receipt could not be used

#### Scenario: Unowned file survives cleanup

- **WHEN** a skill directory contains a file absent from receipt ownership
- **THEN** skill removal SHALL leave it unchanged

#### Scenario: Configuration claim proves approval without revealing declaration

- **WHEN** a successful operation records an MCP configuration claim
- **THEN** a later operation SHALL be able to determine whether the same effective declaration was approved
- **AND** the stored receipt SHALL NOT reveal the command, URL, environment names, or environment values

#### Scenario: Unsupported receipt version is not shape-reinterpreted

- **WHEN** a reader whose exact supported receipt versions exclude `0.5` encounters a `0.5` receipt
- **THEN** it SHALL reject that receipt as unsupported rather than reinterpret its shape as an older version or derive ownership or approval from it

### Requirement: Namespace collisions are evaluated across the complete desired set before any write

Before writing or deleting any materialized asset, MCP configuration, project manifest, lockfile, or receipt, the system SHALL evaluate every authored contribution from the complete post-operation facet set of the selected collection. This SHALL run for add, install, update, repair, removal, and frozen reproduction, SHALL report every collision group, and SHALL NOT choose a winner from ordering.

Evaluation SHALL be independent per collection. The same effective-name, namespace, name-normalization, and alias and omission rules SHALL apply within a project collection and within the user collection. Contributions from different collections SHALL NOT be combined for collision detection, and the system SHALL NOT report or resolve cross-collection shadowing, which each target tool's own precedence governs.

Text assets SHALL collide by installation scope, materialization namespace, and portable effective name: skills and commands share one namespace and agents occupy another. MCP servers SHALL collide with other servers within the selected collection by portable effective name. A server SHALL NOT collide with any text asset, and skill companions SHALL NOT be independent claimants.

#### Scenario: Added facet collides with installed facet

- **WHEN** an added facet and an already-declared facet each contribute project skill `review`
- **THEN** the system SHALL report both claimants before any write

#### Scenario: Update introduces a collision

- **WHEN** a newly resolved version introduces an asset or server name colliding in its applicable identity space
- **THEN** the system SHALL detect it before materialization

#### Scenario: Skill and command collide

- **WHEN** a skill and command in the same scope have effective name `deploy`
- **THEN** the system SHALL place them in one collision group

#### Scenario: Agent and skill coexist

- **WHEN** an agent and skill share effective name `review`
- **THEN** the system SHALL NOT report a collision between them

#### Scenario: Server and asset coexist

- **WHEN** an MCP server and text asset share effective name `review`
- **THEN** the system SHALL NOT report a collision between them

#### Scenario: All groups are reported

- **WHEN** the desired set contains three collision groups across assets and servers
- **THEN** one evaluation SHALL report all three and every claimant

#### Scenario: Declaration order does not select a winner

- **WHEN** an unresolved collision is present
- **THEN** reordering facet declarations SHALL NOT change the failure or materialize a claimant

#### Scenario: Two user facets collide within the user collection

- **WHEN** two facets in the user collection each contribute skill `review`
- **THEN** the system SHALL report both claimants before any write

#### Scenario: Same skill coexists across collections

- **WHEN** the user collection materializes skill `foo`
- **AND** a project collection materializes skill `foo` from the same or a different facet
- **THEN** neither collection's operation SHALL report a collision for that name
- **AND** each collection SHALL materialize its own copy at its own scope's destinations

### Requirement: Active MCP declarations are configured in every selected adapter

Every active concrete MCP server declaration SHALL be reconciled into every selected adapter's native configuration for the selected collection's installation scope after facet integrity verification: project-scoped configuration for a project collection and user-level configuration for the user collection. One effective server set SHALL apply across adapters. A facet whose only deliverable is a server declaration SHALL install successfully with zero text assets. Installation SHALL NOT launch, contact, authenticate to, or install a declared server.

#### Scenario: Standard-input server reaches every selected adapter

- **WHEN** a facet contributes an active standard-input server and two supporting adapters are selected
- **THEN** both adapters SHALL contain equivalent server configuration at the selected collection's scope after success

#### Scenario: Server-only facet performs meaningful installation

- **WHEN** a facet contains one active server and no text assets
- **THEN** installation SHALL configure the server and succeed with zero materialized assets

#### Scenario: Omitted server is inactive

- **WHEN** project intent omits a declared server
- **THEN** no selected adapter SHALL receive that server
- **AND** no ownership or approval claim SHALL be recorded for it

#### Scenario: Configuration does not execute the server

- **WHEN** a declaration is materialized
- **THEN** installation SHALL NOT start its command, connect to its URL, or collect credentials

#### Scenario: Project server stays project-scoped

- **WHEN** a project collection configures an active Streamable HTTP server
- **THEN** each selected adapter SHALL receive it only in project-scoped configuration

#### Scenario: User server is configured at the user level

- **WHEN** the user collection configures an active Streamable HTTP server
- **THEN** each selected adapter SHALL receive it in its user-level configuration
- **AND** no project-scoped configuration SHALL be modified

### Requirement: MCP server contributions use effective-name collision resolution

Before any mutation, the system SHALL apply recorded aliases and omissions and evaluate every active MCP contribution within the selected collection by portable effective server name. Multiple claims with the same semantic fingerprint SHALL compose into one effective configuration while retaining every claimant. Claims with different fingerprints SHALL form one collision group containing every claimant and SHALL NOT select a winner by ordering. Contributions from different collections SHALL NOT be evaluated together.

Interactive collision resolution SHALL allow each server claimant to keep its authored name, use a valid alias, or be omitted, using the same complete-draft validation and cancellation guarantees as text assets. A server identity SHALL remain separate from every text-asset namespace.

#### Scenario: Different declarations collide

- **WHEN** two facets contribute different declarations at effective name `filesystem`
- **THEN** the system SHALL report both claimants before mutation and SHALL write neither declaration

#### Scenario: Identical declarations compose

- **WHEN** two facets contribute semantically identical declarations at the same effective name
- **THEN** the system SHALL produce one effective configuration retaining both claimants

#### Scenario: Alias resolves a server conflict

- **WHEN** one colliding declaration is aliased to an otherwise unused valid name
- **THEN** the collision-free effective set SHALL contain both servers

#### Scenario: Omission resolves a server conflict

- **WHEN** one colliding declaration is omitted
- **THEN** only the remaining declaration SHALL participate in configuration

#### Scenario: Server and skill names do not collide

- **WHEN** a server and a skill share effective name `review`
- **THEN** the system SHALL NOT place them in one collision group

#### Scenario: All collision groups are reported

- **WHEN** several server and asset collision groups exist
- **THEN** one evaluation SHALL report every group and claimant without choosing winners

#### Scenario: Different collections may declare the same server name

- **WHEN** a project collection and the user collection each declare a different server at effective name `filesystem`
- **THEN** neither collection's operation SHALL report a collision for that name

### Requirement: Unrecognized fields are tolerated

The system SHALL accept lockfiles containing fields not defined in the selected schema. Unrecognized fields SHALL be preserved, not stripped or rejected.

Preservation SHALL survive reconstruction, not only loading. When the system rewrites a lockfile, it SHALL carry forward the unrecognized fields of the top-level document, of every facet entry it still records, of a retained facet's source when the source kind is unchanged, of every asset entry matched by installation scope and authored type and name, of every file record matched by path, and of every previous `0.4` server record matched by authored name within its facet. Where a schema-defined field and an unrecognized field share a name, the schema-defined value SHALL win. Unrecognized fields belonging to a facet, asset, file record, or server record that the new state no longer contains SHALL be dropped with it.

When migrating `0.2` or `0.3`, an extension named `servers` SHALL be replaced by the verified canonical inventory. Its elements SHALL NOT be interpreted as records or as a source of server-record extensions, regardless of resemblance to the new schema. Other retained extension fields SHALL continue to be preserved.

#### Scenario: Unknown field in lockfile

- **WHEN** an otherwise valid lockfile contains a field not defined in its schema (e.g., `generatedAt: "2026-04-18"`)
- **THEN** the system SHALL accept the lockfile
- **AND** the field SHALL be present in the loaded result

#### Scenario: Unknown fields survive migration to the current version

- **WHEN** a non-frozen install migrates a `0.2` or `0.3` lockfile carrying unrecognized fields at the document, facet, source, asset, and file-record levels
- **THEN** the committed `0.4` lockfile SHALL retain those fields except names newly defined by the current schema
- **AND** equivalent preservation SHALL hold for a `0.4` rewrite, including retained server-record extensions

#### Scenario: Removed state takes its unknown fields with it

- **WHEN** a rewrite no longer records a facet that carried an unrecognized field
- **THEN** that field SHALL NOT appear in the rewritten lockfile

#### Scenario: Retained server extensions survive an alias change

- **WHEN** a `0.4` rewrite retains a facet and authored server name but changes its alias
- **THEN** the record's opaque extension fields SHALL survive
- **AND** its new canonical disposition and fingerprint SHALL take precedence over previous values

#### Scenario: Legacy extension contents are not promoted

- **WHEN** a legacy `servers` extension contains apparently valid records with extra fields
- **AND** installation migrates the facet to `0.4`
- **THEN** only verified definitions SHALL supply the canonical inventory
- **AND** the extension's contents SHALL NOT supply server-record metadata or extensions

#### Scenario: Removed server loses its extensions

- **WHEN** a verified update no longer declares a previously recorded server
- **THEN** that server's record and its extension fields SHALL be absent from the new lockfile

### Requirement: Frozen-lockfile install treats the lockfile as authoritative

The system SHALL provide a frozen-lockfile mode for install in which the selected collection's manifest and lockfile are treated as authoritative and reproduced exactly: no extra facets, no missing facets, no source changes, no content changes, and no recorded materialization-intent changes. In this mode the system SHALL NOT perform version resolution, prompt for collision choices, migrate or write the manifest, or write the lockfile. Content download for a locked exact version absent from the cache SHALL remain permitted after pre-fetch consistency checks pass, because downloading already-locked bytes is reproduction, not drift. Because adding or removing a facet changes the locked set, the system SHALL reject a frozen-lockfile operation that carries any explicit add or removal before inspecting the lockfile.

Before fetching content, cleanup, or materialization, the system SHALL verify that the manifest uses a supported form and that the lockfile fully and consistently covers its sources and every materialization disposition the selected format supports. The system SHALL fail without modifying the selected collection if any of the following is true: the operation carries an explicit add or removal; no lockfile exists; the lockfile cannot be read or does not satisfy its selected published schema; the manifest declares an unsupported explicit version; the manifest declares a facet that has no lockfile entry; a lockfile entry's recorded version does not satisfy its manifest specifier; a manifest override requires a disposition its lockfile version cannot represent; overrides differ from recorded dispositions, name an absent recorded contribution, or leave an unresolved effective-name collision in the recorded set; a locked asset's scope disagrees with the selected collection; the lockfile pins a facet the manifest no longer declares; or a git or local facet's manifest source string no longer matches its recorded provenance. Valid legacy unversioned manifests and supported earlier lockfiles SHALL remain reproducible without rewriting when their format-capability, source, content, and approval checks pass. Server checks for legacy formats without inventory SHALL continue from verified definitions after the pre-fetch gates pass.

When the lockfile fully covers the manifest, the system SHALL install exactly the versions, integrity hashes, and effective materialized contributions determined by the supported locked state, downloading any required locked content not cached. It SHALL verify that every facet, including cached content and local sources, reproduces its recorded integrity and SHALL fail if any content does not match. For `0.4`, the complete recorded server inventory SHALL additionally agree with the verified declarations before cleanup or materialization. Because frozen mode never creates a lockfile entry, it SHALL NOT require integrity confirmation against the registry; its only permitted network activity is downloading already-locked content.

Frozen mode constrains the locked set, not the machine's materialized state: assets that the selected collection's receipt shows as materialized but that the lockfile-covered manifest no longer wants SHALL still be removed, while the lockfile and manifest SHALL never be written. Receipt-driven cleanup SHALL begin only after every frozen consistency check passes, and user cleanup SHALL additionally require matching target bindings. After successful materialization, frozen mode SHALL attempt to persist the resulting receipt on a best-effort basis. A receipt-persistence failure SHALL be reported without claiming that the new ownership, bindings, or approval were recorded, and SHALL NOT by itself turn otherwise successful frozen reproduction into a failed installation or rewrite shared intent. This SHALL be the frozen-mode exception to the normal manifest, lockfile, and receipt commit rule.

#### Scenario: Frozen install proceeds when locked state covers intent

- **WHEN** a user runs install in frozen-lockfile mode
- **AND** manifest sources and materialization intent exactly match supported locked state
- **AND** all content, adapter, native-state, and approval checks pass
- **THEN** the system SHALL reproduce exact versions, integrity, and effective contributions without version resolution or prompt
- **AND** it SHALL NOT write the manifest or lockfile

#### Scenario: Frozen mode downloads absent locked content

- **WHEN** a locked exact version's content is absent from the cache
- **AND** the pre-fetch consistency checks pass
- **THEN** the system SHALL download and verify that exact content
- **AND** it SHALL NOT treat the download as drift

#### Scenario: Frozen mode verifies cached content

- **WHEN** cached content differs from locked integrity
- **THEN** the system SHALL fail with an integrity error before materialization
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen verification is independent of cache warmth

- **WHEN** two frozen installs reproduce the same locked facet with warm and cold caches respectively
- **THEN** both SHALL verify and reconcile the same complete authored contributions
- **AND** both SHALL preserve the same authored companion content for materialization

#### Scenario: Frozen reproduction preserves companions

- **WHEN** a frozen install reproduces a skill whose primary and companions already match verified content
- **THEN** it SHALL treat the complete bundle as unchanged
- **AND** it SHALL NOT infer that the companion set is empty merely because content was obtained through a different acquisition path
- **AND** it SHALL NOT delete a verified desired companion

#### Scenario: Frozen mode cleans receipt-only orphan

- **WHEN** manifest and lockfile both dropped a facet still present in the receipt
- **AND** all frozen consistency checks pass and receipt persistence succeeds
- **THEN** receipt-driven cleanup SHALL remove its effective ownership
- **AND** the receipt SHALL be updated so it no longer lists the facet
- **AND** the manifest and lockfile SHALL remain unchanged

#### Scenario: Frozen mode rejects explicit delta

- **WHEN** frozen installation carries an add or removal
- **THEN** it SHALL fail before inspecting the lockfile or resolving any facet
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects missing lockfile

- **WHEN** no lockfile exists
- **THEN** frozen installation SHALL fail with an error stating the lockfile is missing
- **AND** it SHALL NOT create or modify the lockfile

#### Scenario: Frozen mode rejects an unsupported manifest version

- **WHEN** the manifest declares an unsupported explicit `manifestVersion`
- **THEN** frozen installation SHALL fail with the observed and supported versions
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects uncovered facet

- **WHEN** a manifest facet has no lockfile entry
- **THEN** frozen installation SHALL fail identifying that facet
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects version drift

- **WHEN** a locked version does not satisfy its manifest source
- **THEN** frozen installation SHALL fail identifying the facet, manifest specifier, and locked version
- **AND** it SHALL NOT perform version resolution
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects materialization drift

- **WHEN** manifest overrides disagree with recorded dispositions or leave a collision in the locked contribution set
- **THEN** frozen installation SHALL fail identifying the affected contributions
- **AND** it SHALL NOT fetch facet content, prompt, or write state

#### Scenario: Frozen mode rejects stale override

- **WHEN** an override names an asset absent from locked content
- **THEN** frozen installation SHALL fail identifying the facet, type, and authored name
- **AND** it SHALL NOT remove the override or write any state

#### Scenario: Frozen mode rejects orphaned lockfile entry

- **WHEN** the lockfile pins a facet absent from the manifest
- **THEN** frozen installation SHALL fail identifying the orphaned facet and its locked version
- **AND** it SHALL NOT prune the orphaned facet's assets
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects changed git or local source

- **WHEN** manifest source differs from locked git or local provenance
- **THEN** frozen installation SHALL fail identifying the facet, manifest source, and locked source
- **AND** it SHALL NOT clone, resolve, or build from the changed source
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Frozen mode rejects local content drift

- **WHEN** local content no longer reproduces locked integrity
- **THEN** frozen installation SHALL fail with an integrity error rather than rebuilding and overwriting the entry
- **AND** it SHALL leave the manifest, lockfile, receipt, and adapter state unchanged

#### Scenario: Asset aliases remain representable in both disposition-bearing formats

- **WHEN** a `0.3` or `0.4` lockfile records an asset alias matching the project manifest
- **AND** all other frozen checks pass
- **THEN** frozen installation SHALL accept that asset disposition

#### Scenario: Asset-only format refusal reports capability rather than writer version

- **WHEN** a `0.2` lockfile is used with an asset override and no server override
- **THEN** frozen installation SHALL refuse before fetching with `requiredVersion: 0.3`
- **AND** its guidance SHALL explain that a normal install writes the current `0.4` format

#### Scenario: Frozen user receipt persistence failure is reported honestly

- **WHEN** a frozen user install successfully materializes an explicitly approved new server but cannot persist the resulting receipt
- **THEN** it SHALL report successful reproduction with the receipt-persistence failure disclosed
- **AND** the user manifest and lockfile SHALL remain byte-identical
- **AND** it SHALL NOT claim that new ownership, bindings, or approval were persisted
- **AND** a later run without persisted approval SHALL require approval again

### Requirement: Mutable project state is read under the project lock

The system SHALL acquire the selected collection's operation lock before reading any mutable collection state that a commit is derived from, including its declarations, lockfile, and receipt. Every project SHALL retain its independent lock, and every user mutation SHALL acquire the same user collection lock regardless of working directory. A user operation SHALL NOT acquire a project lock, a project operation SHALL NOT acquire the user lock, and no machine-wide lock SHALL serialize unrelated collections. Reading commit-authoritative state before acquiring its lock SHALL NOT occur.

Once the collection's lock can be identified, contention SHALL be the only failure reported before acquiring it. A failure that prevents identifying the user collection, such as a relative Facets metadata root, MAY be reported before lock acquisition and SHALL NOT read collection state. Other failures, including absent, malformed, or unsupported-version declarations, SHALL be reported after acquiring the lock and before mutation.

Advisory reads performed outside the lock for presentation SHALL NOT be reused as the basis of a commit or decide an operation's outcome. Removal SHALL decide which requested facets are declared from state read under the lock, including when every requested name appeared undeclared during pre-lock validation.

A snapshot-bound operation SHALL carry the exact observed states used to present its reviewed plan, acquire the selected collection's lock before resolution, downloads, cache writes, or transaction creation, and compare current state with the carried state before that work begins. A mismatch SHALL fail the operation. It SHALL NOT merge, rebase, or silently re-derive the reviewed plan from changed state.

#### Scenario: Lock contention is reported before project state is examined

- **WHEN** an install runs against a project whose install lock is already held
- **AND** the project manifest is absent, malformed, or declares an unsupported version
- **THEN** the system SHALL report the lock contention
- **AND** the system SHALL NOT report the manifest problem in its place

#### Scenario: A concurrent commit is not overwritten

- **WHEN** another operation commits new project state after this operation begins but before this operation acquires the lock
- **THEN** this operation SHALL derive its commit from the state committed by that operation
- **AND** the earlier snapshot SHALL NOT be written back over it

#### Scenario: A facet declared after validation is still removed

- **WHEN** a removal request names a facet that is not declared when the request is validated, but is declared when the lock is acquired
- **THEN** the system SHALL remove that facet
- **AND** a requested name that is undeclared under the lock SHALL remain a silent no-op

#### Scenario: An entirely undeclared removal request still reaches the commit

- **WHEN** every name in a removal request is undeclared at pre-lock validation
- **AND** one of those names is declared by a concurrent commit before the lock is acquired
- **THEN** the system SHALL remove that facet
- **AND** the operation SHALL NOT report a no-op decided before the lock was held

#### Scenario: A snapshot-bound operation refuses rather than merges

- **WHEN** a snapshot-bound operation acquires the lock and finds that the state it carried has changed
- **THEN** it SHALL fail before performing resolution, downloads, cache writes, or transaction creation
- **AND** it SHALL NOT merge the change into the reviewed plan or re-derive the plan from the new state

#### Scenario: Concurrent user operations from different directories contend

- **WHEN** two user collection operations start from different working directories at the same time
- **THEN** they SHALL contend for the same user collection lock
- **AND** the second SHALL NOT overwrite the first operation's commit from an earlier snapshot

#### Scenario: User and project operations do not contend

- **WHEN** a user collection install and a project install run concurrently
- **THEN** neither SHALL report lock contention caused by the other

#### Scenario: User lock contention precedes state problems

- **WHEN** a user operation runs while the user collection lock is held
- **AND** the user declarations are absent or malformed
- **THEN** the system SHALL report the lock contention rather than the declarations problem

#### Scenario: Reviewed user update rejects changed state

- **WHEN** the user lockfile changes after user update discovery and before application acquires the user collection lock
- **THEN** application SHALL fail as a stale plan without changing cache, collection, materialized, or native configuration state

### Requirement: New or changed MCP declarations require explicit machine-local approval

Before any mutation, the system SHALL require approval for every active `(kind, effective name, semantic declaration)` value not already approved in the selected collection's machine-local receipt. Approval SHALL be collection-local: project approval SHALL NOT authorize user configuration, and user approval SHALL NOT authorize project configuration. Interactive users SHALL receive one MCP-configuration-only request showing every claimant facet and either the exact command, ordered arguments, and environment assignments or the exact URL. A user-collection request SHALL explain its cross-project effect, subject to native overrides and precedence. Approval SHALL apply to the complete displayed set. A changed declaration or effective name SHALL require new approval; an unchanged value already approved by that collection SHALL NOT.

Non-interactive operations with unapproved active declarations SHALL fail before mutation unless approval is supplied. Frozen installation SHALL never prompt but MAY use pre-supplied approval. Approval evidence SHALL be committed only after the complete operation succeeds and SHALL remain machine-local. A fingerprint in a shared cache, a lockfile, or another collection's receipt SHALL NOT substitute for approval.

#### Scenario: Interactive user approves a new command server

- **WHEN** an unapproved standard-input declaration is active
- **THEN** the user SHALL see its claimant facets, effective name, command, every argument, and every environment assignment before any file changes
- **AND** approval SHALL permit installation to continue

#### Scenario: URL declaration is displayed exactly

- **WHEN** an unapproved Streamable HTTP declaration is active
- **THEN** the approval request SHALL display its exact URL

#### Scenario: Unchanged approved declaration does not prompt

- **WHEN** the selected collection's receipt already approves the same effective name and semantic declaration
- **THEN** reproduction SHALL proceed without another MCP approval request

#### Scenario: Changed declaration requires approval again

- **WHEN** an approved declaration changes its command, argument order, environment value, transport, URL, or effective name
- **THEN** the system SHALL request approval for the changed value

#### Scenario: Identical second claimant does not re-prompt

- **WHEN** another facet in the same collection contributes the same semantic declaration at the same effective name
- **THEN** the existing collection approval SHALL cover the effective configuration

#### Scenario: Approval does not travel to another machine

- **WHEN** a teammate installs committed project state whose declarations were approved on a different machine
- **THEN** the teammate's machine SHALL require its own approval before materialization

#### Scenario: Declining changes nothing

- **WHEN** the user declines the MCP configuration request
- **THEN** the operation SHALL fail without changing the selected collection's declarations, lockfile, receipt, assets, or native configuration

#### Scenario: Non-interactive operation requires pre-supplied approval

- **WHEN** a non-interactive operation has unapproved MCP declarations and no pre-supplied approval
- **THEN** it SHALL fail with the complete declaration list before mutation

#### Scenario: Failed operation does not bank approval

- **WHEN** a user approves MCP configuration but a later step fails
- **THEN** the receipt SHALL contain no approval from that failed operation
- **AND** the next attempt SHALL request approval again

#### Scenario: Project approval does not pre-approve non-interactive user installation

- **WHEN** a declaration is approved in a project but not in the user collection, and the user collection installs it non-interactively without supplied approval
- **THEN** the user operation SHALL fail before mutation for lack of user-collection approval
