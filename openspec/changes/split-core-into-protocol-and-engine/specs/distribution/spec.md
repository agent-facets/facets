## ADDED Requirements

### Requirement: The published protocol package is distributable to Node-runtime consumers

The system SHALL publish a library package containing the reference implementation of the facet specification. The package SHALL be installable from any JavaScript package manager (`npm`, `pnpm`, `yarn`, `bun`) and SHALL be runnable on the Node runtime, version 22 or later, without requiring the Bun runtime to be present. The package SHALL declare its supported Node engine range and SHALL NOT declare a runtime dependency on `@types/bun` or any other Bun-specific package.

#### Scenario: Install on Node 22

- **WHEN** a consumer runs `npm install @agent-facets/protocol` on a host with Node 22 and no Bun installed
- **THEN** the install SHALL succeed
- **AND** importing the package from a Node program SHALL succeed without runtime errors

#### Scenario: Install on Node 24

- **WHEN** a consumer runs `npm install @agent-facets/protocol` on a host with Node 24 and no Bun installed
- **THEN** the install SHALL succeed
- **AND** importing the package from a Node program SHALL succeed without runtime errors

#### Scenario: Install in an AWS Lambda Node 24 runtime

- **WHEN** a Lambda function bundled for the Node 24 runtime depends on the published protocol package
- **THEN** the function SHALL cold-start successfully
- **AND** invoking validators or integrity verification from the function SHALL succeed without runtime errors

### Requirement: The legacy `@agent-facets/core` package is no longer published

After the protocol package is first published, the system SHALL NOT publish further versions of the legacy `@agent-facets/core` npm package. The legacy package SHALL remain available on the npm registry at its last-published version (`0.9.1`) so that existing pinned consumers continue to resolve, but no version newer than `0.9.1` SHALL be published.

#### Scenario: Existing pinned consumers continue to resolve

- **WHEN** a consumer pinned to `@agent-facets/core@0.9.1` runs `npm install`
- **THEN** the install SHALL succeed using the existing published version
- **AND** the registry SHALL continue to serve the existing tarball

#### Scenario: New publish attempts for the legacy package SHALL NOT occur

- **WHEN** the release pipeline runs after this change has shipped
- **THEN** no version of `@agent-facets/core` newer than `0.9.1` SHALL be uploaded to the npm registry
- **AND** the workspace SHALL NOT contain a package named `@agent-facets/core`

## MODIFIED Requirements

### Requirement: CLI releases are automated on version tag push

The system SHALL automatically build, publish, and verify CLI binaries when a version tag is pushed for the CLI package. A developer who merges a version PR SHALL NOT need to manually run any build, publish, or verification steps — the release pipeline SHALL handle the full lifecycle.

#### Scenario: Tag push triggers the full release pipeline

- **WHEN** a version tag matching the CLI package (e.g., `agent-facets@1.0.0`) is pushed
- **THEN** the system SHALL build all 12 platform binaries
- **AND** the system SHALL publish all platform packages directly to `latest`
- **AND** the system SHALL verify that all platform packages are available in the npm registry
- **AND** the system SHALL publish the CLI package directly to `latest`

#### Scenario: Tag push for a non-CLI library package does not trigger CLI builds

- **WHEN** a version tag for a published library package (e.g., `@agent-facets/protocol@1.0.0` or `@agent-facets/adapter@1.0.0`) is pushed
- **THEN** the system SHALL NOT run the CLI binary build or publish pipeline
- **AND** the system SHALL publish the library package using the standard release flow
