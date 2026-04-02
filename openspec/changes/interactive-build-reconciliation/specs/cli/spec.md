## ADDED Requirements

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
