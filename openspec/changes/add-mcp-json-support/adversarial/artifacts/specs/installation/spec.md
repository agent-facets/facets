## ADDED Requirements

### Requirement: Declared MCP servers are materialized through every selected adapter

When the desired facet set declares MCP servers, installation SHALL materialize each active declaration into every selected adapter's tool-native project configuration as part of the same transactional operation that installs assets. Declarations SHALL contribute no archive entries and no lockfile changes: the lockfile's existing facet integrity already pins the exact manifest containing each declaration. If any selected adapter cannot safely materialize required MCP configuration, the operation SHALL fail before any mutation, identifying every such adapter in one failure. A project whose desired state declares no MCP servers SHALL remain installable with adapters that lack MCP support.

#### Scenario: Declared servers are installed with their facet

- **WHEN** a user adds a facet declaring an MCP server and every selected adapter supports MCP configuration
- **THEN** the operation SHALL materialize the declaration into every selected adapter's project configuration
- **AND** assets and configuration SHALL commit in the same operation

#### Scenario: Unsupported adapter fails the operation before mutation

- **WHEN** active MCP declarations exist and a selected adapter cannot materialize MCP configuration
- **THEN** the operation SHALL fail before any asset or configuration write
- **AND** the failure SHALL identify every selected adapter that lacks MCP support
- **AND** the manifest, lockfile, receipt, materialized assets, and native configuration SHALL remain unchanged

#### Scenario: Text-only project is unaffected by MCP support gaps

- **WHEN** the desired state contains no active MCP declarations
- **AND** a selected adapter lacks MCP support
- **THEN** installation SHALL proceed normally

#### Scenario: Lockfile shape is unchanged by declarations

- **WHEN** an operation installs facets with MCP declarations
- **THEN** the committed lockfile SHALL record no server entries or server dispositions
- **AND** a change to a facet's declarations SHALL be detectable through the facet's recorded integrity

### Requirement: Effective server names compose with the same collision semantics as assets

After applying persisted server aliases and omissions, installation SHALL group every active declaration by effective server name across the complete desired facet set before any mutation. One claim, or multiple claims whose declarations are semantically identical, SHALL produce one effective configuration with every claimant retained for ownership and reporting. Active claims with differing declarations at one effective name SHALL be reported as one complete pre-mutation conflict naming every claimant; the system SHALL NOT choose a winner. A project MAY durably alias a declared server to a different effective name or omit it from the active set through the project manifest, using the same disposition contract as assets; omitted declarations SHALL NOT participate in composition. Server identities SHALL NOT collide with skill, command, or agent identities.

A stale server override — one naming a server absent from the resolved facet — SHALL be reported and pruned only in a successful non-frozen commit; frozen operation SHALL report it as drift and write nothing.

#### Scenario: Two facets with identical declarations share one effective server

- **WHEN** two facets declare semantically identical servers under the same effective name
- **THEN** installation SHALL materialize one effective configuration
- **AND** both facets SHALL be retained as claimants

#### Scenario: Differing declarations at one effective name conflict before mutation

- **WHEN** two facets declare different servers under the same effective name
- **THEN** the operation SHALL fail before any mutation
- **AND** the conflict report SHALL name every claimant facet and summarize each declaration

#### Scenario: Alias changes the effective identity

- **WHEN** a project aliases a facet's server `filesystem` to `project-filesystem`
- **THEN** composition and materialization SHALL use `project-filesystem` as the effective identity
- **AND** the collision that motivated the alias SHALL be resolved

#### Scenario: Omitted server is not materialized

- **WHEN** a project omits a declared server
- **THEN** no selected adapter SHALL receive that declaration
- **AND** a previously materialized entry for it SHALL be removed under the ownership rules

#### Scenario: Server and skill may share a name

- **WHEN** a facet declares a skill `review` and a server `review`
- **THEN** the system SHALL NOT report a collision between them

#### Scenario: Stale server override is pruned only on success

- **WHEN** a resolved facet no longer declares a server named by an override
- **AND** a normal install succeeds
- **THEN** the commit SHALL report and remove that override
- **AND** a failed operation SHALL preserve it

### Requirement: New or changed server declarations require explicit consent before materialization

Materializing an MCP server declaration can cause a tool to execute a command or open a network connection, so installation SHALL treat each new or changed effective declaration as requiring explicit consent before any mutation. Consent SHALL be evaluated per effective identity and declaration content: a declaration previously approved in this project at the same effective name with the same semantic content SHALL NOT prompt again, including on reproduction and when a second facet contributes an identical effective declaration. Approval evidence SHALL be machine-local and SHALL never travel through version-controlled project state, so one machine's approval cannot claim another machine consented.

Interactive operations SHALL present one MCP-configuration consent request covering every unapproved declaration, showing each declaration's claimant facets and its exact command, arguments, and environment assignments, or its exact URL, before anything is written. Declining SHALL end the operation with no mutation. Non-interactive operations SHALL fail before mutation with the complete unapproved list unless the caller supplied an explicit opt-in. Frozen installation SHALL never prompt but MAY use a pre-supplied opt-in; because declarations live in integrity-pinned facet content rather than the lockfile, frozen consent checks MAY require fetching locked content but SHALL still complete before any mutation. Approval evidence SHALL be recorded only through a successful commit: a declined, failed, or rolled-back operation SHALL record nothing.

#### Scenario: First-time declaration is shown in full before any write

- **WHEN** an interactive install encounters a declaration with no prior approval
- **THEN** the user SHALL see the exact command, arguments, and environment assignments, or the exact URL, plus every claimant facet, before any file is modified

#### Scenario: Unchanged approved declaration does not re-prompt

- **WHEN** a previously approved effective declaration is reproduced without change
- **THEN** installation SHALL NOT request consent for it again

#### Scenario: Changed declaration re-prompts

- **WHEN** a facet update changes an approved declaration's command, arguments, environment, or URL
- **THEN** the next operation SHALL require consent for the changed declaration before mutation

#### Scenario: Approval does not travel to another machine

- **WHEN** a teammate installs committed project state whose declarations were approved on a different machine
- **THEN** the teammate's machine SHALL require its own consent before materialization

#### Scenario: Declining consent leaves everything unchanged

- **WHEN** the user declines the MCP consent request
- **THEN** the operation SHALL end with the manifest, lockfile, receipt, materialized assets, and native configuration unchanged
- **AND** no approval evidence SHALL be recorded

#### Scenario: Non-interactive install without opt-in fails with the complete list

- **WHEN** a non-interactive operation encounters unapproved declarations without an explicit opt-in
- **THEN** it SHALL fail before mutation
- **AND** the failure SHALL list every unapproved declaration and its claimant facets

#### Scenario: Failed operation records no approval

- **WHEN** an operation obtains consent but later fails and rolls back
- **THEN** no approval evidence SHALL be recorded
- **AND** the next operation SHALL prompt again

### Requirement: Untracked native server entries are disclosed before adoption or overwrite

When a desired effective server identity already occupies an entry in a selected tool's configuration that this project's machine-local record does not own, installation SHALL disclose that occupancy before mutation as part of the MCP consent request, identifying the adapter, whether the existing entry is semantically equivalent to the desired declaration, and the desired declaration. Upon approval, an equivalent entry SHALL be adopted without rewriting it, and a divergent entry SHALL be overwritten transactionally; either way ownership SHALL be recorded only through the successful commit. Without approval, no takeover SHALL occur. Reconciling an identity the record already owns SHALL NOT be disclosed as a takeover. Deletion SHALL be authorized by recorded ownership alone: an entry the record does not own SHALL never be deleted merely because a declaration, alias, or facet disappeared, and deletion of an owned identity SHALL remove the complete server entry.

#### Scenario: Untracked equivalent entry is adopted without rewriting

- **WHEN** an untracked native entry is semantically equivalent to the desired declaration
- **AND** the user approves the disclosed takeover
- **THEN** the entry SHALL be adopted without a write
- **AND** the commit SHALL record the identity as owned

#### Scenario: Untracked divergent entry is overwritten only after approval

- **WHEN** an untracked native entry diverges from the desired declaration
- **AND** the user approves the disclosed takeover
- **THEN** the entry SHALL be overwritten transactionally
- **AND** cancellation SHALL instead leave the entry unchanged

#### Scenario: Unowned entry survives declaration removal

- **WHEN** a facet stops declaring a server whose native entry the machine-local record does not own
- **THEN** the entry SHALL remain in the tool's configuration untouched

#### Scenario: Owned entry is deleted completely when no claim remains

- **WHEN** no active declaration retains an owned effective server identity
- **THEN** the complete native entry SHALL be removed from every selected adapter
- **AND** unrelated entries SHALL remain

### Requirement: MCP configuration participates in the install transaction

All MCP composition, adapter capability verification, read-only native preparation, and consent SHALL complete before the operation's first mutation. Native configuration SHALL be applied after asset writes and before the manifest, lockfile, and receipt commit, so the interval in which a tool could observe a server that never commits is minimized. A failure after configuration has been applied SHALL restore every modified native document to its exact prior bytes and roll back asset changes, leaving the manifest, lockfile, and receipt untouched. A removal-only operation MAY carry existing configuration claims forward without fetching when local state proves every remaining claim is anchored to the same facet content; when that proof is unavailable, it SHALL fall back to ordinary resolution rather than guess.

#### Scenario: Consent precedes every mutation

- **WHEN** an operation requires MCP consent
- **THEN** no asset write, native configuration write, or project-state write SHALL occur before consent is resolved

#### Scenario: Late failure rolls back configuration byte-exactly

- **WHEN** an operation fails after native MCP configuration has been applied
- **THEN** every modified native document SHALL be restored to its exact prior bytes
- **AND** the manifest, lockfile, and receipt SHALL remain unchanged

#### Scenario: Provable removal-only operation stays offline

- **WHEN** a removal drops one facet and local state proves every remaining configuration claim is anchored to unchanged facet content
- **THEN** the operation SHALL carry the remaining claims forward without fetching
- **AND** it SHALL delete only owned identities no remaining claim uses

#### Scenario: Unprovable removal-only operation falls back

- **WHEN** a removal cannot prove the remaining configuration claims from local state
- **THEN** the operation SHALL fall back to ordinary resolution rather than carry claims forward

### Requirement: MCP configuration outcomes are classified alongside asset outcomes

Installation results SHALL classify MCP configuration work per facet: a declaration, alias, or omission change SHALL be reported as updated even at an unchanged facet version; rewriting a previously approved declaration solely because native state drifted SHALL be reported as repaired; a semantic match SHALL be reported as unchanged. A takeover SHALL be reported alongside the underlying outcome. Summaries SHALL count text assets and MCP configurations separately, so a facet whose only deliverables are server declarations reports meaningful work with zero assets.

#### Scenario: Alias change at an unchanged version is an update

- **WHEN** only a server alias changes for a facet at the same resolved version
- **THEN** the facet SHALL be reported as updated

#### Scenario: Native drift repair is distinguished from intent change

- **WHEN** a previously approved declaration is rewritten because the native entry drifted
- **THEN** the facet SHALL be reported as repaired rather than updated

#### Scenario: Server-only facet reports meaningful work

- **WHEN** a facet contributing only server declarations installs successfully
- **THEN** the summary SHALL report its configuration outcomes
- **AND** it SHALL NOT be presented as having installed nothing

## MODIFIED Requirements

### Requirement: A machine-local record tracks what each project has materialized

The system SHALL maintain a machine-local receipt describing the asset, file, and configuration ownership successfully materialized for each project. The receipt SHALL be separate from version-controlled state, identified by canonical project location, and sufficient to delete the assets and configuration entries it records without cache or network access. Each canonical project location SHALL have its own receipt; two projects SHALL never share one, and concurrent operations in different projects SHALL NOT contend on the same receipt. The receipt SHALL survive lockfile changes made outside the system. Current receipts SHALL use schema version `0.4` and record only assets actually materialized, with authored identity, authored owned-file paths, and the authored-or-aliased materialization disposition needed to address the effective adapter identity, without storing adapter-encoded hashes. Omitted assets SHALL NOT appear. Receipt `1`, `0.2`, and `0.3` assets SHALL refine losslessly to authored or recorded materialization. A legacy receipt that predates companion ownership MAY be refined to primary-only ownership because legacy installation could not materialize companions.

A current receipt SHALL additionally record one configuration claim per active, successfully reconciled MCP server declaration, carrying the authored server name, its authored-or-aliased disposition, and a content fingerprint of the declaration's canonical semantic form. Configuration claims SHALL be simultaneously keyed deletion authority and this machine's evidence of prior approval for that effective declaration; omitted declarations SHALL be unrepresentable as claims. Claims SHALL never store commands, arguments, URLs, or environment values themselves. Receipts earlier than `0.4` SHALL retain their asset ownership but SHALL confer no configuration ownership and no approval evidence; the loader SHALL represent that distinction explicitly rather than synthesizing an empty witnessed configuration record.

The receipt SHALL be the sole authority for materialized ownership. A receipt that cannot be loaded — absent, corrupt, or path-mismatched — SHALL confer no ownership, and the system SHALL NOT derive ownership from the lockfile in its place, because the lockfile is shared, version-controlled state that describes intended rather than local materialization. A corrupt or path-mismatched receipt SHALL be reported, because it silently withdraws deletion authority the project previously had; an absent receipt SHALL NOT be, being the ordinary first-operation state. An asset the receipt records SHALL be a **tracked materialization**; an asset on disk that no receipt record covers SHALL be an **untracked materialization**. Desired project state SHALL authorize writes and tracked ownership SHALL authorize deletion: the system SHALL reconcile every desired effective adapter identity, including one an untracked file already occupies, recording it as tracked thereafter, and SHALL leave untracked files at identities the desired state does not name untouched. Reconciling an identity SHALL mean establishing that its rendered content, metadata, and owned companion set match the desired state before ownership is recorded. Whether that state is established by writing or by determining that it already holds SHALL be an implementation concern, because reconciliation is defined by the state it leaves behind rather than by the operations used to reach it. The same rule SHALL govern MCP configuration identities: desired declarations authorize reconciliation, and recorded configuration claims alone authorize deletion.

Receipt ownership SHALL be adapter-agnostic project ownership. A recorded identity SHALL be managed in every selected adapter, and selecting an adapter SHALL delegate management of the identities the project's receipt records within that adapter's storage. The system SHALL NOT record ownership per adapter, and SHALL NOT require separate evidence per adapter before reconciling or deleting a recorded identity.

The receipt, lockfile, and materialized state SHALL commit together: within one operation, handled failures SHALL roll back all three, and an interruption that prevents rollback SHALL be recoverable by re-running installation, whose per-file integrity reconciliation converges disk, lockfile, and receipt without deleting unowned files. Receipt-driven deletion SHALL aggregate duplicate historical claims by effective adapter identity, delete each obsolete identity at most once, and pass each skill's validated authored companion ownership into the adapter deletion request so removal after a pulled lockfile drops an entry deletes exactly the recorded owned files without cache or network access. Deletion SHALL be limited to state the operation can restore: because a skill bundle is addressed through its primary, an absent primary leaves the recorded companions unreadable as a rollback preimage, so the system SHALL leave those recorded paths untouched rather than perform a deletion a later failure could not undo. The claim SHALL still be dropped when the operation commits, and the paths left behind SHALL be reported as untracked, because a command that reports a removal SHALL NOT leave the user unaware that files remain. The receipt SHALL determine what is currently materialized when pulled version-control changes remove lockfile entries. In frozen-lockfile mode, receipt-driven cleanup SHALL begin only after the frozen consistency check passes. If that check rejects an orphaned lockfile entry, installation SHALL fail before cleanup changes any materialized state. Receipt data SHALL be treated as untrusted: project identity, record shape, and path containment within the selected adapter's storage SHALL be validated before deletion. Invalid or escaping records SHALL be reported and SHALL NOT cause deletion; files not recorded as owned SHALL never be deleted.

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

#### Scenario: Omitted asset is excluded from receipt

- **WHEN** a lockfile asset is omitted
- **THEN** the system SHALL NOT record it as materialized

#### Scenario: Untracked file at a desired identity is reconciled and then tracked

- **WHEN** an untracked file already occupies an effective adapter identity the desired state names
- **THEN** installation SHALL reconcile that identity to the desired state
- **AND** the committed receipt SHALL record that identity as tracked

#### Scenario: Selecting an adapter delegates management of recorded identities

- **WHEN** an adapter is selected after a project already recorded ownership of an effective adapter identity
- **AND** that adapter's storage already contains a file at the same identity
- **THEN** reconciliation SHALL manage that identity in the newly selected adapter
- **AND** deletion of that identity SHALL apply to every selected adapter, because ownership is recorded per project rather than per adapter

#### Scenario: Untracked file outside the desired state is left alone

- **WHEN** an untracked file occupies an effective adapter identity no desired asset names and no receipt record covers
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

## REMOVED Requirements

### Requirement: Declared MCP servers do not block installation

**Reason**: The warn-and-skip contract described speculative server references that no longer validate. Concrete MCP server declarations are now materialized through every selected adapter with explicit consent, so there is no "not yet supported" state to warn about, and the documentation pointer this requirement demanded was never shipped.

**Migration**: Facets with concrete declarations materialize per the MCP requirements above. Manifests carrying old version-string or `{ image }` server references fail validation in every supported manifest format and must be republished with concrete declarations.
