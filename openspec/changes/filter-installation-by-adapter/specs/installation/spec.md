## ADDED Requirements

### Requirement: Explicit adapter targets form an exclusive placement set

The system SHALL treat one or more explicitly named adapters as the exclusive target set for that operation. Every installed adapter capable of holding Facet-managed project state that is not a target SHALL be a purge adapter. When no adapter is named explicitly, every installed materialization-capable adapter SHALL be a target and the purge set SHALL be empty. For an explicit-target operation, the named target set SHALL be the selected-adapter set wherever existing desired-materialization requirements refer to selected adapters; purge adapters SHALL participate only in purge, validation, transaction, and reporting requirements.

#### Scenario: No explicit target preserves existing placement behavior

- **WHEN** a user performs an installation operation without naming an adapter target
- **THEN** every installed materialization-capable adapter SHALL be a target
- **AND** no adapter SHALL be purged merely because of placement scope

#### Scenario: Explicit targets are exclusive

- **WHEN** a user performs an installation operation naming OpenCode and Claude Code as targets
- **THEN** the complete desired project state SHALL be reconciled into OpenCode and Claude Code
- **AND** every other installed adapter capable of holding Facet-managed project state SHALL be a purge adapter

#### Scenario: Adapter targets control placement only

- **WHEN** an operation names an exclusive target set
- **THEN** the project manifest and lockfile SHALL continue to describe one project-wide desired state
- **AND** neither file SHALL record the adapter targets

#### Scenario: An adapter absent from the machine is outside the purge guarantee

- **WHEN** an adapter that previously received project materialization is no longer installed or discoverable
- **THEN** an exclusive-target operation SHALL NOT report that adapter as purged
- **AND** adapter-agnostic receipt ownership SHALL remain available if that adapter later returns

### Requirement: Non-target adapters are purged of project-owned state

For every purge adapter, the system SHALL remove every asset and native MCP entry authorized by the project receipt, including identities that remain in desired project state. The receipt SHALL remain the sole deletion authority. Purging SHALL NOT scan for, adopt, modify, or delete untracked native state, and an authorized identity already absent from a purge adapter SHALL be a successful no-op.

#### Scenario: Still-desired assets are removed from a purge adapter

- **WHEN** the receipt records a desired facet's assets and an installed adapter is outside the explicit target set
- **THEN** the system SHALL remove every recorded owned file for that facet from the purge adapter
- **AND** it SHALL retain the facet in project desired state for reconciliation into the targets

#### Scenario: Multi-file ownership is purged completely

- **WHEN** a purge adapter contains a receipt-owned skill with a primary file and recorded companions
- **THEN** the system SHALL remove every recorded owned file from that adapter
- **AND** it SHALL leave files absent from receipt ownership unchanged

#### Scenario: Desired MCP entry is removed from a purge adapter

- **WHEN** the receipt owns an effective MCP entry that remains desired project-wide
- **AND** an adapter containing that entry is outside the explicit target set
- **THEN** the system SHALL remove the complete owned entry from the purge adapter
- **AND** it SHALL reconcile the desired declaration into every target adapter

#### Scenario: Untracked occupancy in a purge adapter is untouched

- **WHEN** a purge adapter contains an asset or MCP entry that no receipt record covers
- **THEN** the system SHALL leave that state unchanged
- **AND** it SHALL NOT request takeover approval for that state

#### Scenario: Authorized state already absent is a no-op

- **WHEN** the receipt authorizes removal of an identity that is absent from a purge adapter
- **THEN** the purge SHALL succeed for that identity without creating or deleting another file

### Requirement: Target and purge adapters are validated before mutation

Before changing project or adapter files, the system SHALL validate every target adapter and every purge adapter needed to establish the exclusive placement result. A target or purge adapter that is installed but unavailable, broken, API-incompatible, or unable to perform its required transition SHALL cause the complete operation to fail without mutation and SHALL be identified to the user.

#### Scenario: Unavailable target fails safely

- **WHEN** an explicitly named target adapter cannot be loaded
- **THEN** the operation SHALL fail identifying that adapter
- **AND** project, receipt, and adapter files SHALL remain unchanged

#### Scenario: Unavailable purge adapter fails safely

- **WHEN** an installed non-target adapter cannot be loaded for purge planning
- **THEN** the operation SHALL fail identifying that adapter
- **AND** no target or purge mutation SHALL occur

#### Scenario: Target without required MCP support fails

- **WHEN** active desired MCP declarations exist and a target adapter cannot configure them
- **THEN** the operation SHALL fail before mutation identifying that target

#### Scenario: Purge adapter without required MCP removal support fails

- **WHEN** the receipt owns an effective MCP identity that a purge adapter may contain
- **AND** that adapter cannot safely plan removal of the owned native entry
- **THEN** the operation SHALL fail before mutation identifying that purge adapter

#### Scenario: Purge adapter with no MCP work does not fail for that reason

- **WHEN** a purge adapter cannot configure MCP servers
- **AND** the receipt owns no effective MCP identity requiring removal from it
- **THEN** the adapter SHALL NOT fail the operation solely for lacking MCP support

### Requirement: Purge and target placement commit atomically

The system SHALL plan the complete purge and target result before mutation. Purge removals SHALL be applied before target reconciliation, and both phases SHALL form one atomic operation with project manifest, lockfile, and receipt changes. A handled failure SHALL restore every changed file to its exact prior state. When purge and target plans address the same native document, their transitions SHALL compose in purge-then-target order or fail before mutation.

#### Scenario: Target failure restores purge removals

- **WHEN** a purge removes files and later target reconciliation fails
- **THEN** every purged file SHALL be restored to its exact prior bytes
- **AND** project and target state SHALL match their pre-operation state

#### Scenario: Purge failure leaves targets untouched

- **WHEN** a purge transition cannot be applied safely
- **THEN** no target adapter SHALL be changed
- **AND** every earlier purge change SHALL be restored

#### Scenario: Shared native document composes purge before target

- **WHEN** a purge adapter and a target adapter manage the same native configuration document
- **AND** their planned transitions can be composed safely
- **THEN** the committed document SHALL contain the target adapter's desired project entries
- **AND** it SHALL contain none of the purged adapter's receipt-owned project entries

#### Scenario: Uncomposable native document fails before mutation

- **WHEN** purge and target transitions for one native document cannot be composed safely
- **THEN** the operation SHALL fail naming the affected document
- **AND** no project or adapter file SHALL change

### Requirement: Successful exclusive targeting converges placement completely

A successful exclusive-target operation SHALL leave every target adapter reconciled to the complete project desired state and every discoverable purge adapter free of receipt-owned project state. The system SHALL NOT retain deferred placement work or adapter-specific catch-up metadata. A later operation SHALL apply its own target and purge sets independently.

#### Scenario: Add reconciles the complete project into targets

- **WHEN** a user adds facet `cowsay` with OpenCode as the exclusive target
- **THEN** OpenCode SHALL contain every desired project facet including `cowsay`
- **AND** every discoverable purge adapter SHALL contain no receipt-owned project state

#### Scenario: Remove reconciles every remaining facet into targets

- **WHEN** a user removes facet `cowsay` with OpenCode as the exclusive target
- **THEN** `cowsay` SHALL be absent from project desired state
- **AND** OpenCode SHALL contain every remaining desired project facet
- **AND** every discoverable purge adapter SHALL contain no receipt-owned project state

#### Scenario: Later unfiltered install rematerializes every adapter

- **WHEN** an exclusive-target operation previously purged non-target adapters
- **AND** the user later installs without explicit adapter targets
- **THEN** every installed materialization-capable adapter SHALL be reconciled to the complete desired project state

#### Scenario: Opposite target sets converge independently

- **WHEN** one successful operation exclusively targets OpenCode
- **AND** a later successful operation exclusively targets Claude Code
- **THEN** Claude Code SHALL contain the complete desired project state
- **AND** OpenCode SHALL contain no receipt-owned project state

### Requirement: Explicit-target removal resolves target completeness

A remove operation with explicit adapter targets SHALL prove or resolve the complete desired state for every target before mutation. Adapter-agnostic receipt ownership alone SHALL NOT prove that a target currently contains every remaining desired facet after earlier exclusive operations. When local evidence is insufficient, the system SHALL perform ordinary content resolution; if resolution cannot complete, the operation SHALL fail without applying its otherwise-planned purge.

#### Scenario: Filtered removal resolves missing target content

- **WHEN** an explicit-target removal names an adapter that may not contain every remaining desired facet
- **THEN** the system SHALL resolve the remaining desired content before mutation
- **AND** success SHALL leave that target fully reconciled

#### Scenario: Resolution failure preserves purge adapters

- **WHEN** an explicit-target removal cannot resolve content required to complete target state
- **THEN** the operation SHALL fail without purging a non-target adapter
- **AND** project, receipt, and adapter files SHALL remain unchanged

#### Scenario: Receipt-only deletion remains offline

- **WHEN** receipt evidence is sufficient to plan deletion of project-owned state from a purge adapter
- **THEN** that deletion plan SHALL require neither cache nor network content
- **AND** whether the complete operation can proceed offline SHALL depend on proving the remaining target state

### Requirement: Exclusive adapter targeting is permitted in frozen mode

Frozen installation SHALL accept explicit adapter targets. Every frozen consistency, integrity, collision, and consent check SHALL pass before purge or target mutation. Success SHALL leave manifest and lockfile bytes unchanged, purge every discoverable non-target adapter, reconcile the exact locked state into every target adapter, and update only machine-local state.

#### Scenario: Frozen install applies an exclusive target set

- **WHEN** a user runs frozen installation with OpenCode as the exclusive target
- **AND** every frozen consistency and approval check passes
- **THEN** OpenCode SHALL contain the exact locked desired state
- **AND** every discoverable purge adapter SHALL contain no receipt-owned project state
- **AND** manifest and lockfile bytes SHALL remain unchanged

#### Scenario: Frozen failure precedes purge

- **WHEN** frozen consistency, integrity, collision, or consent validation fails
- **THEN** no target or purge adapter SHALL be changed

#### Scenario: Frozen targeting never prompts

- **WHEN** a frozen exclusive-target operation requires an interactive decision
- **THEN** it SHALL fail before mutation unless the decision was validly supplied in advance
- **AND** it SHALL NOT open an interactive prompt

### Requirement: Adapter targets are not persisted

Adapter target and purge sets SHALL exist only for the current invocation. The project manifest, lockfile, and machine-local receipt SHALL NOT record those sets. The receipt SHALL remain schema `0.4` with adapter-agnostic project ownership, and filtered and unfiltered operations that commit the same desired project state SHALL commit the same ownership account.

#### Scenario: Filtered operation retains receipt schema

- **WHEN** an exclusive-target operation succeeds
- **THEN** the receipt SHALL use schema `0.4`
- **AND** it SHALL contain no adapter target, purge, or placement list

#### Scenario: Desired state determines receipt content

- **WHEN** filtered and unfiltered operations commit the same project desired state
- **THEN** their receipts SHALL describe the same project-owned facets, assets, and configuration claims

#### Scenario: Project files contain no target defaults

- **WHEN** an operation uses explicit adapter targets
- **THEN** the manifest and lockfile SHALL contain no adapter target or purge setting

### Requirement: Adapter targeting does not bypass MCP consent

Machine-local MCP approval SHALL continue to gate configuration during exclusive-target operations. Targeting SHALL NOT bypass, narrow, or substitute for consent: a declaration that would require consent in an unfiltered invocation SHALL require the same consent when only some adapters are targeted, and a previously approved effective declaration SHALL NOT require re-approval merely because the target set changed.

#### Scenario: Unapproved declaration still requires consent with explicit targets

- **WHEN** an exclusive-target operation would reconcile an MCP declaration this machine has not approved
- **THEN** the system SHALL require consent before configuring any target adapter
- **AND** targeting fewer adapters SHALL NOT reduce what is disclosed for approval

#### Scenario: Approved declaration is not re-gated by targeting

- **WHEN** an exclusive-target operation reconciles an effective declaration whose approval this machine already evidences
- **THEN** the system SHALL NOT require new approval solely because the target set changed

## MODIFIED Requirements

### Requirement: Adding a facet installs it

When a user adds a facet to a project, the system SHALL fetch its content, verify its integrity, reconcile the complete desired project state into every target adapter, and update the lockfile in a single operation. When the invocation names no explicit adapter targets, every selected adapter SHALL be targeted. When the invocation names an exclusive target set, exactly the named adapters SHALL be targeted and every discoverable non-target adapter SHALL be purged according to receipt ownership. A user SHALL NOT need to run a separate install step after adding. Registry-sourced facets SHALL support unscoped names and scoped names.

#### Scenario: Adding a registry facet installs it

- **WHEN** a user adds a registry facet to a project that has at least one target adapter
- **THEN** the system SHALL update the project manifest to reference the facet
- **AND** the system SHALL fetch the facet's content
- **AND** the system SHALL verify the facet's integrity before any assets are written
- **AND** the system SHALL reconcile the complete desired project state into every target adapter
- **AND** the system SHALL update the lockfile to record the resolved version, integrity hash, and asset list
- **AND** the operation SHALL complete in a single command invocation

#### Scenario: Adding a scoped registry facet installs it

- **WHEN** a user adds `@julian/cowsay` to a project that has at least one target adapter
- **THEN** the system SHALL treat `@julian/cowsay` as a registry facet source
- **AND** the system SHALL fetch, verify, materialize, and lock the scoped facet in a single command invocation

#### Scenario: Adding a git facet installs it

- **WHEN** a user adds a git-source facet to a project that has at least one target adapter
- **THEN** the system SHALL resolve the symbolic ref to a commit
- **AND** the system SHALL fetch the facet's content
- **AND** the system SHALL build the facet locally
- **AND** the system SHALL verify the facet's integrity before any assets are written
- **AND** the system SHALL reconcile the complete desired project state into every target adapter
- **AND** the system SHALL update the lockfile to record the resolved commit, integrity hash, and asset list

#### Scenario: Adding a local facet installs it

- **WHEN** a user adds a local-path facet to a project that has at least one target adapter
- **THEN** the system SHALL build the facet from the local path
- **AND** the system SHALL reconcile the complete desired project state into every target adapter
- **AND** the system SHALL update the lockfile to record the version, integrity hash, and asset list

#### Scenario: Explicit targets exclude every other adapter

- **WHEN** a user adds a facet with one or more explicit adapter targets
- **THEN** the system SHALL reconcile the complete desired project state into every named target
- **AND** it SHALL purge every discoverable non-target adapter according to receipt ownership

#### Scenario: Re-adding a facet at a different version

- **WHEN** a user adds a facet that is already declared in the project manifest
- **AND** the new specifier resolves to a different version than the current one
- **THEN** the system SHALL update the manifest entry to the new specifier
- **AND** the system SHALL replace the previous version in the lockfile and target materialization
- **AND** the user-visible summary SHALL indicate that the facet was updated from the previous version to the new one

#### Scenario: Re-adding the same facet at the same version

- **WHEN** a user adds a facet that is already declared at the same resolved version
- **THEN** the system SHALL leave the manifest unchanged
- **AND** the system SHALL re-verify integrity and reconcile every target to repair any drift
- **AND** the operation SHALL succeed without error

### Requirement: Adding a facet without a selected adapter prompts the user

When a user adds a facet without explicit adapter targets and no selected adapter exists, the system SHALL guide the user through selecting one before installing. In a non-interactive environment, the system SHALL fail with a clear error. Explicit adapter targets SHALL suppress interactive selection and implicit adapter installation.

#### Scenario: Interactive terminal triggers adapter selection

- **WHEN** a user adds a facet in an interactive terminal session
- **AND** the project has no selected adapter
- **AND** the user supplies no explicit adapter target
- **THEN** the system SHALL prompt the user to select one or more adapters
- **AND** if the user selects at least one adapter, the system SHALL proceed with installation
- **AND** if the user cancels selection, the system SHALL leave the project manifest, lockfile, and on-disk adapter state unchanged

#### Scenario: Non-interactive environment fails fast

- **WHEN** a user adds a facet in a non-interactive environment
- **AND** the project has no selected adapter
- **AND** the user supplies no explicit adapter target
- **THEN** the system SHALL exit with a non-zero status without modifying the project
- **AND** the error SHALL direct the user to run interactive adapter selection

#### Scenario: Explicit targets suppress adapter selection

- **WHEN** a user adds a facet with one or more explicit adapter targets
- **THEN** the system SHALL NOT prompt for adapter selection
- **AND** it SHALL NOT install an adapter implicitly

### Requirement: A machine-local record tracks what each project has materialized

The system SHALL maintain a machine-local receipt describing the asset, file, and configuration ownership successfully materialized for each project. The receipt SHALL be separate from version-controlled state, identified by canonical project location, and sufficient to delete the assets and configuration entries it records without cache or network access. Each canonical project location SHALL have its own receipt; two projects SHALL never share one, and concurrent operations in different projects SHALL NOT contend on the same receipt. The receipt SHALL survive lockfile changes made outside the system. Current receipts SHALL use schema version `0.4` and record only assets actually materialized, with authored identity, authored owned-file paths, and the authored-or-aliased materialization disposition needed to address the effective adapter identity, without storing adapter-encoded hashes. Omitted assets SHALL NOT appear. Receipt `1`, `0.2`, and `0.3` assets SHALL refine losslessly to authored or recorded materialization. A legacy receipt that predates companion ownership MAY be refined to primary-only ownership because legacy installation could not materialize companions.

A current receipt SHALL additionally record one configuration claim per active, successfully reconciled MCP server declaration, carrying the authored server name, its authored-or-aliased disposition, a content fingerprint of the declaration's canonical semantic form, and the facet integrity that witnessed the claim. Configuration claims SHALL be simultaneously keyed deletion authority and this machine's evidence of prior approval for that effective declaration; omitted declarations SHALL be unrepresentable as claims. Claims SHALL never store commands, arguments, URLs, environment names, or environment values. Receipts earlier than `0.4` SHALL retain their asset ownership but SHALL confer no configuration ownership and no approval evidence; the loader SHALL represent that distinction explicitly rather than synthesizing an empty witnessed configuration record.

The receipt SHALL be the sole authority for materialized ownership. A receipt that cannot be loaded — absent, corrupt, or path-mismatched — SHALL confer no ownership, and the system SHALL NOT derive ownership from the lockfile in its place, because the lockfile is shared, version-controlled state that describes intended rather than local materialization. A corrupt or path-mismatched receipt SHALL be reported, because it silently withdraws deletion authority the project previously had; an absent receipt SHALL NOT be, being the ordinary first-operation state. An asset the receipt records SHALL be a **tracked materialization**; an asset on disk that no receipt record covers SHALL be an **untracked materialization**. Desired project state SHALL authorize writes and tracked ownership SHALL authorize deletion: the system SHALL reconcile every desired effective adapter identity in every target adapter, including one an untracked file already occupies, recording it as tracked thereafter, and SHALL leave untracked files at identities the desired state does not name untouched. Reconciling an identity SHALL mean establishing that its rendered content, metadata, and owned companion set match the desired state before ownership is recorded. Whether that state is established by writing or by determining that it already holds SHALL be an implementation concern, because reconciliation is defined by the state it leaves behind rather than by the operations used to reach it. The same rule SHALL govern MCP configuration identities: desired declarations authorize reconciliation, and recorded configuration claims alone authorize deletion.

Receipt ownership SHALL be adapter-agnostic project ownership. A recorded identity SHALL be managed in every target adapter, and targeting an adapter SHALL delegate management of the identities the project's receipt records within that adapter's storage. During an exclusive-target operation, the same receipt authority SHALL permit removal of recorded identities from every purge adapter even when those identities remain desired project-wide. The system SHALL NOT record ownership per adapter and SHALL NOT require separate evidence per adapter before reconciling or deleting a recorded identity.

The receipt, lockfile, project manifest, materialized assets, and native MCP configuration SHALL commit together: within one operation, handled failures SHALL roll back all of them, and an interruption that prevents rollback SHALL be recoverable by re-running installation, whose per-file integrity reconciliation converges disk, lockfile, and receipt without deleting unowned files. Receipt-driven deletion SHALL aggregate duplicate historical claims by effective adapter identity, delete each obsolete identity at most once, and pass each skill's validated authored companion ownership into the adapter deletion request so removal after a pulled lockfile drops an entry deletes exactly the recorded owned files without cache or network access. Deletion SHALL be limited to state the operation can restore. Every recorded owned file SHALL be removable on its own terms: each is inspected individually and its exact prior bytes recorded, so a recorded skill whose primary file is already gone SHALL still have its recorded companions removed, and a later failure SHALL restore them byte for byte. The receipt SHALL determine what is currently materialized when pulled version-control changes remove lockfile entries. In frozen-lockfile mode, receipt-driven cleanup SHALL begin only after the frozen consistency check passes. If that check rejects an orphaned lockfile entry, installation SHALL fail before cleanup changes any materialized state. Receipt data SHALL be treated as untrusted: project identity, record shape, and path containment within each target or purge adapter's storage SHALL be validated before deletion. Invalid or escaping records SHALL be reported and SHALL NOT cause deletion; files not recorded as owned SHALL never be deleted.

#### Scenario: Pulled change cleans up a multi-file skill

- **WHEN** pulled state removes a facet but the receipt records its effective skill and companions
- **AND** that skill's primary is present on disk
- **THEN** install SHALL supply the validated recorded companion paths in the adapter deletion request
- **AND** it SHALL delete every recorded owned file from each participating target and purge adapter
- **AND** no network or cache content SHALL be required

#### Scenario: Pulled change cleans up an owned server entry

- **WHEN** pulled state removes a facet whose receipt configuration claim covers an effective server identity no remaining claim uses
- **THEN** the next operation SHALL remove that complete server entry from every participating target and purge adapter
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

#### Scenario: Targeting and purging delegate management of recorded identities

- **WHEN** an adapter is targeted after a project already recorded ownership of an effective identity
- **AND** that adapter's storage already contains state at the same identity
- **THEN** reconciliation SHALL manage that identity in the target adapter
- **AND** an exclusive-target operation SHALL remove the identity from every purge adapter according to the same project-wide ownership

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

- **WHEN** a receipt companion path resolves outside its target or purge adapter's storage through traversal, an absolute path, or a link
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

### Requirement: Removing an undeclared facet is a silent no-op

When a user removes a facet that is not declared in the project manifest, the system SHALL silently ignore the name. The project manifest, lockfile, and receipt SHALL remain unchanged for that name. When every requested name is undeclared under the project lock and no explicit adapter targets were supplied, the operation SHALL succeed, adapter state SHALL remain unchanged, and the system SHALL report that no changes were made. When explicit targets were supplied, the undeclared names SHALL still cause no project desired-state change, but the ordinary exclusive target and purge reconciliation SHALL proceed. That determination SHALL be made by the commit, under the lock — never by a pre-lock read — so a request whose names all appear undeclared SHALL still satisfy the operation's ordinary preconditions, including adapter availability.

#### Scenario: Removing an undeclared facet without explicit targets

- **WHEN** a user removes a facet whose name does not appear in the project manifest
- **AND** the user supplies no explicit adapter target
- **THEN** the system SHALL leave the project manifest, lockfile, receipt, and adapter state unchanged
- **AND** the system SHALL NOT fail with an error

#### Scenario: All requested names are undeclared without explicit targets

- **WHEN** a user removes one or more facets and none are declared in the project manifest
- **AND** no explicit adapter target is supplied
- **THEN** the system SHALL exit successfully
- **AND** the system SHALL report that no changes were made

#### Scenario: Undeclared removal still applies explicit placement

- **WHEN** every requested facet name is undeclared
- **AND** the user supplies one or more explicit adapter targets
- **THEN** the system SHALL make no project desired-state change for those names
- **AND** it SHALL reconcile the complete desired project state into every target
- **AND** it SHALL purge every discoverable non-target adapter

### Requirement: Materialized ownership is reconciled against the complete effective set

The system SHALL plan deletion and replacement from the complete tracked previous ownership and complete desired effective set. Previous ownership SHALL be read from the receipt alone. A materialized identity SHALL be deleted only when the receipt records it and either no desired asset still claims its adapter identity or the adapter is in the purge set for an exclusive-target operation. Cross-facet ownership transfer SHALL replace content without leaving a retained identity deleted in a target adapter; a purge adapter SHALL remove the identity regardless of whether desired state retains it. Duplicate historical claims SHALL be aggregated, each obsolete or purged identity SHALL be deleted at most once per adapter, and all recorded owned companions absent from the target's new owner SHALL be removed while unowned files remain untouched. An identity whose primary is already absent SHALL still have its recorded companions removed, because each is inspected and recorded individually and is therefore restorable on its own.

Changing an alias SHALL delete the old effective identity and reconcile the new one transactionally in every target adapter. Changing to omitted SHALL delete prior target ownership; removing omission SHALL materialize the asset in every target. A disposition-only change SHALL be reported as updated, while disk-only drift SHALL remain repaired. Purge adapters SHALL retain neither the old nor new effective identity when receipt ownership authorizes their removal.

#### Scenario: Ownership transfer retains the identity

- **WHEN** one facet is removed while another desired asset takes its effective name
- **THEN** the identity SHALL contain the new owner's content in every target adapter after success
- **AND** it SHALL NOT be left deleted in a target adapter

#### Scenario: Alias change moves owned files

- **WHEN** an alias changes from `vendor-review` to `partner-review`
- **THEN** the old owned files SHALL be deleted and the new effective identity SHALL be reconciled in every target adapter in one operation
- **AND** neither effective identity SHALL remain in a purge adapter

#### Scenario: An alias change removes a bundle whose primary is gone

- **WHEN** an alias changes and the old effective identity's primary is already absent
- **THEN** the old recorded companions SHALL still be removed
- **AND** a later failure in the same operation SHALL restore each of them to its exact prior bytes
- **AND** the new effective identity SHALL still be reconciled and recorded for the targets

#### Scenario: Historical duplicate claims do not delete a retained target identity

- **WHEN** a receipt has duplicate historical claims for one adapter identity and the desired set retains that identity
- **THEN** the identity SHALL NOT be left deleted in a target adapter
- **AND** companions absent from the retained ownership SHALL be removed

#### Scenario: Both claimants aliased away vacate the authored identity

- **WHEN** a tracked facet is materialized under an authored name, one other facet contributes the same authored name, and the accepted resolution assigns each of the two a distinct alias
- **THEN** the vacated effective identity SHALL be deleted before either alias is written
- **AND** each alias SHALL contain its own facet's authored content in every target adapter
- **AND** the committed receipt SHALL record both aliased identities and SHALL NOT record the vacated one
- **AND** the disposition-only change SHALL be reported as updated while the newly contributing facet is reported as installed

#### Scenario: An authored identity no claimant retains is vacated only when tracked

- **WHEN** every claimant of an authored name is aliased or omitted, so no desired asset retains that effective identity
- **AND** the receipt records that identity
- **THEN** it SHALL be deleted before any alias is written
- **AND** WHEN no receipt record covers it, it SHALL be left in place as an untracked materialization

#### Scenario: Desired identity is deleted from a purge adapter

- **WHEN** the receipt records an effective identity that desired project state retains
- **AND** an installed adapter is in the purge set
- **THEN** the identity SHALL be removed from that adapter
- **AND** it SHALL be reconciled into every target adapter

#### Scenario: A lockfile-only claim authorizes no deletion

- **WHEN** the lockfile records a materialized asset that no receipt record covers
- **THEN** the system SHALL NOT delete anything from a target or purge adapter on the strength of that entry
- **AND** the identity SHALL be reconciled, and only then recorded, if the desired state names it

### Requirement: Removing facets reconciles MCP configuration ownership

Removing a facet SHALL remove an effective MCP entry when machine-local configuration ownership covers it and either no remaining desired or safely carried-forward claim uses the identity or the adapter is in the purge set for an exclusive-target operation. An unowned native entry SHALL never be deleted merely because a facet, alias, lockfile entry, or adapter target changed. A removal that must resolve remaining facets SHALL enter the same MCP approval path as add or install.

A removal-only operation MAY carry configuration claims forward without fetching only when existing local evidence proves each remaining claim is anchored to the same facet integrity and still matches desired project intent. An earlier receipt without configuration claims or any unavailable proof SHALL force ordinary resolution rather than invent ownership. An explicit-target removal SHALL additionally prove complete desired state for every target or perform ordinary resolution before mutation.

#### Scenario: Last owned claimant removes the server

- **WHEN** a removed facet is the last desired claimant of an owned effective server
- **THEN** the system SHALL remove that server from every participating target and purge adapter

#### Scenario: Remaining claimant preserves the server in targets

- **WHEN** another desired facet retains the same effective configuration
- **THEN** removal SHALL preserve or reconcile the native server entry in every target adapter
- **AND** it SHALL remove the owned entry from every purge adapter

#### Scenario: Purge removal requires receipt ownership

- **WHEN** a purge adapter contains a native server entry that no receipt configuration claim covers
- **THEN** the system SHALL leave that entry unchanged

#### Scenario: Pre-0.4 receipt forces resolution

- **WHEN** removal would carry a remaining server claim but the loaded receipt predates configuration ownership
- **THEN** the system SHALL perform ordinary resolution rather than treating the lockfile as deletion authority
