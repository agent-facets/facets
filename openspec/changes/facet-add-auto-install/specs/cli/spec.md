## ADDED Requirements

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
