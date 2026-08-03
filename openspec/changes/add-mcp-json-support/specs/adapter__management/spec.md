## ADDED Requirements

### Requirement: The current CLI supports an explicit exact adapter API set

The current CLI's adapter API support set SHALL be exactly `{0.1, 0.2}` during the compatibility window. Every verification, loading, listing, npm selection, and package-versus-runtime agreement check SHALL use exact-token membership. The set SHALL NOT be interpreted as a range or ordering, and widening it SHALL NOT weaken any individual exact-token check.

#### Scenario: Both tagged contracts are supported

- **WHEN** installed adapters declare API `0.1` and API `0.2`
- **THEN** the CLI SHALL classify both exact tokens as supported

#### Scenario: Positional API remains outside the set

- **WHEN** an adapter declares API `0.0`
- **THEN** the CLI SHALL classify it as well-formed but unsupported

#### Scenario: Supported package and runtime tokens must still agree

- **WHEN** package metadata declares `0.1` and the loaded runtime declares `0.2`
- **THEN** verification SHALL fail even though both tokens belong to the support set

## MODIFIED Requirements

### Requirement: The system loads installed adapter bundles at runtime

The system SHALL inspect installed adapter bundles before returning them for use. A compatible installation SHALL provide a verified adapter whose runtime API is a member of the current exact adapter API support set. If any installed entry is incompatible or broken, loading SHALL fail with all collected failures instead of silently skipping entries. No adapter contract method SHALL be invoked for an entry before its compatibility has been established. A runtime declaration of the superseded positional adapter API `0.0` SHALL be treated as unsupported and SHALL fail closed before any contract method is invoked.

#### Scenario: Load compatible installed adapters for a build

- **WHEN** the system runs a build command
- **AND** every installed adapter is valid and declares an API in the current exact support set
- **THEN** the system SHALL load each verified adapter
- **AND** pass the loaded adapter objects to the build pipeline

#### Scenario: Incompatible installed adapter blocks a build

- **WHEN** the system runs a build command
- **AND** an installed adapter has a missing, malformed, or unsupported API declaration
- **THEN** the build SHALL fail with an actionable adapter compatibility diagnostic
- **AND** no adapter contract method SHALL be invoked

#### Scenario: Positional 0.0 adapter is unsupported at load

- **WHEN** an installed adapter declares runtime API `0.0`
- **AND** the current exact support set excludes `0.0`
- **THEN** loading SHALL fail with an actionable compatibility diagnostic
- **AND** no adapter contract method SHALL be invoked

#### Scenario: No adapters installed during build

- **WHEN** the system runs a build command
- **AND** no adapters are installed
- **THEN** the build SHALL proceed
- **AND** any adapter metadata in the manifest SHALL produce warnings for unknown adapters

### Requirement: npm adapter installs select the highest compatible package version

The system SHALL accept npm adapter package selectors in the exact `MAJOR.MINOR.PATCH`, major-wildcard `MAJOR.*`, minor-wildcard `MAJOR.MINOR.*`, bare wildcard `*`, and `latest` forms. A bare package name or first-party alias SHALL act as an implicit unconstrained selector. For a non-exact request, the system SHALL select the highest stable package version that satisfies the selector and declares an API in the current exact adapter API support set. For an exact request, the system SHALL consider only that package version and SHALL NOT silently substitute another release. The `latest` selector SHALL denote the same unconstrained candidate set as a bare package name or `*`; the system SHALL resolve it to the highest stable version that declares a supported adapter API and SHALL NOT consult the npm `latest` distribution tag during selection.

The npm `latest` distribution tag SHALL continue to advance according to normal publishing policy. Compatibility selection SHALL NOT require moving, pinning, or withholding that tag. Supported API tokens SHALL be treated as an unordered acceptance set: package-version precedence SHALL select among compatible releases, and numeric proximity or ordering between members SHALL NOT alter selection.

#### Scenario: Bare package skips a newer incompatible release

- **WHEN** a user installs an npm adapter by bare package name
- **AND** the newest package release declares an API outside the current exact support set
- **AND** an older stable release declares an API in that set
- **THEN** the system SHALL install the highest stable release that declares a supported API

#### Scenario: Highest package version wins across supported tokens

- **WHEN** a package publishes stable releases declaring different members of the current exact support set
- **AND** both package versions satisfy the user's selector
- **THEN** the system SHALL select the highest package version
- **AND** it SHALL NOT rank one supported API token above the other

#### Scenario: Positional-only release is skipped

- **WHEN** a package publishes a newer release declaring `0.0` and an older release declaring `0.2`
- **THEN** the system SHALL select the compatible `0.2` release
- **AND** it SHALL NOT select the positional release

#### Scenario: Wildcard constrains compatible selection

- **WHEN** a user installs an npm adapter with a supported wildcard selector
- **THEN** the system SHALL select the highest stable package version that both satisfies the wildcard and declares an API in the current exact support set

#### Scenario: Exact incompatible release is not substituted

- **WHEN** a user requests an exact npm adapter package version whose declared adapter API is missing, malformed, or unsupported
- **THEN** installation SHALL fail for that exact release
- **AND** the system SHALL NOT install another package version instead

#### Scenario: Unsupported range syntax is rejected

- **WHEN** a user supplies a caret, tilde, comparator, OR, hyphen, prerelease, or `x`-style npm adapter selector
- **THEN** the system SHALL reject the selector
- **AND** the error SHALL identify the accepted exact, wildcard, and `latest` forms

#### Scenario: No compatible release is available

- **WHEN** no package version satisfying the user's selector declares an API in the current exact support set
- **THEN** installation SHALL fail before downloading an adapter bundle
- **AND** the failure SHALL identify the package and requested selector
- **AND** the failure SHALL identify every member of the current exact support set
- **AND** the failure SHALL identify the newest considered release and its missing, malformed, or unsupported declaration

### Requirement: Compatibility failures provide actionable diagnostics

When an adapter cannot be selected, verified, or loaded because its API declaration is missing, malformed, outside the current exact support set, or inconsistent with package metadata, the system SHALL return structured failure data. User-facing diagnostics SHALL identify the affected adapter or package, the found declaration when one exists, every API in the current exact support set, and the best available compatible-install command. When the installation retains original source provenance, that command SHALL use the recorded source. When provenance is unavailable, the command SHALL use the best available identifier and SHALL indicate that the original install source is unavailable. Compatibility failures SHALL NOT be reported as “no adapters installed” or as an unknown facet metadata schema.

#### Scenario: Unsupported installed adapter reports recovery

- **WHEN** an installed adapter declares an API outside the current exact support set
- **THEN** the command SHALL fail with a diagnostic identifying the adapter and its declared API
- **AND** the diagnostic SHALL list every API in the current exact support set
- **AND** the diagnostic SHALL provide the best available compatible-install command

#### Scenario: Positional 0.0 adapter reports a reinstall command

- **WHEN** an installed adapter declares positional API `0.0`
- **THEN** the diagnostic SHALL identify the adapter and its declared `0.0` API
- **AND** the diagnostic SHALL list every API in the current exact support set
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
