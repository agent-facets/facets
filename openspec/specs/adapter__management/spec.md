## Purpose

Users install, list, and remove adapters (AI coding tool integrations) through the CLI. The system downloads adapter sources from multiple source types (built-in names, npm, Git, local paths), bundles them into self-contained JavaScript files, verifies them, and stores them in a well-known directory. Installed adapters are loaded at runtime and passed to the build pipeline so they can validate manifest metadata for their tools.

## Requirements

### Requirement: Users can install adapters from multiple sources

The system SHALL provide a command to install adapters. The command SHALL accept specifiers in multiple formats: built-in names for first-party adapters, npm package names, Git URLs using standard Git protocols, and local filesystem paths.

#### Scenario: Install a first-party adapter by name

- **WHEN** a user runs the install command with a built-in name (e.g., "opencode")
- **THEN** the system SHALL resolve the name to the corresponding official package
- **AND** download, bundle, verify, and install the adapter

#### Scenario: Install an adapter from an npm package

- **WHEN** a user runs the install command with an npm package specifier
- **THEN** the system SHALL download the package from the npm registry
- **AND** bundle, verify, and install the adapter

#### Scenario: Install an adapter from a Git repository

- **WHEN** a user runs the install command with a Git URL
- **THEN** the system SHALL clone the repository using the system's `git` binary
- **AND** bundle, verify, and install the adapter

#### Scenario: Git is not available for Git URL install

- **WHEN** a user runs the install command with a Git URL
- **AND** the `git` binary is not available on the system
- **THEN** the system SHALL produce a clear error indicating that `git` is required

#### Scenario: Install an adapter from a local path

- **WHEN** a user runs the install command with a local filesystem path
- **THEN** the system SHALL use the path directly
- **AND** bundle, verify, and install the adapter

### Requirement: Adapter installation produces a self-contained bundle

The system SHALL produce a single self-contained JavaScript file with all dependencies inlined when installing an adapter. The bundle SHALL be loadable at runtime without any external dependency resolution.

#### Scenario: Bundle includes all dependencies

- **WHEN** the system installs an adapter whose source imports third-party packages
- **THEN** the produced bundle SHALL be self-contained with all dependencies inlined
- **AND** the bundle SHALL be loadable at runtime without any external dependency resolution

### Requirement: Adapter installation verifies the bundle before placement

The system SHALL verify that a produced adapter bundle is valid before placing it in the adapter directory. Verification SHALL check that the bundle exports a valid adapter object.

#### Scenario: Valid bundle passes verification

- **WHEN** the system bundles an adapter that correctly exports an adapter object via the SDK factory
- **THEN** verification SHALL succeed
- **AND** the bundle SHALL be placed in the adapter directory

#### Scenario: Invalid bundle fails verification

- **WHEN** the system bundles an adapter that does not export a valid adapter object
- **THEN** verification SHALL fail
- **AND** the system SHALL report which validation checks failed
- **AND** the bundle SHALL NOT be placed in the adapter directory

### Requirement: Adapter identity is determined by the adapter itself

The system SHALL determine an adapter's name from the adapter object's own name field after bundling and verification. This name SHALL be used as the directory name under the adapter installation directory.

#### Scenario: Adapter names itself

- **WHEN** the system installs an adapter from any source
- **AND** the adapter object declares its name
- **THEN** the bundle SHALL be placed at the path corresponding to that adapter name

#### Scenario: Adapter name conflict overwrites

- **WHEN** the system installs an adapter whose name matches an already-installed adapter
- **THEN** the system SHALL overwrite the existing adapter bundle with the new one

### Requirement: Users can list installed adapters

The system SHALL provide a command to list all adapters currently installed in the adapter directory.

#### Scenario: List with installed adapters

- **WHEN** a user runs the list command
- **AND** adapters are installed
- **THEN** the system SHALL display the name of each installed adapter

#### Scenario: List with no installed adapters

- **WHEN** a user runs the list command
- **AND** no adapters are installed
- **THEN** the system SHALL indicate that no adapters are installed

### Requirement: Users can remove installed adapters

The system SHALL provide a command to remove an installed adapter by name.

#### Scenario: Remove an existing adapter

- **WHEN** a user runs the remove command with the name of an installed adapter
- **THEN** the system SHALL delete the adapter from the adapter directory

#### Scenario: Remove a non-existent adapter

- **WHEN** a user runs the remove command with a name that does not match any installed adapter
- **THEN** the system SHALL report that no adapter with that name is installed

### Requirement: The system loads installed adapter bundles at runtime

The system SHALL load installed adapter bundles from the adapter directory at runtime. Loaded adapters SHALL be passed to the build pipeline for metadata building.

#### Scenario: Load installed adapters for a build

- **WHEN** the system runs a build command
- **THEN** the system SHALL scan the adapter directory for installed adapter bundles
- **AND** load each bundle
- **AND** pass the loaded adapter objects to the build pipeline

#### Scenario: No adapters installed during build

- **WHEN** the system runs a build command
- **AND** no adapters are installed
- **THEN** the build SHALL proceed
- **AND** any adapter metadata in the manifest SHALL produce warnings for unknown adapters
