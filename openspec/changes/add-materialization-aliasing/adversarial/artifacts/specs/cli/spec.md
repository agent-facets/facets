## ADDED Requirements

### Requirement: Add and install present collision groups for interactive resolution

When an interactive `add` or `install` detects an unresolved cross-facet asset collision, the rendered view SHALL present each collision group before any file is written. The presentation SHALL name each contributing facet, each colliding asset with its type, and the shared namespace involved, and SHALL offer the user exactly three choices per asset: keep the authored name, enter an alias, or omit the asset. An entered alias SHALL be validated immediately against the asset-name grammar and against the rest of the effective asset set, with the specific constraint violation shown on failure, and the user SHALL be able to correct it without restarting the operation. Cancelling SHALL exit without modifying the project.

#### Scenario: Collision group names facets and assets

- **WHEN** two facets both contribute skill `review` and a user runs `add` in an interactive terminal
- **THEN** the rendered view SHALL show one collision group naming both facets and the colliding asset `review`
- **AND** the view SHALL indicate that skills and commands share one namespace

#### Scenario: User assigns an alias interactively

- **WHEN** a user chooses to alias one colliding skill and enters `review-acme`
- **THEN** the system SHALL validate the alias against the asset-name grammar and the effective asset set
- **AND** on success the operation SHALL proceed with `review-acme` as that asset's effective name

#### Scenario: Invalid alias input is corrected in place

- **WHEN** a user enters an alias that violates the asset-name grammar or collides with another effective name
- **THEN** the rendered view SHALL show the specific constraint that failed
- **AND** the user SHALL be able to enter a different alias without restarting the command

#### Scenario: Cancelling collision resolution aborts cleanly

- **WHEN** a user cancels the collision prompt
- **THEN** the process SHALL exit without modifying the project manifest, lockfile, or adapter state

### Requirement: Unresolved collisions in non-interactive use render an actionable failure

When a non-interactive `add` or `install` fails because of an unresolved collision, the rendered failure SHALL identify each collision group — naming every contributing facet and colliding asset — and SHALL state the available resolutions and that resolutions are recorded in the project manifest. The process SHALL exit with a non-zero code.

#### Scenario: Non-interactive collision failure is actionable

- **WHEN** a non-interactive install encounters skill `review` contributed by two facets with no recorded resolution
- **THEN** the rendered failure SHALL name both facets and the colliding asset
- **AND** the failure SHALL state that each colliding asset must be kept, aliased, or omitted via the project manifest
- **AND** the process SHALL exit with a non-zero code

#### Scenario: Multiple collision groups are all reported at once

- **WHEN** a non-interactive install encounters two independent collision groups
- **THEN** the rendered failure SHALL report both groups in one run
- **AND** the user SHALL NOT need a second failing run to discover the second group

### Requirement: Recorded resolutions install without prompting and are visible in the summary

When every collision is covered by a recorded resolution, `add` and `install` SHALL proceed without any collision prompt, and the final summary SHALL show each aliased asset's authored name together with its effective materialized name and SHALL identify omitted assets as omitted.

#### Scenario: Recorded resolutions produce no prompt

- **WHEN** a user runs `install` on a project whose recorded intent covers every collision
- **THEN** no collision prompt SHALL appear
- **AND** the operation SHALL materialize the recorded effective asset set

#### Scenario: Summary shows authored and effective names

- **WHEN** an install materializes skill `review` under the alias `review-acme` and omits command `deploy`
- **THEN** the summary SHALL show `review` together with its effective name `review-acme`
- **AND** the summary SHALL identify `deploy` as omitted
