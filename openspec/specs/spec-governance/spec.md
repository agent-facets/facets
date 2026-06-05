## Purpose

Standards for how specifications are written in this project. Establishes the value-centric philosophy: specs describe customer/user/developer value, are organized by product domain, and do not reference internal implementation details.

## Requirements

### Requirement: Specifications describe customer value

All specifications SHALL describe value delivered to customers, users, or developers. The litmus test for every requirement SHALL be: "Would a customer, user, or developer care if this stopped working?" If the answer is no, the content belongs in a design document, not a specification.

#### Scenario: Execution requirement passes the litmus test

- **WHEN** a developer writes a requirement about plan execution visibility
- **THEN** the requirement SHALL describe what users can observe (e.g., "users can see which tasks have completed and which are pending")
- **AND** the requirement SHALL NOT describe internal mechanisms (e.g., "ExecutionService persists a PlanExecution record via storage.ts")

#### Scenario: Infrastructure mechanism fails the litmus test

- **WHEN** a proposed requirement describes an internal caching layer, job queue, or instrumentation mechanism
- **AND** no customer, user, or developer directly interacts with or depends on that mechanism
- **THEN** the requirement SHALL be rejected from the spec
- **AND** the content SHOULD be captured in the relevant change's design document instead

### Requirement: Specifications do not reference internal implementation details

Requirements and scenarios SHALL NOT reference internal class names, method names, module paths, or internal data structures. Specs describe observable behavior from the perspective of whoever receives the value.

#### Scenario: Requirement avoids internal references

- **WHEN** a requirement describes a system capability
- **THEN** the requirement text SHALL NOT contain internal class names (e.g., `ExecutionService`, `DispatchService`, `PlanningService`)
- **AND** the requirement text SHALL NOT contain internal method signatures (e.g., `.claimNextTask()`, `.tryParseAndValidate()`)
- **AND** scenarios SHALL describe outcomes in terms of what users, developers, or API consumers observe

#### Scenario: Implementation detail belongs in design

- **WHEN** a developer needs to document which internal classes implement a capability
- **THEN** that documentation SHALL be placed in the change's design document
- **AND** the spec SHALL describe only the externally observable behavior the implementation delivers

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

- **WHEN** a parent concept carries genuinely-shared rules across multiple target variants (e.g., `publishing` holds shared identity, tokens, ownership, and provenance rules; `publishing__collections` holds rules specific to collection-scoped facets; `publishing__global_facets` holds rules specific to global facets)
- **THEN** a parent spec MAY be created at `openspec/specs/publishing/spec.md` alongside sibling specs at `openspec/specs/publishing__collections/spec.md` and `openspec/specs/publishing__global_facets/spec.md`
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

- **WHEN** an author proposes a spec name with more than one `__` separator (e.g., `publishing__collections__facets`)
- **THEN** the proposal SHALL be rejected
- **AND** the author SHALL restructure into a single level of cascade or express the additional distinction as a requirement within a single sibling spec

### Requirement: Specifications are organized by product domain

Specs SHALL be organized by the product domain that delivers customer value, not by infrastructure domain. Each spec directory SHALL use flat naming under `openspec/specs/` — either plain kebab-case (e.g., `installation`) or category-qualified with `__` (e.g., `authoring__facets`).

#### Scenario: Execution persistence belongs in the execution spec

- **WHEN** a developer needs to spec persistence behavior for the execution domain
- **THEN** the requirements SHALL be placed in the `execution` spec (the product domain delivering value)
- **AND** the requirements SHALL NOT be placed in a `state-machines` or `task-persistence` spec (infrastructure concerns, not product domains)

#### Scenario: Naming convention for specs

- **WHEN** a new spec is created for a product domain
- **THEN** the directory name SHALL use either plain kebab-case (e.g., `planning`, `execution`, `spec-governance`) or category-qualified naming with `__` (e.g., `authoring__facets`, `authoring__servers`)

#### Scenario: One spec per domain

- **WHEN** a product domain is specified
- **THEN** the domain SHALL have exactly one spec at `openspec/specs/<domain>/spec.md`
- **AND** all capabilities within the domain SHALL be expressed as requirements within that single spec
- **AND** the domain SHALL NOT be split into multiple specs per capability (e.g., `execution-loop` and `execution-triggering` are requirements within the `execution` spec, not separate specs; `auth-login` is a requirement within the `auth` spec, not a separate spec)

### Requirement: Specifications do not reference domain names in requirements

Spec files — including Purpose sections, requirements, and scenarios — SHALL NOT use domain names (e.g., "the planning domain," "the execution domain," "the orchestration layer") as subjects, objects, or qualifiers. Specs describe what the system does for users — not which internal organizational unit does it. The subject SHALL be "the system," "the user," "the plan," "the agent," or another user-visible concept — or omitted entirely using passive voice (e.g., "User requests are transformed into structured plans"). Users do not know about domains; specs SHALL NOT assume they do.

#### Scenario: Domain name used as subject is rejected

- **WHEN** a proposed requirement uses a domain name as its subject (e.g., "the planning domain SHALL return one of three response types")
- **THEN** the requirement SHALL be rejected
- **AND** it SHALL be rewritten with a user-visible subject (e.g., "the system SHALL return one of three response types")

#### Scenario: Domain name used as consumer is rejected

- **WHEN** a proposed requirement references another domain as a consumer or recipient (e.g., "the plan SHALL be available for the execution domain to execute")
- **THEN** the requirement SHALL be rejected
- **AND** it SHALL be rewritten to describe the outcome without naming the consumer (e.g., "the plan SHALL be available for execution")

#### Scenario: Internal layer name is rejected

- **WHEN** a proposed requirement uses an internal layer name (e.g., "the orchestration layer SHALL transform internal agent responses")
- **THEN** the requirement SHALL be rejected
- **AND** it SHALL be rewritten to describe user-observable behavior (e.g., "the system SHALL present responses to the user in a consistent format")

#### Scenario: Cross-domain responsibility attribution is rejected

- **WHEN** a proposed requirement attributes responsibility to another domain (e.g., "this is coordinated by the X domain's Y capability" or "the orchestration domain is responsible for presenting failures")
- **THEN** the requirement SHALL be rejected
- **AND** it SHALL be rewritten to describe the observable behavior without attributing it to a domain

#### Scenario: User-observable outcome is acceptable

- **WHEN** a requirement describes an outcome that the user observes (e.g., "when a user approves a plan, execution begins automatically")
- **THEN** the requirement SHALL be accepted because it describes a user-observable outcome
- **AND** the requirement SHALL NOT add organizational commentary about which domain triggers the transition

### Requirement: Scenarios are testable and verifiable

Every scenario SHALL describe a concrete, verifiable outcome. Scenarios SHALL be specific enough that a developer could write an automated test or manually verify the behavior.

#### Scenario: Testable scenario

- **WHEN** a developer reads a scenario in a spec
- **THEN** the scenario SHALL describe specific observable inputs and outputs
- **AND** a developer SHALL be able to determine unambiguously whether the scenario passes or fails

#### Scenario: Vague scenario is rejected

- **WHEN** a proposed scenario uses vague language like "the system is observable" or "performance is acceptable"
- **THEN** the scenario SHALL be rejected
- **AND** it SHALL be rewritten with specific, measurable criteria (e.g., "the user is presented with retry, re-plan, or stop options when a task fails")
