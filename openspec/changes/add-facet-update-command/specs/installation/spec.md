## ADDED Requirements

### Requirement: Update discovery reports registry-resolved choices

For every registry-backed manifest entry with usable local resolution state, the system SHALL report the exact locked version as Current, the exact version the authored specifier resolves to as Target, and the exact version resolved from `latest` as Latest. Target SHALL satisfy the authored specifier. Registry resolution SHALL remain caller-relative and SHALL use the same available credentials as other registry reads.

When the authored specifier is exact, Target SHALL be taken from local state rather than resolved: the facet is checkable only because its locked version satisfies that specifier, and an exact specifier admits exactly one version. The system SHALL NOT issue a registry lookup for such a Target, and SHALL NOT carry registry metadata for it — a Target equal to Current can never be selected, so no release is ever installed for it.

The system SHALL treat the registry as authoritative for resolving each supported manifest specifier and `latest`. Returned facet identities and versions SHALL be validated before they are presented or selected; a mismatched identity, unsupported exact-version form, unusable integrity value, or Target that does not satisfy its authored specifier SHALL fail discovery.

#### Scenario: Exact pin has a fixed Target

- **WHEN** a manifest pins `1.2.0`, the lockfile records Current `1.2.0`, and the registry resolves Latest `2.0.0`
- **THEN** discovery SHALL report Target `1.2.0`
- **AND** discovery SHALL report Latest `2.0.0`
- **AND** discovery SHALL issue no registry lookup for that facet's Target

#### Scenario: A pinned facet whose installed release was withdrawn

- **WHEN** a manifest pins a version the registry can no longer resolve
- **AND** the lockfile records that version as Current
- **THEN** discovery SHALL still report it as Target and Current
- **AND** the rest of the project's facets SHALL still be planned

#### Scenario: Major wildcard resolves its Target

- **WHEN** a manifest declares `1.*` and the registry resolves that specifier to `1.8.0`
- **THEN** discovery SHALL report Target `1.8.0`

#### Scenario: Minor wildcard resolves its Target

- **WHEN** a manifest declares `1.4.*` and the registry resolves that specifier to `1.4.7`
- **THEN** discovery SHALL report Target `1.4.7`

#### Scenario: Bare wildcard and latest use registry latest

- **WHEN** a manifest declares `*` or `latest`
- **AND** the registry resolves Latest to `3.0.0`
- **THEN** discovery SHALL report `3.0.0` as both Target and Latest

#### Scenario: Invalid resolved target fails discovery

- **WHEN** the registry response identifies another facet, returns a non-supported exact version, omits usable integrity, or returns a Target outside the authored specifier
- **THEN** discovery SHALL fail before presenting an actionable plan
- **AND** no project or machine-local state SHALL change

### Requirement: Update discovery requires usable local resolution state

A registry facet SHALL be checkable only when the lockfile contains a matching, valid registry entry whose exact Current version satisfies the manifest specifier. Update discovery SHALL NOT re-resolve Current or require the locked version to remain available from the registry. If any registry facet has missing, mismatched, invalid, or drifted local resolution state, discovery SHALL fail with every affected facet name and SHALL direct the user to run `facet install`.

Git and local facet sources SHALL be reported as unsupported for update discovery and SHALL NOT prevent otherwise valid registry facets from being checked or updated.

#### Scenario: Missing lock entry requires install

- **WHEN** the manifest declares a registry facet that has no matching lockfile entry
- **THEN** update discovery SHALL fail and name that facet
- **AND** the failure SHALL direct the user to run `facet install`

#### Scenario: Every unusable registry entry is reported

- **WHEN** multiple registry facets have missing, mismatched, invalid, or drifted local resolution state
- **THEN** one discovery failure SHALL identify every affected facet
- **AND** no actionable update plan SHALL be presented

#### Scenario: Locked Current need not remain available

- **WHEN** a valid lockfile entry records an exact Current version satisfying the manifest specifier
- **AND** that exact version is no longer available from the registry
- **THEN** update discovery SHALL still use the locked version as Current
- **AND** it SHALL NOT fail solely because Current cannot be resolved again

#### Scenario: Unsupported sources do not block registry updates

- **WHEN** a project contains usable registry facets together with git or local facets
- **THEN** discovery SHALL mark the git and local facets unsupported
- **AND** it SHALL continue checking the usable registry facets

### Requirement: Update discovery is complete or fails without a partial plan

The system SHALL complete every required Target and Latest lookup before presenting an actionable update plan. If any required lookup fails, the complete discovery SHALL fail and SHALL NOT present the successful subset as actionable. Discovery SHALL preserve project order when pairing results with facets and determining which lookup failure to report.

#### Scenario: One lookup failure rejects the whole discovery

- **WHEN** Target and Latest resolution succeeds for some registry facets but a required resolution fails for another
- **THEN** the system SHALL fail discovery
- **AND** it SHALL NOT present the successful subset as an actionable update plan
- **AND** no project or machine-local state SHALL change

#### Scenario: A lookup that throws is reported as a failure, not raised

- **WHEN** a required registry lookup rejects rather than returning a failure
- **THEN** discovery SHALL report it as a structured discovery failure
- **AND** the error SHALL NOT escape update discovery

#### Scenario: Concurrent failures have deterministic reporting order

- **WHEN** more than one required registry lookup fails
- **THEN** the system SHALL report the first failure according to the original project lookup order
- **AND** network completion order SHALL NOT change which failure is reported

### Requirement: Update modes select only advancing versions

Plain update SHALL select Target for every registry facet whose Target is newer than Current. Latest mode SHALL select Latest for every registry facet whose Latest is newer than Current, regardless of whether the authored specifier permits Latest. No mode SHALL select a version equal to or older than Current.

#### Scenario: Plain update respects a bounded range

- **WHEN** Current is `1.2.0`, Target is `1.8.0`, and Latest is `2.0.0`
- **AND** the user requests plain update
- **THEN** the selected version SHALL be `1.8.0`

#### Scenario: Latest mode crosses a bounded range

- **WHEN** Current is `1.2.0`, Target is `1.8.0`, and Latest is `2.0.0`
- **AND** the user requests latest mode
- **THEN** the selected version SHALL be `2.0.0`

#### Scenario: Exact pin is unchanged by plain update

- **WHEN** an exact manifest pin makes Target equal Current
- **AND** Latest is newer than Current
- **THEN** plain update SHALL leave that facet unselected
- **AND** latest mode MAY select Latest

#### Scenario: Older registry choices never downgrade Current

- **WHEN** Target or Latest is equal to or older than Current
- **THEN** that choice SHALL NOT be selectable or applied

### Requirement: Latest selection preserves manifest specifier style

When Latest is selected, the system SHALL preserve the authored specifier's style while changing only the version components needed to include the selected exact version. An exact pin SHALL become the selected exact version. A major wildcard SHALL become the selected major followed by `.*`. A minor wildcard SHALL become the selected major and minor followed by `.*`. The authored `*` and `latest` forms SHALL remain unchanged. Selecting Target SHALL leave the authored specifier unchanged.

#### Scenario: Target preserves authored range

- **WHEN** a facet authored as `1.*` selects Target `1.8.0`
- **THEN** the committed manifest specifier SHALL remain `1.*`

#### Scenario: Latest rewrites an exact pin

- **WHEN** a facet authored as `1.2.0` selects Latest `2.4.1`
- **THEN** the committed manifest specifier SHALL be `2.4.1`

#### Scenario: Latest rewrites a major wildcard

- **WHEN** a facet authored as `1.*` selects Latest `2.4.1`
- **THEN** the committed manifest specifier SHALL be `2.*`

#### Scenario: Latest rewrites a minor wildcard

- **WHEN** a facet authored as `1.2.*` selects Latest `2.4.1`
- **THEN** the committed manifest specifier SHALL be `2.4.*`

#### Scenario: Floating forms remain unchanged

- **WHEN** a facet authored as `*` or `latest` selects a newer exact version
- **THEN** the committed manifest SHALL preserve the authored `*` or `latest` form unchanged

### Requirement: Selected updates install exactly the reviewed versions

Application SHALL install the exact Target or Latest version selected from the prepared plan and SHALL use the registry integrity information obtained during discovery. It SHALL NOT repeat version resolution for a selected target. A newer release published after discovery SHALL NOT change the selected exact version.

For selected facets, application SHALL ignore the old lock entry as a version anchor while retaining it for ownership reconciliation and the previous-version summary. Unselected facets SHALL continue to reproduce their satisfying locked versions. Existing materialization overrides SHALL remain attached to every selected facet.

#### Scenario: Publication after discovery does not change selection

- **WHEN** a user reviews and selects Target `1.5.0`
- **AND** `1.6.0` is published before application begins
- **THEN** application SHALL install `1.5.0`
- **AND** it SHALL NOT repeat range resolution and substitute `1.6.0`

#### Scenario: Selected facet does not reuse its old lock anchor

- **WHEN** a selected facet is locked at `1.2.0` and its reviewed target is `1.5.0`
- **THEN** application SHALL resolve content for exact version `1.5.0`
- **AND** the resulting summary SHALL identify the transition from `1.2.0` to `1.5.0`

#### Scenario: Unselected facet remains reproducible

- **WHEN** one candidate facet is selected and another candidate facet is not selected
- **THEN** application SHALL update only the selected facet
- **AND** the unselected facet SHALL continue to use its satisfying locked version

#### Scenario: Materialization overrides survive a version update

- **WHEN** a selected facet has existing alias or omission overrides
- **THEN** application SHALL preserve those overrides in the project manifest
- **AND** the selected version's contributions SHALL be materialized using the preserved intent

#### Scenario: Alias disposition is recorded at the updated version

- **WHEN** a selected facet whose skill `review` is aliased to `vendor-review` updates to a newer version that still contains that skill
- **THEN** the skill SHALL remain materialized as `vendor-review`
- **AND** the lockfile SHALL record the alias disposition with the facet's new exact version

#### Scenario: Omission disposition is recorded at the updated version

- **WHEN** a selected facet with an omitted asset updates to a newer version that still contains that asset
- **THEN** the asset SHALL remain omitted
- **AND** the lockfile SHALL list the asset with its omitted disposition and the facet's new exact version

### Requirement: Selected facet updates are one verified transaction

All selected facets SHALL pass the same cache audit, content download, integrity verification, complete-set collision evaluation, MCP consent, asset takeover, ownership reconciliation, receipt update, materialization, native configuration, and rollback requirements as other installation operations. The project manifest, lockfile, receipt, materialized assets, and native configuration SHALL commit together for the complete selected set or SHALL roll back together on a handled failure.

#### Scenario: Multiple selected updates commit together

- **WHEN** every selected facet resolves, verifies, composes, and materializes successfully
- **THEN** all selected version transitions and project records SHALL commit in one operation

#### Scenario: One selected update fails verification

- **WHEN** one selected facet fails integrity verification
- **THEN** no selected update SHALL remain committed
- **AND** the project SHALL report whether every touched file was restored

#### Scenario: Updated content introduces a collision

- **WHEN** selected versions introduce an unresolved asset or MCP server collision
- **THEN** the system SHALL follow the existing interactive or non-interactive collision behavior before committing project state
- **AND** cancellation or unresolved failure SHALL leave the project unchanged

#### Scenario: Updated content requires MCP consent

- **WHEN** selected versions introduce unapproved MCP declarations
- **THEN** the system SHALL follow the existing consent requirements before mutation
- **AND** declining or lacking required consent SHALL leave the project unchanged

### Requirement: Prepared updates reject stale project state

Update discovery and selection SHALL remain read-only and SHALL capture the exact observed states of the project manifest and lockfile. Discovery SHALL re-check both files before returning a plan and SHALL reject the plan if either changed during discovery. Before application performs resolution, cache writes, downloads, or transaction creation, it SHALL acquire the project install lock and compare the current manifest and lockfile states with the reviewed states. Any mismatch SHALL fail as a stale plan, SHALL direct the user to rerun update, and SHALL leave project and machine-local state unchanged.

#### Scenario: Manifest changes during discovery

- **WHEN** the project manifest changes while update discovery is resolving registry choices
- **THEN** discovery SHALL fail without returning an actionable plan
- **AND** no project or machine-local state SHALL change

#### Scenario: Lockfile changes after the plan is reviewed

- **WHEN** the lockfile changes after discovery but before application acquires the project lock
- **THEN** application SHALL fail as a stale plan
- **AND** the failure SHALL direct the user to rerun update
- **AND** no cache, project, materialized, adapter, or native configuration state SHALL change

#### Scenario: Unchanged reviewed state may be applied

- **WHEN** the manifest and lockfile exactly match the states captured by discovery when application acquires the project lock
- **THEN** application MAY proceed with the selected exact versions

### Requirement: Discovery and preview are free of installation side effects

Preparing an update plan, presenting interactive selection, cancelling selection, and completing a dry run SHALL NOT download facet content, populate the facet cache, install or select adapters, create persistent project-lock state, or modify the project manifest, lockfile, receipt, materialized assets, or native configuration.

#### Scenario: Discovery performs no content work

- **WHEN** the system successfully discovers Target and Latest choices
- **THEN** it SHALL NOT download facet archives or populate the facet cache
- **AND** it SHALL NOT modify project or adapter state

#### Scenario: Dry run performs no installation work

- **WHEN** a user completes a non-interactive or interactive update dry run
- **THEN** no adapter SHALL be installed or selected
- **AND** no project, cache, materialized, or native configuration state SHALL change
