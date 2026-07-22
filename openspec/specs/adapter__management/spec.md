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

The system SHALL verify that a produced adapter bundle is valid and compatible before placing or activating it. Verification SHALL check that the bundle exports a valid adapter object with a present, well-formed runtime API declaration supported by the current CLI. For an npm candidate, verification SHALL also require the runtime declaration to equal the package declaration used for selection. A compatibility failure SHALL NOT trigger a source-rebundling fallback and SHALL NOT replace an existing adapter.

#### Scenario: Valid bundle passes verification

- **WHEN** the system bundles an adapter that correctly exports an adapter object with an API supported by the CLI
- **THEN** verification SHALL succeed
- **AND** the bundle SHALL be placed in the adapter directory

#### Scenario: Invalid bundle fails verification

- **WHEN** the system bundles an adapter that does not export a valid adapter object
- **THEN** verification SHALL fail
- **AND** the system SHALL report which validation checks failed
- **AND** the bundle SHALL NOT be placed in the adapter directory

#### Scenario: Runtime API declaration is missing or malformed

- **WHEN** a candidate bundle has no runtime adapter API declaration or has a malformed declaration
- **THEN** verification SHALL fail with the corresponding compatibility classification
- **AND** the candidate SHALL NOT become active

#### Scenario: Runtime API declaration is unsupported

- **WHEN** a candidate bundle declares a well-formed adapter API that the CLI does not support
- **THEN** verification SHALL fail before any adapter contract method is invoked
- **AND** the candidate SHALL NOT become active

#### Scenario: Git or local candidate is checked as supplied

- **WHEN** a user installs an adapter from Git or a local path
- **THEN** the produced runtime bundle MUST declare an adapter API supported by the CLI
- **AND** an incompatible declaration SHALL fail rather than trigger package-version substitution

### Requirement: Adapter identity is determined by the adapter itself

The system SHALL determine an adapter's name from the adapter object's own name field after bundling and verification. This name SHALL be used as the directory name under the adapter installation directory. When that name matches an existing installation, the system SHALL replace the existing adapter only after the candidate has passed verification.

#### Scenario: Adapter names itself

- **WHEN** the system installs an adapter from any source
- **AND** the adapter object declares its name
- **THEN** the bundle SHALL be placed at the path corresponding to that adapter name

#### Scenario: Adapter name conflict replaces atomically

- **WHEN** the system installs a verified adapter whose name matches an already-installed adapter
- **THEN** the system SHALL atomically activate the new adapter as the replacement
- **AND** a failure before activation SHALL leave the existing adapter unchanged

### Requirement: Users can list installed adapters

The system SHALL provide a command to list all adapters currently installed in the adapter directory. The listing SHALL inspect every entry and display its declared adapter API as an exact identifier, `missing`, or `malformed`, together with a `supported`, `unsupported`, or `broken` compatibility status. An entry SHALL be classified as `broken` when its installation metadata is invalid, its bundle cannot be loaded, or its export is not a valid adapter object. A missing, malformed, or unsupported API declaration alone SHALL be classified as API incompatibility rather than `broken`. An entry with no installation metadata — a legacy directly placed bundle without an installation receipt — SHALL be inspected as an unmanaged installation and classified from its runtime bundle: `supported` when it declares a supported API, `unsupported` when its API declaration is missing, malformed, or unsupported, and `broken` only when the bundle cannot be loaded or its export is not a valid adapter object. The entry SHALL NOT be classified as `broken` merely because its receipt is absent. Listing SHALL remain available when one or more entries are incompatible or broken so the user can identify what needs repair.

#### Scenario: List with compatible installed adapters

- **WHEN** a user runs the list command
- **AND** compatible adapters are installed
- **THEN** the system SHALL display the name, declared API, and supported status of each adapter

#### Scenario: List with incompatible or broken adapters

- **WHEN** a user runs the list command
- **AND** an installed entry has a missing, malformed, or unsupported API declaration, invalid installation metadata, an unloadable bundle, or an invalid export
- **THEN** the system SHALL display that entry, its declared API when available, and its compatibility status
- **AND** the command SHALL remain available for recovery

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

The system SHALL inspect installed adapter bundles before returning them for use. A compatible installation SHALL provide a verified adapter whose runtime API is supported by the current CLI. If any installed entry is incompatible or broken, loading SHALL fail with all collected failures instead of silently skipping entries. No adapter contract method SHALL be invoked for an entry before its compatibility has been established.

#### Scenario: Load compatible installed adapters for a build

- **WHEN** the system runs a build command
- **AND** every installed adapter is valid and declares a supported API
- **THEN** the system SHALL load each verified adapter
- **AND** pass the loaded adapter objects to the build pipeline

#### Scenario: Incompatible installed adapter blocks a build

- **WHEN** the system runs a build command
- **AND** an installed adapter has a missing, malformed, or unsupported API declaration
- **THEN** the build SHALL fail with an actionable adapter compatibility diagnostic
- **AND** no adapter contract method SHALL be invoked

#### Scenario: No adapters installed during build

- **WHEN** the system runs a build command
- **AND** no adapters are installed
- **THEN** the build SHALL proceed
- **AND** any adapter metadata in the manifest SHALL produce warnings for unknown adapters

### Requirement: npm adapter installs select the highest compatible package version

The system SHALL accept npm adapter package selectors in the exact `MAJOR.MINOR.PATCH`, major-wildcard `MAJOR.*`, minor-wildcard `MAJOR.MINOR.*`, bare wildcard `*`, and `latest` forms. A bare package name or first-party alias SHALL act as an implicit unconstrained selector. For a non-exact request, the system SHALL select the highest stable package version that satisfies the selector and declares an adapter API supported by the current CLI. For an exact request, the system SHALL consider only that package version and SHALL NOT silently substitute another release. The `latest` selector SHALL denote the same unconstrained candidate set as a bare package name or `*`; the system SHALL resolve it to the highest stable version that declares a supported adapter API and SHALL NOT consult the npm `latest` distribution tag during selection.

The npm `latest` distribution tag SHALL continue to advance according to normal publishing policy. Compatibility selection SHALL NOT require moving, pinning, or withholding that tag.

#### Scenario: Bare package skips a newer incompatible release

- **WHEN** a user installs an npm adapter by bare package name
- **AND** the newest package release declares an unsupported adapter API
- **AND** an older stable release declares an API supported by the CLI
- **THEN** the system SHALL install the highest stable release that declares a supported API

#### Scenario: Wildcard constrains compatible selection

- **WHEN** a user installs an npm adapter with a supported wildcard selector
- **THEN** the system SHALL select the highest stable package version that both satisfies the wildcard and declares a supported adapter API

#### Scenario: Exact incompatible release is not substituted

- **WHEN** a user requests an exact npm adapter package version whose declared adapter API is missing, malformed, or unsupported
- **THEN** installation SHALL fail for that exact release
- **AND** the system SHALL NOT install another package version instead

#### Scenario: Unsupported range syntax is rejected

- **WHEN** a user supplies a caret, tilde, comparator, OR, hyphen, prerelease, or `x`-style npm adapter selector
- **THEN** the system SHALL reject the selector
- **AND** the error SHALL identify the accepted exact, wildcard, and `latest` forms

#### Scenario: No compatible release is available

- **WHEN** no package version satisfying the user's selector declares an adapter API supported by the CLI
- **THEN** installation SHALL fail before downloading an adapter bundle
- **AND** the failure SHALL identify the package and requested selector
- **AND** the failure SHALL identify the CLI's supported APIs
- **AND** the failure SHALL identify the newest considered release and its missing, malformed, or unsupported declaration

### Requirement: Published npm adapters declare their API before download

An npm adapter release MUST publish its adapter API identifier in the top-level `facetAdapterApiVersion` package field. The package declaration SHALL be used to select a candidate before download, but the loaded adapter's runtime declaration SHALL remain authoritative. A package/runtime disagreement SHALL fail verification and SHALL NOT be treated as a reason to select a different call contract.

#### Scenario: Compatible package declaration permits candidacy

- **WHEN** an npm adapter release publishes a well-formed `facetAdapterApiVersion` supported by the CLI
- **AND** its package version satisfies the user's selector
- **THEN** that release SHALL be eligible for compatible version selection

#### Scenario: Missing package declaration is ineligible

- **WHEN** an npm adapter release omits `facetAdapterApiVersion`
- **THEN** that release SHALL NOT be eligible for compatibility-aware selection

#### Scenario: Package and runtime declarations disagree

- **WHEN** a selected npm release declares one supported adapter API in package metadata
- **AND** its loaded runtime adapter declares a different API
- **THEN** verification SHALL fail before the adapter is activated
- **AND** no adapter contract method SHALL be invoked

### Requirement: Adapter replacement is atomic

The system SHALL completely verify a candidate adapter before making it active. Replacing an adapter SHALL switch from the previous verified installation to the new verified installation atomically. Any failure before activation SHALL leave the previous installation active and unchanged.

#### Scenario: Verified replacement becomes active

- **WHEN** a user replaces an installed adapter with a candidate that passes all verification
- **THEN** the new adapter SHALL become the sole active installation for that adapter name
- **AND** subsequent loads SHALL use the new adapter

#### Scenario: Failed replacement preserves the previous adapter

- **WHEN** a user attempts to replace an installed adapter
- **AND** candidate resolution, download, bundling, verification, staging, or activation fails
- **THEN** the previous adapter SHALL remain active
- **AND** the previous installation SHALL remain unchanged

### Requirement: Managed adapter installations retain repair provenance

A managed installation SHALL retain its original source specifier, verified adapter API, and source-specific provenance sufficient to identify the installed source and render a repair command. npm provenance SHALL include the resolved package name and version and the registry integrity used to authenticate that package. Git provenance SHALL include the repository URL and optional requested ref. Local provenance SHALL include the resolved source path. Git and local provenance SHALL NOT claim an npm package version or npm registry integrity.

#### Scenario: Managed npm installation provides its repair source

- **WHEN** a managed npm adapter is later found incompatible or broken
- **THEN** its retained provenance SHALL include the original install specifier, resolved package name and version, verified adapter API, and registry integrity
- **AND** the CLI SHALL be able to present `facet adapter install <specifier>` as the repair command

#### Scenario: Git or local installation retains source-specific provenance

- **WHEN** a user installs an adapter from Git or a local path
- **THEN** the retained provenance SHALL include the original specifier and verified adapter API
- **AND** Git provenance SHALL include the repository URL and optional requested ref
- **AND** local provenance SHALL include the resolved source path
- **AND** the provenance SHALL NOT include an npm package version or npm registry integrity

### Requirement: Compatibility failures provide actionable diagnostics

When an adapter cannot be selected, verified, or loaded because its API declaration is missing, malformed, unsupported, or inconsistent with package metadata, the system SHALL return structured failure data. User-facing diagnostics SHALL identify the affected adapter or package, the found declaration when one exists, the adapter APIs supported by the CLI, and the best available compatible-install command. When the installation retains original source provenance, that command SHALL use the recorded source. When provenance is unavailable, the command SHALL use the best available identifier — a first-party alias, or otherwise the installed adapter name — and the diagnostic SHALL indicate that the original install source is unavailable. Compatibility failures SHALL NOT be reported as “no adapters installed” or as an unknown facet metadata schema.

#### Scenario: Unsupported installed adapter reports recovery

- **WHEN** an installed adapter declares an API not supported by the CLI
- **THEN** the command SHALL fail with a diagnostic identifying the adapter and its declared API
- **AND** the diagnostic SHALL list the APIs supported by the CLI
- **AND** the diagnostic SHALL provide the best available compatible-install command

#### Scenario: Multiple installed failures are reported together

- **WHEN** more than one installed adapter is incompatible or broken
- **THEN** loading SHALL fail with all collected adapter failures
- **AND** each compatibility failure SHALL retain its own repair information

#### Scenario: Installation without provenance reports a best-available repair

- **WHEN** an installed adapter without retained source provenance is found incompatible or broken
- **AND** its name does not match a first-party alias
- **THEN** the diagnostic SHALL provide a best-available compatible-install command derived from the installed adapter name
- **AND** the diagnostic SHALL indicate that the original install source is unavailable
