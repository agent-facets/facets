## ADDED Requirements

### Requirement: Users can invoke project facet updates

The system SHALL register `update` as the canonical command for updating registry-backed facets declared by a project. The system SHALL accept `upgrade` as an alias with identical output, side effects, and exit behavior. Both names SHALL operate on project facets and SHALL NOT update the CLI binary.

The command SHALL accept `--latest` with short alias `-L`, `--interactive` with short alias `-i`, `--dry-run`, `--verbose`, and `--accept-mcp`. It SHALL accept no positional arguments and SHALL NOT expose `--frozen-lockfile`.

#### Scenario: Update command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the output SHALL list `update` as the canonical project-facet update command
- **AND** the output SHALL identify `upgrade` as its alias

#### Scenario: Upgrade alias performs the same operation

- **WHEN** a user runs `facet upgrade` with the same flags and project state as a corresponding `facet update` invocation
- **THEN** the system SHALL produce the same output, side effects, and exit code as `facet update`
- **AND** the invocation SHALL NOT report that the command is unimplemented

#### Scenario: Update rejects positional arguments

- **WHEN** a user runs `facet update` with one or more positional arguments
- **THEN** the system SHALL print a usage error
- **AND** the error SHALL direct the user to `--interactive` for per-facet selection
- **AND** the process SHALL exit with code 1

#### Scenario: Update help lists supported flags

- **WHEN** a user runs `facet update --help`
- **THEN** the help SHALL list `--latest` with `-L`
- **AND** the help SHALL list `--interactive` with `-i`
- **AND** the help SHALL list `--dry-run`, `--verbose`, and `--accept-mcp`
- **AND** the help SHALL NOT list `--frozen-lockfile`

#### Scenario: Update help distinguishes project facets from the CLI binary

- **WHEN** a user runs `facet update --help`
- **THEN** the help SHALL describe `update` as operating on facets declared by the project
- **AND** the help SHALL name `self-update` as the command for updating the CLI binary

### Requirement: Update presentations distinguish Current Target and Latest

Whenever the update command presents discovered choices, it SHALL identify each checkable registry facet's manifest specifier, locked Current version, range-respecting Target version, and registry Latest version. Git and local facets SHALL be named as unsupported sources rather than counted as current.

#### Scenario: Preview shows all version choices

- **WHEN** a project facet is locked at `1.2.0`, its authored specifier resolves to Target `1.4.0`, and the registry resolves Latest `2.0.0`
- **AND** a user requests an update preview
- **THEN** the output SHALL identify `1.2.0` as Current, `1.4.0` as Target, and `2.0.0` as Latest
- **AND** the output SHALL include the authored specifier

#### Scenario: Unsupported sources are named

- **WHEN** a project contains git or local facets alongside registry facets
- **AND** the update command presents discovery results
- **THEN** the output SHALL name each git or local facet as unsupported for update discovery
- **AND** it SHALL NOT report those facets as current registry facets

### Requirement: Users can select updates interactively

The `--interactive` mode SHALL present every registry facet for which Target or Latest is newer than Current. Range Target SHALL be the initial choice unless `--latest` is also supplied, in which case Latest SHALL be initial. Users SHALL be able to navigate rows, select or deselect facets, and toggle the focused row between Target and Latest with `l`. A choice that does not advance Current SHALL NOT be selectable, and confirmation SHALL require at least one selected advancing choice.

Interactive selection SHALL occur before adapter selection or update application. The command SHALL reject interactive mode before discovery when the terminal cannot prompt. Cancelling or interrupting the picker SHALL apply nothing, SHALL report that nothing was applied, and SHALL exit with code 1.

#### Scenario: Interactive mode starts with range targets

- **WHEN** a user runs `facet update --interactive`
- **AND** a facet has both an advancing Target and an advancing Latest
- **THEN** the facet's initial choice SHALL be Target
- **AND** pressing `l` on that row SHALL change its choice to Latest

#### Scenario: Latest interactive mode starts with latest targets

- **WHEN** a user runs `facet update --interactive --latest`
- **AND** a facet has both an advancing Target and an advancing Latest
- **THEN** the facet's initial choice SHALL be Latest
- **AND** pressing `l` on that row SHALL change its choice to Target

#### Scenario: Non-advancing choice cannot be selected

- **WHEN** a facet's Target equals Current but its Latest is newer
- **THEN** the Target choice SHALL NOT be selectable
- **AND** the user SHALL be able to toggle to and select Latest

#### Scenario: Confirmation requires a selection

- **WHEN** no advancing update is selected in the interactive picker
- **THEN** the system SHALL prevent confirmation

#### Scenario: Interactive mode requires a prompt-capable terminal

- **WHEN** a user runs `facet update --interactive` in a non-interactive terminal
- **THEN** the system SHALL fail before registry discovery
- **AND** the process SHALL exit with code 1

#### Scenario: Cancelling interactive update changes nothing

- **WHEN** a user cancels or interrupts the update picker before confirmation
- **THEN** the project manifest, lockfile, receipt, materialized assets, native configuration, cache, and adapter selection SHALL remain unchanged
- **AND** the output SHALL state that nothing was applied
- **AND** the process SHALL exit with code 1

### Requirement: Users can preview facet updates without applying them

The `--dry-run` flag SHALL present the update choices that the selected mode would apply and SHALL NOT modify project or machine-local state. Without `--interactive`, it SHALL present the complete discovered plan using the default Target choices or the `--latest` choices. With `--interactive`, it SHALL present the user's confirmed selection and stop before adapter selection or application. A successful preview SHALL exit with code 0 whether updates are available or not.

#### Scenario: Default dry run previews range targets

- **WHEN** a user runs `facet update --dry-run`
- **THEN** the output SHALL present the complete discovered plan using each facet's range-respecting Target
- **AND** no project or machine-local state SHALL change
- **AND** the process SHALL exit with code 0

#### Scenario: Latest dry run previews latest targets

- **WHEN** a user runs `facet update --latest --dry-run`
- **THEN** the output SHALL present the complete discovered plan using each facet's Latest choice
- **AND** the output SHALL show every manifest specifier rewrite the selected updates would commit
- **AND** no project or machine-local state SHALL change
- **AND** the process SHALL exit with code 0

#### Scenario: Interactive dry run stops after confirmed preview

- **WHEN** a user confirms a non-empty selection in `facet update --interactive --dry-run`
- **THEN** the output SHALL present that confirmed selection
- **AND** the system SHALL stop before adapter selection or application
- **AND** the process SHALL exit with code 0

#### Scenario: Dry run with no available update succeeds

- **WHEN** a user runs an update dry run and no selected mode permits an advancing choice
- **THEN** the output SHALL report the applicable no-op reason
- **AND** the process SHALL exit with code 0

### Requirement: Update no-op outcomes are distinguishable

A successful update that applies nothing SHALL distinguish among a project with no registry facets, a project whose registry facets are all current, and a project for which newer releases exist but the authored ranges permit no advancing Target. Each no-op SHALL exit with code 0. Invalid invocation, non-interactive use of `--interactive`, cancellation, stale plans, discovery failures, and application failures SHALL exit with code 1; unexpected failures escaping command handling SHALL exit with code 2.

#### Scenario: Project has no registry facets

- **WHEN** a user runs `facet update` in a project containing no registry-backed facets
- **THEN** the output SHALL state that the project has no registry facets to update
- **AND** the process SHALL exit with code 0

#### Scenario: Every registry facet is current

- **WHEN** every registry facet's Current version equals both available choices
- **THEN** the output SHALL state that all registry facets are current
- **AND** the process SHALL exit with code 0

#### Scenario: Authored ranges permit no update

- **WHEN** at least one facet has a Latest version newer than Current
- **AND** no facet has a Target newer than Current
- **AND** the user runs `facet update` without `--latest`
- **THEN** the output SHALL state that newer releases exist but the current ranges permit no update
- **AND** the output SHALL identify `--latest` as the mode that can select those releases
- **AND** the process SHALL exit with code 0

#### Scenario: Expected update failure uses exit code one

- **WHEN** update fails because discovery or application cannot complete
- **THEN** the process SHALL exit with code 1
- **AND** the error SHALL be written to stderr

### Requirement: Applied updates use the shared installation presentation

After a non-dry-run selection is confirmed or derived, the update command SHALL present the same per-facet progress stages, collision and consent surfaces, rollback reporting, and final version-transition summaries used by other facet installation operations. `--verbose` SHALL add diagnostics on stderr. In non-interactive use, `--accept-mcp` SHALL be the sole flag that pre-approves otherwise valid MCP configuration work and SHALL NOT authorize asset takeover.

#### Scenario: Update shows per-facet installation progress

- **WHEN** a user applies one or more facet updates
- **THEN** the output SHALL show progress for each selected facet
- **AND** the final summary SHALL identify each previous and installed version

#### Scenario: Update verbose output uses stderr

- **WHEN** a user runs an applying update with `--verbose`
- **THEN** installation progress SHALL remain on stdout
- **AND** additional diagnostics SHALL be written to stderr

#### Scenario: Non-interactive MCP work requires explicit acceptance

- **WHEN** a non-interactive update would apply unapproved MCP configuration
- **AND** `--accept-mcp` is not supplied
- **THEN** the command SHALL fail before mutation with the complete consent information
- **AND** when `--accept-mcp` is supplied, the command SHALL proceed without prompting if the work is otherwise valid

## MODIFIED Requirements

### Requirement: Commands declare per-command flags

The system SHALL support per-command flag declarations on command definitions. The router SHALL parse per-command flags via the argument parser and pass the parsed values to command handlers alongside positional arguments. A declared flag MAY define a short alias; the long and short forms SHALL set the same canonical flag value, and the short form SHALL NOT be exposed to handlers as a second independent value.

#### Scenario: Command with declared boolean flag

- **WHEN** a command declares a boolean flag (e.g., `--force`)
- **AND** a user provides that flag on the command line
- **THEN** the command handler SHALL receive the flag value as `true`

#### Scenario: Command with declared string flag

- **WHEN** a command declares a string flag (e.g., `--registry`)
- **AND** a user provides that flag with a value on the command line
- **THEN** the command handler SHALL receive the flag value as the provided string

#### Scenario: Declared short alias sets the canonical flag

- **WHEN** a command declares `-i` as the short alias of `--interactive`
- **AND** a user provides `-i`
- **THEN** the command handler SHALL receive `interactive` as `true`
- **AND** the handler SHALL NOT receive `i` as a separate flag value

#### Scenario: Undeclared flags are ignored

- **WHEN** a user provides a flag that is not declared by the command and is not a declared short alias
- **THEN** the command handler SHALL NOT receive that flag

### Requirement: Per-command help displays usage and flags

The system SHALL render per-command help text from command metadata including usage syntax, flag descriptions, and declared short aliases. Authors SHALL NOT need to maintain a separate alias map or duplicate flag help text manually.

#### Scenario: Per-command help shows usage line

- **WHEN** a user runs `<command> --help` for a command that declares a `usage` field
- **THEN** the help output SHALL display the usage syntax (e.g., `Usage: facet create [directory] [options]`)

#### Scenario: Per-command help lists declared flags

- **WHEN** a user runs `<command> --help` for a command that declares flags
- **THEN** the help output SHALL list each declared flag with its description under an Options section
- **AND** the `--help` flag SHALL also appear in the Options section

#### Scenario: Per-command help shows a declared short alias

- **WHEN** a command declares `-L` as the short alias of `--latest`
- **AND** a user requests that command's help
- **THEN** the Options section SHALL present `-L` and `--latest` together from the same declaration

### Requirement: The `self-` prefix is reserved for CLI-binary operations

The system SHALL reserve commands prefixed with `self-` for operations that act on the CLI binary itself. Commands without the `self-` prefix that share a verb, including `update` and `upgrade`, SHALL NOT act on the CLI binary; they SHALL operate on facet packages declared by the current project.

#### Scenario: self-update acts on the CLI binary

- **WHEN** a user runs `facet self-update`
- **THEN** the system SHALL update the CLI binary
- **AND** the system SHALL NOT modify any facet package or facet manifest

#### Scenario: Bare update or upgrade acts on project facets

- **WHEN** a user runs `facet update` or `facet upgrade`
- **THEN** the system SHALL perform the project-facet update workflow
- **AND** the system SHALL NOT update the CLI binary

### Requirement: A failed operation reports what it left on disk, by path

When an add, install, remove, or update operation fails, the command SHALL report whether the project was fully restored, and the process SHALL exit with a non-zero code. When any file could not be returned to its prior state, the command SHALL name every such file on the error stream.

The report SHALL distinguish a file deliberately left alone — because something else changed it after this run wrote it — from one whose restoration genuinely failed, and SHALL give each the remedy that applies to it. A preserved concurrent edit SHALL NOT be described as damage to hunt for.

The command SHALL NOT prompt about a contested file, and SHALL NOT offer to overwrite one, in interactive or non-interactive use alike. Whatever the other writer left SHALL remain exactly as they left it.

An interactive option to force restoration over a contested file is intentionally deferred rather than omitted by oversight. Adding one would ask a user to choose between two states during failure handling, on the least informed footing they will ever have; reporting the path lets them compare the two deliberately afterward. Reporting is therefore the floor a later option would build on, never something it would replace.

#### Scenario: Failed operation that fully rolls back

- **WHEN** an operation fails and every file it changed is restored
- **THEN** the rendered view SHALL indicate that the project state is unchanged
- **AND** the process SHALL exit with a non-zero code

#### Scenario: Failed operation that could not restore a file

- **WHEN** an operation fails and a file could not be returned to its prior state
- **THEN** the command SHALL name that file on the error stream
- **AND** the process SHALL exit with a non-zero code

#### Scenario: A preserved concurrent edit is reported without a prompt

- **WHEN** something else changed a file after the run wrote it, and the run then failed
- **THEN** the command SHALL name that file and say it was left as it is
- **AND** the command SHALL NOT ask whether to overwrite it
