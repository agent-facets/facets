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
- **THEN** the system SHALL print usage information specific to that command
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

The system SHALL route known command names to their registered handlers. Each command receives the remaining arguments after the command name.

#### Scenario: Registered command is invoked

- **WHEN** a user runs the CLI with a registered command name (e.g., `build`)
- **THEN** the system SHALL execute that command's handler
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
