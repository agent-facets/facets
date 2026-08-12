## ADDED Requirements

### Requirement: Users approve new or changed MCP configuration before any write

Interactive `add`, `install`, and `remove` operations SHALL display one MCP-configuration-only approval screen when active declarations are new or changed for the current machine. The screen SHALL identify every effective server, claimant facet, and exact command with arguments and environment assignments or exact URL. A distinct section SHALL identify every untracked native entry that will be adopted or replaced and the affected adapter. Approval SHALL accept the complete displayed set; declining SHALL exit non-zero and leave all state unchanged.

The MCP approval screen SHALL NOT include asset collision choices or asset takeover confirmations. Declaration contents SHALL NOT be reproduced in verbose or persistent diagnostic output outside this approval screen.

#### Scenario: Complete command declaration is displayed

- **WHEN** an interactive install encounters an unapproved standard-input declaration
- **THEN** the approval screen SHALL show the effective name, every claimant facet, command, ordered arguments, and environment assignments before any write

#### Scenario: Multiple declarations use one MCP screen

- **WHEN** several declarations and native takeovers require approval
- **THEN** one MCP configuration screen SHALL contain the complete set in distinct declaration and takeover sections

#### Scenario: Declining MCP consent changes nothing

- **WHEN** the user declines the MCP configuration screen
- **THEN** the command SHALL exit non-zero and state that no changes were made
- **AND** the manifest, lockfile, receipt, assets, and native configuration SHALL remain unchanged

#### Scenario: Unchanged approved declaration does not prompt

- **WHEN** every active declaration is already approved at the same effective name and content
- **THEN** the command SHALL proceed without displaying the MCP approval screen

#### Scenario: Verbose output does not leak declarations

- **WHEN** an operation uses verbose output
- **THEN** commands, URLs, and environment values SHALL appear only in the interactive approval display

### Requirement: Non-interactive MCP configuration requires explicit opt-in

The `add`, `install`, and `remove` commands SHALL each accept `--accept-mcp` as the sole non-interactive MCP acceptance mechanism. No second MCP override flag SHALL be introduced. A non-interactive operation with unapproved declarations or MCP native-entry takeovers SHALL fail before mutation unless the flag is supplied. Frozen installation SHALL never prompt and MAY use the same pre-supplied flag. The flag SHALL NOT authorize asset takeover.

#### Scenario: Add without opt-in reports every declaration

- **WHEN** non-interactive `add` encounters unapproved declarations without `--accept-mcp`
- **THEN** it SHALL fail with every effective name, claimant facet, and complete command or URL
- **AND** it SHALL state that no state changed

#### Scenario: Install with opt-in proceeds

- **WHEN** non-interactive `install --accept-mcp` encounters otherwise valid unapproved declarations
- **THEN** it SHALL proceed without prompting

#### Scenario: Remove exposes the same flag

- **WHEN** a user requests help for `remove`
- **THEN** the help SHALL list `--accept-mcp` with the same approval meaning as `add` and `install`

#### Scenario: Frozen mode never prompts

- **WHEN** frozen installation needs MCP approval
- **THEN** it SHALL honor `--accept-mcp` when supplied and otherwise fail without opening a prompt

#### Scenario: Flag does not accept asset takeover

- **WHEN** `--accept-mcp` is supplied and an untracked asset destination is encountered interactively
- **THEN** the asset SHALL retain its separate continue-or-cancel screen

### Requirement: Users confirm untracked asset takeovers separately

When interactive asset materialization reaches a desired destination occupied by an untracked asset, the command SHALL show a separate continue-or-cancel screen naming the effective destination, with continue selected by default. Cancellation SHALL exit non-zero and report whether prior operation work was restored. Non-interactive commands SHALL continue automatically without an asset prompt.

#### Scenario: Asset takeover defaults to continue

- **WHEN** interactive materialization encounters an occupied untracked asset destination
- **THEN** the screen SHALL identify the destination and select Continue by default

#### Scenario: Asset takeover cancellation reports restoration

- **WHEN** the user cancels after earlier writes
- **THEN** the command SHALL exit non-zero and report that the complete operation was restored or identify any restoration failure

#### Scenario: Non-interactive asset takeover does not prompt

- **WHEN** non-interactive materialization encounters an occupied untracked asset destination
- **THEN** the command SHALL continue automatically

### Requirement: Unsupported MCP adapters are reported completely

When active MCP declarations exist and selected adapters include API `0.1` adapters or API `0.2` adapters without MCP support, the command SHALL fail before prompting or mutation. One error SHALL identify every unsupported selected adapter and SHALL direct the user to upgrade the adapter or omit the active server declarations.

#### Scenario: Every unsupported adapter is listed

- **WHEN** two selected adapters cannot configure active MCP declarations
- **THEN** one failure SHALL name both adapters and give actionable remediation

#### Scenario: Omitted declarations avoid the failure

- **WHEN** every authored server is omitted and no active declaration remains
- **THEN** an adapter without MCP support SHALL NOT fail the operation for that reason

### Requirement: Command output reports MCP configuration outcomes

Command summaries SHALL report MCP servers separately from text assets and SHALL identify added, updated, unchanged, aliased, omitted, repaired, removed, conflicted, unsupported, and takeover outcomes. An aliased server SHALL show authored and effective names. A server-only facet SHALL not be presented as a no-op. Declaration contents SHALL remain absent from summaries and diagnostics.

#### Scenario: Server-only facet has a meaningful summary

- **WHEN** a facet configures one server and zero text assets
- **THEN** the summary SHALL report the server addition and zero assets

#### Scenario: Alias and omission are visible

- **WHEN** server `filesystem` is materialized as `project-filesystem` and server `docs` is omitted
- **THEN** the summary SHALL show both authored and effective alias names and identify `docs` as omitted

#### Scenario: Remove reports native server deletion

- **WHEN** removal deletes an owned effective server entry
- **THEN** the summary SHALL identify the removed server and affected adapters

#### Scenario: Drift-only rewrite is repaired

- **WHEN** an approved desired declaration rewrites only native drift
- **THEN** the summary SHALL classify the configuration as repaired

#### Scenario: Semantic match is unchanged

- **WHEN** native configuration already matches semantically
- **THEN** the summary SHALL classify it as unchanged

## MODIFIED Requirements

### Requirement: Interactive add and install let users resolve every materialization collision

When `add` or `install` encounters unresolved asset or MCP server collisions in an interactive terminal, the system SHALL show one overview containing every collision group and claimant before materialization begins. Users SHALL be able to focus one group at a time and assign Keep, Alias, or Omit to each claimant. Asset claimants SHALL be identified by facet, scope, asset type, authored name, effective name, and disposition. MCP claimants SHALL be identified by facet, authored server name, effective name, declaration summary, and disposition.

The system SHALL request choices only after adapter compatibility and facet integrity have been established. Frozen installation SHALL NOT request choices.

#### Scenario: One asset collision group is resolved

- **WHEN** two facets contribute project-scoped skill `review` during an interactive add
- **THEN** the system SHALL show both facets and assets in one collision group
- **AND** it SHALL offer Keep, Alias, and Omit for each claimant

#### Scenario: One server collision group is resolved

- **WHEN** two facets contribute different declarations at effective server name `filesystem`
- **THEN** the system SHALL show both facets, declarations, names, and dispositions in one group
- **AND** it SHALL offer Keep, Alias, and Omit for each claimant

#### Scenario: Multiple groups are available from one overview

- **WHEN** an interactive install encounters several asset and server collision groups
- **THEN** the overview SHALL list every claimant and its resolution status
- **AND** the user SHALL be able to revise each group before installation resumes

#### Scenario: Every claimant can be omitted

- **WHEN** a user chooses Omit for every claimant in a group
- **THEN** the system SHALL accept the group as resolved

#### Scenario: Frozen installation never prompts

- **WHEN** frozen installation encounters an unresolved collision in an interactive terminal
- **THEN** it SHALL report the collision without opening the resolution workspace

#### Scenario: Earlier failure prevents prompting

- **WHEN** adapter compatibility or facet integrity validation fails
- **THEN** the system SHALL report that failure without requesting collision choices

### Requirement: Collision choices receive live global and accessible validation

After every Keep, Alias, or Omit edit, the system SHALL reevaluate the complete in-memory asset and server choice set and update every affected claimant's status. The overview and focused group SHALL distinguish unresolved, draft-conflicting, and resolved items using text or icons in addition to color. A draft conflict SHALL identify every linked claimant and SHALL remain editable rather than discarding the user's choice.

Alias input for both assets and servers SHALL use the published portable single-segment name rules and SHALL display a specific validation reason when invalid. Installation SHALL resume only when every claimant is resolved and the complete final choice set passes validation.

#### Scenario: New alias conflicts with another group

- **WHEN** a user enters an asset or server alias already claimed in the same applicable identity space
- **THEN** every linked claimant SHALL be marked as a draft conflict
- **AND** the user SHALL be able to revise either side

#### Scenario: Previously resolved item becomes conflicting

- **WHEN** a later edit targets the effective identity of an item already marked resolved
- **THEN** both items SHALL change to draft-conflicting status

#### Scenario: Invalid alias explains the problem

- **WHEN** a user enters an alias outside the portable name grammar
- **THEN** the system SHALL display the validation reason and prevent confirmation

#### Scenario: Status does not depend on color alone

- **WHEN** the workspace displays resolution statuses
- **THEN** each status SHALL include a label or icon distinguishable without color

#### Scenario: Complete collision-free draft resumes installation

- **WHEN** every claimant has a unique effective identity in its applicable space or is omitted
- **AND** the user confirms the draft
- **THEN** installation SHALL resume using the confirmed choices

### Requirement: Cancelling collision resolution leaves the project unchanged

Users SHALL be able to cancel the collision workspace, including by interrupting the command. Cancellation SHALL end the operation without persisting asset or server choices or changing the project manifest, lockfile, receipt, materialized assets, or native MCP configuration. A cancelled operation SHALL exit non-zero and SHALL NOT report success.

#### Scenario: User cancels from the workspace

- **WHEN** a user cancels before confirming a collision-free draft
- **THEN** the command SHALL end without applying any draft choice
- **AND** project and adapter state SHALL remain unchanged

#### Scenario: User interrupts resolution

- **WHEN** a user sends an interrupt while the collision workspace is open
- **THEN** the command SHALL end without displaying a successful summary
- **AND** project and adapter state SHALL remain unchanged

### Requirement: Non-interactive collision failures are complete and actionable

When a facet operation cannot interactively resolve an asset or MCP server collision, the system SHALL write one error to stderr, exit non-zero, and identify every group and claimant. Asset claimants SHALL include facet, scope, type, authored name, effective name, and the corresponding typed asset override location. MCP claimants SHALL include facet, authored server name, effective name, declaration summary, and the corresponding `materialization.servers` location.

The error SHALL include syntactically valid alias and omission examples for each claimant kind. It SHALL NOT choose a winner or invent an alias and SHALL state that no project or materialized state changed.

#### Scenario: Non-interactive install reports all groups

- **WHEN** a non-interactive install encounters several asset and server collision groups
- **THEN** one failure SHALL list every group and claimant and exit non-zero

#### Scenario: Failure shows editable asset location

- **WHEN** an asset claimant requires durable intent
- **THEN** the error SHALL identify its typed asset map and authored key with valid snippets

#### Scenario: Failure shows editable server location

- **WHEN** an MCP claimant requires durable intent
- **THEN** the error SHALL identify its facet's `materialization.servers.<authored-name>` location with valid snippets

#### Scenario: Failure does not prescribe a winner

- **WHEN** two claimants share an effective identity
- **THEN** the error SHALL NOT prefer either claimant or derive a replacement alias

#### Scenario: Non-interactive failure confirms no mutation

- **WHEN** collision resolution is unavailable
- **THEN** the error SHALL state that manifest, lockfile, receipt, assets, and native configuration were unchanged

### Requirement: Users are notified when stale materialization intent is removed

When a successful non-frozen operation removes an override whose authored asset or server no longer exists, normal command output SHALL identify the facet, contribution kind, and authored name without requiring verbose output. Frozen installation SHALL instead report the stale override as blocking drift.

#### Scenario: Successful install reports pruned asset intent

- **WHEN** a normal install succeeds after finding an override for a missing authored asset
- **THEN** output SHALL identify the removed override by facet, asset type, and authored name

#### Scenario: Successful install reports pruned server intent

- **WHEN** a normal install succeeds after finding an override for a missing authored server
- **THEN** output SHALL identify the facet and server name

#### Scenario: Frozen install reports stale intent as drift

- **WHEN** frozen installation finds an override for a missing locked asset or integrity-pinned server declaration
- **THEN** the error SHALL identify the facet, contribution kind, and authored name
- **AND** it SHALL state that no override was removed

## REMOVED Requirements

### Requirement: Add command warns when servers are declared

**Reason**: Concrete MCP declarations are now approved and configured rather than skipped, and obsolete reference forms fail validation.

**Migration**: Users SHALL review the MCP configuration approval screen and command summary. There is no replacement skip warning.
