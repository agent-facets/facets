## MODIFIED Requirements

### Requirement: Category-domain naming for sibling domains

When multiple independent domains share a parent concept, they MAY use `__` (double underscore) to encode the category: `category__domain`. Each `category__domain` SHALL be a fully independent spec with its own `spec.md`.

A `<category>` parent spec at `openspec/specs/<category>/spec.md` MAY also exist alongside its `__`-suffixed siblings, forming a **cascade**: the parent holds requirements common to all siblings, and each sibling holds requirements specific to its target. When a parent spec is present, its requirements SHALL apply to every `<category>__<sibling>` spec as if inlined, AND sibling specs SHALL NOT restate parent requirements. The parent spec is OPTIONAL — sibling-only layouts (no parent) remain valid.

The cascade SHALL be expressed by naming convention and reading order alone (parent first, then siblings). Spec files SHALL NOT use in-file inheritance, import, or extension syntax to link sibling specs to their parent.

The `__` separator SHALL NOT be used to encode a *feature* of a single domain (a capability inside one domain that does not stand alone as an independently-testable target). The discriminator SHALL be whether the right-hand side is an independently-testable target variant with its own consumers and rules (allowed) or a capability inside one domain (forbidden).

Only one level of cascade is permitted: `<category>` plus `<category>__<sibling>`. Multi-segment names such as `<category>__<sub>__<leaf>` SHALL NOT be used.

#### Scenario: Sibling domains share a category

- **WHEN** two or more domains are independent systems under a shared concept (e.g., facet authoring and server authoring are both authoring systems)
- **THEN** they MAY use `category__domain` naming (e.g., `authoring__facets`, `authoring__servers`)
- **AND** each SHALL have its own independent spec at `openspec/specs/category__domain/spec.md`
- **AND** a parent `authoring/spec.md` is OPTIONAL — the sibling-only layout is valid

#### Scenario: Parent category and sibling targets form a cascade

- **WHEN** a parent concept carries genuinely-shared rules across multiple target variants (e.g., `authoring` holds shared identity and asset naming rules; `authoring__facets` holds rules specific to facet projects; `authoring__servers` holds rules specific to server projects)
- **THEN** a parent spec MAY be created at `openspec/specs/authoring/spec.md` alongside sibling specs at `openspec/specs/authoring__facets/spec.md` and `openspec/specs/authoring__servers/spec.md`
- **AND** the parent spec SHALL hold the shared requirements
- **AND** each sibling spec SHALL hold only its target-specific requirements
- **AND** sibling specs SHALL NOT restate any requirement already present in the parent
- **AND** the cascade SHALL be conveyed by naming and reading order only — sibling specs SHALL NOT contain `extends:`, `imports:`, or any other inheritance directive

#### Scenario: Feature within a domain does not use category separator

- **WHEN** a capability is a *feature* of a single domain — a capability inside that domain that does not stand alone as an independently-testable target with its own consumers and rules (e.g., login within auth, prompt resolution within facet authoring)
- **THEN** it SHALL NOT use `__` to create a separate spec (e.g., `auth__login` is forbidden)
- **AND** it SHALL be expressed as a requirement within the parent domain's spec
- **AND** the cascade pattern (parent + `__`-siblings for independently-testable target variants) SHALL NOT be used to dress up a feature-of-a-domain split

#### Scenario: Standalone domain does not require a category

- **WHEN** a domain has no sibling domains under a shared concept (e.g., `installation`, `spec-governance`)
- **THEN** it SHALL use a plain kebab-case name without a `__` separator

#### Scenario: Multi-level nesting is not permitted

- **WHEN** an author proposes a spec name with more than one `__` separator (e.g., `authoring__facets__scaffold`)
- **THEN** the proposal SHALL be rejected
- **AND** the author SHALL restructure into a single level of cascade or express the additional distinction as a requirement within a single sibling spec
