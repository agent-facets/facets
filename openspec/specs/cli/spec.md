## Purpose

Defines the command-line interface behavior for argument parsing, command dispatch, help output, version reporting, and error handling.

## Requirements

### Requirement: Users can see available commands

The system SHALL display a list of all registered commands with their descriptions when the user requests help. The help output SHALL be written to stdout.

#### Scenario: Global help via --help flag

- **WHEN** a user runs the CLI with `--help`
- **THEN** the system SHALL print a usage summary listing all available commands with their descriptions
- **AND** the output SHALL be written to stdout
- **AND** the process SHALL exit with code 0

#### Scenario: Global help via help command

- **WHEN** a user runs the CLI with `help` as the command
- **THEN** the system SHALL print the same usage summary as `--help`
- **AND** the process SHALL exit with code 0

#### Scenario: Per-command help

- **WHEN** a user runs the CLI with `<command> --help`
- **THEN** the system SHALL print usage information specific to that command, including usage syntax and declared flags
- **AND** the output SHALL be written to stdout
- **AND** the process SHALL exit with code 0

### Requirement: Users can check the installed version

The system SHALL display the current version when the user requests it. The version SHALL match the version declared in the package manifest.

#### Scenario: Version flag

- **WHEN** a user runs the CLI with `--version`
- **THEN** the system SHALL print the current version number
- **AND** the output SHALL be written to stdout
- **AND** the process SHALL exit with code 0

### Requirement: Known commands are dispatched

The system SHALL route known command names to their registered handlers. Each command receives the remaining positional arguments after the command name, along with parsed flag values based on the command's declared flags.

#### Scenario: Registered command is invoked

- **WHEN** a user runs the CLI with a registered command name (e.g., `build`)
- **THEN** the system SHALL parse any declared flags for that command
- **AND** the system SHALL execute that command's handler with positional arguments and parsed flags
- **AND** the process SHALL exit with the code returned by the handler

#### Scenario: Stubbed command reports its status

- **WHEN** a user runs the CLI with a command that is registered but not yet implemented
- **THEN** the system SHALL print a message indicating the command is not yet implemented
- **AND** the output SHALL identify the command by name
- **AND** the process SHALL exit with code 0

### Requirement: Unknown commands are rejected with suggestions

The system SHALL reject command names that are not registered. When a close match exists, the system SHALL suggest it to help the user recover from typos.

#### Scenario: Unknown command with close match

- **WHEN** a user runs the CLI with a command name that is not registered but is similar to a registered command
- **THEN** the system SHALL print an error message identifying the unknown command
- **AND** the system SHALL suggest the closest matching registered command
- **AND** the error SHALL be written to stderr
- **AND** the process SHALL exit with code 1

#### Scenario: Unknown command with no close match

- **WHEN** a user runs the CLI with a command name that is not registered and has no similar registered commands
- **THEN** the system SHALL print an error message identifying the unknown command
- **AND** the system SHALL NOT print a suggestion
- **AND** the error SHALL be written to stderr
- **AND** the process SHALL exit with code 1

### Requirement: No arguments shows help

The system SHALL display help when invoked with no arguments, so users who run the CLI for the first time see how to use it.

#### Scenario: Bare invocation

- **WHEN** a user runs the CLI with no arguments and no flags
- **THEN** the system SHALL print the same usage summary as `--help`
- **AND** the process SHALL exit with code 0

### Requirement: Errors are reported clearly

All user-facing errors SHALL be written to stderr. Successful output (help, version, command results) SHALL be written to stdout. This separation ensures that error output does not corrupt piped data.

#### Scenario: User error goes to stderr

- **WHEN** a user triggers a user error (e.g., unknown command)
- **THEN** the error message SHALL be written to stderr
- **AND** no error output SHALL appear on stdout

#### Scenario: Unexpected error goes to stderr

- **WHEN** an unexpected error occurs during command execution
- **THEN** the system SHALL print an error message to stderr
- **AND** the process SHALL exit with code 2

### Requirement: Exit codes are consistent and meaningful

The system SHALL use distinct exit codes to indicate the outcome category, so scripts and CI pipelines can branch on the result.

#### Scenario: Successful execution

- **WHEN** a command completes successfully
- **THEN** the process SHALL exit with code 0

#### Scenario: User error

- **WHEN** a user provides invalid input (unknown command, invalid arguments)
- **THEN** the process SHALL exit with code 1

#### Scenario: Unexpected error

- **WHEN** an unhandled exception occurs
- **THEN** the process SHALL exit with code 2

### Requirement: Edit command is registered

The system SHALL register an `edit` command that launches the interactive editing workbench for facet manifests. The command SHALL accept an optional directory argument specifying the facet project to edit, defaulting to the current directory.

#### Scenario: Edit command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `edit` command with its description

#### Scenario: Edit command is invoked

- **WHEN** a user runs the CLI with `edit`
- **THEN** the system SHALL execute the editing command's handler

#### Scenario: Edit command accepts a directory argument

- **WHEN** a user runs the CLI with `edit ./my-facet`
- **THEN** the system SHALL execute the editing command against the `./my-facet` directory

#### Scenario: Edit command exits on invalid manifest

- **WHEN** a user runs the CLI with `edit` in a directory with an invalid manifest
- **THEN** the system SHALL display the validation errors
- **AND** the system SHALL exit without launching the interactive interface

#### Scenario: Edit command skips reconciliation when no drift

- **WHEN** a user runs the CLI with `edit` in a directory where the manifest matches disk contents
- **THEN** the system SHALL skip the reconciliation phase
- **AND** the system SHALL proceed directly to the editing phase

### Requirement: Commands validate directory arguments before execution

The system SHALL validate directory arguments provided to commands before executing any command logic. Invalid directory arguments SHALL produce clear, immediate error messages and exit with code 1.

#### Scenario: No directory argument defaults to current directory

- **WHEN** a user runs a command without a directory argument
- **THEN** the system SHALL use the current working directory

#### Scenario: Argument points to facet.json directly

- **WHEN** a user provides a path ending with `facet.json` as the directory argument
- **THEN** the system SHALL silently use the parent directory

#### Scenario: Argument is a non-directory file

- **WHEN** a user provides a path to a file that is not `facet.json`
- **THEN** the system SHALL print an error indicating a directory was expected
- **AND** the process SHALL exit with code 1

#### Scenario: Directory does not exist for commands requiring it

- **WHEN** a user provides a path to a non-existent directory for `build`, `edit`, or `publish`
- **THEN** the system SHALL print an error indicating the directory does not exist
- **AND** the process SHALL exit with code 1

#### Scenario: Directory is auto-created for create command

- **WHEN** a user provides a path to a non-existent directory for `create`
- **THEN** the system SHALL create the directory automatically

#### Scenario: Build, edit, and publish require facet.json to exist

- **WHEN** a user runs `build`, `edit`, or `publish` in a directory without `facet.json`
- **THEN** the system SHALL print an error indicating no facet manifest was found
- **AND** the process SHALL exit with code 1

#### Scenario: Publish accepts an optional directory argument

- **WHEN** a user runs `publish` with a path to a directory that contains `facet.json`
- **THEN** the system SHALL publish the facet in that directory
- **AND** the system SHALL NOT require the user to change into that directory first

### Requirement: Commands declare per-command flags

The system SHALL support per-command flag declarations on command definitions. The router SHALL parse per-command flags via the argument parser and pass the parsed values to command handlers alongside positional arguments, including flags a command did not declare. A declared flag MAY define a short alias; the long and short forms SHALL set the same canonical flag value, and the short form SHALL NOT be exposed to handlers as a second independent value.

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

#### Scenario: Undeclared long flags reach the handler

- **WHEN** a user provides a long flag that the command did not declare
- **THEN** the command handler SHALL receive that flag

#### Scenario: A short alias is never a flag of its own

- **WHEN** a user provides a declared short alias
- **THEN** the command handler SHALL NOT receive the short name as an independent flag value

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

### Requirement: Create command protects against accidental overwrite

The `create` command SHALL detect when a `facet.json` already exists in the target directory and prompt the user before overwriting. A `--force` flag SHALL bypass the prompt.

#### Scenario: Create in directory with existing facet.json

- **WHEN** a user runs `create` in a directory that already contains `facet.json`
- **AND** the `--force` flag is NOT set
- **THEN** the system SHALL prompt the user with a confirmation question
- **AND** if the user declines, the system SHALL exit with code 1 without making changes
- **AND** if the user accepts, the system SHALL proceed with the create wizard

#### Scenario: Create with --force flag

- **WHEN** a user runs `create --force` in a directory that already contains `facet.json`
- **THEN** the system SHALL proceed with the create wizard without prompting

#### Scenario: Create in empty directory

- **WHEN** a user runs `create` in a directory that does not contain `facet.json`
- **THEN** the system SHALL proceed with the create wizard without prompting

### Requirement: CLI entry point delegates to a platform-specific binary

The system SHALL use a launcher script as its npm `bin` entry point. The launcher script SHALL delegate execution to a platform-specific compiled binary. All existing CLI behavior (commands, flags, help, version, exit codes) SHALL be preserved regardless of which binary is executed.

#### Scenario: Launcher delegates to compiled binary

- **WHEN** a user invokes the CLI via the npm `bin` entry point (e.g., `npx facet build`)
- **THEN** the launcher SHALL resolve and execute the platform-appropriate compiled binary
- **AND** the CLI SHALL behave identically to a directly-invoked compiled binary

#### Scenario: All commands work through the launcher

- **WHEN** a user runs any registered command through the launcher
- **THEN** the command SHALL produce the same output, exit code, and behavior as direct execution

### Requirement: Add command is registered

The system SHALL register an `add` command that adds a facet to the project manifest and installs it in a single operation. The command SHALL accept one or more source specifiers as positional arguments.

#### Scenario: Add command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `add` command with its description

#### Scenario: Add command requires at least one source

- **WHEN** a user runs `add` with no positional arguments
- **THEN** the system SHALL print a usage error
- **AND** the process SHALL exit with code 1

#### Scenario: Add command accepts multiple sources

- **WHEN** a user runs `add` with two or more source specifiers
- **THEN** the system SHALL parse and add each specifier
- **AND** the operation SHALL succeed only if every specifier resolves and installs successfully

### Requirement: Install command is registered

The system SHALL register an `install` command that brings the project on disk into agreement with the lockfile. The command SHALL accept no positional arguments.

#### Scenario: Install command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `install` command with its description

#### Scenario: Install command rejects positional arguments

- **WHEN** a user runs `install` with one or more positional arguments
- **THEN** the system SHALL print a usage error directing the user to `add` for adding new facets
- **AND** the process SHALL exit with code 1

### Requirement: Adapter command is registered

The system SHALL register an `adapter` command that manages the adapter tooling installed on the machine, exposing the subcommands `add`, `list`, and `remove`. `add` SHALL be the canonical name for installing an adapter and SHALL accept an optional source specifier, matching the top-level split where the command that takes a specifier is named `add` and the command that takes none is named `install`.

The system SHALL also accept `install` as a deprecated alias of `add`, so users with muscle memory for the former name succeed; both names SHALL invoke identical behavior. An operational invocation of the alias SHALL additionally emit a deprecation notice naming the canonical name. That notice SHALL be written to stderr, so it cannot corrupt output a caller consumes from stdout, and it SHALL NOT change the command's exit code.

Advertised usage, per-command help, and recovery guidance SHALL name only the canonical subcommands, and every repair or recovery command the CLI renders for an adapter SHALL name `add` rather than the deprecated alias.

#### Scenario: Adapter command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `adapter` command with its description

#### Scenario: Adapter add installs the named adapter

- **WHEN** a user runs `adapter add` with a source specifier
- **THEN** the system SHALL install the adapter identified by that specifier
- **AND** the system SHALL NOT emit a deprecation notice

#### Scenario: Deprecated install alias produces identical behavior

- **WHEN** a user runs `adapter install` with the same arguments as a corresponding `adapter add` invocation
- **THEN** the system SHALL produce the same stdout output, the same side effects, and the same exit code as `adapter add`
- **AND** the system SHALL write a deprecation notice to stderr naming `adapter add` as the command to use instead

#### Scenario: Usage lists only the canonical subcommands

- **WHEN** a user runs `adapter` with no subcommand
- **THEN** the system SHALL print a usage error listing `add`, `list`, and `remove`
- **AND** the usage error SHALL NOT advertise the deprecated alias
- **AND** the process SHALL exit with code 1

#### Scenario: Unknown adapter subcommand names the canonical set

- **WHEN** a user runs `adapter` with a subcommand that is neither registered nor the deprecated alias
- **THEN** the system SHALL print an error identifying the unknown subcommand
- **AND** the error SHALL name `add`, `list`, and `remove` as the available subcommands
- **AND** the process SHALL exit with code 1

### Requirement: Add and install render a unified progress view

The `add` and `install` commands SHALL present progress through a single shared rendering. A user watching either command SHALL see the same shape of output: a per-facet section that names each facet, indicates its current stage, and shows whether it succeeded, failed, or is in progress, followed by a final summary that lists each affected facet on its own line.

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

### Requirement: Add command surfaces re-add updates

When `add` re-adds a facet that was already declared at a different version, the rendered view SHALL clearly identify both the previous and new versions so the user can confirm the upgrade or downgrade.

#### Scenario: Re-add at a higher version

- **WHEN** a user runs `add name@2.0.0` for a facet currently locked at `1.5.0`
- **THEN** the summary line for that facet SHALL include both versions in a way that identifies the prior version and the new version

#### Scenario: Re-add at a lower version

- **WHEN** a user runs `add name@1.0.0` for a facet currently locked at `1.5.0`
- **THEN** the summary line for that facet SHALL include both versions in a way that identifies the prior version and the new version

### Requirement: Add command rejects facets that compose other facets

When `add` encounters a facet whose manifest declares dependencies on other facets, the system SHALL reject the operation with a clear error before any project state is modified.

#### Scenario: Composition is rejected during add

- **WHEN** a user runs `add` with a source whose manifest declares facet dependencies
- **THEN** the system SHALL print an error identifying the composing facet by name
- **AND** the error SHALL state that facet composition is not supported
- **AND** the project manifest, lockfile, and adapter state SHALL be unchanged
- **AND** the process SHALL exit with a non-zero code

### Requirement: Add command auto-launches adapter selection when no adapter is selected

When a user runs `add` in a project that has no selected adapter, the system SHALL launch interactive adapter selection in a TTY, and SHALL fail with a clear error in a non-TTY environment.

#### Scenario: Interactive add with no selected adapter

- **WHEN** a user runs `add` in an interactive terminal
- **AND** the project has no selected adapter
- **THEN** the system SHALL launch the adapter selection picker
- **AND** if the user selects at least one adapter, the system SHALL proceed with the install
- **AND** if the user cancels the picker, the system SHALL exit without modifying the project

#### Scenario: Non-interactive add with no selected adapter

- **WHEN** a user runs `add` in a non-interactive environment
- **AND** the project has no selected adapter
- **THEN** the system SHALL exit with a non-zero code
- **AND** the error SHALL direct the user to run interactive adapter selection

### Requirement: Add and install report integrity failures clearly

When an install operation aborts because of an integrity mismatch, the rendered view SHALL identify the affected facet and the nature of the mismatch, and the process SHALL exit with a non-zero code.

#### Scenario: Integrity mismatch is reported in the rendered view

- **WHEN** the system aborts an install because fetched content fails integrity verification
- **THEN** the view SHALL identify the affected facet by name
- **AND** the view SHALL describe the mismatch as a security failure
- **AND** the process SHALL exit with a non-zero code

### Requirement: Add and install accept verbose output

The `add` and `install` commands SHALL accept a `--verbose` flag that emits additional diagnostic output. The verbose output SHALL be written to stderr so that it does not interfere with the rendered view on stdout.

#### Scenario: Verbose flag emits diagnostics on stderr

- **WHEN** a user runs `add` or `install` with `--verbose`
- **THEN** the rendered view SHALL appear on stdout as usual
- **AND** additional diagnostic output SHALL appear on stderr

### Requirement: Users can update the CLI to a newer version in-band

The system SHALL provide a `self-update` command that updates the running CLI binary to a newer version. The system SHALL also accept `self-upgrade` as an alias of the same command, so users with muscle memory for either verb succeed. Both names SHALL invoke identical behavior.

#### Scenario: self-update command is listed in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list `self-update` with its description
- **AND** the help output SHALL list `self-upgrade` as an alias of the same command

#### Scenario: self-update is invoked

- **WHEN** a user runs `facet self-update`
- **THEN** the system SHALL attempt to update the running binary to the latest published version
- **AND** the process SHALL exit with code 0 on a successful update
- **AND** the process SHALL exit with code 0 if no update is available

#### Scenario: self-upgrade alias produces identical behavior

- **WHEN** a user runs `facet self-upgrade` with the same arguments and flags as a corresponding `facet self-update` invocation
- **THEN** the system SHALL produce the same output, side effects, and exit code as `facet self-update`

#### Scenario: Per-command help shows usage and flags for self-update

- **WHEN** a user runs `facet self-update --help`
- **THEN** the help output SHALL show the usage syntax
- **AND** the help output SHALL list the `--version` and `--dry-run` flags with descriptions
- **AND** the process SHALL exit with code 0

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

### Requirement: Users can pin a specific version when self-updating

The `self-update` command SHALL accept a `--version <x.y.z>` flag that pins the update target to a specific published version. When the flag is provided, the system SHALL update to exactly that version regardless of which version is currently published as latest.

#### Scenario: self-update with a specific version

- **WHEN** a user runs `facet self-update --version 0.7.0`
- **THEN** the system SHALL update the running binary to version 0.7.0
- **AND** the system SHALL NOT update to any other version even if a newer version is published

#### Scenario: self-update without --version uses latest

- **WHEN** a user runs `facet self-update` without a `--version` flag
- **THEN** the system SHALL update the running binary to the latest published version

### Requirement: Users can preview a self-update without executing it

The `self-update` command SHALL accept a `--dry-run` flag. When the flag is set, the system SHALL print the current installed version, the target version, whether an update is available, the detected install method, and the exact command that would run — and SHALL NOT modify any files. The process SHALL exit with code 0 in every `--dry-run` outcome short of a real error.

#### Scenario: Dry run when an update is available

- **WHEN** a user runs `facet self-update --dry-run`
- **AND** a newer version is available
- **THEN** the output SHALL include the current version, the target version, the detected install method, and the exact command that would run
- **AND** the system SHALL NOT modify any files
- **AND** the process SHALL exit with code 0

#### Scenario: Dry run when already up to date

- **WHEN** a user runs `facet self-update --dry-run`
- **AND** the current version equals the target version
- **THEN** the output SHALL indicate that no update is needed
- **AND** the system SHALL NOT modify any files
- **AND** the process SHALL exit with code 0

#### Scenario: Dry run with a pinned version

- **WHEN** a user runs `facet self-update --version 0.6.0 --dry-run`
- **THEN** the target version in the output SHALL be 0.6.0
- **AND** the printed command SHALL reference version 0.6.0
- **AND** the system SHALL NOT modify any files

### Requirement: The CLI's view of the registry contract is anchored to the registry's published specification

The CLI SHALL derive every registry-facing wire-shaped type — request shapes, response shapes, and error envelopes — from the registry's own published API specification rather than from CLI-side hand-authored types. A registry response field that is renamed, removed, or changes shape SHALL surface as a build-time error against typed code in a CLI pull request, not as a runtime "unexpected response" error to a user running a released CLI.

Internal CLI contracts (the discriminated result envelope returned to commands, parsed input forms, display structures) MAY remain hand-authored, since they describe the CLI's contract with itself rather than the wire.

#### Scenario: Registry adds a new field to a response

- **WHEN** the registry publishes a new optional field on a response shape and a contributor refreshes the CLI's view of the registry
- **THEN** the new field SHALL be available to CLI code as a typed field on that response
- **AND** existing CLI call sites SHALL continue to compile without modification

#### Scenario: Registry renames a field on a response

- **WHEN** the registry renames a field on a response shape and a contributor refreshes the CLI's view of the registry
- **THEN** every CLI call site that reads the renamed field SHALL fail to type-check
- **AND** the failure SHALL surface in the contributor's editor and in CI before the change can be merged

#### Scenario: Released CLI versions stay in lockstep with the registry

- **WHEN** a CLI version is released
- **THEN** that CLI version's compiled type contract SHALL match a specific, identifiable version of the registry's published specification
- **AND** the matched specification version SHALL be reproducible from the released CLI's source tree without network access

### Requirement: A single command refreshes the CLI's registry-contract view

Contributors SHALL be able to update the CLI's view of the registry contract with a single, idempotent command. Running the command twice in succession with no upstream changes SHALL produce no diff. The command SHALL fail loudly and leave existing on-disk state unmodified if the registry is unreachable or returns an invalid specification.

#### Scenario: Refresh against an unchanged registry produces no diff

- **WHEN** a contributor runs the refresh command and the registry's published specification has not changed since the last refresh
- **THEN** the command SHALL exit successfully
- **AND** no files SHALL be modified on disk

#### Scenario: Refresh against an updated registry produces a reviewable diff

- **WHEN** a contributor runs the refresh command and the registry's published specification has changed since the last refresh
- **THEN** the command SHALL update the CLI's on-disk view to match the new specification
- **AND** the resulting changes SHALL be a reviewable diff in version control

#### Scenario: Refresh fails cleanly when the registry is unreachable

- **WHEN** a contributor runs the refresh command and the registry cannot be reached or returns an invalid specification
- **THEN** the command SHALL exit with a non-zero status and a clear error message
- **AND** the CLI's on-disk view SHALL remain unchanged from before the command was run

### Requirement: Search results show asset counts

When the CLI lists facets in response to a search, each result SHALL display a one-line summary of the facet's asset counts (e.g., "1 agent, 2 commands, 1 server"). Asset kinds with a zero count SHALL be omitted from the line. If every asset count is zero, the line SHALL be omitted entirely rather than rendered as an empty list. The summary SHALL be derived from the data returned by the registry — not from any client-side computation — so that what the user sees matches what the registry has published.

#### Scenario: Search result lists a facet with multiple asset kinds

- **WHEN** the registry returns a facet with one agent, two commands, and one server
- **THEN** the search output for that facet SHALL include a line containing "1 agent, 2 commands, 1 server"
- **AND** asset kinds with a zero count SHALL NOT appear on the line

#### Scenario: Search result lists a facet with a single asset kind

- **WHEN** the registry returns a facet with two commands and zero of every other kind
- **THEN** the search output for that facet SHALL include a line containing "2 commands"
- **AND** the line SHALL NOT contain any of the zero-count kinds

#### Scenario: Search result lists a facet with no assets at all

- **WHEN** the registry returns a facet whose every asset count is zero
- **THEN** the search output for that facet SHALL omit the asset-counts line entirely
- **AND** SHALL NOT render an empty list or a line of zeros

### Requirement: Registry calls have a single per-call deadline that the caller can compose with their own abort signal

When the CLI makes a request to the registry, the request SHALL be subject to a single bounded deadline that covers the entire call including any retries. The deadline SHALL NOT be reset between retries. If the caller supplies their own abort signal alongside the request, the call SHALL abort when either signal fires — whichever happens first. The caller's signal SHALL NOT be silently overridden by the per-call deadline.

#### Scenario: Per-call deadline elapses across retries

- **WHEN** the registry is unreachable and the per-call deadline elapses while retries are still pending
- **THEN** the call SHALL abort and return a network failure
- **AND** no further retry attempts SHALL be made after the deadline has elapsed

#### Scenario: Caller signal aborts a retry in progress

- **WHEN** the caller supplies an abort signal and aborts it during a retry's backoff
- **THEN** the call SHALL surface the abort to the caller
- **AND** the per-call deadline SHALL NOT prevent the caller's abort from taking effect

### Requirement: Retry policy distinguishes idempotent and non-idempotent requests

When a registry call fails for a transient reason (a network error such as connection refused, DNS failure, or socket timeout), the CLI SHALL retry the call **only when the request method is idempotent** (GET, HEAD, OPTIONS). Non-idempotent requests (POST, PUT, PATCH, DELETE) SHALL NOT be retried automatically because they may have already produced a side effect on the registry. HTTP error responses (4xx, 5xx) SHALL NOT trigger retry — the registry's structured error envelope SHALL be surfaced to the caller as-is.

#### Scenario: Network failure on a GET retries

- **WHEN** a `GET` request to the registry fails with a network error
- **THEN** the CLI SHALL retry the request up to the configured retry count
- **AND** the user SHALL see at most one user-facing error message describing the final outcome

#### Scenario: Network failure on a POST does not retry

- **WHEN** a `POST` request to the registry (e.g., publishing a facet) fails with a network error
- **THEN** the CLI SHALL NOT retry the request
- **AND** the user SHALL see a clear error message indicating the request did not complete

#### Scenario: HTTP error response does not retry

- **WHEN** the registry returns a non-2xx HTTP status (any 4xx or 5xx)
- **THEN** the CLI SHALL NOT retry the request
- **AND** the user SHALL see the structured error envelope translated to a clear CLI error

### Requirement: Registry retries honor the server's `Retry-After` header

When the registry sends a `Retry-After` header on a retryable response and the CLI is preparing to retry, the CLI SHALL honor the server's hint as the backoff duration, capped by a configured maximum to defend against runaway values. When the header is absent, the CLI SHALL use its configured default backoff.

#### Scenario: Server requests a longer wait

- **WHEN** the registry responds with a `Retry-After` header indicating a duration longer than the CLI's default backoff
- **THEN** the CLI SHALL wait the server-requested duration before the next retry attempt
- **AND** the wait SHALL be capped by the CLI's configured maximum backoff

#### Scenario: Server omits the header

- **WHEN** the registry responds without a `Retry-After` header
- **THEN** the CLI SHALL use its configured default backoff before the next retry attempt

### Requirement: The CLI's registry-contract view exposes its own freshness

The CLI's stored view of the registry contract SHALL carry machine-readable provenance — at minimum, the time of last refresh and the source from which it was refreshed. Contributors SHALL be able to ask "is my view of the registry stale?" without making any network call.

#### Scenario: Contributor checks freshness offline

- **WHEN** a contributor asks the CLI's tooling for the freshness of its registry-contract view while disconnected from the network
- **THEN** the tooling SHALL report the time of last refresh and the configured staleness threshold
- **AND** the tooling SHALL indicate whether the view exceeds the threshold
- **AND** no network call SHALL be required to produce this report

#### Scenario: CI surfaces a stale view as a non-blocking warning

- **WHEN** a pull request is opened against the CLI and the stored registry-contract view exceeds the configured staleness threshold
- **THEN** CI SHALL emit a visible warning annotation on the pull request
- **AND** CI SHALL NOT fail the pull request solely because of staleness
- **AND** transient failures reaching the registry during the staleness check SHALL NOT fail the pull request

### Requirement: Remove command is registered

The system SHALL register a `remove` command that removes one or more facets from the project manifest and uninstalls them in a single operation. The command SHALL accept one or more facet names as positional arguments. The system SHALL also accept `rm` as an alias of the same command, so users with muscle memory for either name succeed; both names SHALL invoke identical behavior.

#### Scenario: Remove command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `remove` command with its description
- **AND** the help output SHALL list `rm` as an alias of the same command

#### Scenario: rm alias produces identical behavior

- **WHEN** a user runs `rm` with the same arguments and flags as a corresponding `remove` invocation
- **THEN** the system SHALL produce the same output, side effects, and exit code as `remove`

#### Scenario: Remove command requires at least one name

- **WHEN** a user runs `remove` with no positional arguments
- **THEN** the system SHALL print a usage error
- **AND** the process SHALL exit with code 1

#### Scenario: Remove command accepts multiple names

- **WHEN** a user runs `remove` with two or more facet names
- **THEN** the system SHALL remove each declared facet
- **AND** the system SHALL silently ignore any undeclared names
- **AND** the operation SHALL succeed if every declared facet is removed successfully

### Requirement: Remove renders the unified progress view

The `remove` command SHALL present progress through the same shared rendering used by the commands that add and install facets. A user watching `remove` SHALL see a per-facet section that names each removed facet and indicates whether its removal succeeded or failed, followed by a final summary that lists each affected facet on its own line.

#### Scenario: Single-facet removal shows per-facet detail

- **WHEN** a user runs `remove` with exactly one facet to remove
- **THEN** the rendered view SHALL show the facet's name and its removal progress
- **AND** on completion the view SHALL show a one-line summary identifying the removed facet

#### Scenario: Multi-facet removal shows aggregate progress

- **WHEN** a user runs `remove` with multiple facets to remove
- **THEN** the rendered view SHALL show progress for each facet
- **AND** on completion the view SHALL show one summary line per affected facet

### Requirement: Remove handles undeclared names gracefully

When `remove` is given a name that is not declared in the project, the system SHALL silently ignore it. When every requested name is undeclared, the rendered view SHALL report that no changes were made and the process SHALL exit with code 0.

Whether a requested name is declared SHALL be decided by the commit, under the project lock. The CLI SHALL NOT skip any step of the ordinary removal flow on the strength of a pre-lock read, and SHALL therefore discover adapters for every removal request, including one whose names all appear undeclared. Adapter discovery for `remove` SHALL follow the same contract as the commands that add and install facets: a project with no installable adapter SHALL prompt for one in an interactive terminal and SHALL fail with a non-zero exit code in a non-interactive environment. The CLI SHALL still validate that the project manifest can be read before discovering adapters, so an absent, malformed, or unsupported-version manifest is reported as such rather than as a missing adapter.

#### Scenario: Removing only undeclared names shows no-op summary

- **WHEN** a user runs `remove` with one or more names that are not declared in the project manifest
- **AND** no requested name is declared
- **AND** the project has at least one installable adapter
- **THEN** the rendered view SHALL show a summary indicating no changes
- **AND** the process SHALL exit with code 0

#### Scenario: Removing only undeclared names still requires an adapter

- **WHEN** a user runs `remove` in a non-interactive environment with names that are all undeclared
- **AND** the project has no installable adapter
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

### Requirement: Remove accepts verbose output

The `remove` command SHALL accept a `--verbose` flag that emits additional diagnostic output. The verbose output SHALL be written to stderr so that it does not interfere with the rendered view on stdout.

#### Scenario: Verbose flag emits diagnostics on stderr

- **WHEN** a user runs `remove` with `--verbose`
- **THEN** the rendered view SHALL appear on stdout as usual
- **AND** additional diagnostic output SHALL appear on stderr

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

A declaration summary SHALL carry the transport, the standard-input command or the URL origin, and a fingerprint prefix, and SHALL carry nothing else from the declaration. Two claimants sharing a command SHALL remain distinguishable through that prefix.

#### Scenario: A summary distinguishes without disclosing

- **WHEN** two claimants declare the same command and differ only in arguments or environment
- **THEN** their summaries SHALL differ
- **AND** neither SHALL contain an argument, an environment name, an environment value, or a URL path

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

### Requirement: Users approve new or changed MCP configuration before any write

Interactive `add`, `install`, and `remove` operations SHALL display one MCP-configuration-only approval screen when active declarations are new or changed for the current machine. The screen SHALL identify every effective server, claimant facet, and exact command with arguments and environment assignments or exact URL. A distinct section SHALL identify every untracked native entry that will be adopted or replaced and the affected adapter. Approval SHALL accept the complete displayed set; declining SHALL exit non-zero and leave all state unchanged.

The MCP approval screen SHALL NOT include asset collision choices or asset takeover confirmations.

Exactly two surfaces SHALL reproduce declaration contents *completely*: this interactive approval screen, and the non-interactive MCP consent failure specified below. Both exist to show a user what approval would authorize, and neither elides any part of it.

Every other surface SHALL reproduce at most the single declaration value that explains a failure or distinguishes one claimant from another, and SHALL NOT reproduce the declaration fields around it. A diagnostic reporting that one value cannot be written SHALL be free to name that value, because a user cannot correct a value they were not shown; a collision summary SHALL be free to name the command or the URL origin, because that is what tells two claimants apart. Arguments, environment names, environment values, and a URL's path, query, and fragment SHALL remain absent from every surface other than the two consent surfaces.

Every reproduced declaration value, on every surface, SHALL be rendered through one canonical escaped representation. That representation SHALL be unambiguous: each value SHALL be delimited so that argument boundaries survive, so that two different argument lists cannot render identically, and so that no value can introduce a line break, terminal control sequence, or other character that would let declaration text impersonate surrounding output. It SHALL restrict its output to printable characters by allowing them rather than by excluding known-dangerous ones, so that a character it has never been told about cannot pass through. Escaping SHALL preserve the complete value rather than redact, truncate, or normalize it.

#### Scenario: A failure names the value that caused it

- **WHEN** an adapter reports that one declaration value cannot be written literally
- **THEN** the diagnostic SHALL reproduce that value in escaped form
- **AND** it SHALL NOT reproduce any other field of that declaration

#### Scenario: A declaration cannot forge a diagnostic

- **WHEN** a reproduced value contains a line break or terminal control sequence
- **THEN** the diagnostic SHALL occupy no additional line and issue no terminal control

#### Scenario: An unfamiliar character is escaped rather than drawn

- **WHEN** a declaration value contains a character outside the printable set the rendering allows
- **THEN** it SHALL be escaped
- **AND** the complete value SHALL remain recoverable from the rendering

#### Scenario: Distinct argument lists render differently

- **WHEN** one declaration carries a single argument containing a space and another carries two separate arguments with the same characters
- **THEN** the two consent renderings SHALL differ

#### Scenario: Control characters cannot forge output

- **WHEN** a declaration value contains a newline, carriage return, or terminal control sequence
- **THEN** the consent rendering SHALL escape it so it occupies no additional line and issues no terminal control
- **AND** the complete value SHALL remain present in escaped form

#### Scenario: Empty and whitespace arguments stay visible

- **WHEN** a declaration carries an empty argument or an argument that is only whitespace
- **THEN** the consent rendering SHALL show it as a distinct delimited argument

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
- **THEN** arguments and environment values SHALL NOT appear
- **AND** a complete declaration SHALL appear only on the two consent surfaces

### Requirement: Non-interactive MCP configuration requires explicit opt-in

The `add`, `install`, and `remove` commands SHALL each accept `--accept-mcp` as the sole non-interactive MCP acceptance mechanism. No second MCP override flag SHALL be introduced. A non-interactive operation with unapproved declarations or MCP native-entry takeovers SHALL fail before mutation unless the flag is supplied. Frozen installation SHALL never prompt and MAY use the same pre-supplied flag. The flag SHALL NOT authorize asset takeover.

That failure is the second consent surface, so it SHALL disclose the complete set the flag would authorize. For every unapproved declaration it SHALL identify the effective name, every claimant facet, and the complete escaped declaration. For every untracked native entry it would take over it SHALL identify the adapter, the effective identity, whether the existing entry is equivalent or divergent, and the complete escaped declaration. It SHALL state that no state changed.

#### Scenario: Add without opt-in reports every declaration

- **WHEN** non-interactive `add` encounters unapproved declarations without `--accept-mcp`
- **THEN** it SHALL fail with every effective name, claimant facet, and complete command or URL
- **AND** it SHALL state that no state changed

#### Scenario: Failure discloses every takeover

- **WHEN** a non-interactive operation without `--accept-mcp` would take over untracked native entries
- **THEN** the failure SHALL identify each takeover's adapter, effective identity, equivalent or divergent status, and complete escaped declaration
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

When active MCP declarations exist and any selected adapter declares no MCP support, the command SHALL fail before prompting or mutation. One error SHALL identify every unsupported selected adapter and SHALL direct the user to omit the active server declarations or deselect the adapter.

#### Scenario: Every unsupported adapter is listed

- **WHEN** two selected adapters cannot configure active MCP declarations
- **THEN** one failure SHALL name both adapters and give actionable remediation

#### Scenario: Omitted declarations avoid the failure

- **WHEN** every authored server is omitted, no active declaration remains, and the receipt owns no effective server identity needing reconciliation or deletion
- **THEN** an adapter without MCP support SHALL NOT fail the operation for that reason

#### Scenario: Pending receipt cleanup still fails

- **WHEN** every authored server is omitted but the receipt still owns an effective server identity this operation must delete
- **THEN** an adapter without MCP support SHALL fail the operation before mutation

### Requirement: Command output reports MCP configuration outcomes

Command summaries SHALL report MCP servers separately from text assets and SHALL identify added, updated, unchanged, aliased, omitted, repaired, removed, conflicted, unsupported, and takeover outcomes. An aliased server SHALL show authored and effective names. A server-only facet SHALL not be presented as a no-op. Declaration contents SHALL remain absent from summaries, which report outcomes rather than diagnose failures and therefore need no declaration value at all.

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

### Requirement: Generated JSON files are byte-stable

Every JSON document the system generates SHALL use two-space indentation and SHALL end with exactly one trailing newline, so a generated file opened in an editor that appends a final newline needs no fix-up and produces no diff. This SHALL hold for the project manifest, the lockfile, the machine-local install receipt, build manifests, scaffolded facet manifests, and cache integrity records alike, and SHALL hold identically on every rewrite.

A write to the project manifest SHALL additionally preserve the comments a user wrote in it. Documents the system does not generate — a coding tool's own native configuration — SHALL be outside this requirement's scope, because their formatting belongs to the tool that created them.

#### Scenario: A generated file needs no editor fix-up

- **WHEN** a user opens a JSON file the system generated and saves it in an editor that appends a trailing newline
- **THEN** the saved file SHALL be byte-for-byte unchanged

#### Scenario: A rewrite reproduces the same formatting

- **WHEN** the system rewrites a JSON document it generates
- **THEN** the rewritten document SHALL carry the same two-space indentation and single trailing newline as its first write

#### Scenario: Hand-written project manifest comments survive a write

- **WHEN** a user annotates `facets.json` with comments and then runs a command that writes the manifest
- **THEN** the written manifest SHALL retain those comments
- **AND** it SHALL end with exactly one trailing newline

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

Whenever the update command presents discovered choices, it SHALL identify each checkable registry facet's locked Current version, range-respecting Target version, and registry Latest version. The static preview SHALL additionally identify each facet's manifest specifier. Both presentations SHALL align their columns, seeding each column's width from its own header label so no header overflows the column it names. Git and local facets SHALL be named as unsupported sources rather than counted as current.

Interactive candidate rows SHALL show Current, Target, and Latest simultaneously, SHALL name the chosen column in visible text so the choice survives a terminal with no styling support, and SHALL color only the single version component that changed — by change size, using the existing semantic theme roles: patch as success/green, minor as caution/amber, and major as warning/coral. Styling MAY reinforce the chosen column but SHALL NOT be the only carrier of it. Current and stationary values SHALL remain dim.

#### Scenario: Preview shows all version choices

- **WHEN** a project facet is locked at `1.2.0`, its authored specifier resolves to Target `1.4.0`, and the registry resolves Latest `2.0.0`
- **AND** a user requests an update preview
- **THEN** the output SHALL identify `1.2.0` as Current, `1.4.0` as Target, and `2.0.0` as Latest
- **AND** the output SHALL include the authored specifier

#### Scenario: Interactive rows show all choices and change size

- **WHEN** interactive discovery finds candidate facets with patch, minor, or major Target or Latest advances
- **THEN** each candidate row SHALL show Current, Target, and Latest simultaneously
- **AND** each row SHALL name its chosen column in visible text, independent of any styling
- **AND** only the version component that changed SHALL be colored, using the existing success, caution, or warning theme role for a patch, minor, or major advance respectively

#### Scenario: Unsupported sources are named

- **WHEN** a project contains git or local facets alongside registry facets
- **AND** the update command presents discovery results
- **THEN** the output SHALL name each git or local facet as unsupported for update discovery
- **AND** it SHALL NOT report those facets as current registry facets

### Requirement: Update reports registry discovery progress

When the output stream is a terminal, the update command SHALL provide immediate visible feedback while registry discovery is pending. It SHALL state that it is checking the registry for facet updates and SHALL reuse the CLI's existing indeterminate progress indicator. The indicator SHALL be removed before the command presents a picker, static plan, no-op, or structured error, however discovery ends. The command SHALL NOT present a percentage or completed count unless the discovery boundary exposes real progress events. When the output stream is not a terminal, the command SHALL perform the same discovery and SHALL NOT emit progress frames.

#### Scenario: Pending discovery is visible in a terminal

- **WHEN** registry discovery has started but has not settled in a terminal
- **THEN** the command SHALL state that it is checking the registry for facet updates
- **AND** it SHALL render the existing indeterminate progress indicator

#### Scenario: Discovery feedback yields to the result

- **WHEN** registry discovery succeeds or fails
- **THEN** the pending indicator SHALL be removed
- **AND** the command SHALL continue to the picker, plan, no-op, or structured error appropriate to the result

#### Scenario: Non-terminal discovery emits no progress frames

- **WHEN** registry discovery runs with a non-terminal output stream
- **THEN** the command SHALL NOT write progress frames
- **AND** the discovered result SHALL be unchanged

### Requirement: Users can select updates interactively

The `--interactive` mode SHALL present every registry facet for which Target or Latest is newer than Current. Whether the picker opens SHALL be determined from that candidate set, not from whether the initial mode has a non-empty default selection. Range Target SHALL be the initial choice unless `--latest` is also supplied, in which case Latest SHALL be initial. Users SHALL be able to navigate rows, select or deselect facets, and change the focused row's column between Target and Latest. Left and right SHALL address the Target and Latest columns directly and SHALL clamp at each end rather than wrap; `l` SHALL flip the focused row between them. A choice that does not advance Current SHALL NOT be selectable, and confirmation SHALL require at least one selected advancing choice.

Interactive selection SHALL occur before adapter selection or update application. The command SHALL reject interactive mode before discovery when the terminal cannot prompt. Cancelling or interrupting the picker SHALL apply nothing, SHALL report that nothing was applied, and SHALL exit with code 1.

#### Scenario: Interactive mode starts with range targets

- **WHEN** a user runs `facet update --interactive`
- **AND** a facet has both an advancing Target and an advancing Latest
- **THEN** the facet's initial choice SHALL be Target
- **AND** pressing `l` or right on that row SHALL change its choice to Latest

#### Scenario: Column keys clamp at each end

- **WHEN** a row's choice is Target and the user presses left
- **THEN** the choice SHALL remain Target
- **AND** when a row's choice is Latest and the user presses right, the choice SHALL remain Latest

#### Scenario: Latest interactive mode starts with latest targets

- **WHEN** a user runs `facet update --interactive --latest`
- **AND** a facet has both an advancing Target and an advancing Latest
- **THEN** the facet's initial choice SHALL be Latest
- **AND** pressing `l` or left on that row SHALL change its choice to Target

#### Scenario: Non-advancing choice cannot be selected

- **WHEN** a facet's Target equals Current but its Latest is newer
- **THEN** the Target choice SHALL NOT be selectable
- **AND** the user SHALL be able to toggle to and select Latest

#### Scenario: Latest-only candidate opens plain interactive mode

- **WHEN** a facet's Target equals Current and its Latest is newer
- **AND** the user runs `facet update --interactive` without `--latest`
- **THEN** the command SHALL open the picker rather than report the range-specific no-op
- **AND** the row SHALL start on its stationary Target, unselected
- **AND** the user SHALL be able to toggle to Latest, select it, and confirm

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
