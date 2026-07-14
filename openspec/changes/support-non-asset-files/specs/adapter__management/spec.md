## MODIFIED Requirements

### Requirement: The system loads installed adapter bundles at runtime

The system SHALL inspect installed adapter bundles before returning them for use. A compatible installation SHALL provide a verified adapter whose runtime API is supported by the current CLI. If any installed entry is incompatible or broken, loading SHALL fail with all collected failures instead of silently skipping entries. No adapter contract method SHALL be invoked for an entry before its compatibility has been established. A runtime declaration of the superseded positional adapter API `0.0` SHALL be treated as unsupported by a CLI whose supported set is the tagged-contract API `0.1`, and SHALL fail closed before any contract method is invoked.

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

#### Scenario: Positional 0.0 adapter is unsupported at load

- **WHEN** an installed adapter declares runtime API `0.0`
- **AND** the CLI supports only the tagged-contract API `0.1`
- **THEN** loading SHALL fail with an actionable compatibility diagnostic
- **AND** no adapter contract method SHALL be invoked

#### Scenario: No adapters installed during build

- **WHEN** the system runs a build command
- **AND** no adapters are installed
- **THEN** the build SHALL proceed
- **AND** any adapter metadata in the manifest SHALL produce warnings for unknown adapters

### Requirement: npm adapter installs select the highest compatible package version

The system SHALL accept npm adapter package selectors in the exact `MAJOR.MINOR.PATCH`, major-wildcard `MAJOR.*`, minor-wildcard `MAJOR.MINOR.*`, bare wildcard `*`, and `latest` forms. A bare package name or first-party alias SHALL act as an implicit unconstrained selector. For a non-exact request, the system SHALL select the highest stable package version that satisfies the selector and declares an adapter API supported by the current CLI. For an exact request, the system SHALL consider only that package version and SHALL NOT silently substitute another release. The `latest` selector SHALL denote the same unconstrained candidate set as a bare package name or `*`; the system SHALL resolve it to the highest stable version that declares a supported adapter API and SHALL NOT consult the npm `latest` distribution tag during selection.

The npm `latest` distribution tag SHALL continue to advance according to normal publishing policy. Compatibility selection SHALL NOT require moving, pinning, or withholding that tag.

A CLI that supports only the tagged-contract API `0.1` SHALL select the highest stable release declaring `0.1` and SHALL skip releases declaring the superseded positional API `0.0`. A CLI that supports only `0.0` SHALL correspondingly skip `0.1` releases and select the highest compatible `0.0` release, so the two axes advance independently across the release window.

#### Scenario: Bare package skips a newer incompatible release

- **WHEN** a user installs an npm adapter by bare package name
- **AND** the newest package release declares an unsupported adapter API
- **AND** an older stable release declares an API supported by the CLI
- **THEN** the system SHALL install the highest stable release that declares a supported API

#### Scenario: Tagged CLI selects the 0.1 release over a 0.0 release

- **WHEN** a user installs an npm adapter by bare package name
- **AND** the package publishes both a `0.0` release and a newer `0.1` release
- **AND** the CLI supports only the tagged-contract API `0.1`
- **THEN** the system SHALL install the `0.1` release
- **AND** the system SHALL NOT select the `0.0` release

#### Scenario: Positional CLI retains the highest compatible 0.0 release

- **WHEN** a user installs an npm adapter by bare package name
- **AND** the package publishes both a `0.0` release and a newer `0.1` release
- **AND** the CLI supports only the positional API `0.0`
- **THEN** the system SHALL install the highest stable `0.0` release
- **AND** the system SHALL NOT select the `0.1` release

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

### Requirement: Compatibility failures provide actionable diagnostics

When an adapter cannot be selected, verified, or loaded because its API declaration is missing, malformed, unsupported, or inconsistent with package metadata, the system SHALL return structured failure data. User-facing diagnostics SHALL identify the affected adapter or package, the found declaration when one exists, the adapter APIs supported by the CLI, and the best available compatible-install command. When the installation retains original source provenance, that command SHALL use the recorded source. When provenance is unavailable, the command SHALL use the best available identifier — a first-party alias, or otherwise the installed adapter name — and the diagnostic SHALL indicate that the original install source is unavailable. Compatibility failures SHALL NOT be reported as “no adapters installed” or as an unknown facet metadata schema.

#### Scenario: Unsupported installed adapter reports recovery

- **WHEN** an installed adapter declares an API not supported by the CLI
- **THEN** the command SHALL fail with a diagnostic identifying the adapter and its declared API
- **AND** the diagnostic SHALL list the APIs supported by the CLI
- **AND** the diagnostic SHALL provide the best available compatible-install command

#### Scenario: Positional 0.0 adapter reports a reinstall command

- **WHEN** an installed adapter declares the positional API `0.0`
- **AND** the CLI supports only the tagged-contract API `0.1`
- **THEN** the diagnostic SHALL identify the adapter and its declared `0.0` API
- **AND** the diagnostic SHALL list `0.1` among the APIs supported by the CLI
- **AND** the diagnostic SHALL provide the best available compatible-install command to reinstall a `0.1` adapter

#### Scenario: Multiple installed failures are reported together

- **WHEN** more than one installed adapter is incompatible or broken
- **THEN** loading SHALL fail with all collected adapter failures
- **AND** each compatibility failure SHALL retain its own repair information

#### Scenario: Installation without provenance reports a best-available repair

- **WHEN** an installed adapter without retained source provenance is found incompatible or broken
- **AND** its name does not match a first-party alias
- **THEN** the diagnostic SHALL provide a best-available compatible-install command derived from the installed adapter name
- **AND** the diagnostic SHALL indicate that the original install source is unavailable
