## MODIFIED Requirements

### Requirement: Valid facet manifests are accepted

The system SHALL accept a facet manifest that conforms to the manifest schema. A valid manifest has a name, a version, and at least one text asset (skills, agents, commands, or composed facets). The name SHALL be either an unscoped kebab-case facet identity (`name`) or a scoped facet identity (`@scope/name`). All three text asset types — skills, agents, and commands — use the same descriptor model: a map of asset name to a descriptor with a required description and optional platform metadata. Descriptors SHALL NOT contain prompt references — prompt content is inferred from the file-path convention. Skills use the Agent Skills directory convention `skills/<name>/SKILL.md`. Agents and commands use the flat file convention `agents/<name>.md` and `commands/<name>.md` respectively. All three descriptor types SHALL require a `description` field. Asset names SHALL remain local kebab-case identifiers and SHALL NOT be scoped facet identities.

#### Scenario: Minimal valid manifest with a skill

- **WHEN** an author provides a manifest with a name, version, and a single skill descriptor that includes a description
- **THEN** the system SHALL accept the manifest

#### Scenario: Valid manifest with a scoped facet identity

- **WHEN** an author provides a manifest whose `name` is `@julian/cowsay`, with a version and a single skill descriptor that includes a description
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with all sections

- **WHEN** an author provides a manifest with identity fields, skill descriptors with descriptions, agent descriptors with descriptions, command descriptors with descriptions, composed facets, and server references
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with only composed facets is valid

- **WHEN** an author provides a manifest with `name`, `version`, and a `facets` section but no local skills, agents, or commands
- **THEN** the system SHALL accept the manifest

### Requirement: Authors can scaffold a new facet project interactively

The system SHALL provide an interactive wizard that guides the author through creating a new facet project. The wizard SHALL collect the following required information:

- **Name**: A valid facet identity name. The name SHALL be either an unscoped kebab-case name (`name`) or a scoped name (`@scope/name`). The system SHALL validate the name in real-time and reject invalid input.
- **Description**: A non-empty description. The system SHALL NOT allow the author to complete the wizard without providing a description.

The wizard SHALL also collect optional information:

- **Version**: A valid SemVer version (N.N.N format). The system SHALL default to `0.0.0`. The author MAY accept the default or change it.

The wizard SHALL also allow the author to manage assets (skills, commands, and agents):

- The author SHALL be able to add multiple named assets of any type
- The author SHALL be able to edit the name of an existing asset
- The author SHALL be able to remove an existing asset
- All asset names SHALL be validated as kebab-case in real-time
- Asset names SHALL be unique within their type — the system SHALL reject duplicates within the same asset type
- Assets of different types MAY share the same name
- The first asset added to each type SHOULD default its name to the unscoped name segment of the facet identity as a suggestion

The wizard SHALL require the author to add at least one **asset** before completing. Name, description, and at least one **asset** are all required.

All fields SHALL remain editable throughout the wizard — the author SHALL be able to go back and change any previously entered value.

Before completing, the wizard SHALL display a confirmation summary showing only the asset types that have entries and a preview of the files to be created. The author SHALL be able to confirm or go back.

The wizard SHALL provide an exit confirmation mechanism that prevents accidental loss of unsaved work.

Upon confirmation, the system SHALL create a project directory containing a valid manifest and named starter files for each asset the author specified, with each starter file containing template content that guides authors on what belongs in each section. Skill starter files SHALL be created at `skills/<name>/SKILL.md`. Agent and command starter files SHALL be created at `agents/<name>.md` and `commands/<name>.md` respectively. All starter files SHALL contain no YAML front matter.

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

#### Scenario: Target directory already contains a manifest

- **WHEN** the author runs the create wizard and a manifest already exists in the target directory
- **THEN** the system SHALL warn the author and ask for confirmation before overwriting

### Requirement: Authors can build a facet locally for validation and inspection

The system SHALL compile a facet project into a build output directory. The build command SHALL read the manifest, validate it, verify that every declared asset file exists, is non-empty, and contains no YAML front matter, resolve all file-based prompts to their content, run all validation checks, assemble the resolved output into a deterministic compressed archive, compute content hashes, and write the archive and build manifest to a `dist/` directory. The build command SHALL NOT modify the manifest or any content files. The build command SHALL NOT be interactive — it SHALL behave identically in all environments.

The build output SHALL contain a compressed archive (`.facet` file) with the manifest and all text asset files with prompts resolved to their final string content, and a build manifest (`build-manifest.json`) recording content hashes. For a scoped facet identity, whose name renders as a nested path under `dist/`, the system SHALL create any required parent directories under `dist/` before writing the built archive. The build-output write boundary SHALL create parent directories for any slash-containing archive path, so the same fix also repairs the pre-existing failure for any nested archive filename.

The build command SHALL render its progress as a step-by-step display, showing each pipeline stage as it completes — including the archive assembly stage. On success, the system SHALL display the archive contents listing and the archive content hash. On failure, the system SHALL indicate which stage failed and display errors with their field paths, and SHALL suggest running the editing command to fix the issues. After the display exits, the system SHALL print a brief plain-text summary to stdout — including the content hash — so it persists in terminal scroll-back.

#### Scenario: Successful build of a valid facet

- **WHEN** the author runs the build command in a directory with a valid manifest, all referenced files exist, and no files contain front matter
- **THEN** the system SHALL write a compressed archive and build manifest to `dist/`
- **AND** the archive SHALL contain the facet manifest and all text asset files with prompts resolved to their string content
- **AND** the build manifest SHALL contain the archive content hash and per-asset content hashes
- **AND** the system SHALL display the archive contents and content hash
- **AND** the system SHALL print a brief success summary to stdout including the content hash

#### Scenario: Successful build of a scoped facet identity

- **WHEN** the author runs the build command for a valid facet whose name is `@julian/cowsay`
- **THEN** the system SHALL write the built archive under `dist/` without failing on the scoped name separator
- **AND** the archive SHALL contain `facet.json` at the archive root with `name` set to `@julian/cowsay`
- **AND** the archive's internal asset paths SHALL continue to be derived from asset names, not from the facet identity

#### Scenario: Build-output write boundary creates parent directories for a nested archive path

- **WHEN** the build-output write boundary writes an archive whose filename renders as a nested path under `dist/` (for example a scoped `@scope/name` identity, or any other slash-containing archive filename)
- **THEN** the system SHALL create the required parent directories under `dist/` before writing the archive
- **AND** the write SHALL NOT fail with a missing-directory error

#### Scenario: Build fails on invalid manifest

- **WHEN** the author runs the build command and the manifest fails schema validation
- **THEN** the system SHALL report the validation errors with field paths
- **AND** the system SHALL suggest running the editing command to fix the issues
- **AND** the system SHALL NOT write any output to `dist/`

#### Scenario: Build fails on missing asset file

- **WHEN** the author runs the build command and any asset references a file that does not exist
- **THEN** the system SHALL report which file is missing and which asset references it
- **AND** the system SHALL suggest running the editing command to fix the issues
- **AND** the system SHALL NOT write any output to `dist/`

#### Scenario: Build fails on file containing front matter

- **WHEN** the author runs the build command and a content file contains YAML front matter
- **THEN** the system SHALL report which file contains front matter
- **AND** the system SHALL suggest running the editing command to strip it
- **AND** the system SHALL NOT write any output to `dist/`

#### Scenario: Build fails on empty content file

- **WHEN** the author runs the build command and a content file referenced by the manifest is empty (zero bytes or only whitespace)
- **THEN** the system SHALL report which file is empty and which asset references it
- **AND** the system SHALL suggest running the editing command to add content
- **AND** the system SHALL NOT write any output to `dist/`

#### Scenario: Build with no manifest

- **WHEN** the author runs the build command in a directory with no manifest
- **THEN** the system SHALL report that no manifest was found

#### Scenario: Build cleans previous output

- **WHEN** the author runs the build command and a `dist/` directory already exists from a previous build
- **THEN** the system SHALL remove the previous `dist/` directory before writing new output

### Requirement: Authors can edit a facet project interactively

The system SHALL provide an interactive editing command that serves as the full authoring workbench for facet manifests. The editing command SHALL combine all capabilities of the scaffolding wizard (identity editing, asset creation, asset removal) with automatic reconciliation of disk contents against the manifest. The editing command SHALL scan conventional **asset** directories to detect discrepancies between disk contents and the manifest. If the manifest is invalid, the editing command SHALL display errors and exit. If drift is detected, the editing command SHALL present a reconciliation phase before proceeding to editing.

#### Scenario: Author edits facet identity fields

- **WHEN** the author runs the edit command on a facet project
- **THEN** the system SHALL display the current name, description, and version
- **AND** the author SHALL be able to change any of them
- **AND** if version is absent, the system SHALL default it to `0.0.0`

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
