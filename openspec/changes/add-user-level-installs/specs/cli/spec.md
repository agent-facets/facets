## ADDED Requirements

### Requirement: Facet lifecycle commands accept explicit user-collection targeting

The `add`, `install`, `update`, `remove`, `list`, and `outdated` commands SHALL each accept a `--user` flag that selects the user collection, including through the `rm` and `upgrade` aliases with identical behavior. Each command's help SHALL list `--user`. Omitting `--user` SHALL retain project behavior, and a missing project manifest SHALL NOT cause a command to target the user collection. A `--user` command SHALL be usable from any working directory, including one with no project manifest, and SHALL target the same user collection from every directory. A `--user` command SHALL NOT read, modify, or report the project collection in its working directory.

Commands outside facet lifecycle management, including authoring commands, adapter management, and CLI self-update, SHALL NOT declare `--user`, SHALL NOT list it in their help, and SHALL NOT change what they operate on because of it. All six commands SHALL apply one shared targeting rule, so no command selects a collection differently from another.

#### Scenario: Lifecycle help lists the user flag

- **WHEN** a user requests help for `add`, `install`, `update`, `remove`, `list`, or `outdated`
- **THEN** the help SHALL list `--user` and describe it as targeting the user collection

#### Scenario: Alias forms accept the user flag

- **WHEN** a user runs `facet rm --user cowsay` or `facet upgrade --user`
- **THEN** the system SHALL produce the same output, side effects, and exit code as `facet remove --user cowsay` or `facet update --user` respectively

#### Scenario: User command runs outside any project

- **WHEN** a user runs `facet add --user cowsay` in a directory with no project manifest
- **THEN** the command SHALL add `cowsay` to the user collection
- **AND** it SHALL NOT create `facets.json` or `facets.lock` in the working directory

#### Scenario: User command ignores the nearby project

- **WHEN** a user runs `facet install --user` inside a project directory
- **THEN** the project's manifest, lockfile, receipt, and project-scoped materializations SHALL remain unchanged

#### Scenario: Missing project manifest does not fall back to the user collection

- **WHEN** a user runs `facet install` without `--user` in a directory with no project manifest
- **THEN** the command SHALL report the missing project manifest
- **AND** it SHALL NOT install the user collection

#### Scenario: Unrelated commands do not advertise the flag

- **WHEN** a user requests help for `build`, `adapter`, or `self-update`
- **THEN** the help SHALL NOT list `--user`

### Requirement: User-targeted commands retain existing command behavior

With `--user`, each lifecycle command SHALL retain every applicable existing behavior, with the user collection's declarations, lockfile, and receipt in place of the project's. This SHALL include accepted source kinds and specifier forms, version selection, re-add reporting, adapter-selection prompting, unified progress views, collision resolution with Keep, Alias, and Omit, asset takeover confirmation, MCP approval, `--accept-mcp`, `--frozen-lockfile` on `install`, `--latest`, `--interactive`, `--dry-run`, and `--json` on `update` and `outdated`, `--verbose`, rollback reporting, undeclared-name handling for `remove`, and exit-code behavior. Flag combinations a command rejects without `--user` SHALL remain rejected with `--user`. The feature SHALL NOT add a preview mode a command does not already offer.

#### Scenario: Frozen user install uses the user lockfile

- **WHEN** a user runs `facet install --user --frozen-lockfile --accept-mcp`
- **THEN** the command SHALL reproduce the user lockfile under the existing frozen rules
- **AND** it SHALL NOT write the user declarations or lockfile

#### Scenario: User update dry run previews the user collection

- **WHEN** a user runs `facet update --user --dry-run`
- **THEN** the command SHALL present the update plan for the user collection's registry facets
- **AND** no collection or machine-local state SHALL change

#### Scenario: Rejected combinations stay rejected

- **WHEN** a user runs `facet update --user --json --interactive`
- **THEN** the system SHALL print a usage error and exit with code 1

#### Scenario: Removing an undeclared user facet is a no-op

- **WHEN** a user runs `facet remove --user missing` and the user declarations file exists but does not declare `missing`
- **THEN** the command SHALL report that no changes were made
- **AND** the process SHALL exit with code 0

### Requirement: Commands report missing user collection state actionably

When no user declarations file exists, `list --user` SHALL report an empty user collection and exit with code 0, and `outdated --user` SHALL report that the user collection has no registry facets and exit with code 0; neither SHALL create any state. `install --user`, `update --user`, and `remove --user` SHALL fail with a non-zero exit code, state that the user collection has no declarations yet, show a `facet add --user <facet>` command to start one, and create no state. The first successful `add --user` SHALL create the user declarations and lockfile in its commit. An existing user declarations file declaring no facets SHALL be treated as a valid empty collection. Malformed or unsupported user state SHALL retain each command's existing failure or warning behavior and SHALL be identified as user collection state rather than reported as absent.

#### Scenario: Listing before the first user add

- **WHEN** a user runs `facet list --user` before any user facet exists
- **THEN** the output SHALL state that the user collection is empty
- **AND** the process SHALL exit with code 0
- **AND** no user state directory or file SHALL be created

#### Scenario: Installing before the first user add

- **WHEN** a user runs `facet install --user` before any user facet exists
- **THEN** the command SHALL exit non-zero
- **AND** the error SHALL show `facet add --user <facet>` as the way to start the user collection
- **AND** no user state directory or file SHALL be created

#### Scenario: Outdated before the first user add

- **WHEN** a user runs `facet outdated --user --json` before any user facet exists
- **THEN** stdout SHALL contain one document with `ok` set to `true`, no facet entries, and scope `user`
- **AND** the process SHALL exit with code 0

#### Scenario: Malformed user declarations are reported as such

- **WHEN** the user declarations file is malformed and a user runs `facet list --user`
- **THEN** the command SHALL report that the user collection's declarations are malformed
- **AND** it SHALL NOT report an empty collection

### Requirement: List reports the selected collection

`facet list` SHALL report only the project collection, and SHALL NOT discover or advertise the user collection. `facet list --user` SHALL report the user collection's declared facets, preferring each facet's locked resolved version and otherwise showing its declared source, and SHALL label the output as the user collection. Listing SHALL be read-only in both scopes: it SHALL NOT contact the network, fetch content, create or migrate state, or write materialized assets or native configuration.

#### Scenario: User list shows user facets

- **WHEN** the user collection declares `cowsay` locked at `1.2.0`
- **AND** a user runs `facet list --user` from any directory
- **THEN** the output SHALL identify the user collection and list `cowsay` at `1.2.0`

#### Scenario: Plain list stays project-only

- **WHEN** the user collection declares facets and a user runs `facet list` in a project
- **THEN** the output SHALL list only the project's facets
- **AND** it SHALL NOT mention the user collection's facets

#### Scenario: Listing changes nothing

- **WHEN** a user runs `facet list --user`
- **THEN** the user declarations, lockfile, and receipt SHALL remain byte-for-byte unchanged

### Requirement: Command output and prompts identify the selected scope

Human-readable output from the lifecycle commands SHALL identify whether the operation targets the project or the user collection. This SHALL include progress views and final summaries, collision overviews and non-interactive collision failures, asset takeover screens, MCP approval screens and non-interactive MCP consent failures, update plans, no-op messages, and failure and rollback reports. Recovery and next-step commands the CLI renders SHALL include `--user` when the operation targeted the user collection and SHALL omit it otherwise. Collision guidance for the user collection SHALL identify the user declarations file as the location of the asset or `materialization.servers` override to edit.

#### Scenario: User summary is labelled

- **WHEN** `facet add --user cowsay` succeeds
- **THEN** the summary SHALL identify the user collection as the target

#### Scenario: User recovery command keeps the flag

- **WHEN** `facet update --user` fails because a user facet lacks usable local resolution state
- **THEN** the guidance SHALL direct the user to run `facet install --user`

#### Scenario: User collision failure points at user declarations

- **WHEN** a non-interactive `facet install --user` encounters an unresolved collision
- **THEN** the error SHALL identify the user declarations file and the override location to edit
- **AND** it SHALL state that no collection or materialized state changed

#### Scenario: Asset takeover screen names the scope

- **WHEN** an interactive user operation reaches an occupied untracked user-level asset destination
- **THEN** the continue-or-cancel screen SHALL identify the destination as user-level

### Requirement: User MCP approval explains its cross-project effect

The MCP approval screen and the non-interactive MCP consent failure for a user collection operation SHALL state that the configuration applies at the user level for the selected tools, across projects those tools open, subject to each tool's own overrides and precedence. They SHALL retain every existing disclosure and escaping rule. Approval recorded for a project SHALL NOT suppress user approval, and the CLI SHALL NOT present a project approval as covering the user collection. `--accept-mcp` with `--user` SHALL pre-approve only the user collection operation and SHALL NOT authorize asset takeover.

#### Scenario: User approval screen describes scope

- **WHEN** an interactive `facet add --user` requires approval for a new server declaration
- **THEN** the approval screen SHALL state that the server will be configured at the user level across projects opened by the selected tools
- **AND** it SHALL show the complete escaped declaration

#### Scenario: Project approval does not skip the user prompt

- **WHEN** a declaration is already approved for a project
- **AND** a user adds the same facet with `facet add --user` interactively
- **THEN** the MCP approval screen SHALL be displayed for the user collection

#### Scenario: Non-interactive user consent failure

- **WHEN** non-interactive `facet install --user` has unapproved declarations and no `--accept-mcp`
- **THEN** the failure SHALL disclose every declaration completely, identify the user scope, and state that no state changed

#### Scenario: Opt-in is scoped to the targeted collection

- **WHEN** non-interactive `facet install --user --accept-mcp` succeeds for a declaration, and a project with no approval for that declaration later installs it non-interactively without `--accept-mcp`
- **THEN** the project operation SHALL fail for lack of approval before mutation

### Requirement: Machine-readable output identifies the selected scope

Every JSON document emitted by `update --json` and `outdated --json`, including refusal and failure documents, SHALL carry a `scope` field whose value is `project` or `user`. Adding the field SHALL NOT remove or rename any existing field. Scope SHALL NOT be conveyed by a prose banner, and stdout SHALL still contain exactly one JSON document and nothing else. For these documents, `applied` SHALL report whether the run modified the selected collection.

#### Scenario: User outdated JSON carries scope

- **WHEN** a user runs `facet outdated --user --json`
- **THEN** stdout SHALL contain exactly one JSON document with `scope` set to `user`
- **AND** stdout SHALL contain no prose banner

#### Scenario: Project JSON carries project scope

- **WHEN** a user runs `facet update --dry-run --json` without `--user`
- **THEN** the document SHALL carry `scope` set to `project`

#### Scenario: User error document carries scope

- **WHEN** `facet update --user --json` fails
- **THEN** the error document SHALL carry `ok` set to `false` and `scope` set to `user`

### Requirement: Verbose output reports resolved native locations

When `add`, `install`, `remove`, or an applying `update` runs with `--verbose` in human-readable mode, the command SHALL report on stderr each participating adapter's resolved storage roots and MCP configuration document paths for the selected scope. It SHALL NOT dump unrelated configuration contents or environment values beyond the resolved paths and any declaration disclosure the existing verbose rules permit. JSON mode SHALL retain precedence over verbose human diagnostics: `--json --verbose` SHALL emit the single JSON document without a native-location banner or additional stderr output.

#### Scenario: Verbose user install shows destinations

- **WHEN** a user runs `facet install --user --verbose`
- **THEN** stderr SHALL name each participating adapter's user-level storage roots and MCP document paths
- **AND** stdout SHALL contain the usual rendered view

#### Scenario: Verbose output does not dump configuration

- **WHEN** a verbose operation reads a user-level configuration document containing unrelated settings
- **THEN** neither stream SHALL dump those settings or the location-resolution environment snapshot

#### Scenario: JSON output suppresses verbose human diagnostics

- **WHEN** a user runs `facet update --user --json --verbose`, whether it succeeds, refuses, or fails
- **THEN** stdout SHALL contain exactly one JSON document identifying scope `user`
- **AND** stderr SHALL remain empty
- **AND** no verbose native-location banner SHALL be emitted

### Requirement: Scope failures are reported completely and actionably

Each scope-related failure SHALL be reported as a distinct, structured, non-zero failure that names the user or project scope and gives a recovery action:

- An adapter lacking support for the requested scope SHALL produce one `ADAPTER_SCOPE_UNSUPPORTED` failure naming the requested scope and every offending adapter and capability with its declared scopes.
- A blocking lockfile scope mismatch, including frozen reproduction or update discovery, SHALL produce `LOCKFILE_SCOPE_MISMATCH` naming the collection scope and each offending facet and asset scope, with guidance to run a normal install for that collection. A successful normal install that regenerates consistent inventory SHALL report that recovery instead of a failed run.
- A user binding whose adapter location changed SHALL be reported as location drift with the restore, remove, and reinstall recovery.
- A missing bound adapter SHALL be reported with the adapter to restore.
- Physically aliased project and user destinations, including a project rooted at the home directory, SHALL be reported as an unsupported layout with its cleanup guidance.
- A relative Facets metadata root used with `--user` SHALL be reported with guidance to configure an absolute path.
- A persisted relative user local source SHALL be reported with guidance to re-add the facet or declare an absolute source.

None of these failures SHALL be reported as an adapter API incompatibility, a missing manifest, or an integrity failure, and each SHALL state that no state changed. Under `update --json` and `outdated --json`, each SHALL appear as the error document's `error` object.

#### Scenario: Unsupported scope lists every offender

- **WHEN** two selected adapters lack user-scope support for capabilities `facet install --user` requires
- **THEN** one error SHALL name both adapters, each offending capability, and each declared scope set
- **AND** the process SHALL exit non-zero

#### Scenario: Frozen scope mismatch is distinguishable

- **WHEN** `facet install --user --frozen-lockfile` finds a locked asset recording scope `project`
- **THEN** the error SHALL identify `LOCKFILE_SCOPE_MISMATCH`, the offending facet, and both scopes
- **AND** it SHALL direct the user to run `facet install --user` without `--frozen-lockfile`

#### Scenario: Location drift explains recovery

- **WHEN** a user operation fails because a bound adapter now resolves a different user-level location
- **THEN** the error SHALL name the adapter and both locations
- **AND** it SHALL describe restoring the previous location, removing the old materializations, and reinstalling

#### Scenario: Relative metadata root is explained

- **WHEN** a user runs `facet list --user` with a relative Facets metadata root
- **THEN** the command SHALL exit non-zero with guidance to configure an absolute path

#### Scenario: Home-rooted project refusal explains migration

- **WHEN** `facet install` targets a project rooted at home whose selected adapter's project storage aliases its user storage
- **THEN** the command SHALL exit non-zero without mutation and explain removing the old project materializations with a compatible pre-upgrade CLI before adopting `--user`

#### Scenario: Missing bound adapter is named before removal

- **WHEN** `facet remove --user cowsay` requires an adapter recorded in the user receipt that is no longer installed
- **THEN** the command SHALL name the adapter to restore, exit non-zero, and remove no user materialization

## MODIFIED Requirements

### Requirement: Add command is registered

The system SHALL register an `add` command that adds a facet to the selected collection's declarations and installs it in a single operation. Without `--user`, the selected collection SHALL be the project and its declarations SHALL be the project manifest; with `--user`, they SHALL be the user collection's declarations. The command SHALL accept one or more source specifiers as positional arguments.

#### Scenario: Add command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `add` command with its description

#### Scenario: Add command requires at least one source

- **WHEN** a user runs `add` with no positional arguments
- **THEN** the system SHALL print a usage error
- **AND** the process SHALL exit with code 1

#### Scenario: Add command accepts multiple sources

- **WHEN** a user runs `add` with two or more source specifiers
- **THEN** the system SHALL parse and add each specifier
- **AND** the operation SHALL succeed only if every specifier resolves and installs successfully

#### Scenario: Add with user targeting records user declarations

- **WHEN** a user runs `facet add --user cowsay`
- **THEN** the system SHALL record `cowsay` in the user collection's declarations
- **AND** it SHALL NOT modify any project manifest

#### Scenario: User local argument is declared absolutely

- **WHEN** a user runs `facet add --user ./my-facet` from `/work/tools` with a valid local facet at that path
- **THEN** the user declarations SHALL record its canonical absolute directory, and a later `facet install --user` from another directory SHALL resolve that same recorded directory

### Requirement: Install command is registered

The system SHALL register an `install` command that brings the selected collection on disk into agreement with its lockfile: the project by default, or the user collection with `--user`. The command SHALL accept no positional arguments.

#### Scenario: Install command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `install` command with its description

#### Scenario: Install command rejects positional arguments

- **WHEN** a user runs `install` with one or more positional arguments
- **THEN** the system SHALL print a usage error directing the user to `add` for adding new facets
- **AND** the process SHALL exit with code 1

#### Scenario: Install with user targeting reconciles the user collection

- **WHEN** a user runs `facet install --user` and the user collection declares facets
- **THEN** the system SHALL bring the user collection's materializations into agreement with the user lockfile

### Requirement: Remove command is registered

The system SHALL register a `remove` command that removes one or more facets from the selected collection's declarations and uninstalls them in a single operation: the project manifest by default, or the user collection's declarations with `--user`. The command SHALL accept one or more facet names as positional arguments. The system SHALL also accept `rm` as an alias of the same command, so users with muscle memory for either name succeed; both names SHALL invoke identical behavior.

#### Scenario: Remove command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `remove` command with its description
- **AND** the help output SHALL list `rm` as an alias of the same command

#### Scenario: rm alias produces identical behavior

- **WHEN** a user runs `rm` with the same arguments and flags as a corresponding `remove` invocation
- **THEN** the system SHALL produce the same output, side effects, and exit code as `remove`

#### Scenario: Remove command requires at least one name

- **WHEN** a user runs `remove` with no positional arguments
- **THEN** the system SHALL print a usage error
- **AND** the process SHALL exit with code 1

#### Scenario: Remove command accepts multiple names

- **WHEN** a user runs `remove` with two or more facet names
- **THEN** the system SHALL remove each declared facet
- **AND** the system SHALL silently ignore any undeclared names
- **AND** the operation SHALL succeed if every declared facet is removed successfully

#### Scenario: Remove with user targeting leaves projects alone

- **WHEN** a user runs `facet remove --user cowsay` inside a project that also declares `cowsay`
- **THEN** the system SHALL remove `cowsay` from the user collection only
- **AND** the project's declaration and materializations SHALL remain unchanged

### Requirement: Users can invoke project facet updates

The system SHALL register `update` as the canonical command for updating registry-backed facets declared by the selected collection: the project by default, or the user collection with `--user`. The system SHALL accept `upgrade` as an alias with identical output, side effects, and exit behavior. Both names SHALL operate on facets of the selected collection and SHALL NOT update the CLI binary.

The command SHALL accept `--latest` with short alias `-L`, `--interactive` with short alias `-i`, `--dry-run`, `--json`, `--verbose`, `--accept-mcp`, and `--user`. It SHALL accept no positional arguments and SHALL NOT expose `--frozen-lockfile`.

#### Scenario: Update command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the output SHALL list `update` as the canonical project-facet update command
- **AND** the output SHALL identify `upgrade` as its alias

#### Scenario: Upgrade alias performs the same operation

- **WHEN** a user runs `facet upgrade` with the same flags and project state as a corresponding `facet update` invocation
- **THEN** the system SHALL produce the same output, side effects, and exit code as `facet update`
- **AND** the invocation SHALL NOT report that the command is unimplemented

#### Scenario: Update rejects positional arguments

- **WHEN** a user runs `facet update` with one or more positional arguments
- **THEN** the system SHALL print a usage error
- **AND** the error SHALL direct the user to `--interactive` for per-facet selection
- **AND** the process SHALL exit with code 1

#### Scenario: Update help lists supported flags

- **WHEN** a user runs `facet update --help`
- **THEN** the help SHALL list `--latest` with `-L`
- **AND** the help SHALL list `--interactive` with `-i`
- **AND** the help SHALL list `--dry-run`, `--verbose`, `--accept-mcp`, and `--user`
- **AND** the help SHALL NOT list `--frozen-lockfile`

#### Scenario: Update help distinguishes project facets from the CLI binary

- **WHEN** a user runs `facet update --help`
- **THEN** the help SHALL describe `update` as operating on facets declared by the project, or by the user collection with `--user`
- **AND** the help SHALL name `self-update` as the command for updating the CLI binary

#### Scenario: Update rejects json with interactive

- **WHEN** a user runs `facet update --json --interactive`
- **THEN** the system SHALL print a usage error
- **AND** the process SHALL exit with code 1

#### Scenario: User update operates on the user collection

- **WHEN** a user runs `facet update --user` from inside a project
- **THEN** discovery and application SHALL use only the user collection's declarations and lockfile
- **AND** the project's manifest and lockfile SHALL remain unchanged

### Requirement: Outdated command is registered

The system SHALL register an `outdated` command that reports the update plan for the selected collection's facets: the project by default, or the user collection with `--user`. The command SHALL NOT modify the selected collection's declarations or lockfile, which are `facets.json` and `facets.lock` for a project.

#### Scenario: Outdated command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `outdated` command with its description

#### Scenario: Outdated command leaves the manifest and lockfile unchanged

- **WHEN** a user runs `facet outdated` in a project with an existing manifest and lockfile
- **AND** the command completes its report
- **THEN** the process SHALL exit with code 0
- **AND** `facets.json` SHALL remain byte-identical to its state before the command ran
- **AND** `facets.lock` SHALL remain byte-identical to its state before the command ran

#### Scenario: Outdated leaves the manifest and lockfile unchanged even when it cannot report

- **WHEN** a user runs `facet outdated` against a malformed lockfile
- **THEN** the command SHALL fail without exiting 0
- **AND** `facets.json` SHALL remain byte-identical to its state before the command ran
- **AND** `facets.lock` SHALL remain byte-identical to its state before the command ran

#### Scenario: User outdated leaves user state unchanged

- **WHEN** a user runs `facet outdated --user` with existing user declarations and lockfile
- **AND** the command completes its report
- **THEN** the process SHALL exit with code 0
- **AND** the user declarations, lockfile, and receipt SHALL remain byte-identical to their state before the command ran

### Requirement: Applied updates use the shared installation presentation

After a non-dry-run selection is confirmed or derived, the update command's human-readable output SHALL present the same per-facet progress stages, collision and consent surfaces, rollback reporting, and final version-transition summaries used by other facet installation operations for the selected collection. `--verbose` SHALL add diagnostics on stderr in human-readable mode; `--json` SHALL suppress that presentation and verbose prose in favor of its single-document contract. In non-interactive use, `--accept-mcp` SHALL be the sole flag that pre-approves otherwise valid MCP configuration work and SHALL NOT authorize asset takeover.

#### Scenario: Update shows per-facet installation progress

- **WHEN** a user applies one or more facet updates in human-readable mode
- **THEN** the output SHALL show progress for each selected facet
- **AND** the final summary SHALL identify each previous and installed version

#### Scenario: Update verbose output uses stderr

- **WHEN** a user runs an applying update with `--verbose` and without `--json`
- **THEN** installation progress SHALL remain on stdout
- **AND** additional diagnostics SHALL be written to stderr

#### Scenario: Non-interactive MCP work requires explicit acceptance

- **WHEN** a non-interactive update would apply unapproved MCP configuration
- **AND** `--accept-mcp` is not supplied
- **THEN** the command SHALL fail before mutation with the complete consent information
- **AND** when `--accept-mcp` is supplied, the command SHALL proceed without prompting if the work is otherwise valid

### Requirement: Machine-readable output reports whether the run wrote to the project

An `update --json` document with `ok: true` SHALL carry an `applied` boolean reporting whether the run modified the selected collection: the project by default, or the user collection with `--user`. A facet MAY be reported with outcome updated in a document whose `applied` is `false`, when the run previewed a change without writing it.

#### Scenario: A dry run reports applied false with facets it would update

- **WHEN** a user runs `facet update --latest --dry-run --json` against a facet with a newer release
- **THEN** the document SHALL report that facet's outcome as updated
- **AND** the document SHALL carry an `applied` field set to `false`

#### Scenario: An applying run reports applied true

- **WHEN** a user runs `facet update --latest --json --accept-mcp` and the run writes to the project
- **THEN** the document SHALL carry an `applied` field set to `true`

#### Scenario: A user update reports its own application

- **WHEN** `facet update --user --latest --json --accept-mcp` successfully updates user facets while leaving a nearby project unchanged
- **THEN** its document SHALL carry `scope: "user"` and `applied: true`
