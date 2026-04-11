## ADDED Requirements

### Requirement: Users can install harnesses from multiple sources

The system SHALL provide a command to install harnesses. The command SHALL accept specifiers in multiple formats: built-in names for first-party harnesses, npm package names, Git URLs using standard Git protocols, and local filesystem paths.

#### Scenario: Install a first-party harness by name

- **WHEN** a user runs the install command with a built-in name (e.g., "opencode")
- **THEN** the system SHALL resolve the name to the corresponding official package
- **AND** download, bundle, verify, and install the harness

#### Scenario: Install a harness from an npm package

- **WHEN** a user runs the install command with an npm package specifier
- **THEN** the system SHALL download the package from the npm registry
- **AND** bundle, verify, and install the harness

#### Scenario: Install a harness from a Git repository

- **WHEN** a user runs the install command with a Git URL
- **THEN** the system SHALL clone the repository using the system's `git` binary
- **AND** bundle, verify, and install the harness

#### Scenario: Git is not available for Git URL install

- **WHEN** a user runs the install command with a Git URL
- **AND** the `git` binary is not available on the system
- **THEN** the system SHALL produce a clear error indicating that `git` is required

#### Scenario: Install a harness from a local path

- **WHEN** a user runs the install command with a local filesystem path
- **THEN** the system SHALL use the path directly
- **AND** bundle, verify, and install the harness

### Requirement: Harness installation produces a self-contained bundle

The system SHALL produce a single self-contained JavaScript file with all dependencies inlined when installing a harness. The bundle SHALL be loadable at runtime without any external dependency resolution.

#### Scenario: Bundle includes all dependencies

- **WHEN** the system installs a harness whose source imports third-party packages
- **THEN** the produced bundle SHALL be self-contained with all dependencies inlined
- **AND** the bundle SHALL be loadable at runtime without any external dependency resolution

### Requirement: Harness installation verifies the bundle before placement

The system SHALL verify that a produced harness bundle is valid before placing it in the harness directory. Verification SHALL check that the bundle exports a valid harness object.

#### Scenario: Valid bundle passes verification

- **WHEN** the system bundles a harness that correctly exports a harness object via the SDK factory
- **THEN** verification SHALL succeed
- **AND** the bundle SHALL be placed in the harness directory

#### Scenario: Invalid bundle fails verification

- **WHEN** the system bundles a harness that does not export a valid harness object
- **THEN** verification SHALL fail
- **AND** the system SHALL report which validation checks failed
- **AND** the bundle SHALL NOT be placed in the harness directory

### Requirement: Harness identity is determined by the harness itself

The system SHALL determine a harness's name from the harness object's own name field after bundling and verification. This name SHALL be used as the directory name under the harness installation directory.

#### Scenario: Harness names itself

- **WHEN** the system installs a harness from any source
- **AND** the harness object declares its name
- **THEN** the bundle SHALL be placed at the path corresponding to that harness name

#### Scenario: Harness name conflict overwrites

- **WHEN** the system installs a harness whose name matches an already-installed harness
- **THEN** the system SHALL overwrite the existing harness bundle with the new one

### Requirement: Users can list installed harnesses

The system SHALL provide a command to list all harnesses currently installed in the harness directory.

#### Scenario: List with installed harnesses

- **WHEN** a user runs the list command
- **AND** harnesses are installed
- **THEN** the system SHALL display the name of each installed harness

#### Scenario: List with no installed harnesses

- **WHEN** a user runs the list command
- **AND** no harnesses are installed
- **THEN** the system SHALL indicate that no harnesses are installed

### Requirement: Users can remove installed harnesses

The system SHALL provide a command to remove an installed harness by name.

#### Scenario: Remove an existing harness

- **WHEN** a user runs the remove command with the name of an installed harness
- **THEN** the system SHALL delete the harness from the harness directory

#### Scenario: Remove a non-existent harness

- **WHEN** a user runs the remove command with a name that does not match any installed harness
- **THEN** the system SHALL report that no harness with that name is installed

### Requirement: The system loads installed harness bundles at runtime

The system SHALL load installed harness bundles from the harness directory at runtime. Loaded harnesses SHALL be passed to the build pipeline for metadata building.

#### Scenario: Load installed harnesses for a build

- **WHEN** the system runs a build command
- **THEN** the system SHALL scan the harness directory for installed harness bundles
- **AND** load each bundle
- **AND** pass the loaded harness objects to the build pipeline

#### Scenario: No harnesses installed during build

- **WHEN** the system runs a build command
- **AND** no harnesses are installed
- **THEN** the build SHALL proceed
- **AND** any harness metadata in the manifest SHALL produce warnings for unknown harnesses
