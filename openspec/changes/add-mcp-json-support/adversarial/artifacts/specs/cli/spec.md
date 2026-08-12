## ADDED Requirements

### Requirement: Users approve MCP configuration in one explicit consent step

When an interactive `add`, `install`, or `remove` operation requires MCP configuration consent, the rendered view SHALL present one consent request covering every unapproved declaration and every disclosed untracked native-entry takeover before anything is written. Each declaration SHALL be shown with its claimant facets and its exact command, arguments, and environment assignments, or its exact URL — never a summary that hides what would execute. Takeovers SHALL appear in a distinct section identifying the adapter, whether the existing entry is equivalent, and the desired declaration. The request SHALL cover only MCP configuration: asset collision resolution and asset takeover confirmation SHALL remain separate workflows. Declining SHALL end the command with a non-zero exit code and no mutation.

#### Scenario: Consent shows the exact command before any write

- **WHEN** an interactive install encounters an unapproved stdio declaration
- **THEN** the consent view SHALL display the exact command, arguments, and environment assignments together with the claimant facets
- **AND** nothing SHALL be written before the user responds

#### Scenario: Takeovers are displayed distinctly

- **WHEN** the consent request includes an untracked native entry at a desired identity
- **THEN** the takeover SHALL be shown in its own section with the adapter name, an equivalence indication, and the desired declaration

#### Scenario: Declining exits non-zero without mutation

- **WHEN** the user declines the MCP consent request
- **THEN** the command SHALL exit with a non-zero code
- **AND** the view SHALL state that no project or tool configuration was changed

#### Scenario: Consent is not requested for approved unchanged configuration

- **WHEN** every effective declaration was previously approved on this machine and is unchanged
- **THEN** the command SHALL proceed without an MCP consent step

### Requirement: Non-interactive MCP acceptance uses one explicit flag

The `add`, `install`, and `remove` commands SHALL accept an `--accept-mcp` flag as the only non-interactive MCP acceptance mechanism; no second MCP override flag SHALL exist. A non-interactive operation requiring MCP consent without the flag SHALL fail before mutation, and its stderr output SHALL render the complete unapproved declaration list — exact commands, arguments, environment assignments, or URLs — the claimant facets, every disclosed takeover, and the fact that nothing was changed, without relying on free-form messages. The flag SHALL NOT accept asset takeovers or resolve asset collisions on the caller's behalf. Frozen installation SHALL never prompt and MAY use the flag.

#### Scenario: Non-interactive failure is complete and actionable

- **WHEN** a non-interactive install requires MCP consent and `--accept-mcp` was not supplied
- **THEN** the command SHALL exit non-zero before any mutation
- **AND** stderr SHALL list every unapproved declaration in full with its claimant facets and every takeover

#### Scenario: The flag authorizes MCP configuration only

- **WHEN** a non-interactive install runs with `--accept-mcp` and also has an unresolved asset collision
- **THEN** the MCP declarations SHALL be accepted
- **AND** the asset collision SHALL still fail with its own complete report

#### Scenario: Remove accepts the flag

- **WHEN** a non-interactive `remove` reconciles remaining facets whose MCP configuration requires consent
- **THEN** `--accept-mcp` SHALL be accepted and honored identically to `add` and `install`

### Requirement: MCP configuration outcomes are visible in command output

The rendered view for commands that install, update, or remove facets SHALL surface MCP configuration outcomes: added, updated, unchanged, aliased, omitted, removed, conflicting, taken over, and unsupported-adapter results. Summaries SHALL count MCP configurations separately from text assets so a server-only facet visibly reports its work. An aliased server SHALL be shown with both its authored and effective names; an omitted server SHALL be identified as omitted. A desired-state conflict SHALL identify every claimant facet and the exact `facets.json` disposition location that can record an alias or omission, with syntactically valid examples, and SHALL NOT select a winner. An unsupported-adapter failure SHALL name every adapter that must be upgraded. Output SHALL NOT persist declaration contents to logs outside the interactive consent display.

#### Scenario: Server-only facet reports meaningful work

- **WHEN** a facet contributing only MCP declarations installs successfully
- **THEN** the summary SHALL report its configuration outcomes with zero assets
- **AND** the facet SHALL NOT be reported as a no-op

#### Scenario: Aliases and omissions appear in the summary

- **WHEN** an install materializes server `filesystem` as `project-filesystem` and omits server `scratch`
- **THEN** the summary SHALL show `filesystem` together with `project-filesystem`
- **AND** it SHALL identify `scratch` as omitted

#### Scenario: Conflict report shows editable manifest locations

- **WHEN** two facets declare different servers at one effective name
- **THEN** the failure SHALL identify both claimants and the expanded `facets.json` server entries that can record an alias or omission
- **AND** it SHALL include valid alias and omission snippets
- **AND** it SHALL NOT prescribe a winner

#### Scenario: Unsupported adapters are named with guidance

- **WHEN** active MCP declarations exist and selected adapters lack MCP support
- **THEN** the failure SHALL name every such adapter
- **AND** it SHALL direct the user to upgrade or reinstall a compatible adapter

## REMOVED Requirements

### Requirement: Add command warns when servers are declared

**Reason**: The warn-and-skip rendering existed for speculative server references that installation ignored. Those references no longer validate, and concrete declarations are materialized with explicit consent and full outcome reporting, so a warning that servers were skipped would be false.

**Migration**: Users see the MCP consent request before configuration is written and per-server outcomes in the command summary. Manifests using the old reference forms fail validation with a structured error rather than producing a warning.
