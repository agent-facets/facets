## Purpose

TBD — Defines the command-line interface behavior for argument parsing, command dispatch, help output, version reporting, and error handling.

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

- **WHEN** a user provides a path to a non-existent directory for `build` or `edit`
- **THEN** the system SHALL print an error indicating the directory does not exist
- **AND** the process SHALL exit with code 1

#### Scenario: Directory is auto-created for create command

- **WHEN** a user provides a path to a non-existent directory for `create`
- **THEN** the system SHALL create the directory automatically

#### Scenario: Build and edit require facet.json to exist

- **WHEN** a user runs `build` or `edit` in a directory without `facet.json`
- **THEN** the system SHALL print an error indicating no facet manifest was found
- **AND** the process SHALL exit with code 1

### Requirement: Commands declare per-command flags

The system SHALL support per-command flag declarations on command definitions. The router SHALL parse per-command flags via the argument parser and pass the parsed values to command handlers alongside positional arguments.

#### Scenario: Command with declared boolean flag

- **WHEN** a command declares a boolean flag (e.g., `--force`)
- **AND** a user provides that flag on the command line
- **THEN** the command handler SHALL receive the flag value as `true`

#### Scenario: Command with declared string flag

- **WHEN** a command declares a string flag (e.g., `--registry`)
- **AND** a user provides that flag with a value on the command line
- **THEN** the command handler SHALL receive the flag value as the provided string

#### Scenario: Undeclared flags are ignored

- **WHEN** a user provides a flag that is not declared by the command
- **THEN** the command handler SHALL NOT receive that flag

### Requirement: Per-command help displays usage and flags

The system SHALL render per-command help text from command metadata including usage syntax and flag descriptions. Authors SHALL NOT need to maintain help text manually.

#### Scenario: Per-command help shows usage line

- **WHEN** a user runs `<command> --help` for a command that declares a `usage` field
- **THEN** the help output SHALL display the usage syntax (e.g., `Usage: facet create [directory] [options]`)

#### Scenario: Per-command help lists declared flags

- **WHEN** a user runs `<command> --help` for a command that declares flags
- **THEN** the help output SHALL list each declared flag with its description under an Options section
- **AND** the `--help` flag SHALL also appear in the Options section

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

### Requirement: Add and install render a unified progress view

The `add` and `install` commands SHALL present progress through a single shared rendering. A user watching either command SHALL see the same shape of output: a per-facet section that names each facet, indicates its current stage, and shows whether it succeeded, failed, or is in progress, followed by a final summary that lists each affected facet on its own line.

#### Scenario: Single-facet operation shows per-facet detail

- **WHEN** a user runs `add` or `install` with exactly one facet to install or update
- **THEN** the rendered view SHALL show the facet's name and its current stage as it progresses through fetch, verification, build, and materialization
- **AND** on completion the view SHALL show a one-line summary of the facet's resolved version

#### Scenario: Multi-facet operation shows aggregate progress

- **WHEN** a user runs `add` or `install` with multiple facets to install or update
- **THEN** the rendered view SHALL show progress for each facet
- **AND** on completion the view SHALL show one summary line per affected facet identifying the action and resolved version

#### Scenario: No-op install renders an empty summary

- **WHEN** a user runs `install` and the lockfile already matches on-disk state
- **THEN** the view SHALL render a summary indicating no changes were applied
- **AND** the process SHALL exit with code 0

### Requirement: Add command surfaces re-add updates

When `add` re-adds a facet that was already declared at a different version, the rendered view SHALL clearly identify both the previous and new versions so the user can confirm the upgrade or downgrade.

#### Scenario: Re-add at a higher version

- **WHEN** a user runs `add name@2.0.0` for a facet currently locked at `1.5.0`
- **THEN** the summary line for that facet SHALL include both versions in a way that identifies the prior version and the new version

#### Scenario: Re-add at a lower version

- **WHEN** a user runs `add name@1.0.0` for a facet currently locked at `1.5.0`
- **THEN** the summary line for that facet SHALL include both versions in a way that identifies the prior version and the new version

### Requirement: Add command warns when servers are declared

When a facet being installed declares MCP server dependencies, the rendered view SHALL display a warning naming each declared server. The warning SHALL appear in the rendered output, not on stderr.

#### Scenario: Single declared server emits a single warning line

- **WHEN** the system installs a facet that declares one MCP server
- **THEN** the rendered view SHALL include a warning line identifying the server by name
- **AND** the warning SHALL state that server installation is not yet supported

#### Scenario: Multiple declared servers are listed together

- **WHEN** the system installs a facet that declares multiple MCP servers
- **THEN** the rendered view SHALL include a single warning line listing every declared server name

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
