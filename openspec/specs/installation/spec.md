## Purpose

The lockfile (`facets.lock`) records the exact resolved state of installed facets so that installations are reproducible across machines and environments. This spec defines what a valid lockfile contains.

The closed-alpha lockfile shape is **adapter-agnostic**: it records what each facet contributes (scope/type/name tuples) and leaves materialization to the installer. The installer applies the same asset set to every selected adapter, so the lockfile never embeds per-adapter state.

## Requirements

### Requirement: Lockfile declares a version

The lockfile SHALL include a top-level `lockfileVersion` integer. The CLI SHALL bump this on breaking shape changes and refuse to load lockfiles with a version it does not understand.

#### Scenario: Missing lockfile version

- **WHEN** a lockfile omits `lockfileVersion`
- **THEN** the system SHALL reject the lockfile

### Requirement: Each facet entry records source provenance

For every facet in `facets`, the lockfile SHALL record the original source specifier and (for git sources) the symbolic ref and resolved commit SHA. Local sources SHALL omit `ref` and `commit`.

#### Scenario: Valid git-source entry

- **WHEN** a lockfile facet entry includes `source`, `ref`, `commit`, `version`, `integrity`, and `assets`
- **THEN** the system SHALL accept the entry

#### Scenario: Valid local-source entry

- **WHEN** a lockfile facet entry includes `source: "file:./..."`, `version`, `integrity`, and `assets`, and omits `ref` / `commit`
- **THEN** the system SHALL accept the entry

### Requirement: Each facet entry captures identity and integrity

Every facet entry SHALL include `version` (from the facet's `facet.json`) and `integrity` (the sha256 of the built `.facet` archive). Missing either field SHALL cause the lockfile to be rejected.

#### Scenario: Missing integrity hash

- **WHEN** a facet entry omits `integrity`
- **THEN** the system SHALL reject the lockfile

### Requirement: Each facet entry lists its assets, adapter-agnostically

Every facet entry SHALL include an `assets` array whose members are `{scope, type, name}` tuples. `scope` SHALL be one of `system | user | project`. `type` SHALL be one of `skill | agent | command`. No per-adapter fields live here — the installer applies the asset set to every selected adapter ("same thing per adapter").

#### Scenario: Valid asset tuple

- **WHEN** an asset entry has `scope: "user"`, `type: "skill"`, and `name: "planning"`
- **THEN** the system SHALL accept the entry

#### Scenario: Unknown asset scope

- **WHEN** an asset entry has `scope: "global"`
- **THEN** the system SHALL reject the lockfile

#### Scenario: Unknown asset type

- **WHEN** an asset entry has `type: "hook"`
- **THEN** the system SHALL reject the lockfile

### Requirement: A lockfile without facets is valid

A project that declares no facets in `facets.json` SHALL produce a valid lockfile with an empty `facets` object.

#### Scenario: Empty facets map

- **WHEN** a lockfile contains `lockfileVersion` and `facets: {}`
- **THEN** the system SHALL accept the lockfile

### Requirement: Unrecognized fields are tolerated

The system SHALL accept lockfiles containing fields not defined in the current schema. Unrecognized fields SHALL be preserved, not stripped or rejected.

#### Scenario: Unknown field in lockfile

- **WHEN** a lockfile contains a field not defined in the schema (e.g., `generatedAt: "2026-04-18"`)
- **THEN** the system SHALL accept the lockfile
- **AND** the field SHALL be present in the loaded result

## Future requirements (open-beta)

These requirements apply to the open-beta install pipeline (registry resolution, MCP server references, composition). They are **not** part of closed-alpha scope and are deferred until the registry lands.

- Per-facet MCP server entries (source-mode + ref-mode) with API surface hashes for breaking-change detection.
- Composed facets (`facets`/`servers` inside a facet manifest) with sub-lockfile state.
- Registry-pinned integrity alongside source-pinned integrity (provenance chain).
