## MODIFIED Requirements

### Requirement: Publish ships an already-built, verified facet artifact

Building and publishing are distinct steps. Building is the only operation that constructs a facet archive from source and persists it to the project's build-output location. Publishing reads that already-built artifact, verifies it against the facet artifact specification, and uploads it. The system SHALL NOT construct a facet archive from source as part of publishing on the normal path, and SHALL NOT upload an artifact that has not been verified against the integrity and content rules a facet-compatible system applies to a `.facet`.

When the expected built artifact for the source's declared name and version is absent, the system SHALL NOT contact the registry. In an interactive terminal, the system SHALL offer the user the option to build the current source before publishing; on acceptance, the system SHALL build, verify, and upload; on decline, the system SHALL report that there is nothing to publish and exit with a non-zero code. In a non-interactive context the system SHALL NOT prompt and SHALL fail with a clear "no built artifact; build first" message.

The system SHALL verify the built artifact before uploading it. Verification SHALL apply the same checks a facet-compatible system applies to a `.facet` archive: the recomputed inner-archive content hash equals the integrity value recorded in the artifact's build manifest, every per-asset hash recorded in the build manifest matches the actual hash of the corresponding file, the embedded facet manifest is schema-valid, and the inner content satisfies the artifact content rules (no empty declared assets, no naming collisions within an asset type). A verification failure SHALL fail the publish before the registry is contacted, with an error that identifies the built artifact as the invalid party and suggests rebuilding.

When the built artifact disagrees with the current source manifest — the artifact was built from an older or different manifest and not rebuilt — the system SHALL surface the disagreement to the user as source drift. The system SHALL distinguish two kinds of drift: **content drift**, where the artifact and the source share the same name and version but the manifest content differs; and **identity drift**, where the artifact and the source disagree on name or version.

In an interactive terminal, **content drift** SHALL surface as a two-option choice: rebuild the current source and publish the freshly built artifact, or publish the existing artifact unchanged. **Identity drift** SHALL surface as a three-option choice: build the current source and publish that freshly built artifact, publish the existing (differently-identified) artifact unchanged under its own embedded identity, or cancel without publishing.

In a non-interactive context the system SHALL NOT prompt for either drift kind; it SHALL emit a drift warning to standard error and upload the existing artifact unchanged.

When the system uploads a freshly built artifact through a build offer, it SHALL write the build output to the build-output location, verify the freshly built artifact, and upload that. When the system uploads an existing artifact through a "publish existing" choice, it SHALL upload that artifact unchanged and use its embedded identity for the upload address; if the registry rejects the upload because that identity is already published (immutability), the rejection SHALL be surfaced verbatim to the user as the indication that the source needs a version bump.

The name and version used to address the upload SHALL be read from the verified artifact's embedded build manifest and facet manifest, not from a separate parse of the source-tree facet manifest. When that name is scoped, the upload SHALL address the registry using the registry's scoped route shape, with the literal scope marker and facet name as separate path components accepted by the registry API.

#### Scenario: Missing artifact in an interactive terminal — user accepts the build offer

- **WHEN** a user publishes from a source directory whose declared name and version have no corresponding built artifact in the build-output location
- **AND** the publish is run in an interactive terminal
- **AND** the user accepts the offer to build the current source
- **THEN** the system SHALL build the current source, verify the built artifact, and upload it
- **AND** the system SHALL NOT contact the registry before verification succeeds

#### Scenario: Missing artifact in an interactive terminal — user declines the build offer

- **WHEN** a user publishes from a source directory with no corresponding built artifact
- **AND** the publish is run in an interactive terminal
- **AND** the user declines the offer to build the current source
- **THEN** the system SHALL report that there is nothing to publish
- **AND** the system SHALL NOT contact the registry
- **AND** the process SHALL exit with a non-zero code

#### Scenario: Missing artifact in a non-interactive context

- **WHEN** a user publishes from a source directory with no corresponding built artifact
- **AND** the publish is run in a non-interactive context
- **THEN** the system SHALL NOT prompt
- **AND** the system SHALL fail with a message stating that no built artifact exists and that the user must build first
- **AND** the system SHALL NOT contact the registry
- **AND** the process SHALL exit with a non-zero code

#### Scenario: Built artifact is self-inconsistent

- **WHEN** a user publishes and the built artifact's recomputed inner-archive content hash, any per-asset hash, embedded manifest schema validity, or content rules do not match what its build manifest claims
- **THEN** the system SHALL fail with a verification error identifying the built artifact as the invalid party
- **AND** the error SHALL suggest rebuilding the artifact
- **AND** the system SHALL NOT contact the registry
- **AND** the process SHALL exit with a non-zero code

#### Scenario: Content drift in an interactive terminal — user accepts the rebuild offer

- **WHEN** a user publishes and the built artifact's embedded facet manifest has the same name and version as the source manifest but the manifest content differs (content drift)
- **AND** the publish is run in an interactive terminal
- **AND** the user accepts the offer to rebuild the current source
- **THEN** the system SHALL build the current source, write the freshly built artifact to the build-output location, verify it, and upload it
- **AND** the uploaded artifact SHALL match the current source

#### Scenario: Content drift in an interactive terminal — user declines the rebuild offer

- **WHEN** a user publishes and the built artifact has the same name and version as the source manifest but the manifest content differs
- **AND** the publish is run in an interactive terminal
- **AND** the user declines the offer to rebuild
- **THEN** the system SHALL upload the existing, drifted artifact unchanged
- **AND** the system SHALL record that the user explicitly accepted shipping an artifact that does not match the current source

#### Scenario: Identity drift in an interactive terminal — user chooses to build the current source

- **WHEN** a user publishes and the built artifact's embedded facet manifest disagrees with the source manifest on name or version (identity drift)
- **AND** the publish is run in an interactive terminal
- **AND** the user chooses to build the current source and publish the freshly built artifact
- **THEN** the system SHALL build the current source, write the freshly built artifact to the build-output location, verify it, and upload it under the freshly built artifact's embedded identity
- **AND** the uploaded artifact SHALL match the current source

#### Scenario: Identity drift in an interactive terminal — user chooses to publish the existing artifact

- **WHEN** a user publishes and the built artifact disagrees with the source manifest on name or version
- **AND** the publish is run in an interactive terminal
- **AND** the user chooses to publish the existing artifact as-is
- **THEN** the system SHALL upload the existing artifact unchanged
- **AND** the upload address SHALL use the existing artifact's embedded identity, not the source manifest's name or version

#### Scenario: Identity drift in an interactive terminal — user cancels

- **WHEN** a user publishes and the built artifact disagrees with the source manifest on name or version
- **AND** the publish is run in an interactive terminal
- **AND** the user cancels rather than choosing to build or publish the existing artifact
- **THEN** the system SHALL NOT contact the registry
- **AND** the process SHALL exit with a non-zero code

#### Scenario: Source drift in a non-interactive context

- **WHEN** a user publishes and the built artifact disagrees with the current source manifest in any way (content or identity)
- **AND** the publish is run in a non-interactive context
- **THEN** the system SHALL NOT prompt
- **AND** the system SHALL emit a drift warning to standard error
- **AND** the system SHALL upload the existing, drifted artifact unchanged

#### Scenario: Happy path — built artifact matches source

- **WHEN** a user publishes and the built artifact exists and matches the current source manifest
- **THEN** the system SHALL verify the built artifact
- **AND** on successful verification, the system SHALL upload the built artifact unchanged
- **AND** the name and version on the upload SHALL be read from the artifact's embedded manifests

#### Scenario: Upload address uses the artifact's embedded identity

- **WHEN** a user publishes any built artifact
- **THEN** the name and version used to address the upload SHALL come from the artifact's embedded build manifest and facet manifest
- **AND** the system SHALL NOT separately parse the source-tree facet manifest to determine the upload address

#### Scenario: Scoped upload uses scoped registry address

- **WHEN** a user publishes a verified artifact whose embedded facet name is `@julian/cowsay`
- **THEN** the system SHALL upload the artifact under the `@julian` scope and `cowsay` name accepted by the registry API
- **AND** the system SHALL NOT collapse the scoped identity into a single percent-encoded name segment

#### Scenario: Registry rejects scoped upload authorization

- **WHEN** a user publishes a verified artifact whose embedded facet name is `@acme/cowsay`
- **AND** the registry rejects the upload because the authenticated user is not authorized to publish under `@acme`
- **THEN** the system SHALL surface the registry's rejection verbatim
- **AND** the system SHALL NOT replace the registry's scope ownership explanation with CLI-authored text
