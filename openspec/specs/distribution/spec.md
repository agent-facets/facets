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

### Requirement: Each supported target has a dedicated platform package on npm

The system SHALL publish a scoped npm package for each supported platform, architecture, and ABI combination under the `@agent-facets` scope with a `cli-` prefix (e.g., `@agent-facets/cli-darwin-arm64`). Each platform package SHALL contain a single pre-compiled binary for its target. The wrapper package (`agent-facets`) SHALL declare all platform packages as `optionalDependencies` so that package managers fetch only the matching binary for the user's platform.

#### Scenario: Platform package contains the correct binary

- **WHEN** a platform package is published for a given target
- **THEN** the package SHALL contain exactly one compiled binary for that target
- **AND** the package's `os` and `cpu` fields SHALL match the target platform and architecture

#### Scenario: Wrapper package declares platform packages as optional dependencies

- **WHEN** the wrapper package `agent-facets` is published
- **THEN** the `optionalDependencies` field SHALL include all 12 platform packages
- **AND** each optional dependency SHALL reference the same version as the wrapper package

#### Scenario: Package manager installs only the matching platform package

- **WHEN** a user runs `npm install agent-facets` on a supported platform
- **THEN** the package manager SHALL install only the platform package matching the user's OS and architecture
- **AND** the package manager SHALL skip platform packages for other targets

### Requirement: Developers can seed platform package names on npm

The system SHALL provide a seed script that publishes placeholder packages to claim the 12 platform package names on npm. The seed script SHALL be invocable via a single command from the repository root.

#### Scenario: Seeding publishes placeholders for missing packages

- **WHEN** a developer runs the seed script while logged in to npm
- **THEN** the system SHALL check which platform package names do not yet exist on npm
- **AND** the system SHALL publish a v0.0.1 placeholder for each missing package
- **AND** the system SHALL skip packages that already exist

#### Scenario: Seeding prints OIDC setup instructions

- **WHEN** the seed script finishes publishing placeholders
- **THEN** the system SHALL print the OIDC setup instructions for each seeded package
- **AND** the system SHALL print the path to the OIDC setup guide in the repository

#### Scenario: Seeding fails gracefully without npm login

- **WHEN** a developer runs the seed script without being logged in to npm
- **THEN** the system SHALL print an error message instructing the developer to run `npm login`
- **AND** the process SHALL exit with a non-zero code without publishing anything

### Requirement: The publish scripts package and publish binaries directly to latest

The system SHALL publish platform packages and the CLI package directly to the `latest` dist-tag. The system SHALL NOT use a staging dist-tag with a separate promotion step, because npm's OIDC trusted publishing does not support `npm dist-tag add` operations.

#### Scenario: Publishing platform packages directly to latest

- **WHEN** the release pipeline publishes a platform package after a successful build
- **THEN** the system SHALL pack and publish the platform package with `--tag latest`

#### Scenario: Publishing the CLI package directly to latest

- **WHEN** the release pipeline publishes the CLI package after all platform packages are verified
- **THEN** the system SHALL synthesize the CLI package containing the launcher script, the postinstall script, and a generated `package.json` with `optionalDependencies`
- **AND** the system SHALL publish the CLI package with `--tag latest`

#### Scenario: Publishing is idempotent

- **WHEN** a publish step runs and a package at the target version already exists on npm
- **THEN** the system SHALL skip that package
- **AND** the system SHALL continue publishing remaining packages

#### Scenario: Publishing uses provenance attestation

- **WHEN** the publish step runs in a CI environment with OIDC configured
- **THEN** the system SHALL publish with `--provenance` for supply chain attestation

### Requirement: The CLI package publishes last to prevent partial releases

The CLI package (`agent-facets`) SHALL always be the last package published in a release. Users install via the CLI package, which resolves platform binaries through `optionalDependencies`. Publishing the CLI package last ensures users never see a version where the CLI package exists but its platform dependencies do not.

#### Scenario: Platform binaries publish before the CLI package

- **WHEN** a CLI release is triggered
- **THEN** the system SHALL publish all 12 platform packages before publishing the CLI package
- **AND** the system SHALL verify all platform packages are available in the npm registry before publishing the CLI package

#### Scenario: Partial platform publish prevents CLI package publish

- **WHEN** one or more platform packages fail to publish or verify
- **THEN** the system SHALL NOT publish the CLI package
- **AND** users on the previous version SHALL be unaffected

### Requirement: The CLI package is versioned but not published by changesets

The changeset workflow SHALL continue to bump the version and generate changelogs for the CLI package. The changeset publish step SHALL NOT publish the CLI package to npm — the custom publish script handles CLI distribution instead.

#### Scenario: Changeset version bumps the CLI package

- **WHEN** a developer runs the changeset version command with a changeset that includes the CLI package
- **THEN** the system SHALL bump the version in the CLI package's `package.json`
- **AND** the system SHALL update the CLI package's changelog

#### Scenario: Changeset version creates a git tag for the CLI package

- **WHEN** a developer runs the changeset version command
- **THEN** the system SHALL create a git tag for the CLI package version

#### Scenario: Changeset publish skips the CLI package

- **WHEN** the changeset publish command runs
- **THEN** the system SHALL NOT publish the CLI package to npm
- **AND** the system SHALL publish other non-private workspace packages normally

### Requirement: OIDC setup is documented for developers

The system SHALL provide a developer-facing guide in the repository that documents how to configure npm OIDC trusted publishing for CircleCI. The guide SHALL NOT be published to the documentation website.

#### Scenario: OIDC guide covers CircleCI configuration

- **WHEN** a developer reads the OIDC setup guide
- **THEN** the guide SHALL document the CircleCI organization, project, and workflow values needed for npm's trust policy
- **AND** the guide SHALL include step-by-step instructions for configuring each platform package on npm

#### Scenario: OIDC guide is discoverable from the seed script

- **WHEN** a developer runs the seed script
- **THEN** the seed script output SHALL reference the OIDC setup guide's location in the repository

### Requirement: CLI releases are automated on version tag push

The system SHALL automatically build, publish, and verify CLI binaries when a version tag is pushed for the CLI package. A developer who merges a version PR SHALL NOT need to manually run any build, publish, or verification steps — the release pipeline SHALL handle the full lifecycle.

#### Scenario: Tag push triggers the full release pipeline

- **WHEN** a version tag matching the CLI package (e.g., `agent-facets@1.0.0`) is pushed
- **THEN** the system SHALL build all 12 platform binaries
- **AND** the system SHALL publish all platform packages directly to `latest`
- **AND** the system SHALL verify that all platform packages are available in the npm registry
- **AND** the system SHALL publish the CLI package directly to `latest`

#### Scenario: Tag push for a non-CLI package does not trigger CLI builds

- **WHEN** a version tag for a non-CLI package (e.g., `@agent-facets/core@1.0.0`) is pushed
- **THEN** the system SHALL NOT run the CLI binary build or publish pipeline
- **AND** the system SHALL publish the non-CLI package using the standard release flow

### Requirement: Platform packages are verified before the CLI package publishes

The system SHALL verify that every platform package exists at the expected version in the npm registry before publishing the CLI package. This ensures the CLI package's `optionalDependencies` are resolvable when users install it.

#### Scenario: All platform packages verified successfully

- **WHEN** all 12 platform packages are available at the expected version in the npm registry
- **THEN** the system SHALL proceed to publish the CLI package

#### Scenario: Verification retries on registry propagation delay

- **WHEN** a published platform package is not yet visible in the npm registry immediately after publishing
- **THEN** the system SHALL retry verification with exponential backoff
- **AND** the system SHALL allow sufficient time for npm registry propagation before failing

#### Scenario: Verification fails after maximum retries

- **WHEN** one or more platform packages are still not visible after the maximum number of retry attempts
- **THEN** the system SHALL fail the release pipeline with a non-zero exit code
- **AND** the system SHALL report which packages could not be verified

### Requirement: CLI releases produce a GitHub Release and notification

The system SHALL create a GitHub Release and send a notification when a CLI version is successfully published. This ensures CLI releases have the same visibility as other package releases.

#### Scenario: GitHub Release created after successful publish

- **WHEN** the CLI release pipeline completes successfully (build, publish, verify)
- **THEN** the system SHALL create a GitHub Release tagged with the version
- **AND** the release notes SHALL include the changelog entry for that version

#### Scenario: Notification sent after successful publish

- **WHEN** the CLI release pipeline completes successfully
- **THEN** the system SHALL send a notification to the configured notification channel
