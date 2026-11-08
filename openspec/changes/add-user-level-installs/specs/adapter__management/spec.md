## ADDED Requirements

### Requirement: Project-rooted CLIs keep selecting compatible adapter releases

A compatibility-aware released CLI whose exact adapter SDK API support set is `{0.3}` SHALL continue selecting compatible releases when newer releases declaring `0.4` are published. First-party releases declaring `0.3` SHALL remain available for selection, so that such a CLI's non-exact npm selection resolves to the highest stable release declaring `0.3`. For a third-party package with no compatible release, selection SHALL retain its explicit no-compatible-release failure rather than promise availability controlled by another publisher. An exact request from such a CLI for a release declaring `0.4` SHALL fail for that exact release without substituting another version and without replacing the currently installed adapter. Publishing a `0.4` release SHALL NOT require moving, pinning, or withholding the npm `latest` distribution tag.

#### Scenario: Older CLI skips a scope-aware release

- **WHEN** a CLI supporting exactly `{0.3}` installs a first-party adapter by built-in name
- **AND** the newest stable release declares `0.4` while an older stable release declares `0.3`
- **THEN** the CLI SHALL install the release declaring `0.3`

#### Scenario: Older CLI does not substitute for an exact scope-aware request

- **WHEN** a CLI supporting exactly `{0.3}` requests an exact adapter version declaring `0.4`
- **THEN** installation SHALL fail for that exact release
- **AND** the previously installed adapter SHALL remain active and unchanged

### Requirement: Upgrading to a scope-aware CLI gives actionable adapter reinstall guidance

A CLI whose support set is `{0.4}` SHALL treat an installed adapter declaring `0.3` as an API incompatibility, not as a broken installation or a faulty facet archive. A facet operation requiring such an adapter SHALL fail before invoking any adapter contract method, identifying each such adapter, its declared `0.3` API, the supported set `{0.4}`, and the best available compatible-install command from retained provenance. Adapter listing SHALL continue to report the incompatible installation without invoking it. No adapter or dual-contract shim SHALL be used to run a `0.3` adapter under the scope-aware contract. An exact install request for a release declaring `0.3` SHALL fail for that exact release without substitution and before replacing a working adapter.

#### Scenario: Installed project-rooted adapter after upgrade

- **WHEN** a user upgrades to a CLI supporting exactly `{0.4}` and runs an install with an installed `claude-code` adapter declaring `0.3`
- **THEN** the command SHALL fail before any adapter contract method is invoked and before any facet file changes
- **AND** the diagnostic SHALL name `claude-code`, declared API `0.3`, supported set `0.4`, and the command `facet adapter add claude-code`

#### Scenario: Listing still shows the incompatible adapter

- **WHEN** a user lists adapters with an installed adapter declaring `0.3` on a CLI supporting exactly `{0.4}`
- **THEN** the listing SHALL show that adapter with declared API `0.3` and status `unsupported`

#### Scenario: Exact project-rooted request does not replace a working adapter

- **WHEN** a CLI supporting exactly `{0.4}` has a working `0.4` adapter installed and the user requests an exact release declaring `0.3`
- **THEN** installation SHALL fail for that exact release
- **AND** the working `0.4` adapter SHALL remain active and unchanged

#### Scenario: Upgraded CLI does not fall back to the superseded contract

- **WHEN** a CLI supporting exactly `{0.4}` installs an adapter by bare package name, the newest stable release declares `0.3`, and no release declares `0.4`
- **THEN** installation SHALL fail before bundle download, identify supported API `0.4` and the newest considered release's `0.3` declaration, and SHALL NOT substitute the superseded contract

### Requirement: Compatible adapters are published before a CLI requires their contract

When a CLI release changes its exact support set to require a new adapter SDK API, the Adapter SDK declaring that API and a release of every first-party adapter declaring it SHALL be published to npm before that CLI release is published. Each such adapter release SHALL declare the same exact token in its `facetAdapterApiVersion` package field as its runtime adapter declares. Package versions of the SDK, each adapter, and the CLI SHALL remain independent rather than aligned.

#### Scenario: Built-in names resolve on the day a requiring CLI ships

- **WHEN** a CLI release supporting exactly `{0.4}` is first published
- **THEN** each first-party built-in name SHALL already resolve to a stable npm release declaring `0.4`

#### Scenario: Published scope-aware adapter metadata agrees with runtime

- **WHEN** a first-party adapter release declares `facetAdapterApiVersion` `0.4`
- **THEN** its runtime adapter SHALL declare API `0.4`
- **AND** a CLI supporting `{0.4}` SHALL verify and activate it

## MODIFIED Requirements

### Requirement: Adapter installation verifies the bundle before placement

The system SHALL verify that a produced adapter bundle is valid and compatible before placing or activating it. A bundle's default export SHALL be accepted as either a factory result of shape `Validated<Adapter>` or a manually constructed adapter object, subject to the same complete verification of the adapter. The factory-result envelope SHALL be validated before its payload is used. A valid `ok: false` result SHALL produce a structured definition failure preserving its field-addressed validation errors; a malformed result envelope SHALL produce a structured invalid-export failure. Neither SHALL be reported merely as a missing runtime API declaration or reinterpreted as a bare adapter to bypass the failure.

For a successful factory result, verification SHALL examine `data`; for a bare adapter export, it SHALL examine that object. In either case, verification SHALL check the adapter's name, complete capability declarations and operations, and present, well-formed runtime API declaration against the current exact support set `{0.4}`. For an npm candidate, verification SHALL also require the runtime declaration to equal the package declaration used for selection. An `ok: true` envelope SHALL NOT waive any check or authorize an adapter contract method invocation before verification succeeds. Factory, export, and compatibility failures SHALL be returned as structured values, SHALL NOT activate the candidate, and SHALL NOT replace an existing adapter. A compatibility failure SHALL NOT trigger a source-rebundling fallback.

#### Scenario: Valid bundle passes verification

- **WHEN** the system bundles an adapter that correctly exports an adapter object with an API supported by the CLI
- **THEN** verification SHALL succeed
- **AND** the bundle SHALL be placed in the adapter directory

#### Scenario: Invalid bundle fails verification

- **WHEN** the system bundles an adapter whose export is neither a valid adapter object nor a valid successful factory result containing one
- **THEN** verification SHALL fail
- **AND** the system SHALL report which validation checks failed
- **AND** the bundle SHALL NOT be placed in the adapter directory

#### Scenario: Runtime API declaration is missing or malformed

- **WHEN** a candidate adapter, supplied directly or in a successful factory result, has no runtime adapter SDK API declaration or has a malformed declaration
- **THEN** verification SHALL fail with the corresponding compatibility classification
- **AND** the candidate SHALL NOT become active

#### Scenario: Runtime API declaration is unsupported

- **WHEN** a candidate adapter, supplied directly or in a successful factory result, declares a well-formed adapter SDK API that the CLI does not support
- **THEN** verification SHALL fail before any adapter contract method is invoked
- **AND** the candidate SHALL NOT become active

#### Scenario: Git or local candidate is checked as supplied

- **WHEN** a user installs an adapter from Git or a local path
- **THEN** the adapter exported directly or in the produced bundle's successful factory result MUST declare an adapter SDK API supported by the CLI
- **AND** an incompatible declaration SHALL fail rather than trigger package-version substitution

#### Scenario: Successful factory result is fully verified

- **WHEN** a bundle default-exports `ok: true` with a valid API `0.4` adapter in `data`
- **THEN** verification SHALL apply every adapter shape, capability, API, and applicable package/runtime agreement check to `data`
- **AND** verification SHALL succeed only when all checks pass

#### Scenario: Factory validation failure remains structured

- **WHEN** a bundle default-exports a valid `ok: false` factory result with field-addressed definition errors
- **THEN** verification SHALL return a structured definition failure carrying those errors without throwing
- **AND** it SHALL NOT classify the result as merely a missing API declaration
- **AND** it SHALL invoke no adapter contract method and leave any existing installation unchanged

#### Scenario: Malformed result envelope is not trusted

- **WHEN** a bundle presents a factory-result envelope with a missing successful payload, malformed failure errors, or an invalid discriminant
- **THEN** verification SHALL return a structured invalid-export failure without throwing
- **AND** it SHALL NOT reinterpret that envelope as a bare adapter or activate the candidate

#### Scenario: Successful envelope cannot hide an invalid adapter

- **WHEN** a bundle exports `ok: true` with an API `0.4` payload missing a required capability declaration or operation
- **THEN** verification SHALL reject the payload before any adapter contract method is invoked
- **AND** the existing installation SHALL remain unchanged

#### Scenario: Successful envelope cannot admit an older API

- **WHEN** a bundle exports `ok: true` with a payload declaring API `0.3`
- **THEN** a CLI supporting exactly `{0.4}` SHALL report the payload's API as unsupported
- **AND** it SHALL NOT activate the candidate or invoke an adapter contract method

#### Scenario: Package agreement uses the successful payload

- **WHEN** npm package metadata declares API `0.4` but the candidate's successful factory result contains a payload declaring `0.3`
- **THEN** verification SHALL fail rather than treating the success envelope or package declaration as evidence that the payload implements `0.4`
- **AND** the existing installation SHALL remain unchanged

#### Scenario: Manually constructed current adapter remains accepted

- **WHEN** a bundle directly exports a manually constructed API `0.4` adapter rather than a factory result
- **THEN** verification SHALL accept it only after the same complete adapter checks succeed
- **AND** this export form SHALL NOT bypass exact API compatibility

### Requirement: Users can list installed adapters

The system SHALL provide a command to list all adapters currently installed in the adapter directory. The listing SHALL inspect every entry and display its declared adapter SDK API as an exact identifier, `missing`, or `malformed`, together with a `supported`, `unsupported`, or `broken` compatibility status. Bundle inspection SHALL use the same factory-result and bare-adapter verification as installation. For a valid successful result, the runtime API SHALL be read from its adapter payload, not from the outer envelope. An entry SHALL be classified as `broken` when its installation metadata is invalid, its bundle cannot be loaded, its export is invalid, or inspection yields a failed factory result or malformed result envelope. Definition and envelope failures SHALL NOT be classified merely as missing-API incompatibilities.

A missing, malformed, or unsupported API declaration on the adapter itself SHALL remain an API incompatibility rather than `broken`. An entry with no installation metadata — a legacy directly placed bundle without an installation receipt — SHALL be inspected as an unmanaged installation and classified from its runtime bundle using the same rules. The entry SHALL NOT be classified as `broken` merely because its receipt is absent. Retained metadata identifying an unsupported API SHALL continue to permit incompatibility classification without importing the bundle. Listing SHALL remain available when one or more entries are incompatible or broken so the user can identify what needs repair.

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

#### Scenario: Successful factory export is listed by its adapter

- **WHEN** an installed bundle exports a successful factory result containing a fully verified API `0.4` adapter
- **THEN** listing SHALL report the payload's adapter name and API with supported status
- **AND** it SHALL invoke no adapter contract method

#### Scenario: Failed factory export is listed as broken

- **WHEN** bundle inspection encounters a failed factory result or malformed result envelope
- **THEN** listing SHALL show the entry as broken with the structured definition or export failure
- **AND** it SHALL retain any available declared API information without inferring that the outer envelope's lack of `apiVersion` is the failure
- **AND** listing SHALL remain available for recovery

### Requirement: The system loads installed adapter bundles at runtime

The system SHALL inspect installed adapter bundles before returning them for use. A compatible installation SHALL provide a verified adapter whose runtime API is a member of the current exact adapter SDK API support set. Loading SHALL use the same factory-result and bare-adapter verification as installation: successful result payloads SHALL be fully verified, and failed or malformed results SHALL remain structured failures. Build and install pipelines SHALL receive only verified adapter objects, never factory-result envelopes or unchecked successful payloads.

If any installed entry is incompatible or broken, loading SHALL fail with all collected failures instead of silently skipping entries. No adapter contract method SHALL be invoked for an entry before its compatibility has been established. A runtime declaration of the superseded positional adapter SDK API `0.0` SHALL be treated as unsupported and SHALL fail closed before any contract method is invoked.

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

#### Scenario: Factory failures block loading without partial success

- **WHEN** installed bundle inspection finds a failed factory result alongside otherwise compatible adapters
- **THEN** loading SHALL return its structured failure with all other collected failures and no usable adapter list
- **AND** no build or install pipeline SHALL receive the factory-result envelope or treat the failed adapter as absent

### Requirement: npm adapter installs select the highest compatible package version

The system SHALL accept npm adapter package selectors in the exact `MAJOR.MINOR.PATCH`, major-wildcard `MAJOR.*`, minor-wildcard `MAJOR.MINOR.*`, bare wildcard `*`, and `latest` forms. A bare package name or first-party alias SHALL act as an implicit unconstrained selector. For a non-exact request, the system SHALL select the highest stable package version that satisfies the selector and declares an API in the current exact adapter SDK API support set. For an exact request, the system SHALL consider only that package version and SHALL NOT silently substitute another release. The `latest` selector SHALL denote the same unconstrained candidate set as a bare package name or `*`; the system SHALL resolve it to the highest stable version that declares a supported adapter SDK API and SHALL NOT consult the npm `latest` distribution tag during selection.

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

#### Scenario: Superseded-contract release is skipped

- **WHEN** a package publishes a newer release declaring `0.3` and an older release declaring `0.4`
- **AND** the current exact support set is `{0.4}`
- **THEN** the system SHALL select the compatible `0.4` release
- **AND** it SHALL NOT select the release declaring the superseded contract

#### Scenario: Wildcard constrains compatible selection

- **WHEN** a user installs an npm adapter with a supported wildcard selector
- **THEN** the system SHALL select the highest stable package version that both satisfies the wildcard and declares an API in the current exact support set

#### Scenario: Exact incompatible release is not substituted

- **WHEN** a user requests an exact npm adapter package version whose declared adapter SDK API is missing, malformed, or unsupported
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

### Requirement: The current CLI supports an explicit exact adapter SDK API set

The current CLI's adapter SDK API support set SHALL be exactly `{0.4}`. Every verification, loading, listing, npm selection, and package-versus-runtime agreement check SHALL use exact-token membership. The set SHALL NOT be interpreted as a range or ordering, and changing it SHALL NOT weaken any individual exact-token check.

The set holds one token because the superseded contracts cannot receive what the current system requires. Under `0.0`, `0.1`, and `0.2`, an adapter performed its own writes and owned its own rollback, so no caller can offer them the guarantees this system now makes about exact restoration, concurrency detection, and batch atomicity. Under `0.3`, every request carried a project root and no capability declared its supported scopes, so a user installation could be served only by inventing a project or guessing scope support. Accepting any of them would mean silently dropping those guarantees for whatever it materialized.

#### Scenario: The scope-aware planning contract is supported

- **WHEN** an installed adapter declares API `0.4`
- **THEN** the CLI SHALL classify that exact token as supported

#### Scenario: The project-rooted planning contract is unsupported

- **WHEN** an installed adapter declares API `0.3`
- **THEN** the CLI SHALL classify it as well-formed but unsupported
- **AND** the diagnostic SHALL name a reinstall as the remedy

#### Scenario: Positional API remains outside the set

- **WHEN** an adapter declares API `0.0`
- **THEN** the CLI SHALL classify it as well-formed but unsupported

#### Scenario: An adapter that wrote its own files is unsupported

- **WHEN** an installed adapter declares API `0.1` or `0.2`
- **THEN** the CLI SHALL classify it as well-formed but unsupported
- **AND** the diagnostic SHALL name a reinstall as the remedy

#### Scenario: A superseded declaration is rejected before the bundle is imported

- **WHEN** an installation's retained metadata records an unsupported adapter SDK API
- **THEN** the CLI SHALL classify it as incompatible without importing its bundle
