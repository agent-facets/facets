## MODIFIED Requirements

### Requirement: Authors can scaffold a new facet project interactively

The system SHALL provide an interactive wizard that guides the author through creating a new facet project. The wizard SHALL collect the following required information:

- **Name**: A valid facet identity name. The name SHALL be either an unscoped kebab-case name (`name`) or a scoped name (`@scope/name`). The system SHALL validate the name in real-time and reject invalid input.
- **Description**: A non-empty description. The system SHALL NOT allow the author to complete the wizard without providing a description.

The wizard SHALL also collect optional information:

- **Version**: A valid SemVer version (N.N.N format). The system SHALL default to `0.0.0`. The author MAY accept the default or change it.
- **Privacy**: A choice of whether the new facet declares private publish intent. The system SHALL default to public-by-default. The author MAY choose private publish intent or accept the public-by-default default. The system SHALL present this choice in plain terms the author can act on without consulting external documentation — public-by-default means the facet is publicly listable when published, and private publish intent means the author signals the registry to keep the facet unlisted.

The wizard SHALL also allow the author to manage assets (skills, commands, and agents):

- The author SHALL be able to add multiple named assets of any type
- The author SHALL be able to edit the name of an existing asset
- The author SHALL be able to remove an existing asset
- All asset names SHALL be validated as kebab-case in real-time
- Asset names SHALL be unique within their type — the system SHALL reject duplicates within the same asset type
- Assets of different types MAY share the same name
- The first asset added to each type SHOULD default its name to the unscoped name segment of the facet identity as a suggestion

The wizard SHALL require the author to add at least one **asset** before completing. Name, description, and at least one **asset** are all required.

All fields SHALL remain editable throughout the wizard — the author SHALL be able to go back and change any previously entered value, including the privacy choice.

Before completing, the wizard SHALL display a confirmation summary showing only the asset types that have entries and a preview of the files to be created. The summary SHALL communicate the selected privacy intent. The author SHALL be able to confirm or go back.

The wizard SHALL provide an exit confirmation mechanism that prevents accidental loss of unsaved work.

Upon confirmation, the system SHALL create a project directory containing a valid manifest and named starter files for each asset the author specified, with each starter file containing template content that guides authors on what belongs in each section. Skill starter files SHALL be created at `skills/<name>/SKILL.md`. Agent and command starter files SHALL be created at `agents/<name>.md` and `commands/<name>.md` respectively. All starter files SHALL contain no YAML front matter.

When the author selects private publish intent, the generated manifest SHALL declare `private: true`. When the author accepts public-by-default, the generated manifest SHALL omit the `private` field entirely rather than writing `private: false`.

The scaffolded project SHALL be immediately buildable — running the build command on a freshly scaffolded project SHALL succeed with no errors.

#### Scenario: Author scaffolds a scoped project with named skills

- **WHEN** the author runs the create wizard, provides a name `@julian/cowsay` and description `Cowsay tools`, and adds a skill named `cowsay`
- **THEN** the system SHALL create a project directory containing a manifest whose `name` is `@julian/cowsay`
- **AND** a starter file SHALL be created at `skills/cowsay/SKILL.md`
- **AND** the manifest SHALL reference all starter files correctly

#### Scenario: Author scaffolds a project with named skills

- **WHEN** the author runs the create wizard, provides a name "viper-plans" and description "VIPER planning tools", and adds two skills named "viper-planning" and "viper-execution-rules"
- **THEN** the system SHALL create a project directory containing a manifest with the provided identity fields and skill descriptors
- **AND** starter files SHALL be created at `skills/viper-planning/SKILL.md` and `skills/viper-execution-rules/SKILL.md`
- **AND** the manifest SHALL reference all starter files correctly

#### Scenario: Author scaffolds a minimal project accepting the default skill name

- **WHEN** the author runs the create wizard, provides a name "code-review" and a description, then adds a skill accepting the default name suggestion
- **THEN** the system SHALL create a project with a skill named "code-review" (matching the facet name)
- **AND** the starter file SHALL be at `skills/code-review/SKILL.md`

#### Scenario: Author cannot complete without a description

- **WHEN** the author attempts to complete the wizard without providing a description
- **THEN** the system SHALL NOT allow completion
- **AND** the system SHALL indicate that a description is required

#### Scenario: Scoped facet identity is accepted

- **WHEN** the author enters `@acme/deploy-tools` as the facet name
- **THEN** the system SHALL accept the name as a valid facet identity

#### Scenario: Invalid facet identity is rejected

- **WHEN** the author enters `@acme/Deploy_Tools` as the facet name
- **THEN** the system SHALL indicate the name is invalid
- **AND** the system SHALL NOT accept the invalid name

#### Scenario: Asset names are validated as kebab-case

- **WHEN** the author enters an asset name containing uppercase letters, spaces, underscores, slashes, or an at sign
- **THEN** the system SHALL indicate the name is invalid
- **AND** the system SHALL NOT accept the invalid name

#### Scenario: Duplicate asset names within a type are rejected

- **WHEN** the author attempts to add a skill with the same name as an existing skill
- **THEN** the system SHALL reject the duplicate name

#### Scenario: Same name across different asset types is allowed

- **WHEN** the author adds a skill named "viper-plans" and an agent named "viper-plans"
- **THEN** the system SHALL accept both assets without error

#### Scenario: Author edits an existing asset name

- **WHEN** the author selects an existing asset and changes its name to a valid, unique kebab-case name
- **THEN** the system SHALL update the asset name

#### Scenario: Author removes an asset

- **WHEN** the author removes a previously added asset
- **THEN** the asset SHALL no longer appear in the wizard or the confirmation summary

#### Scenario: Author exits the wizard with unsaved work

- **WHEN** the author triggers an exit action during the wizard
- **THEN** the system SHALL confirm the author's intent to exit
- **AND** if the author confirms exit, the system SHALL not create any files or directories

#### Scenario: Version field accepts valid SemVer input

- **WHEN** the author sets the version to a valid SemVer value (e.g., "1.0.0" or "100.2.1")
- **THEN** the system SHALL accept the version

#### Scenario: Version field rejects invalid input

- **WHEN** the author enters a version that does not match the N.N.N pattern
- **THEN** the system SHALL indicate the version is invalid

#### Scenario: Version defaults to 0.0.0

- **WHEN** the author does not change the version field
- **THEN** the manifest SHALL contain version `0.0.0`

#### Scenario: Privacy defaults to public-by-default with the field omitted

- **WHEN** the author completes the create wizard without changing the privacy choice
- **THEN** the generated manifest SHALL NOT contain a `private` field
- **AND** the system SHALL NOT write `private: false`

#### Scenario: Author selects private publish intent during create

- **WHEN** the author selects private publish intent in the create wizard and completes it
- **THEN** the generated manifest SHALL contain `private: true`

#### Scenario: Author selects private then reverts to public before completing

- **WHEN** the author selects private publish intent, then changes the privacy choice back to public-by-default before completing the wizard
- **THEN** the generated manifest SHALL NOT contain a `private` field

#### Scenario: Confirmation summary reflects the selected privacy intent

- **WHEN** the author reaches the confirmation summary after selecting private publish intent
- **THEN** the summary SHALL indicate that the facet declares private publish intent

#### Scenario: Target directory already contains a manifest

- **WHEN** the author runs the create wizard and a manifest already exists in the target directory
- **THEN** the system SHALL warn the author and ask for confirmation before overwriting

### Requirement: Authors can edit a facet project interactively

The system SHALL provide an interactive editing command that serves as the full authoring workbench for facet manifests. The editing command SHALL combine all capabilities of the scaffolding wizard (identity editing, privacy editing, asset creation, asset removal) with automatic reconciliation of disk contents against the manifest. The editing command SHALL scan conventional **asset** directories to detect discrepancies between disk contents and the manifest. If the manifest is invalid, the editing command SHALL display errors and exit. If drift is detected, the editing command SHALL present a reconciliation phase before proceeding to editing.

The editing command SHALL display the facet's current privacy intent so the author can inspect it without opening the manifest file, and SHALL allow the author to change between public-by-default and private publish intent. When the author sets or leaves the facet as private, the written manifest SHALL contain `private: true`. When the author sets or leaves the facet as public-by-default, the written manifest SHALL omit the `private` field; if the manifest previously contained `private: true` or `private: false`, that field SHALL be removed rather than rewritten as `private: false`.

#### Scenario: Author edits facet identity fields

- **WHEN** the author runs the edit command on a facet project
- **THEN** the system SHALL display the current name, description, and version
- **AND** the author SHALL be able to change any of them
- **AND** if version is absent, the system SHALL default it to `0.0.0`

#### Scenario: Author inspects current privacy intent

- **WHEN** the author runs the edit command on a facet whose manifest declares `private: true`
- **THEN** the system SHALL display that the facet currently declares private publish intent

#### Scenario: Author inspects privacy intent on a public facet

- **WHEN** the author runs the edit command on a facet whose manifest omits `private` or declares `private: false`
- **THEN** the system SHALL display that the facet is currently public-by-default

#### Scenario: Author changes a public facet to private

- **WHEN** the author runs the edit command on a facet whose manifest omits `private`, sets it to private publish intent, and confirms
- **THEN** the written manifest SHALL contain `private: true`

#### Scenario: Author changes a private facet to public, omitting the field

- **WHEN** the author runs the edit command on a facet whose manifest declares `private: true`, sets it to public-by-default, and confirms
- **THEN** the written manifest SHALL NOT contain a `private` field
- **AND** the system SHALL NOT write `private: false`

#### Scenario: Editing an explicit private:false manifest to public removes the field

- **WHEN** the author runs the edit command on a facet whose manifest declares `private: false`, leaves it public-by-default, and confirms
- **THEN** the written manifest SHALL NOT contain a `private` field

#### Scenario: Author changes a facet identity to a different scope

- **WHEN** the author changes a facet's name from `@julian/cowsay` to `@acme/cowsay` during edit
- **THEN** the system SHALL treat the change as a normal local identity edit
- **AND** the system SHALL NOT warn specially about changing scopes

#### Scenario: Author creates a new skill from scratch

- **WHEN** the author uses the edit command to add a new skill named "code-review"
- **THEN** the system SHALL create `skills/code-review/SKILL.md` with a starter template
- **AND** the system SHALL add a skill descriptor to the manifest with the author-provided description

#### Scenario: Author creates a new agent from scratch

- **WHEN** the author uses the edit command to add a new agent named "reviewer"
- **THEN** the system SHALL create `agents/reviewer.md` with a starter template
- **AND** the system SHALL add an agent descriptor to the manifest with the author-provided description

#### Scenario: Author creates a new command from scratch

- **WHEN** the author uses the edit command to add a new command named "run-review"
- **THEN** the system SHALL create `commands/run-review.md` with a starter template
- **AND** the system SHALL add a command descriptor to the manifest with the author-provided description

#### Scenario: Author deletes an existing asset

- **WHEN** the author selects an existing asset for deletion during an edit session
- **THEN** the system SHALL remove the asset's entry from the manifest
- **AND** the system SHALL remove the asset's file (or directory, for skills) from disk

#### Scenario: Asset names are validated during edit

- **WHEN** the author enters an asset name during the edit session
- **THEN** the system SHALL validate the name as kebab-case
- **AND** the system SHALL reject names that are not unique within their asset type

### Requirement: Edit is transactional with confirmation

All changes during an edit session SHALL be queued — nothing SHALL be written to disk or manifest until the author explicitly confirms. Before confirmation, the system SHALL display a manifest preview showing identity fields (name, description, version), the privacy intent, and **asset** sections (name and truncated description per **asset**). The author SHALL be able to confirm ("Apply") or go back to editing. The author SHALL be able to exit at any point before confirmation with no changes applied.

#### Scenario: Author confirms changes

- **WHEN** the author reviews the confirmation summary and confirms
- **THEN** all queued changes SHALL be applied atomically to disk and manifest

#### Scenario: Author exits before confirmation

- **WHEN** the author exits the edit session before confirming
- **THEN** no files SHALL be created, modified, or deleted
- **AND** the manifest SHALL remain unchanged

#### Scenario: Confirmation summary shows the privacy intent

- **WHEN** the author reaches the edit confirmation summary
- **THEN** the summary SHALL show the facet's privacy intent alongside the identity fields

#### Scenario: Confirmation summary shows all deltas

- **WHEN** an edit session includes identity changes, a privacy change, two additions, one deletion, and one front matter strip
- **THEN** the confirmation summary SHALL list all changes with their details

## ADDED Requirements

### Requirement: Authoring workflows make a privacy change's rebuild and republish consequence visible

Because privacy intent is manifest content embedded in the built artifact, changing it in the create or edit workflows SHALL NOT, on its own, alter any already-built artifact or any already-published version. The authoring workflows SHALL make clear to the author that a privacy change takes effect only after a rebuild, and that propagating the change to a version that has already been published requires a version bump and a republish. The authoring workflows SHALL NOT automatically rebuild, republish, or contact the registry as a result of a privacy change.

#### Scenario: Editing privacy does not rebuild the artifact

- **WHEN** the author changes a facet's privacy intent in the edit workflow and confirms
- **THEN** the system SHALL update the manifest only
- **AND** the system SHALL NOT rebuild the facet
- **AND** the system SHALL NOT contact the registry

#### Scenario: Author is informed that a privacy change needs a rebuild

- **WHEN** the author changes a facet's privacy intent in the create or edit workflow
- **THEN** the system SHALL make clear that the change affects the built artifact only after the facet is rebuilt

#### Scenario: Author is informed that a published version needs a version bump

- **WHEN** the author changes the privacy intent of a facet whose current version may already be published
- **THEN** the system SHALL make clear that propagating the change to the registry requires a version bump and a republish, because a published version is immutable
