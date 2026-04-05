## Purpose

Defines how the CLI binary is packaged, resolved, and launched across platforms. Users SHALL be able to install the CLI via any JavaScript package manager and run it on any supported platform without manual configuration.

## Requirements

### Requirement: Users can run the CLI on any supported platform

The system SHALL provide pre-compiled binaries for all supported platform, architecture, and ABI combinations. A user who installs the CLI via a JavaScript package manager SHALL receive a working binary for their platform without additional steps.

#### Scenario: Install on macOS Apple Silicon

- **WHEN** a user runs `npm install agent-facets` on macOS with an arm64 processor
- **THEN** the system SHALL install a macOS arm64 binary
- **AND** running `facet --version` SHALL print the version and exit with code 0

#### Scenario: Install on Linux x86-64

- **WHEN** a user runs `npm install agent-facets` on Linux with an x64 processor
- **THEN** the system SHALL install a Linux x64 binary
- **AND** running `facet --version` SHALL print the version and exit with code 0

#### Scenario: Install on unsupported platform

- **WHEN** a user runs `npm install agent-facets` on a platform for which no binary exists
- **THEN** the system SHALL print an error message identifying the unsupported platform and architecture
- **AND** the process SHALL exit with a non-zero code

### Requirement: The launcher resolves the correct binary for the current platform

The system SHALL provide a launcher script that detects the user's platform, architecture, and CPU capabilities, then executes the matching compiled binary. The launcher SHALL follow a defined resolution order to locate the binary.

#### Scenario: Binary resolved from cached hard-link

- **WHEN** a user runs `facet` and a cached binary exists at the expected location
- **THEN** the system SHALL execute the cached binary directly

#### Scenario: Binary resolved from platform package

- **WHEN** a user runs `facet` and no cached binary exists
- **THEN** the system SHALL detect the current platform, architecture, and CPU capabilities
- **AND** the system SHALL locate the matching per-platform binary package in `node_modules`
- **AND** the system SHALL execute the binary from that package

#### Scenario: Binary path override via environment variable

- **WHEN** the `FACET_BIN_PATH` environment variable is set
- **THEN** the system SHALL execute the binary at the specified path
- **AND** the system SHALL skip all other resolution steps

#### Scenario: No matching binary found

- **WHEN** a user runs `facet` and no matching binary can be found
- **THEN** the system SHALL print an error identifying the platform and architecture
- **AND** the process SHALL exit with a non-zero code

### Requirement: Install-time optimization selects the best binary variant

The system SHALL detect platform capabilities at install time and cache the optimal binary variant. This ensures variant selection happens once during installation rather than on every invocation.

#### Scenario: AVX2-capable CPU receives the optimized binary

- **WHEN** the CLI is installed on a system with AVX2 support
- **THEN** the postinstall step SHALL detect AVX2 support
- **AND** the postinstall step SHALL cache the standard (AVX2-enabled) binary variant

#### Scenario: Non-AVX2 CPU receives the baseline binary

- **WHEN** the CLI is installed on a system without AVX2 support
- **THEN** the postinstall step SHALL detect the absence of AVX2
- **AND** the postinstall step SHALL cache the baseline (no-AVX2) binary variant

#### Scenario: musl libc system receives the musl binary

- **WHEN** the CLI is installed on a Linux system using musl libc (e.g., Alpine)
- **THEN** the postinstall step SHALL detect musl
- **AND** the postinstall step SHALL cache the musl binary variant

#### Scenario: Postinstall failure does not prevent CLI usage

- **WHEN** the postinstall step fails (e.g., hard-link error, detection failure)
- **THEN** the launcher SHALL still resolve the correct binary via its fallback resolution logic
- **AND** the system SHALL NOT fail to start

### Requirement: The build pipeline produces binaries for all supported targets

The system SHALL provide a build script that cross-compiles the CLI entry point into standalone binaries for every supported target. Each binary SHALL be a self-contained executable that requires no external runtime.

#### Scenario: Full cross-compilation build

- **WHEN** a developer runs the build script without flags
- **THEN** the system SHALL produce compiled binaries for all 12 supported targets
- **AND** each binary SHALL be a standalone executable

#### Scenario: Single-platform build for local development

- **WHEN** a developer runs the build script with `--single`
- **THEN** the system SHALL produce a compiled binary only for the current platform
- **AND** the build SHALL complete substantially faster than a full build

#### Scenario: Smoke test on native binary

- **WHEN** the build script produces a binary for the current platform
- **THEN** the build script SHALL execute `--version` against the binary to verify it runs
- **AND** the build SHALL fail if the smoke test fails
