## ADDED Requirements

### Requirement: The supported adapter API set is exactly 0.1 and 0.2 with unchanged exact-token semantics

The current CLI's supported adapter API set SHALL be exactly `{0.1, 0.2}` during the compatibility window. Widening the set SHALL change only which exact tokens are accepted: every per-adapter classification — verification, loading, listing, npm candidate selection, and npm package-versus-runtime declaration agreement — SHALL remain exact-token equality, and no check SHALL be weakened to a range, ordering, or proximity comparison. npm candidate selection SHALL select the highest stable release declaring any member of the supported set; a package/runtime disagreement between two supported tokens SHALL still fail verification.

A `0.1` adapter SHALL remain fully usable for text-asset work and SHALL be classified as MCP-server-unsupported: it MAY be selected and loaded, and facet operations SHALL proceed with it whenever the desired state contains no active MCP server declarations. When active MCP declarations exist, a selected `0.1` adapter — or a `0.2` adapter declaring no MCP support — SHALL cause the documented pre-mutation unsupported-adapter failure with upgrade guidance rather than being silently skipped.

#### Scenario: Both tagged tokens are supported at load

- **WHEN** installed adapters declare runtime APIs `0.1` and `0.2`
- **THEN** loading SHALL classify both as supported
- **AND** listing SHALL display each declared API with a supported status

#### Scenario: npm selection considers both supported tokens

- **WHEN** a user installs an npm adapter by bare package name
- **AND** the package publishes a `0.1` release and a newer stable `0.2` release
- **THEN** the system SHALL install the highest stable release declaring a supported API
- **AND** a still-newer release declaring an unsupported API SHALL be skipped

#### Scenario: Package and runtime declarations must agree even within the supported set

- **WHEN** a selected npm release declares `0.1` in package metadata and its loaded runtime adapter declares `0.2`
- **THEN** verification SHALL fail before activation
- **AND** the disagreement SHALL NOT be excused because both tokens are individually supported

#### Scenario: Text-only project works with a 0.1 adapter

- **WHEN** a project's desired state contains no active MCP server declarations
- **AND** a selected adapter declares API `0.1`
- **THEN** facet operations SHALL proceed normally with that adapter

#### Scenario: Positional 0.0 remains unsupported

- **WHEN** an installed adapter declares runtime API `0.0`
- **THEN** loading SHALL fail closed with an actionable compatibility diagnostic
- **AND** no adapter contract method SHALL be invoked

#### Scenario: Compatibility diagnostics list the widened set

- **WHEN** an adapter is rejected for a missing, malformed, or unsupported API declaration
- **THEN** the diagnostic SHALL list `0.1` and `0.2` as the APIs supported by the CLI
- **AND** it SHALL provide the best available compatible-install command
