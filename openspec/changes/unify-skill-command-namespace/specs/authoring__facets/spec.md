## MODIFIED Requirements

### Requirement: Build detects naming collisions between local assets

The system SHALL detect naming collisions among a facet's locally declared assets. Skills SHALL have unique names within the skills section, agents SHALL have unique names within the agents section, and commands SHALL have unique names within the commands section.

In addition, skills and commands SHALL share a single name namespace: a command name MUST NOT equal any skill name, and a skill name MUST NOT equal any command name. This is because some tools install skills and commands into one shared location, where a shared name is not deliverable. Agents SHALL keep an independent namespace — an agent MAY share a name with a skill or a command. The collision is defined on exact name equality; distinct names that share a prefix (for example a command `space` and a skill `space/spec`) SHALL NOT be treated as a collision.

Any collision SHALL cause the build to fail with an error identifying the conflicting name and the sections involved.

#### Scenario: Two skills share a name

- **WHEN** a facet declares two skills with the same name
- **THEN** the build SHALL fail
- **AND** the error SHALL identify the collision within the skills section

#### Scenario: Skill and command share a name

- **WHEN** a facet declares a skill and a command with the same name
- **THEN** the build SHALL fail
- **AND** the error SHALL identify the collision between the skills and commands sections

#### Scenario: Skill and agent share a name

- **WHEN** a facet declares a skill and an agent with the same name
- **THEN** the build SHALL succeed with no collision errors

#### Scenario: Command and agent share a name

- **WHEN** a facet declares a command and an agent with the same name
- **THEN** the build SHALL succeed with no collision errors

#### Scenario: Distinct nested names across skills and commands do not collide

- **WHEN** a facet declares a command named `space` and a skill named `space/spec`
- **THEN** the build SHALL succeed with no collision errors

#### Scenario: No collisions across distinct names within each type

- **WHEN** a facet declares assets with distinct names within each asset type
- **THEN** the build SHALL succeed with no collision errors
