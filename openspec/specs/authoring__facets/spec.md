## Purpose

A facet author writes a facet manifest to declare their facet's identity, text assets, composed facets, and server references. The system validates and loads this manifest so authors get fast, clear feedback when something is wrong, and downstream tools get a reliable typed representation of the manifest.

## Requirements

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

### Requirement: Invalid facet manifests are rejected with actionable errors

The system SHALL reject a facet manifest that does not conform to the manifest schema. Each error SHALL identify the location of the problem (field path) and describe what was expected, so the author can fix it without guessing.

#### Scenario: Missing required identity field

- **WHEN** an author provides a manifest without a `name` or `version` field
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify which required field is missing

#### Scenario: No text assets

- **WHEN** an author provides a manifest with identity fields and server references but no skills, agents, commands, or composed facets
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL indicate that at least one text asset is required

#### Scenario: Agent missing its description

- **WHEN** an author defines an agent without a `description` field
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the agent by name and the missing field

#### Scenario: Selective facets entry with no asset selection

- **WHEN** an author writes a selective facets entry with `name` and `version` but no `skills`, `agents`, or `commands`
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL indicate that at least one asset type must be selected

#### Scenario: Server reference object without image field

- **WHEN** an author writes a server reference as an object but omits the `image` field
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the server by name

### Requirement: Unrecognized fields are tolerated

The system SHALL accept manifests containing fields not defined in the current schema. Unrecognized fields SHALL be preserved, not stripped or rejected. This ensures manifests authored against a newer schema version remain loadable by older tooling.

#### Scenario: Top-level unknown field

- **WHEN** an author includes a field not defined in the schema (e.g., `license: "MIT"`)
- **THEN** the system SHALL accept the manifest
- **AND** the field SHALL be present in the loaded result

#### Scenario: Unknown field nested in a descriptor

- **WHEN** an agent descriptor includes a field not defined in the schema
- **THEN** the system SHALL accept the manifest
- **AND** the field SHALL be present in the loaded result

### Requirement: Facet manifests are loaded from disk

The system SHALL load a facet manifest by reading the facet manifest file from a specified directory. JSON syntax errors and schema validation errors SHALL both be reported through a unified error interface so callers handle one error shape regardless of failure stage.

#### Scenario: Successful load

- **WHEN** a valid facet manifest exists in the specified directory
- **THEN** the system SHALL return the validated manifest data

#### Scenario: File not found

- **WHEN** no facet manifest exists in the specified directory
- **THEN** the system SHALL return an error indicating the file was not found

#### Scenario: Malformed JSON

- **WHEN** the facet manifest contains invalid JSON syntax
- **THEN** the system SHALL return an error indicating a syntax problem

### Requirement: Prompt content is resolved from conventional file paths

After validation, the system SHALL resolve prompt content for all skills, agents, and commands by reading files at conventional paths relative to the facet root directory. Skills use the Agent Skills directory convention — a skill named "code-review" resolves to `skills/code-review/SKILL.md`. Agents and commands use the flat file convention — an agent named "reviewer" resolves to `agents/reviewer.md`, a command named "run-review" resolves to `commands/run-review.md`. Content files SHALL contain pure markdown with no YAML front matter. Resolution failures SHALL identify which asset failed and the expected file path.

#### Scenario: Skill prompt file exists at conventional path

- **WHEN** a skill named "code-review" is declared in the manifest and `skills/code-review/SKILL.md` exists
- **THEN** the system SHALL resolve the skill's prompt to the file's content

#### Scenario: Skill prompt file missing at conventional path

- **WHEN** a skill named "code-review" is declared in the manifest and `skills/code-review/SKILL.md` does not exist
- **THEN** the system SHALL return an error identifying the skill and the expected file path `skills/code-review/SKILL.md`

#### Scenario: Agent and command prompt files at conventional paths

- **WHEN** the manifest declares an agent "reviewer" and a command "run-review"
- **THEN** the system SHALL resolve prompts from `agents/reviewer.md` and `commands/run-review.md` respectively

#### Scenario: Convention applies to all asset types

- **WHEN** the manifest declares a skill "review", an agent "reviewer", and a command "run-review"
- **THEN** the system SHALL resolve prompts from `skills/review/SKILL.md`, `agents/reviewer.md`, and `commands/run-review.md` respectively

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

### Requirement: Build detects naming collisions between local assets

The system SHALL detect when the same name is used by multiple assets within the same asset type. Skills SHALL have unique names within the skills section, agents SHALL have unique names within the agents section, and commands SHALL have unique names within the commands section. Assets of different types MAY share the same name — cross-type collisions SHALL NOT be treated as errors. Intra-type collisions SHALL cause the build to fail with an error identifying the conflicting names and their asset type.

#### Scenario: Two skills share a name

- **WHEN** a facet declares two skills with the same name
- **THEN** the build SHALL fail
- **AND** the error SHALL identify the collision within the skills section

#### Scenario: Skill and command share a name

- **WHEN** a facet declares a skill and a command with the same name
- **THEN** the build SHALL succeed with no collision errors

#### Scenario: Skill and agent share a name

- **WHEN** a facet declares a skill and an agent with the same name
- **THEN** the build SHALL succeed with no collision errors

#### Scenario: No collisions across distinct names within each type

- **WHEN** a facet declares assets with distinct names within each asset type
- **THEN** the build SHALL succeed with no collision errors

### Requirement: Build validates platform configuration for assets

The system SHALL validate `platforms` entries on any asset that declares them during build. The set of known platforms and their expected configuration is maintained by the system. Invalid configuration for a known platform SHALL cause the build to fail. Unknown platform names SHALL produce a warning but SHALL NOT cause the build to fail.

#### Scenario: Valid platform config for a known platform

- **WHEN** an asset declares platform configuration for a known platform with valid configuration
- **THEN** the build SHALL accept the platform configuration

#### Scenario: Invalid platform config for a known platform

- **WHEN** an asset declares platform configuration for a known platform with configuration that violates the expected shape
- **THEN** the build SHALL fail
- **AND** the error SHALL identify the asset, the platform, and what is invalid

#### Scenario: Unknown platform name produces a warning

- **WHEN** an asset declares platform configuration for an unknown platform
- **THEN** the build SHALL succeed
- **AND** the system SHALL emit a warning that the platform is not known

### Requirement: Build validates the facets section structurally without resolving composition

The system SHALL validate the `facets` section of the manifest for structural correctness during build. Compact entries SHALL conform to the expected name-and-version format. Selective entries SHALL include at least one asset type. The system SHALL NOT attempt to resolve or fetch composed facets during build — composition resolution is deferred to a future phase.

#### Scenario: Valid compact facets entry

- **WHEN** the manifest includes a compact facets entry with a name and version
- **THEN** the build SHALL accept the entry

#### Scenario: Malformed compact facets entry

- **WHEN** the manifest includes a compact facets entry that does not conform to the expected format
- **THEN** the build SHALL fail
- **AND** the error SHALL indicate the expected format

#### Scenario: Facets section is not resolved during build

- **WHEN** the manifest includes facets entries referencing other facets
- **THEN** the build SHALL validate the entries structurally
- **AND** the build SHALL NOT attempt to fetch or include composed files in the output

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

### Requirement: Edit detects new files on disk and offers to add them

The system SHALL scan conventional **asset** directories during edit and detect content files that are not declared in the manifest. Undeclared files SHALL be presented in an all-at-once list with inline action options per item. All items SHALL be resolved before proceeding to editing. For each file the author selects, a description SHALL be required before the addition is accepted. Files the author does not select SHALL remain on disk but SHALL NOT be added to the manifest.

#### Scenario: New skill directory discovered

- **WHEN** the author runs edit and `skills/code-review/SKILL.md` exists on disk but is not in the manifest
- **THEN** the system SHALL present "code-review" as an available skill to add
- **AND** the author SHALL be able to select or skip it

#### Scenario: New agent file discovered

- **WHEN** the author runs edit and `agents/reviewer.md` exists on disk but is not in the manifest
- **THEN** the system SHALL present "reviewer" as an available agent to add
- **AND** the author SHALL be able to select or skip it

#### Scenario: New command file discovered

- **WHEN** the author runs edit and `commands/start-review.md` exists on disk but is not in the manifest
- **THEN** the system SHALL present "start-review" as an available command to add
- **AND** the author SHALL be able to select or skip it

#### Scenario: Multiple new files discovered

- **WHEN** the author runs edit and three new files exist across skills, agents, and commands
- **THEN** the system SHALL present all three as a batch selection list
- **AND** the author SHALL be able to select any combination

#### Scenario: Description is required for each addition

- **WHEN** the author selects a file to add to the manifest
- **THEN** the system SHALL require the author to provide a description before accepting the addition

#### Scenario: Unselected files remain on disk

- **WHEN** the author skips a discovered file during reconciliation
- **THEN** the file SHALL remain on disk unchanged
- **AND** the file SHALL NOT appear in the manifest

#### Scenario: Empty files are selectable

- **WHEN** a discovered file is empty or empty after stripping front matter
- **THEN** the system SHALL present the file as selectable like any other file
- **AND** the author SHALL be able to add it to the manifest

### Requirement: Edit detects missing files and offers scaffold-or-remove

The system SHALL detect manifest entries whose corresponding files no longer exist on disk. For each missing file, the author SHALL be offered two choices: remove the entry from the manifest, or scaffold a new starter template file to restore it.

#### Scenario: Missing skill file with removal chosen

- **WHEN** the manifest declares a skill "code-review" but `skills/code-review/SKILL.md` does not exist
- **AND** the author chooses to remove the entry
- **THEN** the system SHALL remove the skill descriptor from the manifest

#### Scenario: Missing skill file with scaffold chosen

- **WHEN** the manifest declares a skill "code-review" but `skills/code-review/SKILL.md` does not exist
- **AND** the author chooses to scaffold a replacement
- **THEN** the system SHALL create `skills/code-review/SKILL.md` with a starter template
- **AND** the manifest entry SHALL be preserved

#### Scenario: Missing agent file with removal chosen

- **WHEN** the manifest declares an agent "reviewer" but `agents/reviewer.md` does not exist
- **AND** the author chooses to remove the entry
- **THEN** the system SHALL remove the agent descriptor from the manifest

### Requirement: Edit parses front matter for defaults and strips it

The system SHALL parse YAML front matter from any file encountered during edit — whether newly discovered or already in the manifest. If front matter contains a `name` field, the name field SHALL be pre-filled with the front matter value. If front matter contains a `description` field, the description field SHALL be pre-filled with the front matter value. If no front matter `name` is present, the filename (or directory name for skills) SHALL be the default. The author SHALL confirm or edit each field — every asset coming out of edit SHALL have an author-confirmed name and description. The final confirmed name SHALL determine the filename on disk. Front matter fields beyond `name` and `description` SHALL be surfaced to the author with their values. The author SHALL choose to either convert them to platform configuration or drop them. If converting, the author SHALL select a platform from the list of known platforms or provide a custom platform name. Custom platform names SHALL be validated as kebab-case. The fields SHALL be placed under that platform key in the manifest as-is. If dropping, the fields SHALL be discarded. Front matter SHALL always be stripped from the file content on confirmation.

#### Scenario: Front matter name pre-fills the name field

- **WHEN** a file at `skills/skill/SKILL.md` contains front matter with `name: typescript-best-practices`
- **THEN** the system SHALL pre-fill the name field with "typescript-best-practices"
- **AND** the author SHALL confirm or edit the name
- **AND** the final confirmed name SHALL determine the directory name on disk

#### Scenario: No front matter name defaults to filename

- **WHEN** a file at `skills/code-review/SKILL.md` contains no `name` field in front matter
- **THEN** the system SHALL pre-fill the name field with "code-review" (from the directory name)
- **AND** the author SHALL confirm or edit the name

#### Scenario: Front matter description pre-fills the description field

- **WHEN** a discovered file contains front matter with `description: A collection of TypeScript best practices`
- **THEN** the system SHALL pre-fill the description field with that value
- **AND** the author SHALL confirm or edit the description

#### Scenario: Extra front matter fields are surfaced to the author

- **WHEN** a file contains front matter with fields beyond `name` and `description` (e.g., `allowed-tools`, `compatibility`)
- **THEN** the system SHALL display the extra fields and their values to the author
- **AND** the system SHALL offer two choices: convert to platform configuration or drop

#### Scenario: Extra front matter fields converted to platform config with known platform

- **WHEN** the author chooses to convert extra front matter fields to platform configuration
- **AND** the author selects a known platform from the list (e.g., "opencode")
- **THEN** the system SHALL place the extra fields under the selected platform key in the manifest

#### Scenario: Extra front matter fields converted to platform config with custom platform

- **WHEN** the author chooses to convert extra front matter fields to platform configuration
- **AND** the author types a custom platform name (e.g., "cursor")
- **THEN** the system SHALL validate the custom platform name as kebab-case
- **AND** the system SHALL place the extra fields under the custom platform key in the manifest

#### Scenario: Custom platform name is validated as kebab-case

- **WHEN** the author types a custom platform name that is not valid kebab-case (e.g., "My Platform" or "CURSOR")
- **THEN** the system SHALL reject the name
- **AND** the system SHALL indicate the name must be kebab-case

#### Scenario: Extra front matter fields dropped

- **WHEN** the author chooses to drop the extra front matter fields
- **THEN** the extra fields SHALL be discarded

#### Scenario: Front matter is stripped from file content

- **WHEN** the author confirms an addition of a file that contained front matter
- **THEN** the persisted file SHALL contain only the markdown body with no YAML front matter

#### Scenario: Malformed front matter is treated as absent

- **WHEN** a file contains text that looks like YAML front matter but fails to parse
- **THEN** the system SHALL treat the file as having no front matter
- **AND** the file SHALL be processed normally

#### Scenario: Existing manifest file with front matter

- **WHEN** a file already in the manifest contains YAML front matter
- **THEN** the system SHALL surface the front matter values during edit
- **AND** front matter SHALL be stripped on confirmation

### Requirement: Edit is transactional with confirmation

All changes during an edit session SHALL be queued — nothing SHALL be written to disk or manifest until the author explicitly confirms. Before confirmation, the system SHALL display a manifest preview showing identity fields (name, description, version) and **asset** sections (name and truncated description per **asset**). The author SHALL be able to confirm ("Apply") or go back to editing. The author SHALL be able to exit at any point before confirmation with no changes applied.

#### Scenario: Author confirms changes

- **WHEN** the author reviews the confirmation summary and confirms
- **THEN** all queued changes SHALL be applied atomically to disk and manifest

#### Scenario: Author exits before confirmation

- **WHEN** the author exits the edit session before confirming
- **THEN** no files SHALL be created, modified, or deleted
- **AND** the manifest SHALL remain unchanged

#### Scenario: Confirmation summary shows all deltas

- **WHEN** an edit session includes identity changes, two additions, one deletion, and one front matter strip
- **THEN** the confirmation summary SHALL list all five changes with their details

### Requirement: Content files contain no front matter

The manifest SHALL be the single source of truth for asset metadata (name, description, platform configuration). Content files on disk and in the archive SHALL contain pure markdown with zero YAML front matter. The scaffolding command, the editing command, and the build command SHALL all enforce this invariant. Front matter is parsed from incoming files to extract defaults, then stripped. At install time, platform-specific front matter SHALL be reconstructed from the manifest.

#### Scenario: Scaffolded files have no front matter

- **WHEN** the scaffolding or editing command creates a new starter template file
- **THEN** the file SHALL contain only markdown content with no YAML front matter

#### Scenario: Build rejects files with front matter

- **WHEN** the build command encounters a content file containing YAML front matter
- **THEN** the build SHALL fail with an error identifying the file and indicating that front matter must be removed

#### Scenario: Archive contains clean files

- **WHEN** a facet is built into an archive
- **THEN** all content files in the archive SHALL contain pure markdown with no YAML front matter
