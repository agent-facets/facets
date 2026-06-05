## ADDED Requirements

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

#### Scenario: Reads carry the credential when one exists

- **WHEN** a user runs a read-only registry operation (such as `search`) with a resolvable credential
- **THEN** the CLI SHALL attach the credential to the request as a bearer token

#### Scenario: Reads work anonymously when no credential exists

- **WHEN** a user runs a read-only registry operation with no resolvable credential
- **THEN** the CLI SHALL send the request without a credential
- **AND** the operation SHALL complete normally on success

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

## MODIFIED Requirements

### Requirement: Commands validate directory arguments before execution

The system SHALL validate directory arguments provided to commands before executing any command logic. Invalid directory arguments SHALL produce clear, immediate error messages and exit with code 1.

#### Scenario: No directory argument defaults to current directory

- **WHEN** a user runs a command without a directory argument
- **THEN** the system SHALL use the current working directory

#### Scenario: Argument points to facet.json directly

- **WHEN** a user provides a path ending with `facet.json` as the directory argument
- **THEN** the system SHALL silently use the parent directory

#### Scenario: Argument is a non-directory file

- **WHEN** a user provides a path to a file that is not `facet.json`
- **THEN** the system SHALL print an error indicating a directory was expected
- **AND** the process SHALL exit with code 1

#### Scenario: Directory does not exist for commands requiring it

- **WHEN** a user provides a path to a non-existent directory for `build`, `edit`, or `publish`
- **THEN** the system SHALL print an error indicating the directory does not exist
- **AND** the process SHALL exit with code 1

#### Scenario: Directory is auto-created for create command

- **WHEN** a user provides a path to a non-existent directory for `create`
- **THEN** the system SHALL create the directory automatically

#### Scenario: Build, edit, and publish require facet.json to exist

- **WHEN** a user runs `build`, `edit`, or `publish` in a directory without `facet.json`
- **THEN** the system SHALL print an error indicating no facet manifest was found
- **AND** the process SHALL exit with code 1

#### Scenario: Publish accepts an optional directory argument

- **WHEN** a user runs `publish` with a path to a directory that contains `facet.json`
- **THEN** the system SHALL publish the facet in that directory
- **AND** the system SHALL NOT require the user to change into that directory first
