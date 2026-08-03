## ADDED Requirements

### Requirement: Active MCP declarations are configured in every selected adapter

Every active concrete MCP server declaration SHALL be reconciled into every selected adapter's project-scoped native configuration after facet integrity verification. One effective server set SHALL apply across adapters. A facet whose only deliverable is a server declaration SHALL install successfully with zero text assets. Installation SHALL NOT launch, contact, authenticate to, or install a declared server.

#### Scenario: Standard-input server reaches every selected adapter

- **WHEN** a facet contributes an active standard-input server and two supporting adapters are selected
- **THEN** both adapters SHALL contain equivalent project-scoped server configuration after success

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

### Requirement: New or changed MCP declarations require explicit machine-local approval

Before any mutation, the system SHALL require approval for every active `(kind, effective name, semantic declaration)` value not already approved in the machine-local receipt. Interactive users SHALL receive one MCP-configuration-only request showing every claimant facet and either the exact command, ordered arguments, and environment assignments or the exact URL. Approval SHALL apply to the complete displayed set. A changed declaration or effective name SHALL require new approval; an unchanged previously approved value SHALL not.

Non-interactive operation SHALL fail before mutation unless MCP approval was supplied. Frozen installation SHALL never prompt but MAY use pre-supplied approval. Approval evidence SHALL be committed only after the complete operation succeeds and SHALL remain machine-local.

#### Scenario: Interactive user approves a new command server

- **WHEN** an unapproved standard-input declaration is active
- **THEN** the user SHALL see its claimant facets, effective name, command, every argument, and every environment assignment before any file changes
- **AND** approval SHALL permit installation to continue

#### Scenario: URL declaration is displayed exactly

- **WHEN** an unapproved Streamable HTTP declaration is active
- **THEN** the approval request SHALL display its exact URL

#### Scenario: Unchanged approved declaration does not prompt

- **WHEN** the receipt already approves the same effective name and semantic declaration
- **THEN** reproduction SHALL proceed without another MCP approval request

#### Scenario: Changed declaration requires approval again

- **WHEN** an approved declaration changes its command, argument order, environment value, transport, URL, or effective name
- **THEN** the system SHALL request approval for the changed value

#### Scenario: Identical second claimant does not re-prompt

- **WHEN** another facet contributes the same semantic declaration at the same effective name
- **THEN** the existing project approval SHALL cover the effective configuration

#### Scenario: Approval does not travel to another machine

- **WHEN** a teammate installs committed project state whose declarations were approved on a different machine
- **THEN** the teammate's machine SHALL require its own approval before materialization

#### Scenario: Declining changes nothing

- **WHEN** the user declines the MCP configuration request
- **THEN** the operation SHALL fail without changing the project manifest, lockfile, receipt, assets, or native configuration

#### Scenario: Non-interactive operation requires pre-supplied approval

- **WHEN** a non-interactive operation has unapproved MCP declarations and no pre-supplied approval
- **THEN** it SHALL fail with the complete declaration list before mutation

#### Scenario: Failed operation does not bank approval

- **WHEN** a user approves MCP configuration but a later step fails
- **THEN** the receipt SHALL contain no approval from that failed operation
- **AND** the next attempt SHALL request approval again

### Requirement: MCP server contributions use effective-name collision resolution

Before any mutation, the system SHALL apply recorded aliases and omissions and evaluate every active MCP contribution by project scope and portable effective server name. Multiple claims with the same semantic fingerprint SHALL compose into one effective configuration while retaining every claimant. Claims with different fingerprints SHALL form one collision group containing every claimant and SHALL NOT select a winner by ordering.

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

### Requirement: MCP aliases and omissions are durable project intent

A server alias SHALL change only the effective configuration name and SHALL NOT change the authored declaration or its facet integrity. An omission SHALL remove the declaration from active composition. One disposition SHALL apply across every selected adapter. Recorded server dispositions SHALL survive source changes, failed operations, and disappearance of the collision that motivated them.

When a disposition names a server absent from the resolved facet, a successful non-frozen operation SHALL report and prune it in the final commit. A failed operation SHALL preserve it. Frozen installation SHALL report it as drift and SHALL NOT prune it.

#### Scenario: Alias survives reproduction

- **WHEN** committed project intent aliases server `filesystem` to `project-filesystem`
- **THEN** another machine SHALL reproduce the effective name without collision prompting

#### Scenario: Alias change moves the effective entry

- **WHEN** a tracked alias changes to a new effective name
- **THEN** the old owned entry SHALL be removed and the new entry reconciled transactionally

#### Scenario: Failed install retains stale server intent

- **WHEN** an operation discovers an override for a server no longer declared but later fails
- **THEN** the project manifest SHALL retain the override

#### Scenario: Successful install prunes stale server intent

- **WHEN** a non-frozen operation succeeds after discovering a stale server override
- **THEN** it SHALL report and remove that override in the successful commit

### Requirement: Untracked occupied MCP entries require approval before takeover

When an active effective server name already occupies an entry in a selected adapter and machine-local configuration ownership does not cover it, the MCP approval request SHALL disclose the adapter, desired declaration, and whether native semantic comparison found the existing entry equivalent. Approval SHALL authorize no-write adoption of an equivalent entry or transactional replacement of a divergent entry. Declining SHALL occur before any mutation. An already-owned desired entry SHALL reconcile without a takeover warning, and an unowned entry outside the desired set SHALL remain untouched.

#### Scenario: Equivalent native entry is adopted without rewriting

- **WHEN** an unowned native entry is semantically equivalent and the user approves takeover
- **THEN** the native document SHALL remain unchanged
- **AND** successful commit SHALL record ownership

#### Scenario: Divergent native entry is replaced after approval

- **WHEN** an unowned native entry differs and the user approves takeover
- **THEN** the entry SHALL be replaced transactionally with the desired configuration

#### Scenario: Declined takeover has no mutation to undo

- **WHEN** the user declines an MCP takeover
- **THEN** the complete operation SHALL end with every project and native file unchanged

#### Scenario: Owned entry does not warn

- **WHEN** the receipt already owns the desired effective server identity
- **THEN** the system SHALL reconcile it without a takeover warning

### Requirement: MCP configuration is prepared before mutation and applied after assets

The system SHALL complete facet verification, effective-name composition, selected-adapter capability checks, native MCP document parsing, and all MCP approval before the first mutation. A parse failure, native conflict, unsupported selected adapter, unresolved desired-state collision, or declined approval SHALL leave all project and adapter state unchanged. Native MCP changes SHALL be applied after desired asset writes and immediately before final project-state commit.

#### Scenario: Invalid native configuration blocks asset writes

- **WHEN** a selected adapter's native MCP document cannot be parsed safely
- **THEN** the operation SHALL fail before writing or deleting any asset

#### Scenario: Unsupported adapter precedes approval

- **WHEN** an active declaration cannot be handled by a selected adapter
- **THEN** the operation SHALL fail before requesting MCP approval or mutating state

#### Scenario: Successful ordering applies configuration last

- **WHEN** an operation writes both assets and MCP configuration
- **THEN** desired asset writes SHALL complete before native MCP configuration changes

### Requirement: Failed operations restore native configuration exactly

When an operation fails after changing one or more native MCP documents, the system SHALL restore every document's exact prior bytes and restore every asset and project-state file changed by the operation. Restoration SHALL preserve comments, formatting, and member order. No new configuration ownership or approval evidence SHALL survive the failed operation.

#### Scenario: Later adapter failure restores earlier configuration

- **WHEN** one selected adapter changes its native document and a later selected adapter fails
- **THEN** the earlier document SHALL match its exact pre-operation bytes

#### Scenario: Final commit failure restores configuration and assets

- **WHEN** native configuration and assets changed but final project-state commit fails
- **THEN** every affected file SHALL be restored to its pre-operation state
- **AND** no new receipt claim SHALL remain

### Requirement: Installation verifies integrity-pinned server declarations before configuration

Concrete declarations SHALL be verified as part of the integrity-protected embedded facet manifest before any native MCP change. Frozen reproduction SHALL derive concrete declarations from the exact integrity-pinned facet content.

#### Scenario: Tampered declaration blocks configuration

- **WHEN** resolved facet content changes a declaration without reproducing locked integrity
- **THEN** installation SHALL fail before any native MCP write

### Requirement: Frozen installation reconciles MCP configuration without changing shared intent

Frozen installation SHALL derive MCP declarations from the exact integrity-pinned facet content and dispositions from the supported project manifest. It SHALL NOT write or migrate the project manifest or lockfile and SHALL NOT prompt. Before any cleanup or materialization, it SHALL fail on an unresolved effective-server collision, stale server override, unsupported selected adapter, invalid native configuration, integrity mismatch, or unapproved declaration without pre-supplied approval. Native configuration and the machine-local receipt MAY be reconciled when every frozen consistency check passes.

#### Scenario: Frozen reproduction configures an approved server

- **WHEN** frozen installation has a covering lockfile, valid server dispositions, and sufficient machine-local approval
- **THEN** it SHALL reconcile the exact locked facet's active declarations
- **AND** it SHALL leave the project manifest and lockfile unchanged

#### Scenario: Frozen reproduction never prompts

- **WHEN** an active declaration lacks machine-local approval during frozen installation
- **THEN** the operation SHALL fail before mutation unless approval was pre-supplied
- **AND** it SHALL NOT open an interactive request

#### Scenario: Frozen server conflict changes nothing

- **WHEN** frozen desired state contains conflicting declarations at one effective name
- **THEN** installation SHALL fail with every claimant identified
- **AND** it SHALL leave project, receipt, asset, and native configuration state unchanged

#### Scenario: Frozen stale server override is blocking drift

- **WHEN** a server override names no declaration in the integrity-pinned facet
- **THEN** frozen installation SHALL report the stale intent and SHALL NOT prune or write it

#### Scenario: Frozen cleanup removes a receipt-only server orphan

- **WHEN** the manifest and lockfile no longer desire an effective server still owned by the receipt
- **AND** every frozen consistency check passes
- **THEN** the system SHALL remove the owned native entry and update the receipt
- **AND** it SHALL leave the manifest and lockfile unchanged

### Requirement: MCP outcomes are reported separately from text assets

Installation results SHALL distinguish MCP configurations from text assets and SHALL report added, updated, unchanged, aliased, omitted, removed, conflicted, unsupported, and takeover outcomes. A server-only facet SHALL report meaningful configuration work with zero assets. An alias, omission, or declaration change at the same facet version SHALL count as updated; rewriting approved native drift SHALL count as repaired; a semantic match SHALL count as unchanged.

#### Scenario: Server-only result is not a no-op

- **WHEN** a server-only facet adds one native entry
- **THEN** the summary SHALL report one MCP configuration added and zero assets

#### Scenario: Equivalent takeover is unchanged

- **WHEN** an equivalent untracked entry is adopted
- **THEN** the result SHALL report unchanged configuration and takeover accepted

#### Scenario: Divergent takeover is repaired

- **WHEN** a divergent untracked entry is overwritten after approval
- **THEN** the result SHALL report repaired configuration and takeover accepted

#### Scenario: Disposition-only change is updated

- **WHEN** a server alias or omission changes at the same facet version
- **THEN** the facet outcome SHALL be updated rather than repaired

### Requirement: Removing facets reconciles MCP configuration ownership

Removing a facet SHALL remove an effective MCP entry only when machine-local configuration ownership covers it and no remaining desired or safely carried-forward claim uses the identity. An unowned native entry SHALL never be deleted merely because a facet, alias, or lockfile entry disappeared. A removal that must resolve remaining facets SHALL enter the same MCP approval path as add or install.

A removal-only operation MAY carry configuration claims forward without fetching only when existing local evidence proves each remaining claim is anchored to the same facet integrity and still matches desired project intent. An earlier receipt without configuration claims or any unavailable proof SHALL force ordinary resolution rather than invent ownership.

#### Scenario: Last owned claimant removes the server

- **WHEN** a removed facet is the last desired claimant of an owned effective server
- **THEN** the system SHALL remove that server from every selected adapter

#### Scenario: Remaining claimant preserves the server

- **WHEN** another desired facet retains the same effective configuration
- **THEN** removal SHALL preserve the native server entry

#### Scenario: Pre-0.4 receipt forces resolution

- **WHEN** removal would carry a remaining server claim but the loaded receipt predates configuration ownership
- **THEN** the system SHALL perform ordinary resolution rather than treating the lockfile as deletion authority

## MODIFIED Requirements

### Requirement: A machine-local record tracks what each project has materialized

The system SHALL maintain a machine-local receipt describing the asset, file, and configuration ownership successfully materialized for each project. The receipt SHALL be separate from version-controlled state, identified by canonical project location, and sufficient to delete the assets and configuration entries it records without cache or network access. Each canonical project location SHALL have its own receipt; two projects SHALL never share one, and concurrent operations in different projects SHALL NOT contend on the same receipt. The receipt SHALL survive lockfile changes made outside the system. Current receipts SHALL use schema version `0.4` and record only assets actually materialized, with authored identity, authored owned-file paths, and the authored-or-aliased materialization disposition needed to address the effective adapter identity, without storing adapter-encoded hashes. Omitted assets SHALL NOT appear. Receipt `1`, `0.2`, and `0.3` assets SHALL refine losslessly to authored or recorded materialization. A legacy receipt that predates companion ownership MAY be refined to primary-only ownership because legacy installation could not materialize companions.

A current receipt SHALL additionally record one configuration claim per active, successfully reconciled MCP server declaration, carrying the authored server name, its authored-or-aliased disposition, a content fingerprint of the declaration's canonical semantic form, and the facet integrity that witnessed the claim. Configuration claims SHALL be simultaneously keyed deletion authority and this machine's evidence of prior approval for that effective declaration; omitted declarations SHALL be unrepresentable as claims. Claims SHALL never store commands, arguments, URLs, environment names, or environment values. Receipts earlier than `0.4` SHALL retain their asset ownership but SHALL confer no configuration ownership and no approval evidence; the loader SHALL represent that distinction explicitly rather than synthesizing an empty witnessed configuration record.

The receipt SHALL be the sole authority for materialized ownership. A receipt that cannot be loaded — absent, corrupt, or path-mismatched — SHALL confer no ownership, and the system SHALL NOT derive ownership from the lockfile in its place, because the lockfile is shared, version-controlled state that describes intended rather than local materialization. A corrupt or path-mismatched receipt SHALL be reported, because it silently withdraws deletion authority the project previously had; an absent receipt SHALL NOT be, being the ordinary first-operation state. An asset the receipt records SHALL be a **tracked materialization**; an asset on disk that no receipt record covers SHALL be an **untracked materialization**. Desired project state SHALL authorize writes and tracked ownership SHALL authorize deletion: the system SHALL reconcile every desired effective adapter identity, including one an untracked file already occupies, recording it as tracked thereafter, and SHALL leave untracked files at identities the desired state does not name untouched. Reconciling an identity SHALL mean establishing that its rendered content, metadata, and owned companion set match the desired state before ownership is recorded. Whether that state is established by writing or by determining that it already holds SHALL be an implementation concern, because reconciliation is defined by the state it leaves behind rather than by the operations used to reach it. The same rule SHALL govern MCP configuration identities: desired declarations authorize reconciliation, and recorded configuration claims alone authorize deletion.

Receipt ownership SHALL be adapter-agnostic project ownership. A recorded identity SHALL be managed in every selected adapter, and selecting an adapter SHALL delegate management of the identities the project's receipt records within that adapter's storage. The system SHALL NOT record ownership per adapter, and SHALL NOT require separate evidence per adapter before reconciling or deleting a recorded identity.

The receipt, lockfile, project manifest, materialized assets, and native MCP configuration SHALL commit together: within one operation, handled failures SHALL roll back all of them, and an interruption that prevents rollback SHALL be recoverable by re-running installation, whose per-file integrity reconciliation converges disk, lockfile, and receipt without deleting unowned files. Receipt-driven deletion SHALL aggregate duplicate historical claims by effective adapter identity, delete each obsolete identity at most once, and pass each skill's validated authored companion ownership into the adapter deletion request so removal after a pulled lockfile drops an entry deletes exactly the recorded owned files without cache or network access. Deletion SHALL be limited to state the operation can restore: because a skill bundle is addressed through its primary, an absent primary leaves the recorded companions unreadable as a rollback preimage, so the system SHALL leave those recorded paths untouched rather than perform a deletion a later failure could not undo. The claim SHALL still be dropped when the operation commits, and the paths left behind SHALL be reported as untracked, because a command that reports a removal SHALL NOT leave the user unaware that files remain. The receipt SHALL determine what is currently materialized when pulled version-control changes remove lockfile entries. In frozen-lockfile mode, receipt-driven cleanup SHALL begin only after the frozen consistency check passes. If that check rejects an orphaned lockfile entry, installation SHALL fail before cleanup changes any materialized state. Receipt data SHALL be treated as untrusted: project identity, record shape, and path containment within the selected adapter's storage SHALL be validated before deletion. Invalid or escaping records SHALL be reported and SHALL NOT cause deletion; files not recorded as owned SHALL never be deleted.

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

#### Scenario: A recorded bundle whose primary is gone is retained rather than half-deleted

- **WHEN** an obsolete recorded skill's primary is absent, so its recorded companions cannot be captured for rollback
- **THEN** the system SHALL NOT issue a deletion for that identity
- **AND** the committed receipt SHALL drop the claim regardless
- **AND** the operation SHALL report the recorded paths it left behind as untracked and requiring manual cleanup

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
- **THEN** it SHALL refine each asset to its recorded materialization in the in-memory current `0.4` receipt shape
- **AND** version `1` SHALL refine to primary-only ownership while `0.2` and `0.3` SHALL retain their complete owned-path sets
- **AND** the refined receipt SHALL carry no configuration claims and confer no MCP approval evidence
- **AND** the next successful receipt write SHALL emit `0.4`, never an intermediate writer format

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

### Requirement: Facet operations require compatible selected adapters before mutation

Before adding, removing, or installing facets, the system SHALL verify that every selected installed adapter declares an API in the current exact adapter API support set. If a selected adapter is missing its declaration, has a malformed or unsupported declaration, conflicts with its recorded package declaration, or cannot be loaded as a valid adapter, the operation SHALL fail before invoking any adapter contract method or writing project or materialized state. The failure SHALL identify every incompatible selected adapter and provide the best available compatible-install command. The system SHALL NOT automatically upgrade or replace an incompatible adapter during a facet operation.

This adapter-compatibility preflight SHALL run before archive-version dispatch and before any per-file integrity reconciliation, so an adapter declaring the superseded positional API `0.0` SHALL cause the current CLI to fail on the adapter — with reinstall guidance — before the archive's `facetVersion` is examined. The adapter API axis and the archive-format axis SHALL be classified independently.

Facet removal of tracked materialization SHALL remain independent of cached facet content and network access, but it SHALL still require compatible selected adapters because deleting materialized assets or MCP configuration invokes each selected adapter's contract. A removal whose remaining desired state is untracked SHALL be permitted to resolve, because it must materialize that state before recording ownership of it.

When active MCP declarations exist, the system SHALL additionally require every selected adapter to implement API `0.2` with MCP server support. A selected API `0.1` adapter or API `0.2` adapter that declares `mcpServers: false` SHALL remain usable when no active declaration exists but SHALL join one complete unsupported-adapter failure when one does.

#### Scenario: Adding a facet with an incompatible selected adapter changes nothing

- **WHEN** a user adds a facet
- **AND** a selected installed adapter does not declare an API in the current exact support set
- **THEN** the operation SHALL fail before any facet is materialized
- **AND** no adapter contract method SHALL be invoked
- **AND** the project manifest, lockfile, install receipt, materialized assets, and native MCP configuration SHALL remain unchanged
- **AND** the error SHALL direct the user to install a compatible adapter

#### Scenario: Positional 0.0 adapter blocks a facet operation before archive dispatch

- **WHEN** a user adds or installs a facet whose archive uses `facetVersion: 0.2`
- **AND** a selected installed adapter declares the positional API `0.0`
- **AND** the CLI's current exact support set excludes `0.0`
- **THEN** the operation SHALL fail on the incompatible adapter before the archive version is dispatched
- **AND** no adapter contract method SHALL be invoked
- **AND** the project manifest, lockfile, install receipt, materialized assets, and native MCP configuration SHALL remain unchanged
- **AND** the error SHALL direct the user to reinstall a compatible adapter

#### Scenario: Installing with several incompatible adapters reports all of them

- **WHEN** a user installs the project's declared facets
- **AND** more than one selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** the operation SHALL fail before any materialization write
- **AND** the failure SHALL identify every incompatible selected adapter and every selected adapter that cannot be loaded
- **AND** each compatibility failure SHALL include its best available repair command

#### Scenario: Removing a facet does not bypass adapter compatibility

- **WHEN** a user removes a facet
- **AND** a selected installed adapter is incompatible or cannot be loaded as a valid adapter
- **THEN** the operation SHALL fail before deleting any materialized asset or MCP configuration
- **AND** the project manifest, lockfile, install receipt, materialized assets, and native MCP configuration SHALL remain unchanged

#### Scenario: Compatible selected adapters allow facet operations to proceed

- **WHEN** a user adds or installs a facet
- **AND** every selected installed adapter loads as a valid adapter and declares an API in the current exact support set
- **THEN** the operation SHALL proceed through the applicable fetch, integrity verification, materialization, and project-state update requirements

#### Scenario: Previous tagged adapter serves asset-only desired state

- **WHEN** every selected adapter belongs to the current exact support set and no active MCP declaration exists
- **THEN** the operation SHALL proceed through applicable asset behavior

#### Scenario: Active MCP declaration requires MCP support

- **WHEN** active MCP declarations exist and selected adapters include API `0.1` or `mcpServers: false`
- **THEN** the operation SHALL fail before mutation
- **AND** it SHALL identify every adapter that needs upgrade or server omission

#### Scenario: Facet operation does not auto-upgrade an incompatible adapter

- **WHEN** a facet operation detects an incompatible selected adapter or missing MCP support
- **THEN** the system SHALL NOT download or activate a replacement adapter automatically
- **AND** the failure SHALL direct the user to an explicit adapter install command

### Requirement: Namespace collisions are evaluated across the complete desired set before any write

Before writing or deleting any materialized asset, MCP configuration, project manifest, lockfile, or receipt, the system SHALL evaluate every authored contribution from the complete post-operation facet set. This SHALL run for add, install, update, repair, removal, and frozen reproduction, SHALL report every collision group, and SHALL NOT choose a winner from ordering.

Text assets SHALL collide by scope, materialization namespace, and portable effective name: skills and commands share one namespace and agents occupy another. MCP servers SHALL collide with other servers by project scope and portable effective name. A server SHALL NOT collide with any text asset, and skill companions SHALL NOT be independent claimants.

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

### Requirement: Project-manifest format migration is transactional

A successful non-frozen add, install, update, or removal SHALL write current `manifestVersion: 0.2`, including when reading valid legacy unversioned or version `0.1` input. A failed operation SHALL leave the prior bytes unchanged. Frozen installation SHALL accept supported earlier input when consistency checks pass and SHALL NOT migrate or rewrite it. Expanded entries in an unversioned manifest and unsupported explicit versions SHALL fail before mutation.

#### Scenario: Successful normal install migrates unversioned input

- **WHEN** a normal install succeeds from a valid unversioned compact manifest
- **THEN** the committed manifest SHALL declare `manifestVersion: 0.2`
- **AND** every previously declared facet entry SHALL be preserved with unchanged meaning

#### Scenario: Successful normal install migrates version 0.1

- **WHEN** a non-frozen operation succeeds from a valid `manifestVersion: 0.1` document
- **THEN** the committed manifest SHALL declare `manifestVersion: 0.2`

#### Scenario: Failed operation does not migrate

- **WHEN** an operation fails while reading valid earlier project-manifest input
- **THEN** the manifest SHALL remain byte-for-byte in its earlier format

#### Scenario: Frozen operation retains earlier manifest

- **WHEN** frozen installation succeeds with supported unversioned or `0.1` input
- **THEN** it SHALL NOT rewrite the manifest

## REMOVED Requirements

### Requirement: Declared MCP servers do not block installation

**Reason**: Concrete MCP declarations are now validated, approved, and materialized. Speculative reference forms fail validation instead of installing with a skip warning.

**Migration**: Authors SHALL republish old references as concrete current-format declarations. Users SHALL approve active declarations or record aliases and omissions through project materialization intent.
