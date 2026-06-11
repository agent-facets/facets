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

#### Scenario: Removing only undeclared names shows no-op summary

- **WHEN** a user runs `remove` with one or more names that are not declared in the project manifest
- **AND** no requested name is declared
- **THEN** the rendered view SHALL show a summary indicating no changes
- **AND** the process SHALL exit with code 0

#### Scenario: Mix of declared and undeclared names removes the declared ones

- **WHEN** a user runs `remove` with names where some are declared and some are not
- **THEN** the system SHALL remove the declared facets
- **AND** the system SHALL silently ignore the undeclared names
- **AND** the process SHALL exit with code 0 if all declared facets were removed successfully

### Requirement: Remove reports rollback outcome on failure

When a remove operation fails after the project manifest has been modified, the rendered view SHALL indicate whether the project was fully restored to its pre-operation state or whether some state may remain, and the process SHALL exit with a non-zero code.

#### Scenario: Failed removal that fully rolls back

- **WHEN** a remove operation fails and the system fully restores the project to its pre-operation state
- **THEN** the rendered view SHALL indicate that the project state is unchanged
- **AND** the process SHALL exit with a non-zero code

#### Scenario: Failed removal that cannot fully roll back

- **WHEN** a remove operation fails and the system cannot fully restore the project
- **THEN** the rendered view SHALL warn the user that some state may remain
- **AND** the process SHALL exit with a non-zero code

### Requirement: Remove accepts verbose output

The `remove` command SHALL accept a `--verbose` flag that emits additional diagnostic output. The verbose output SHALL be written to stderr so that it does not interfere with the rendered view on stdout.

#### Scenario: Verbose flag emits diagnostics on stderr

- **WHEN** a user runs `remove` with `--verbose`
- **THEN** the rendered view SHALL appear on stdout as usual
- **AND** additional diagnostic output SHALL appear on stderr
