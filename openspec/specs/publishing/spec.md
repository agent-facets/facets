## Purpose

Defines how a built facet is verified, authenticated for, and uploaded to the registry. Covers the verify-and-ship publish flow, the build/rebuild offers on missing or drifted artifacts, the credential lifecycle (`login`, `whoami`, `logout`), credential attachment to registry requests, registry-verbatim error rendering, and the queued-for-review success outcome.

## Requirements

### Requirement: Publish ships an already-built, verified facet artifact

Building and publishing are distinct steps. Building is the only operation that constructs a facet archive from source and persists it to the project's build-output location. Publishing reads that already-built artifact, verifies it against the facet artifact specification, and uploads it. The system SHALL NOT construct a facet archive from source as part of publishing on the normal path, and SHALL NOT upload an artifact that has not been verified against the integrity and content rules a facet-compatible system applies to a `.facet`.

When the expected built artifact for the source's declared name and version is absent, the system SHALL NOT contact the registry. In an interactive terminal, the system SHALL offer the user the option to build the current source before publishing; on acceptance, the system SHALL build, verify, and upload; on decline, the system SHALL report that there is nothing to publish and exit with a non-zero code. In a non-interactive context the system SHALL NOT prompt and SHALL fail with a clear "no built artifact; build first" message.

The system SHALL verify the built artifact before uploading it. Verification SHALL apply the same checks a facet-compatible system applies to a `.facet` archive: the recomputed inner-archive content hash equals the integrity value recorded in the artifact's build manifest, every per-asset hash recorded in the build manifest matches the actual hash of the corresponding file, the embedded facet manifest is schema-valid, and the inner content satisfies the artifact content rules (no empty declared assets, no naming collisions within an asset type). A verification failure SHALL fail the publish before the registry is contacted, with an error that identifies the built artifact as the invalid party and suggests rebuilding.

When the built artifact disagrees with the current source manifest — the artifact was built from an older or different manifest and not rebuilt — the system SHALL surface the disagreement to the user as source drift. The system SHALL distinguish two kinds of drift: **content drift**, where the artifact and the source share the same name and version but the manifest content differs; and **identity drift**, where the artifact and the source disagree on name or version.

In an interactive terminal, **content drift** SHALL surface as a two-option choice: rebuild the current source and publish the freshly built artifact, or publish the existing artifact unchanged. **Identity drift** SHALL surface as a three-option choice: build the current source and publish that freshly built artifact, publish the existing (differently-identified) artifact unchanged under its own embedded identity, or cancel without publishing.

In a non-interactive context the system SHALL NOT prompt for either drift kind; it SHALL emit a drift warning to standard error and upload the existing artifact unchanged.

When the system uploads a freshly built artifact through a build offer, it SHALL write the build output to the build-output location, verify the freshly built artifact, and upload that. When the system uploads an existing artifact through a "publish existing" choice, it SHALL upload that artifact unchanged and use its embedded identity for the upload address; if the registry rejects the upload because that identity is already published (immutability), the rejection SHALL be surfaced verbatim to the user as the indication that the source needs a version bump.

The name and version used to address the upload SHALL be read from the verified artifact's embedded build manifest and facet manifest, not from a separate parse of the source-tree facet manifest.

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

### Requirement: Publishing authenticates with a bearer token

When a user publishes a facet, the CLI SHALL authenticate to the registry with a bearer token. The token SHALL be resolved from, in order of precedence, the `FACET_TOKEN` environment variable, then a credentials file stored under the CLI's on-disk root. When no token can be resolved, the CLI SHALL refuse to publish before contacting the registry, and SHALL tell the user how to obtain a token.

#### Scenario: Publish with a token in the environment

- **WHEN** a user runs `publish` with `FACET_TOKEN` set to a valid token
- **THEN** the CLI SHALL send the token to the registry as a bearer credential

#### Scenario: Publish with a token only in the credentials file

- **WHEN** a user runs `publish` with no `FACET_TOKEN` in the environment but a saved credentials file containing a token
- **THEN** the CLI SHALL send the saved token to the registry as a bearer credential

#### Scenario: Environment token wins over the credentials file

- **WHEN** a user runs `publish` with `FACET_TOKEN` set in the environment AND a different token saved in the credentials file
- **THEN** the CLI SHALL send the environment token
- **AND** the CLI SHALL NOT send the saved file token

#### Scenario: Publish with no resolvable credential

- **WHEN** a user runs `publish` with no `FACET_TOKEN` in the environment and no saved credentials file
- **THEN** the CLI SHALL print an error stating that no credential was found
- **AND** the error SHALL direct the user to sign in or set a token
- **AND** the CLI SHALL NOT contact the registry
- **AND** the process SHALL exit with a non-zero code

### Requirement: A resolved credential is attached to every registry request

When a credential is resolvable (from the environment or the credentials file), the CLI SHALL attach it to every registry request it makes — reads (such as search, facet info, version metadata, and archive download) as well as writes (publish) — so that authenticated traffic qualifies for the registry's authenticated rate-limit tier. When no credential is resolvable, read requests SHALL still be sent, without a credential, and SHALL remain fully functional. The CLI SHALL NOT inspect, parse, or validate the credential it holds before sending it; whether a given credential is accepted on a given request is the registry's decision.

When a credentials file exists but the CLI cannot read it at all (for example because the path is a directory, has unreadable permissions, or is a broken link), the CLI SHALL treat the situation as having no resolvable credential rather than failing with an unhandled error. For a read operation, the CLI SHALL send the request without a credential, SHALL remain fully functional, and SHALL warn the user that the credentials file could not be read. For an operation that requires a credential, the CLI SHALL report that it could not read the credentials file as a pre-flight failure and SHALL NOT contact the registry.

#### Scenario: Reads carry the credential when one exists

- **WHEN** a user runs a read-only registry operation (such as `search`) with a resolvable credential
- **THEN** the CLI SHALL attach the credential to the request as a bearer token

#### Scenario: Reads work anonymously when no credential exists

- **WHEN** a user runs a read-only registry operation with no resolvable credential
- **THEN** the CLI SHALL send the request without a credential
- **AND** the operation SHALL complete normally on success

#### Scenario: Reads proceed anonymously when the credentials file cannot be read

- **WHEN** a user runs a read-only registry operation with no environment token set and a credentials file that exists but cannot be read
- **THEN** the CLI SHALL send the request without a credential
- **AND** the CLI SHALL warn the user that the credentials file could not be read
- **AND** the operation SHALL complete normally on success

#### Scenario: A credential-requiring command reports an unreadable credentials file

- **WHEN** a user runs a command that requires a credential with no environment token set and a credentials file that exists but cannot be read
- **THEN** the CLI SHALL print an error stating that the credentials file could not be read
- **AND** the CLI SHALL NOT contact the registry
- **AND** the process SHALL exit with a non-zero code

#### Scenario: The CLI does not pre-validate the credential

- **WHEN** a resolved credential is malformed, expired, or revoked
- **THEN** the CLI SHALL still send it unchanged to the registry
- **AND** the CLI SHALL surface the registry's response rather than rejecting the credential itself

### Requirement: Registry-originated errors render the registry's own text

When the registry returns its structured error envelope, the CLI SHALL render the registry's own human-readable explanation and suggested-fix text to the user verbatim, and SHALL NOT translate the registry's error code through any CLI-side code-to-message map. The CLI SHALL author its own error text in only two cases, neither of which is a registry-returned error code: a pre-flight failure the registry never sees (a missing credential, a missing facet manifest, or an unreachable network), and a response from the registry that is not a valid structured error envelope at all.

#### Scenario: Structured registry error is shown verbatim

- **WHEN** the registry rejects a request with its structured error envelope containing an explanation and a suggested fix
- **THEN** the CLI SHALL display the registry's explanation and suggested-fix text as written
- **AND** the CLI SHALL NOT substitute its own message for the registry's error code

#### Scenario: Unparseable registry response

- **WHEN** the registry responds with a body that is not a valid structured error envelope
- **THEN** the CLI SHALL print a CLI-authored message stating that it could not process the registry's response
- **AND** the CLI SHALL NOT direct the user to any documentation link

#### Scenario: Pre-flight failure uses CLI-authored text

- **WHEN** a request fails before the registry is contacted (missing credential, missing facet manifest, or unreachable network)
- **THEN** the CLI SHALL print its own error text for that failure
- **AND** the registry-verbatim rendering rule SHALL NOT apply

### Requirement: A first-time global-facet publish accepted for review is a success

When a publish is accepted into the registry's moderation queue rather than published immediately, the CLI SHALL treat the outcome as a success. The CLI SHALL render the registry's queue-acknowledgement message to the user and SHALL exit with a success code.

#### Scenario: Publish is queued for review

- **WHEN** a user publishes a facet and the registry accepts it into its review queue instead of publishing it immediately
- **THEN** the CLI SHALL render the registry's queue-acknowledgement message
- **AND** the CLI SHALL exit with code 0
- **AND** the CLI SHALL NOT present the outcome as a failure

### Requirement: Users can sign in with a personal access token

The CLI SHALL register a `login` command that guides a user through saving a registry credential. The command SHALL present a choice between pasting a personal access token (available now) and signing in via a web browser (shown as a disabled "coming soon" option that performs no action when chosen). When the user pastes a token, the CLI SHALL accept it with masked input so the token is not echoed in the clear, SHALL verify the token against the registry before saving it, and SHALL save it to the credentials file only after the registry confirms it is valid. On success the CLI SHALL confirm the signed-in identity to the user. On rejection the CLI SHALL render the registry's own error text and SHALL allow the user to try again.

#### Scenario: login is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `login` command with its description

#### Scenario: Successful token sign-in

- **WHEN** a user runs `login`, chooses to paste a personal access token, and provides a token the registry accepts
- **THEN** the CLI SHALL accept the token with masked input
- **AND** the CLI SHALL verify the token against the registry before saving it
- **AND** the CLI SHALL save the token to the credentials file
- **AND** the CLI SHALL print a confirmation naming the signed-in user and account tier

#### Scenario: Rejected token

- **WHEN** a user runs `login`, pastes a token, and the registry rejects it
- **THEN** the CLI SHALL render the registry's own error text
- **AND** the CLI SHALL NOT save the rejected token
- **AND** the CLI SHALL allow the user to enter another token

#### Scenario: Browser option is a disabled placeholder

- **WHEN** a user runs `login` and selects the "sign in via browser" option
- **THEN** the CLI SHALL take no action for that option
- **AND** the CLI SHALL indicate that browser sign-in is not yet available

#### Scenario: login warns when the environment token will take precedence

- **WHEN** a user runs `login` while `FACET_TOKEN` is set in the environment
- **THEN** the CLI SHALL warn, before prompting, that the environment variable will be used for every command in preference to the file about to be written
- **AND** the warning SHALL direct the user to unset the environment variable if they want the saved credentials file to take effect
- **AND** the user SHALL be allowed to proceed past the warning

### Requirement: Users can see who they are signed in as

The CLI SHALL register a `whoami` command that reports the identity associated with the resolved credential. The command SHALL display the authenticated user's username, email, account tier, and suspension state, as reported by the registry. When the credential in use comes from the `FACET_TOKEN` environment variable, the output SHALL indicate that the environment variable is the source, so the user is not confused about which credential authenticated the call.

#### Scenario: whoami is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `whoami` command with its description

#### Scenario: whoami reports the authenticated identity

- **WHEN** a user runs `whoami` with a credential the registry accepts
- **THEN** the CLI SHALL display the username, email, account tier, and suspension state reported by the registry

#### Scenario: whoami indicates the environment source

- **WHEN** a user runs `whoami` while the credential in use comes from `FACET_TOKEN`
- **THEN** the output SHALL indicate that the credential came from the environment variable

#### Scenario: whoami with no credential

- **WHEN** a user runs `whoami` with no resolvable credential
- **THEN** the CLI SHALL print an error indicating the user is not signed in
- **AND** the process SHALL exit with a non-zero code

### Requirement: Users can sign out by clearing the local credentials

The CLI SHALL register a `logout` command that removes the saved credentials file. The command SHALL NOT contact the registry and SHALL NOT revoke any token server-side; token revocation is performed by the user in the web UI. When `FACET_TOKEN` is set in the environment at the time `logout` runs, the CLI SHALL inform the user that the file has been removed but the environment variable is still active, and SHALL direct the user to unset it to fully sign out of the current shell.

#### Scenario: logout is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `logout` command with its description

#### Scenario: logout removes the saved credentials

- **WHEN** a user runs `logout` with a saved credentials file present
- **THEN** the CLI SHALL remove the saved credentials file
- **AND** the CLI SHALL NOT contact the registry

#### Scenario: logout warns that the environment token is still active

- **WHEN** a user runs `logout` while `FACET_TOKEN` is set in the environment
- **THEN** the CLI SHALL inform the user that the saved file was removed but the environment variable is still in effect
- **AND** the CLI SHALL direct the user to unset the environment variable to fully sign out of the current shell

#### Scenario: logout when no credentials file exists

- **WHEN** a user runs `logout` with no saved credentials file present
- **THEN** the CLI SHALL report that there were no saved credentials to remove
- **AND** the process SHALL exit with code 0
