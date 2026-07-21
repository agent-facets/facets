## ADDED Requirements

### Requirement: npm adapter installation selects the highest compatible release

When installing an adapter from an npm package name or a built-in first-party name, the system SHALL determine adapter API compatibility from package-version metadata before downloading, and SHALL select the highest package version whose declared adapter API is supported. An explicit package version range SHALL constrain selection to compatible versions within that range. An explicit exact package version SHALL be installed only if that release declares a supported adapter API; when it does not, the system SHALL fail rather than substitute a different release. The npm `latest` dist-tag SHALL continue to identify the latest published release; compatibility selection SHALL NOT depend on moving, pinning, or withholding that tag.

When no package version in the requested set declares a supported adapter API, the system SHALL fail with structured data identifying the newest considered release, its declared or missing adapter API, and the supported adapter APIs.

#### Scenario: Plain npm install skips a newer incompatible release

- **WHEN** a user installs an npm adapter without specifying a version
- **AND** the newest published release declares an unsupported adapter API
- **AND** an older release declares a supported adapter API
- **THEN** the system SHALL select the highest release that declares a supported adapter API
- **AND** the system SHALL NOT install the newer incompatible release

#### Scenario: Explicit range constrains compatible selection

- **WHEN** a user installs an npm adapter with an explicit package version range
- **THEN** the system SHALL select the highest release within that range whose declared adapter API is supported

#### Scenario: Explicit exact version that is incompatible fails

- **WHEN** a user installs an npm adapter pinned to an exact package version
- **AND** that release declares a missing or unsupported adapter API
- **THEN** the system SHALL fail without installing anything
- **AND** the system SHALL NOT substitute a different release

#### Scenario: No compatible release fails with structured data

- **WHEN** a user installs an npm adapter
- **AND** no release in the requested set declares a supported adapter API
- **THEN** the system SHALL fail with structured data identifying the newest considered release, its declared or missing adapter API, and the supported adapter APIs

#### Scenario: Release without a declared adapter API is not a compatible candidate

- **WHEN** the system evaluates npm releases for compatible selection
- **AND** a release's package metadata declares no adapter API
- **THEN** that release SHALL NOT be selected as a compatible candidate

#### Scenario: Git and local adapters are not version-selected

- **WHEN** a user installs an adapter from a Git URL or a local path
- **THEN** the system SHALL NOT perform compatible version selection
- **AND** the supplied source SHALL be bundled and SHALL pass runtime adapter API verification before placement

### Requirement: Installed adapter replacement is atomic

When an adapter installation would replace an already-installed adapter bundle, the system SHALL stage and verify the candidate bundle before replacement, and the replacement SHALL be atomic. Any verification or placement failure SHALL leave the existing installed bundle unchanged and loadable.

#### Scenario: Verified candidate replaces the existing bundle atomically

- **WHEN** the system installs an adapter whose name matches an already-installed adapter
- **AND** the candidate bundle passes verification
- **THEN** the system SHALL replace the installed bundle atomically
- **AND** at no point SHALL the adapter directory contain a partially written bundle for that adapter

#### Scenario: Failed candidate leaves the existing bundle untouched

- **WHEN** the system installs an adapter whose name matches an already-installed adapter
- **AND** the candidate bundle fails verification or placement
- **THEN** the system SHALL report the failure
- **AND** the previously installed bundle SHALL remain unchanged and loadable

### Requirement: Adapter installation records provenance

For every installed adapter, the system SHALL retain installation provenance sufficient to identify and replace an incompatible adapter later: the source specifier the user supplied, the resolved npm package name and version when the source was an npm package or built-in name, the adapter API version the bundle declares, and the package integrity of the installed content.

#### Scenario: npm install records resolved package provenance

- **WHEN** a user installs an adapter from an npm package or built-in name
- **THEN** the retained provenance SHALL include the source specifier, the resolved package name and version, the declared adapter API version, and the package integrity

#### Scenario: Git or local install records its source provenance

- **WHEN** a user installs an adapter from a Git URL or a local path
- **THEN** the retained provenance SHALL include the source specifier, the declared adapter API version, and the package integrity
- **AND** the provenance SHALL NOT record a resolved npm package version

### Requirement: Adapter incompatibility failures are actionable

Every adapter API incompatibility failure SHALL identify the adapter, its declared or missing adapter API, the supported adapter APIs, and the command that installs a compatible release.

#### Scenario: Incompatibility diagnostic names the remedy

- **WHEN** any operation fails because an adapter's declared adapter API is missing, malformed, or unsupported
- **THEN** the failure SHALL identify the adapter, its declared or missing adapter API, and the supported adapter APIs
- **AND** the failure SHALL include the command the user can run to install a compatible release

## MODIFIED Requirements

### Requirement: Adapter installation verifies the bundle before placement

The system SHALL verify that a produced adapter bundle is valid before placing it in the adapter directory. Verification SHALL check that the bundle exports a valid adapter object and that the adapter object declares a supported adapter API version. A bundle whose adapter API declaration is missing, malformed, or unsupported SHALL fail verification with structured data before any adapter method is invoked. Package metadata SHALL be treated as a selection aid only: the loaded bundle's own declaration is the final compatibility check, and a conflict between the package metadata's declared adapter API and the bundle's runtime declaration SHALL fail verification.

#### Scenario: Valid bundle passes verification

- **WHEN** the system bundles an adapter that correctly exports an adapter object via the SDK factory
- **AND** the adapter object declares a supported adapter API version
- **THEN** verification SHALL succeed
- **AND** the bundle SHALL be placed in the adapter directory

#### Scenario: Invalid bundle fails verification

- **WHEN** the system bundles an adapter that does not export a valid adapter object
- **THEN** verification SHALL fail
- **AND** the system SHALL report which validation checks failed
- **AND** the bundle SHALL NOT be placed in the adapter directory

#### Scenario: Bundle without an adapter API declaration fails verification

- **WHEN** the system bundles an adapter whose exported adapter object declares no adapter API version
- **THEN** verification SHALL fail with structured data identifying the missing declaration
- **AND** the bundle SHALL NOT be placed in the adapter directory
- **AND** no adapter method of the bundle SHALL be invoked

#### Scenario: Bundle with an unsupported adapter API fails verification

- **WHEN** the system bundles an adapter whose exported adapter object declares an adapter API version that is not supported
- **THEN** verification SHALL fail with structured data identifying the declared and supported adapter APIs
- **AND** the bundle SHALL NOT be placed in the adapter directory

#### Scenario: Metadata and runtime declaration conflict fails verification

- **WHEN** an npm release's package metadata declares one adapter API version
- **AND** the bundled adapter object's runtime declaration differs from it
- **THEN** verification SHALL fail
- **AND** the system SHALL NOT silently select either declared call shape

### Requirement: The system loads installed adapter bundles at runtime

The system SHALL load installed adapter bundles from the adapter directory at runtime. Before returning a loaded bundle to a build or installation workflow, the system SHALL verify that the bundle declares a supported adapter API version. A bundle whose declaration is missing, malformed, or unsupported SHALL fail with structured data before any adapter method is invoked. Loaded, verified adapters SHALL be passed to the build pipeline for metadata building.

#### Scenario: Load installed adapters for a build

- **WHEN** the system runs a build command
- **THEN** the system SHALL scan the adapter directory for installed adapter bundles
- **AND** load each bundle
- **AND** verify each loaded bundle declares a supported adapter API version
- **AND** pass the loaded adapter objects to the build pipeline

#### Scenario: No adapters installed during build

- **WHEN** the system runs a build command
- **AND** no adapters are installed
- **THEN** the build SHALL proceed
- **AND** any adapter metadata in the manifest SHALL produce warnings for unknown adapters

#### Scenario: Installed bundle without a supported API is not returned for use

- **WHEN** the system loads an installed adapter bundle whose adapter API declaration is missing, malformed, or unsupported
- **THEN** the load SHALL fail with structured data identifying the adapter, its declared or missing adapter API, and the supported adapter APIs
- **AND** no adapter method of that bundle SHALL be invoked

### Requirement: Users can list installed adapters

The system SHALL provide a command to list all adapters currently installed in the adapter directory. For each installed adapter, the listing SHALL surface the adapter's declared adapter API version — or that the declaration is missing — and whether that adapter API is supported.

#### Scenario: List with installed adapters

- **WHEN** a user runs the list command
- **AND** adapters are installed
- **THEN** the system SHALL display the name of each installed adapter
- **AND** the system SHALL display each adapter's declared adapter API version, or that it is missing
- **AND** the system SHALL indicate whether each adapter's adapter API is supported

#### Scenario: List with no installed adapters

- **WHEN** a user runs the list command
- **AND** no adapters are installed
- **THEN** the system SHALL indicate that no adapters are installed

#### Scenario: List surfaces an incompatible installed adapter

- **WHEN** a user runs the list command
- **AND** an installed adapter declares a missing or unsupported adapter API
- **THEN** the listing SHALL identify that adapter as not supported by the current CLI
