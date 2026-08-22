## ADDED Requirements

### Requirement: Installation commands accept repeatable adapter targets

The `add`, `install`, and `remove` commands SHALL each accept `--adapter <name>` as an optional repeatable flag with the same exclusive-target meaning. One or more occurrences SHALL name the complete target set. Duplicate names SHALL be treated as one target. Omitting the flag SHALL preserve existing all-adapter behavior.

#### Scenario: Every installation command lists the target flag

- **WHEN** a user requests help for `add`, `install`, or `remove`
- **THEN** the help SHALL list `--adapter <name>` with the same meaning for each command
- **AND** it SHALL state that the flag can be supplied more than once

#### Scenario: Multiple targets are accepted

- **WHEN** a user supplies `--adapter opencode --adapter claude-code`
- **THEN** both OpenCode and Claude Code SHALL be targets
- **AND** neither SHALL be reported as purged

#### Scenario: Duplicate targets are deduplicated

- **WHEN** a user names the same adapter more than once
- **THEN** the adapter SHALL be targeted once
- **AND** it SHALL appear once in command output

#### Scenario: Omitting targets preserves existing behavior

- **WHEN** a user supplies no `--adapter` flag
- **THEN** every installed materialization-capable adapter SHALL be targeted
- **AND** no adapter SHALL be purged because of placement scope

#### Scenario: Frozen install accepts targets

- **WHEN** a user runs `install --frozen-lockfile --adapter opencode`
- **THEN** the command SHALL accept OpenCode as the exclusive target

### Requirement: Explicit adapter targets are exclusive

Command behavior SHALL make explicit adapter targets an exclusive placement set. A successful filtered command SHALL leave the complete desired project state in every named target and SHALL clear all receipt-owned project state from every discoverable non-target adapter.

#### Scenario: Add targets the complete project

- **WHEN** a user runs `add cowsay --adapter opencode`
- **THEN** OpenCode SHALL receive every desired project facet including `cowsay`
- **AND** every discoverable non-target adapter SHALL be purged of Facet-managed project state

#### Scenario: Remove targets the complete remaining project

- **WHEN** a user runs `remove cowsay --adapter opencode`
- **THEN** `cowsay` SHALL be removed from project desired state
- **AND** OpenCode SHALL receive every remaining desired facet
- **AND** every discoverable non-target adapter SHALL be purged of Facet-managed project state

#### Scenario: Unfiltered install restores all adapters

- **WHEN** a filtered command previously purged non-target adapters
- **AND** the user later runs `install` without explicit targets
- **THEN** every installed materialization-capable adapter SHALL receive the complete desired project state

### Requirement: Adapter targets are validated before any mutation

The command SHALL validate the complete target and purge population before changing project or adapter files. A missing or empty value, an unknown target, or an installed target or purge adapter that is unavailable, incompatible, broken, or unable to perform its required transition SHALL produce a non-zero failure identifying the problem and SHALL leave all state unchanged.

#### Scenario: Missing target value is a usage error

- **WHEN** a user supplies `--adapter` without a value
- **THEN** the command SHALL report a usage error
- **AND** no project or adapter file SHALL change

#### Scenario: Empty target value is a usage error

- **WHEN** a user supplies an empty adapter value
- **THEN** the command SHALL report a usage error
- **AND** no project or adapter file SHALL change

#### Scenario: Comma-separated names are not split

- **WHEN** a user supplies `--adapter opencode,claude-code`
- **THEN** the command SHALL treat `opencode,claude-code` as one adapter name
- **AND** it SHALL fail if no installed adapter has that exact name

#### Scenario: Unknown target fails safely

- **WHEN** a user names an adapter that is not installed
- **THEN** the command SHALL identify that adapter and exit non-zero
- **AND** project, receipt, and adapter state SHALL remain unchanged

#### Scenario: Unavailable purge adapter fails safely

- **WHEN** an installed non-target adapter cannot be loaded for purge
- **THEN** the command SHALL identify that adapter and exit non-zero
- **AND** no target or purge mutation SHALL occur

#### Scenario: Add source syntax precedes target discovery

- **WHEN** an `add` request contains an invalid facet source and invalid adapter target
- **THEN** the command SHALL report the source error before adapter discovery

#### Scenario: Remove manifest validation precedes target discovery

- **WHEN** a `remove` request runs in a project with an unreadable manifest and an invalid adapter target
- **THEN** the command SHALL report the manifest problem before adapter discovery

### Requirement: Installation commands reject unknown flags

The `add`, `install`, and `remove` commands SHALL reject undeclared flags as usage errors. The command SHALL NOT continue with a wider placement scope when a user misspells an adapter target flag. Commands whose documented contract accepts dynamic undeclared flags SHALL retain that behavior.

#### Scenario: Misspelled adapter flag does not run unfiltered

- **WHEN** a user runs `add cowsay --adaptor opencode`
- **THEN** the command SHALL report `--adaptor` as unknown and exit non-zero
- **AND** no adapter SHALL be targeted or purged

#### Scenario: Strict rejection applies to all installation commands

- **WHEN** `add`, `install`, or `remove` receives an undeclared flag
- **THEN** that command SHALL report a usage error rather than execute

#### Scenario: Dynamic authoring flags remain supported

- **WHEN** a command whose documented contract accepts dynamic adapter-prefixed flags receives one
- **THEN** the command SHALL continue to receive and validate that dynamic flag

### Requirement: Explicit adapter targets suppress adapter selection

When a user supplies one or more explicit adapter targets, the command SHALL NOT launch interactive adapter selection and SHALL NOT install an adapter implicitly. A target that is not installed SHALL fail with guidance to install it explicitly.

#### Scenario: Filtered add does not launch the picker

- **WHEN** a user runs interactive `add` with an explicit target that is not installed
- **THEN** the command SHALL NOT launch the adapter picker
- **AND** it SHALL fail identifying the missing target

#### Scenario: Filtered remove does not launch the picker

- **WHEN** a user runs interactive `remove` with an explicit target that is not installed
- **THEN** the command SHALL NOT launch the adapter picker
- **AND** it SHALL fail identifying the missing target

#### Scenario: Missing target is never installed implicitly

- **WHEN** an explicit target is not installed
- **THEN** the command SHALL NOT download or activate it
- **AND** the error SHALL direct the user to the explicit adapter-add command

### Requirement: Command output identifies target and purged adapters

The `add`, `install`, and `remove` commands SHALL identify every target adapter and every purged adapter for an exclusive-target operation. When a rendered progress view is active, the destructive scope SHALL be visible before mutation and repeated in the final summary. The output SHALL distinguish target writes from purge removals and SHALL NOT describe a placement-changing operation as a no-op.

#### Scenario: Filtered command names both placement sets

- **WHEN** a filtered `add`, `install`, or `remove` succeeds
- **THEN** the final summary SHALL name every target adapter
- **AND** it SHALL name every purged adapter

#### Scenario: Scope is shown before mutation

- **WHEN** an exclusive-target command uses a rendered progress view
- **THEN** the view SHALL identify the target and purge sets before any file changes

#### Scenario: Purge and target counts are separate

- **WHEN** an operation both writes target files and removes purge-adapter files
- **THEN** the summary SHALL report target writes separately from purge removals

#### Scenario: Placement-only work is not a no-op

- **WHEN** project desired state is unchanged but a filtered command purges a non-target adapter
- **THEN** the command SHALL report the purge rather than report that no changes were applied

#### Scenario: Explicit targets require no confirmation prompt

- **WHEN** a user runs a filtered command in an interactive terminal
- **THEN** the command SHALL show the destructive scope
- **AND** it SHALL NOT require an additional confirmation prompt

#### Scenario: Empty purge adapter is still reported

- **WHEN** an installed materialization-capable adapter is outside the explicit target set
- **AND** that adapter contains no receipt-owned project state
- **THEN** the command SHALL still identify it as within the purge scope
- **AND** it SHALL report zero purge removals for that adapter

### Requirement: Suggested reruns preserve explicit adapter targets

When a failed filtered operation suggests a corrected or repeated command, the suggestion SHALL preserve every explicit adapter target. A suggested rerun SHALL NOT silently widen placement to an adapter the user did not name.

#### Scenario: Generic rerun suggestion repeats every target

- **WHEN** a command supplied with multiple adapter targets fails and suggests a rerun
- **THEN** the suggested command SHALL include every supplied `--adapter <name>` target

#### Scenario: Collision remedy preserves targets

- **WHEN** a filtered operation fails because a collision requires durable intent
- **THEN** any suggested rerun SHALL preserve every adapter target

#### Scenario: MCP acceptance remedy preserves targets

- **WHEN** a filtered non-interactive operation directs the user to add `--accept-mcp`
- **THEN** the suggested command SHALL also preserve every adapter target

## MODIFIED Requirements

### Requirement: Commands declare per-command flags

The system SHALL support per-command flag declarations on command definitions. The router SHALL parse per-command flags via the argument parser and pass the parsed values to command handlers alongside positional arguments. Flag declarations SHALL support boolean values, single string values, and repeatable string values. A command MAY require strict validation that rejects undeclared flags before its handler runs.

#### Scenario: Command with declared boolean flag

- **WHEN** a command declares a boolean flag (e.g., `--force`)
- **AND** a user provides that flag on the command line
- **THEN** the command handler SHALL receive the flag value as `true`

#### Scenario: Command with declared string flag

- **WHEN** a command declares a string flag (e.g., `--registry`)
- **AND** a user provides that flag with a value on the command line
- **THEN** the command handler SHALL receive the flag value as the provided string

#### Scenario: Command with declared repeatable flag

- **WHEN** a command declares a repeatable string flag
- **AND** a user provides that flag multiple times
- **THEN** the command handler SHALL receive every provided value in command-line order

#### Scenario: Undeclared flags are omitted for permissive commands

- **WHEN** a user provides a flag that is not declared by a command without strict validation
- **THEN** the command handler SHALL NOT receive that flag

#### Scenario: Undeclared flags fail for strict commands

- **WHEN** a user provides a flag that is not declared by a command with strict validation
- **THEN** the system SHALL report a usage error before the command handler runs

### Requirement: Per-command help displays usage and flags

The system SHALL render per-command help text from command metadata including usage syntax and flag descriptions. Authors SHALL NOT need to maintain help text manually. A flag that accepts a value SHALL render its value placeholder, and a repeatable flag's description SHALL state that it can be supplied more than once.

#### Scenario: Per-command help shows usage line

- **WHEN** a user runs `<command> --help` for a command that declares a `usage` field
- **THEN** the help output SHALL display the usage syntax (e.g., `Usage: facet create [directory] [options]`)

#### Scenario: Per-command help lists declared flags

- **WHEN** a user runs `<command> --help` for a command that declares flags
- **THEN** the help output SHALL list each declared flag with its description under an Options section
- **AND** the `--help` flag SHALL also appear in the Options section

#### Scenario: Value-carrying flag shows its placeholder

- **WHEN** a declared flag accepts a value named `name`
- **THEN** help SHALL render the value placeholder with the flag rather than render only the bare flag name

### Requirement: Add and install render a unified progress view

The `add` and `install` commands SHALL present progress through a single shared rendering. A user watching either command SHALL see the same shape of output: a per-facet section that names each facet, indicates its current stage, and shows whether it succeeded, failed, or is in progress, followed by a final summary that lists each affected facet on its own line. For an exclusive-target operation, the view SHALL additionally identify target and purge adapters before mutation and in the final summary.

Collision checking SHALL be rendered as one global phase covering the complete desired set, entered after every facet is resolved and before any materialization, rather than as a per-facet stage. Every `add` or `install` operation SHALL make that phase visible whether it affects one facet or many, because it is evaluated once over all of them; a rendering that showed it for a single-facet run and omitted it for a multi-facet run would misdescribe when the check happens.

When interactive materialization choices are required, the same command view SHALL transition from progress to the collision overview and focused resolution workspace, then return to progress after confirmation. It SHALL indicate that installation is awaiting collision resolution. A materialization-disposition change at an unchanged facet version SHALL be reported as an update; repair of disk-only drift SHALL remain reported as a repair. When materialization dispositions affect the result, the final summary SHALL show every aliased asset's authored name together with its effective materialized name and SHALL identify every omitted asset as omitted.

#### Scenario: Single-facet operation shows per-facet detail

- **WHEN** a user runs `add` or `install` with exactly one facet to install or update
- **THEN** the rendered view SHALL show the facet's name and its current stage as it progresses through fetch, verification, build, and materialization
- **AND** the view SHALL show the global collision-check phase between resolution and materialization
- **AND** on completion the view SHALL show a one-line summary of the facet's resolved version

#### Scenario: Multi-facet operation shows aggregate progress

- **WHEN** a user runs `add` or `install` with multiple facets to install or update
- **THEN** the rendered view SHALL show progress for each facet
- **AND** the view SHALL show the same single global collision-check phase it shows for a single-facet operation
- **AND** on completion the view SHALL show one summary line per affected facet identifying the action and resolved version

#### Scenario: True no-op install renders an empty summary

- **WHEN** a user runs `install`, desired state already matches every target, and no purge adapter contains receipt-owned project state
- **THEN** the view SHALL render a summary indicating no changes were applied
- **AND** the process SHALL exit with code 0

#### Scenario: Filtered purge is not rendered as a no-op

- **WHEN** desired project state is unchanged but an exclusive-target install purges receipt-owned state
- **THEN** the view SHALL report the purge
- **AND** it SHALL NOT state that no changes were applied

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

### Requirement: Add command auto-launches adapter selection when no adapter is selected

When a user runs `add` without explicit adapter targets in a project that has no selected adapter, the system SHALL launch interactive adapter selection in a TTY and SHALL fail with a clear error in a non-TTY environment. Explicit adapter targets SHALL suppress interactive selection and implicit adapter installation.

#### Scenario: Interactive add with no selected adapter or explicit target

- **WHEN** a user runs `add` in an interactive terminal
- **AND** the project has no selected adapter
- **AND** the user supplies no explicit adapter target
- **THEN** the system SHALL launch the adapter selection picker
- **AND** if the user selects at least one adapter, the system SHALL proceed with the install
- **AND** if the user cancels the picker, the system SHALL exit without modifying the project

#### Scenario: Non-interactive add with no selected adapter or explicit target

- **WHEN** a user runs `add` in a non-interactive environment
- **AND** the project has no selected adapter
- **AND** the user supplies no explicit adapter target
- **THEN** the system SHALL exit with a non-zero code
- **AND** the error SHALL direct the user to run interactive adapter selection

#### Scenario: Explicit add target suppresses selection

- **WHEN** a user runs `add` with one or more explicit adapter targets
- **THEN** the system SHALL NOT launch the adapter picker
- **AND** it SHALL NOT install an adapter implicitly

### Requirement: Remove handles undeclared names gracefully

When `remove` is given a name that is not declared in the project, the system SHALL silently ignore it. When every requested name is undeclared and no explicit adapter targets were supplied, the rendered view SHALL report that no changes were made and the process SHALL exit with code 0. When explicit targets were supplied, the rendered view SHALL report no facet changes but SHALL still report the ordinary target and purge placement effects.

Whether a requested name is declared SHALL be decided by the commit, under the project lock. The CLI SHALL NOT skip any step of the ordinary removal flow on the strength of a pre-lock read, and SHALL therefore discover adapters for every removal request, including one whose names all appear undeclared. Adapter discovery for `remove` without explicit targets SHALL follow the same contract as the commands that add and install facets: a project with no installable adapter SHALL prompt for one in an interactive terminal and SHALL fail with a non-zero exit code in a non-interactive environment. Explicit targets SHALL suppress the picker. The CLI SHALL still validate that the project manifest can be read before discovering adapters, so an absent, malformed, or unsupported-version manifest is reported as such rather than as a missing adapter.

#### Scenario: Removing only undeclared names without explicit targets shows no-op summary

- **WHEN** a user runs `remove` with one or more names that are not declared in the project manifest
- **AND** no requested name is declared
- **AND** no explicit adapter target is supplied
- **AND** the project has at least one installable adapter
- **THEN** the rendered view SHALL show a summary indicating no changes
- **AND** the process SHALL exit with code 0

#### Scenario: Removing only undeclared names with explicit targets reports placement

- **WHEN** every requested name is undeclared
- **AND** the user supplies one or more explicit adapter targets
- **THEN** the rendered view SHALL report no facet changes
- **AND** it SHALL identify every target and purged adapter
- **AND** the process SHALL exit with code 0 when placement succeeds

#### Scenario: Removing only undeclared names still requires an adapter

- **WHEN** a user runs `remove` in a non-interactive environment with names that are all undeclared
- **AND** the project has no installable adapter
- **AND** no explicit adapter target is supplied
- **THEN** the system SHALL report that no adapters are installed
- **AND** the process SHALL exit with a non-zero code
- **AND** the project manifest, lockfile, receipt, and adapter state SHALL remain unchanged

#### Scenario: An unreadable manifest is reported before adapter discovery

- **WHEN** a user runs `remove` in a project whose manifest is absent, malformed, or declares an unsupported version
- **THEN** the system SHALL report the manifest problem
- **AND** the system SHALL NOT report a missing adapter in its place

#### Scenario: Mix of declared and undeclared names removes the declared ones

- **WHEN** a user runs `remove` with names where some are declared and some are not
- **THEN** the system SHALL remove the declared facets
- **AND** the system SHALL silently ignore the undeclared names
- **AND** the process SHALL exit with code 0 if all declared facets were removed successfully

### Requirement: Unsupported MCP adapters are reported completely

When active MCP declarations exist and any target adapter declares no MCP support, the command SHALL fail before prompting or mutation. When the receipt owns an effective MCP identity requiring deletion from a purge adapter and that adapter cannot safely plan the removal, the command SHALL also fail before prompting or mutation. One error SHALL identify every affected adapter and SHALL give actionable remediation.

#### Scenario: Every unsupported target is listed

- **WHEN** two target adapters cannot configure active MCP declarations
- **THEN** one failure SHALL name both adapters and give actionable remediation

#### Scenario: Omitted declarations avoid target failure

- **WHEN** every authored server is omitted and no active declaration remains
- **THEN** a target adapter without MCP support SHALL NOT fail the operation for desired configuration

#### Scenario: Pending purge cleanup still fails

- **WHEN** the receipt owns an effective server identity requiring deletion from a purge adapter
- **AND** that adapter cannot safely plan the native removal
- **THEN** the operation SHALL fail before mutation naming that adapter

#### Scenario: Purge adapter with no owned server does not fail

- **WHEN** a purge adapter lacks MCP support
- **AND** the receipt owns no effective server identity requiring removal from it
- **THEN** that adapter SHALL NOT fail the operation for lacking MCP support

### Requirement: Command output reports MCP configuration outcomes

Command summaries SHALL report MCP servers separately from text assets and SHALL identify added, updated, unchanged, aliased, omitted, repaired, removed, purged, conflicted, unsupported, and takeover outcomes. An aliased server SHALL show authored and effective names. A server-only facet SHALL not be presented as a no-op. Declaration contents SHALL remain absent from summaries, which report outcomes rather than diagnose failures and therefore need no declaration value at all. A purged outcome SHALL identify removal from an adapter while the declaration may remain desired project-wide.

#### Scenario: Server-only facet has a meaningful summary

- **WHEN** a facet configures one server and zero text assets
- **THEN** the summary SHALL report the server addition and zero assets

#### Scenario: Alias and omission are visible

- **WHEN** server `filesystem` is materialized as `project-filesystem` and server `docs` is omitted
- **THEN** the summary SHALL show both authored and effective alias names and identify `docs` as omitted

#### Scenario: Remove reports native server deletion

- **WHEN** removal deletes an owned effective server entry from project desired state
- **THEN** the summary SHALL identify the removed server and affected adapters

#### Scenario: Purged server remains desired project-wide

- **WHEN** exclusive targeting removes an owned effective server entry from a purge adapter
- **AND** the same declaration remains configured in a target adapter
- **THEN** the summary SHALL identify the purge adapter
- **AND** it SHALL NOT present the server as removed from the project

#### Scenario: Drift-only rewrite is repaired

- **WHEN** an approved desired declaration rewrites only native drift
- **THEN** the summary SHALL classify the configuration as repaired

#### Scenario: Semantic match is unchanged

- **WHEN** native configuration already matches semantically
- **THEN** the summary SHALL classify it as unchanged
