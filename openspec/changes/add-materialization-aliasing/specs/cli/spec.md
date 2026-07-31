## ADDED Requirements

### Requirement: Interactive add and install let users resolve every materialization collision

When `add` or `install` encounters unresolved materialization collisions in an interactive terminal, the system SHALL show one overview containing every collision group and affected asset before materialization begins. Users SHALL be able to focus one group at a time and assign Keep, Alias, or Omit to each claimant. Every claimant SHALL be identified by facet, scope, asset type, authored name, effective name, and current disposition.

The system SHALL request choices only after adapter compatibility and facet integrity have been established. Frozen installation SHALL NOT request choices.

#### Scenario: One collision group is resolved

- **WHEN** two facets contribute project-scoped skill `review` during an interactive add
- **THEN** the system SHALL show both facets and both authored assets in one collision group
- **AND** it SHALL offer Keep, Alias, and Omit for each claimant

#### Scenario: Multiple groups are available from one overview

- **WHEN** an interactive install encounters multiple collision groups
- **THEN** the overview SHALL list every affected asset and its current resolution status
- **AND** the user SHALL be able to open and revise each group before installation resumes

#### Scenario: Every claimant can be omitted

- **WHEN** a user chooses Omit for every claimant in a group
- **THEN** the system SHALL accept the group as resolved

#### Scenario: Frozen installation never prompts

- **WHEN** frozen installation encounters an unresolved collision in an interactive terminal
- **THEN** the system SHALL report the collision without opening the resolution workspace

#### Scenario: Earlier failure prevents prompting

- **WHEN** adapter compatibility or facet integrity validation fails
- **THEN** the system SHALL report that failure without requesting collision choices

### Requirement: Collision choices receive live global and accessible validation

After every Keep, Alias, or Omit edit, the system SHALL reevaluate the complete in-memory choice set and update every affected item's status. The overview and focused group SHALL distinguish unresolved, draft-conflicting, and resolved items using text or icons in addition to red, yellow, and green color. A draft conflict SHALL identify every linked claimant and SHALL remain editable rather than discarding the user's choice.

Alias input SHALL be validated with the published asset-name rules and SHALL display a specific validation reason when invalid. Installation SHALL resume only when every affected item is resolved and the complete final choice set passes validation.

#### Scenario: New alias conflicts with another group

- **WHEN** a user enters an alias already claimed elsewhere in the complete draft
- **THEN** every linked claimant SHALL be marked as a draft conflict
- **AND** the user SHALL be able to navigate to and revise either side

#### Scenario: Previously resolved item becomes conflicting

- **WHEN** a later edit targets the effective name of an item already marked resolved
- **THEN** both items SHALL change to draft-conflicting status

#### Scenario: Invalid alias explains the problem

- **WHEN** a user enters an alias outside the asset-name grammar
- **THEN** the system SHALL display the validation reason
- **AND** it SHALL NOT allow confirmation while that alias remains invalid

#### Scenario: Status does not depend on color alone

- **WHEN** the workspace displays resolution statuses
- **THEN** each status SHALL include a label or icon that distinguishes unresolved, draft-conflicting, and resolved states without color

#### Scenario: Complete collision-free draft resumes installation

- **WHEN** every affected item has a globally unique effective identity or is omitted
- **AND** the user confirms the draft
- **THEN** installation SHALL resume using the confirmed choices

### Requirement: Cancelling collision resolution leaves the project unchanged

Users SHALL be able to cancel the collision workspace, including by interrupting the command. Cancellation SHALL end the operation without persisting draft choices or changing the project manifest, lockfile, receipt, or materialized assets.

#### Scenario: User cancels from the workspace

- **WHEN** a user cancels before confirming a collision-free draft
- **THEN** the command SHALL end without applying any draft choice
- **AND** project and adapter state SHALL remain unchanged

#### Scenario: User interrupts resolution

- **WHEN** a user sends an interrupt while the collision workspace is open
- **THEN** the command SHALL end without displaying a successful install summary
- **AND** project and adapter state SHALL remain unchanged

### Requirement: Non-interactive collision failures are complete and actionable

When `add` or `install` cannot interactively resolve an unresolved collision, the system SHALL write an error to stderr, exit with a non-zero code, and identify every collision group and claimant. For each claimant, the error SHALL identify the facet, scope, type, authored name, and current effective name, and SHALL point to the corresponding expanded `facets.json` entry that can record an alias or omission.

The error SHALL include syntactically valid alias and omission examples. It SHALL NOT select a winner, invent an alias, or present a generated complete resolution as authoritative. It SHALL state that no project or materialized state was changed.

#### Scenario: Non-interactive install reports all groups

- **WHEN** a non-interactive install encounters multiple unresolved collision groups
- **THEN** one failure SHALL list every group and claimant
- **AND** the process SHALL exit with a non-zero code

#### Scenario: Failure shows editable manifest locations

- **WHEN** a claimant requires durable materialization intent
- **THEN** the error SHALL identify its facet, typed asset map, and authored asset key in `facets.json`
- **AND** it SHALL show valid alias and omission snippets for that location

#### Scenario: Failure does not prescribe a winner

- **WHEN** two assets claim the same effective name
- **THEN** the error SHALL NOT describe either claimant as preferred
- **AND** it SHALL NOT derive a replacement alias automatically

#### Scenario: Non-interactive failure confirms no mutation

- **WHEN** collision resolution is unavailable
- **THEN** the error SHALL state that the manifest, lockfile, receipt, and materialized assets were not changed

### Requirement: Users are notified when stale materialization intent is removed

When a successful non-frozen operation removes an override whose authored asset no longer exists, the normal command output SHALL identify the facet, asset type, and authored name. This notice SHALL appear without requiring verbose output. Frozen installation SHALL instead report the stale override as blocking drift.

#### Scenario: Successful install reports pruned intent

- **WHEN** a normal install succeeds after finding an override for a missing authored asset
- **THEN** the output SHALL identify the removed override by facet, type, and authored name
- **AND** the notice SHALL appear without `--verbose`

#### Scenario: Frozen install reports stale intent as drift

- **WHEN** frozen installation finds an override for a missing locked asset
- **THEN** the error SHALL identify the facet, type, and authored name
- **AND** it SHALL state that no override was removed

## MODIFIED Requirements

### Requirement: Add and install render a unified progress view

The `add` and `install` commands SHALL present progress through a single shared rendering. A user watching either command SHALL see the same shape of output: a per-facet section that names each facet, indicates its current stage, and shows whether it succeeded, failed, or is in progress, followed by a final summary that lists each affected facet on its own line.

When interactive materialization choices are required, the same command view SHALL transition from progress to the collision overview and focused resolution workspace, then return to progress after confirmation. It SHALL indicate that installation is awaiting collision resolution. A materialization-disposition change at an unchanged facet version SHALL be reported as an update; repair of disk-only drift SHALL remain reported as a repair. When materialization dispositions affect the result, the final summary SHALL show every aliased asset's authored name together with its effective materialized name and SHALL identify every omitted asset as omitted.

#### Scenario: Single-facet operation shows per-facet detail

- **WHEN** a user runs `add` or `install` with exactly one facet to install or update
- **THEN** the rendered view SHALL show the facet's name and its current stage as it progresses through fetch, verification, build, collision checking, and materialization
- **AND** on completion the view SHALL show a one-line summary of the facet's resolved version

#### Scenario: Multi-facet operation shows aggregate progress

- **WHEN** a user runs `add` or `install` with multiple facets to install or update
- **THEN** the rendered view SHALL show progress for each facet
- **AND** on completion the view SHALL show one summary line per affected facet identifying the action and resolved version

#### Scenario: No-op install renders an empty summary

- **WHEN** a user runs `install` and the lockfile already matches on-disk state
- **THEN** the view SHALL render a summary indicating no changes were applied
- **AND** the process SHALL exit with code 0

#### Scenario: Progress pauses for collision choices

- **WHEN** an interactive operation finishes resolving and verifying facets but requires collision choices
- **THEN** the view SHALL indicate that installation is awaiting resolution
- **AND** after confirmation it SHALL return to progress without starting a separate command output stream

#### Scenario: Disposition-only change is shown as an update

- **WHEN** an alias or omission changes while the facet version remains unchanged
- **THEN** the final summary SHALL classify the facet as updated rather than repaired

#### Scenario: Summary shows aliases and omissions

- **WHEN** an install materializes skill `review` as `vendor-review` and omits command `deploy`
- **THEN** the summary SHALL show `review` together with `vendor-review`
- **AND** it SHALL identify `deploy` as omitted
