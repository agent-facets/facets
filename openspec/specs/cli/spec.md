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

The system SHALL reserve commands prefixed with `self-` for operations that act on the CLI binary itself. Commands without the `self-` prefix that share a verb (e.g., `update`, `upgrade`) SHALL NOT act on the CLI binary; they SHALL remain reserved for operations on facet packages and their dependencies.

#### Scenario: self-update acts on the CLI binary

- **WHEN** a user runs `facet self-update`
- **THEN** the system SHALL update the CLI binary
- **AND** the system SHALL NOT modify any facet package or facet manifest

#### Scenario: bare update or upgrade does not act on the CLI binary

- **WHEN** a user runs `facet update` or `facet upgrade`
- **THEN** the system SHALL NOT update the CLI binary
- **AND** the system SHALL treat the invocation as a facet-package operation (which MAY be a stub indicating the feature is not yet implemented)

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
