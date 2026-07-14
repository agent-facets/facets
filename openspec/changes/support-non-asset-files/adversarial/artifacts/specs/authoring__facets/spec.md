## MODIFIED Requirements

### Requirement: Authors can build a facet locally for validation and inspection

The system SHALL compile a facet project into a build output directory. The build command SHALL read the manifest, validate it, verify that every declared asset file exists, is non-empty, and contains no YAML front matter, verify that every declared supplementary file (top-level and per-skill) exists and satisfies the supplementary path rules, resolve all file-based prompts to their content, run all validation checks, assemble the resolved output and declared supplementary files into a deterministic compressed archive, compute content hashes for every archive entry, and write the archive and build manifest to a `dist/` directory. All source-input validation — including missing declared supplementary files — SHALL complete before any previous `dist/` output is removed, so that a build failure never destroys prior output before its cause is reported. The build command SHALL NOT modify the manifest or any content files. The build command SHALL NOT be interactive — it SHALL behave identically in all environments.

The build output SHALL contain a compressed archive (`.facet` file) with the manifest, all text asset files with prompts resolved to their final string content, and all declared supplementary files with their bytes preserved verbatim, and a build manifest (`build-manifest.json`) recording the archive format version and per-entry content hashes. For a scoped facet identity, whose name renders as a nested path under `dist/`, the system SHALL create any required parent directories under `dist/` before writing the built archive. The build-output write boundary SHALL create parent directories for any slash-containing archive path, so the same fix also repairs the pre-existing failure for any nested archive filename.

The build command SHALL render its progress as a step-by-step display, showing each pipeline stage as it completes — including the archive assembly stage. On success, the system SHALL display the archive contents listing (including supplementary files), the emitted archive format version, and the archive content hash. On failure, the system SHALL indicate which stage failed and display errors with their field paths, and SHALL suggest running the editing command to fix the issues. After the display exits, the system SHALL print a brief plain-text summary to stdout — including the content hash — so it persists in terminal scroll-back.

#### Scenario: Successful build of a valid facet

- **WHEN** the author runs the build command in a directory with a valid manifest, all referenced files exist, and no asset files contain front matter
- **THEN** the system SHALL write a compressed archive and build manifest to `dist/`
- **AND** the archive SHALL contain the facet manifest, all text asset files with prompts resolved to their string content, and all declared supplementary files verbatim
- **AND** the build manifest SHALL contain the archive content hash and per-entry content hashes
- **AND** the system SHALL display the archive contents, the emitted archive format version, and content hash
- **AND** the system SHALL print a brief success summary to stdout including the content hash

#### Scenario: Successful build of a facet with supplementary files

- **WHEN** the author builds a facet declaring a top-level `README.md` and a skill companion `references/api.md`
- **THEN** the archive SHALL contain `README.md` at the archive root and the companion beneath the owning skill's directory
- **AND** the archive contents listing SHALL include both supplementary files

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

#### Scenario: Build fails on missing declared supplementary file before cleaning previous output

- **WHEN** the author runs the build command and a declared supplementary file does not exist on disk
- **AND** a `dist/` directory exists from a previous build
- **THEN** the system SHALL fail with a structured error identifying the missing declared path and its declaration site
- **AND** the previous `dist/` contents SHALL remain untouched

#### Scenario: Build fails on asset file containing front matter

- **WHEN** the author runs the build command and an asset content file contains YAML front matter
- **THEN** the system SHALL report which file contains front matter
- **AND** the system SHALL suggest running the editing command to strip it
- **AND** the system SHALL NOT write any output to `dist/`

#### Scenario: Build fails on empty asset content file

- **WHEN** the author runs the build command and an asset content file referenced by the manifest is empty (zero bytes or only whitespace)
- **THEN** the system SHALL report which file is empty and which asset references it
- **AND** the system SHALL suggest running the editing command to add content
- **AND** the system SHALL NOT write any output to `dist/`

#### Scenario: Build with no manifest

- **WHEN** the author runs the build command in a directory with no manifest
- **THEN** the system SHALL report that no manifest was found

#### Scenario: Build cleans previous output

- **WHEN** the author runs the build command with valid inputs and a `dist/` directory already exists from a previous build
- **THEN** the system SHALL remove the previous `dist/` contents before writing the new output
- **AND** the removal SHALL occur only after all source-input validation has passed

### Requirement: Build detects naming collisions between local assets

The system SHALL detect asset naming collisions during build. Skills SHALL have unique names within the skills section, agents SHALL have unique names within the agents section, and commands SHALL have unique names within the commands section. In addition, skills and commands SHALL share one logical namespace: a facet declaring a skill and a command with the same name SHALL fail the build with a structured error identifying both colliding declarations. Agents SHALL remain a separate namespace: an agent MAY share a name with a skill or a command. Collisions SHALL cause the build to fail with an error identifying the conflicting names and their asset types.

#### Scenario: Two skills share a name

- **WHEN** a facet declares two skills with the same name
- **THEN** the build SHALL fail
- **AND** the error SHALL identify the collision within the skills section

#### Scenario: Skill and command share a name

- **WHEN** a facet declares a skill and a command with the same name
- **THEN** the build SHALL fail
- **AND** the error SHALL identify both the skill declaration and the command declaration

#### Scenario: Skill and agent share a name

- **WHEN** a facet declares a skill and an agent with the same name
- **THEN** the build SHALL succeed with no collision errors

#### Scenario: Command and agent share a name

- **WHEN** a facet declares a command and an agent with the same name
- **THEN** the build SHALL succeed with no collision errors

#### Scenario: No collisions across distinct names

- **WHEN** a facet declares assets with distinct names within each asset type and no skill/command overlap
- **THEN** the build SHALL succeed with no collision errors

### Requirement: Authors can scaffold a new facet project interactively

The system SHALL provide an interactive wizard that guides the author through creating a new facet project. The wizard SHALL collect the following required information:

- **Name**: A valid facet identity name. The name SHALL be either an unscoped kebab-case name (`name`) or a scoped name (`@scope/name`). The system SHALL validate the name in real-time and reject invalid input.
- **Description**: A non-empty description. The system SHALL NOT allow the author to complete the wizard without providing a description.

The wizard SHALL also collect optional information:

- **Version**: A valid SemVer version (N.N.N format). The system SHALL default to `0.0.0`. The author MAY accept the default or change it.
- **Privacy**: A choice of whether the new facet declares private publish intent. The system SHALL default to public visibility intent. The author MAY accept the public default or choose private.
- **README**: A dedicated README step, enabled by default, whose behavior is defined by the first-class README authoring requirement.

The wizard SHALL also allow the author to manage assets (skills, commands, and agents):

- The author SHALL be able to add multiple named assets of any type
- The author SHALL be able to edit the name of an existing asset
- The author SHALL be able to remove an existing asset
- All asset names SHALL be validated in real-time against the single-segment asset-name convention
- Asset names SHALL be unique within their type — the system SHALL reject duplicates within the same asset type
- Skills and commands SHALL share one logical namespace — the system SHALL reject a skill and a command with the same name
- Agents MAY share a name with a skill or a command
- The first asset added to each type SHOULD default its name to the unscoped name segment of the facet identity as a suggestion

The wizard SHALL require the author to add at least one **asset** before completing. Name, description, and at least one **asset** are all required.

All fields SHALL remain editable throughout the wizard — the author SHALL be able to go back and change any previously entered value, including privacy and the README choice.

Before completing, the wizard SHALL display a confirmation summary showing only the asset types that have entries, the selected privacy intent, and a preview of the files to be created — including `README.md` when README creation is enabled. The author SHALL be able to confirm or go back.

The wizard SHALL provide an exit confirmation mechanism that prevents accidental loss of unsaved work.

Upon confirmation, the system SHALL create a project directory containing a valid manifest and named starter files for each asset the author specified, with each starter file containing template content that guides authors on what belongs in each section. Skill starter files SHALL be created at `skills/<name>/SKILL.md`. Agent and command starter files SHALL be created at `agents/<name>.md` and `commands/<name>.md` respectively. All starter files SHALL contain no YAML front matter.

When the author selects private visibility intent, the generated manifest SHALL contain `private: true`. When the author accepts public visibility intent, the generated manifest SHALL omit `private`.

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

#### Scenario: Asset names are validated in real time

- **WHEN** the author enters an asset name containing uppercase letters, spaces, underscores, slashes, or an at sign
- **THEN** the system SHALL indicate the name is invalid
- **AND** the system SHALL NOT accept the invalid name

#### Scenario: Duplicate asset names within a type are rejected

- **WHEN** the author attempts to add a skill with the same name as an existing skill
- **THEN** the system SHALL reject the duplicate name

#### Scenario: Skill and command with the same name are rejected

- **WHEN** the author attempts to add a command with the same name as an existing skill, or a skill with the same name as an existing command
- **THEN** the system SHALL reject the duplicate name
- **AND** the system SHALL indicate that skills and commands share one namespace

#### Scenario: An agent may share a name with a skill

- **WHEN** the author adds a skill named "viper-plans" and an agent named "viper-plans"
- **THEN** the system SHALL accept both assets without error

#### Scenario: Author edits an existing asset name

- **WHEN** the author selects an existing asset and changes its name to a valid, unique name
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

#### Scenario: New facet defaults to public visibility intent

- **WHEN** an author creates a facet interactively and accepts the default privacy choice
- **THEN** the generated manifest SHALL omit `private`
- **AND** the confirmation summary SHALL show the facet as public

#### Scenario: New private facet writes private true

- **WHEN** an author creates a facet interactively and selects private visibility intent
- **THEN** the generated manifest SHALL contain `private: true`
- **AND** the confirmation summary SHALL show the facet as private

#### Scenario: Author selects private then reverts to public before completing

- **WHEN** an author creates a facet interactively, selects private visibility intent, and then changes the privacy choice back to public before completing the wizard
- **THEN** the generated manifest SHALL omit `private`
- **AND** the confirmation summary SHALL show the facet as public

#### Scenario: Target directory already contains a manifest

- **WHEN** the author runs the create wizard and a manifest already exists in the target directory
- **THEN** the system SHALL warn the author and ask for confirmation before overwriting

## ADDED Requirements

### Requirement: Facets declare supplementary files explicitly

An author SHALL be able to declare non-asset files that ship in the built facet: a top-level list of exact repo-relative paths for archive-only files (for example `README.md`, `LICENSE`, `DEVELOPMENT.md`), and a per-skill list of exact paths (relative to the skill's directory) for companion files that belong to that skill. Declarations SHALL enumerate exact paths; the system SHALL NOT recursively auto-discover or auto-package undeclared files. Only declared files SHALL be included in the built archive.

#### Scenario: A declared root file ships with the facet

- **WHEN** an author declares `README.md` in the top-level supplementary-file list and the file exists
- **THEN** the built archive SHALL include `README.md`
- **AND** its hash SHALL be recorded in the build manifest

#### Scenario: A declared skill companion ships beneath its skill

- **WHEN** an author declares `references/art.md` in skill `cowsay`'s file list and the file exists at the corresponding path in the skill's directory
- **THEN** the built archive SHALL include the companion beneath the skill's directory
- **AND** the companion SHALL be associated with skill `cowsay`, not with any other skill

#### Scenario: Undeclared files in the source tree are not packaged

- **WHEN** the facet source tree contains a file that is neither a conventional asset file nor declared in any supplementary-file list
- **THEN** the build SHALL NOT include that file in the archive
- **AND** the build SHALL NOT warn or fail solely because the undeclared file exists

### Requirement: Build validates supplementary file declarations

The system SHALL validate every supplementary-file declaration during build and fail with a structured error for each violation. Validation SHALL reject:

- a declared path that is empty, absolute, contains `.` or `..` segments, backslashes, NUL bytes, or a drive or URL-like prefix;
- a declared path that does not resolve, through existing parent directories, to a regular file inside the facet root — symlinks and hard links SHALL be rejected by resolved identity, not just by spelling;
- the exact root path `facet.json` (the embedded manifest's own path); the basename `facet.json` MAY appear at any other declared path;
- a top-level declaration that resolves under `skills/`;
- a per-skill declaration naming the skill's primary file or resolving outside its skill's directory;
- a per-skill declaration on a skill that is not declared in the manifest;
- a declaration colliding with a conventional primary asset path;
- two declarations that collide by exact spelling, canonical Unicode form, portable case folding, resolved source identity, or file/directory prefix conflict (a path declared as both a file and a parent of another entry).

Each violation SHALL identify the declared path and the declaration site so the author can correct it without guessing.

#### Scenario: A traversal path is rejected

- **WHEN** an author declares a supplementary path containing `..` (for example `../secrets.txt`)
- **THEN** the build SHALL fail with a structured error identifying the unsafe path

#### Scenario: A symlinked supplementary file is rejected

- **WHEN** a declared supplementary path resolves to a symbolic link, or to a file outside the facet root through a symlinked parent
- **THEN** the build SHALL fail with a structured error identifying the path and the reason

#### Scenario: A top-level declaration under skills/ is rejected

- **WHEN** an author declares `skills/cowsay/notes.md` in the top-level supplementary-file list
- **THEN** the build SHALL fail with an error directing the author to declare the file on the owning skill instead

#### Scenario: A declaration colliding with an asset path is rejected

- **WHEN** an author declares a top-level supplementary file at a path that equals a conventional asset path derived from the manifest (for example `agents/reviewer.md` while agent `reviewer` is declared)
- **THEN** the build SHALL fail with a structured error identifying the collision

#### Scenario: Case-folded or Unicode-aliased declarations are rejected

- **WHEN** two declarations differ only by letter case or by Unicode normalization form
- **THEN** the build SHALL fail with a structured error identifying both colliding declarations

#### Scenario: The root manifest path cannot be declared

- **WHEN** an author declares the exact path `facet.json` as a top-level supplementary file
- **THEN** the build SHALL fail with a structured error
- **AND** a declaration of `facet.json` at a non-root path (for example inside a skill's examples directory) SHALL remain valid

### Requirement: Asset names are validated against the single-segment convention during authoring

The scaffolding, editing, and build workflows SHALL validate every skill, command, and agent name against the published single-segment asset-name convention (lowercase ASCII letters, digits, and hyphens; 1–64 characters; no leading, trailing, or consecutive hyphens; no slashes). A source manifest using a slash-containing or otherwise nonconforming asset name SHALL fail the build with a structured error naming the asset and the violated rule, before any output is written. Previously published legacy archives remain consumable; only rebuilding requires renaming.

#### Scenario: A slash-namespaced asset name fails the build actionably

- **WHEN** an author builds a facet whose manifest declares a skill named `tools/review`
- **THEN** the build SHALL fail before writing any output
- **AND** the error SHALL identify the asset name and state that current-format asset names are single segments

#### Scenario: The wizards reject nonconforming asset names in real time

- **WHEN** an author enters an asset name containing a slash, uppercase letter, or consecutive hyphens in the create or edit wizard
- **THEN** the system SHALL indicate the name is invalid
- **AND** the system SHALL NOT accept the invalid name

#### Scenario: The wizards reject a skill/command name collision

- **WHEN** an author attempts to add a command whose name equals an existing skill's name (or vice versa) in the create or edit wizard
- **THEN** the system SHALL reject the duplicate name
- **AND** the system SHALL indicate that skills and commands share one namespace

### Requirement: Create offers first-class README authoring

The interactive scaffolding wizard SHALL include a dedicated README step, separate from asset management. README creation SHALL be enabled by default and SHALL be optional: the author MAY disable it. The wizard SHALL seed editable `README.md` content from the facet name and description and SHALL allow the author to open and edit that content before confirmation. The confirmation summary SHALL list `README.md` explicitly when enabled. Upon confirmation with README enabled, the system SHALL write `README.md` and add its exact path to the top-level supplementary-file declaration in the same atomic apply as the rest of the scaffold. The generated content is an initial value only: subsequent identity edits SHALL NOT regenerate or overwrite authored README content. The scaffolded project SHALL remain immediately buildable.

#### Scenario: Default scaffold includes a README

- **WHEN** an author completes the create wizard without changing the README choice
- **THEN** the created project SHALL contain `README.md` seeded from the facet name and description
- **AND** the manifest SHALL declare `README.md` as a top-level supplementary file
- **AND** running build on the fresh project SHALL succeed

#### Scenario: Author edits the seeded README before confirming

- **WHEN** an author opens the README step and edits the seeded content before confirming the wizard
- **THEN** the created `README.md` SHALL contain the author's edited content

#### Scenario: Author disables README creation

- **WHEN** an author disables the README step and completes the wizard
- **THEN** the created project SHALL NOT contain `README.md`
- **AND** the manifest SHALL NOT declare a README

#### Scenario: A later identity edit does not regenerate the README

- **WHEN** an author changes the facet name or description in a later edit session
- **THEN** the existing `README.md` content SHALL be preserved unchanged unless the author explicitly edits it

### Requirement: Edit provides a dedicated README panel for both conventional paths

The editing command SHALL recognize the exact root paths `README.md` and extensionless `README` as first-class README files and SHALL present them in a dedicated facet-level README panel, separate from generic supplementary-file reconciliation, so neither path appears twice. For each recognized path the offered actions SHALL depend on its state: present and declared — Edit or Remove; present but undeclared — Adopt or Edit-and-Adopt; declared but missing — Scaffold at the same path or Remove Declaration; absent and undeclared — Create, defaulting to `README.md`. If both paths exist, the panel SHALL show both independently and SHALL NOT silently ignore or overwrite either. Adopt SHALL preserve existing bytes unless the author explicitly edits them. Remove SHALL queue both the file deletion and the declaration removal. All README operations SHALL be queued and applied only at the existing edit confirmation, and the confirmation summary SHALL identify the exact README path and operation.

#### Scenario: An undeclared README is offered for adoption

- **WHEN** an author runs edit on a facet whose root contains `README.md` that is not declared in the manifest
- **THEN** the README panel SHALL offer Adopt and Edit-and-Adopt
- **AND** choosing Adopt SHALL queue the declaration addition while preserving the file's bytes

#### Scenario: A declared but missing README offers scaffold-or-remove

- **WHEN** the manifest declares `README.md` but the file does not exist on disk
- **THEN** the README panel SHALL offer scaffolding a new `README.md` at that path or removing the declaration

#### Scenario: Both README.md and README exist

- **WHEN** a facet root contains both `README.md` and extensionless `README`
- **THEN** the README panel SHALL present each path independently with its own state and actions
- **AND** neither file SHALL be silently ignored or overwritten

#### Scenario: README removal is transactional

- **WHEN** an author queues removal of a declared `README.md` and then exits the edit session without confirming
- **THEN** the file SHALL remain on disk and the declaration SHALL remain in the manifest

### Requirement: Edit reconciles supplementary-file declarations against disk

The editing command SHALL extend its reconciliation to supplementary files. It SHALL detect undeclared files inside a declared skill's directory and offer to add each to that skill's companion declaration. It SHOULD detect common root-level supplementary files (for example `LICENSE`) and offer to declare them, while routing `README.md` and `README` exclusively through the dedicated README panel. For any declared supplementary file other than a README that has vanished from disk, edit SHALL offer scaffold-or-remove, mirroring the missing-asset flow. All supplementary reconciliation actions SHALL be queued and applied only at the edit confirmation.

#### Scenario: An undeclared file inside a skill directory is offered for adoption

- **WHEN** an author runs edit and `skills/cowsay/references/art.md` exists on disk but is not declared in skill `cowsay`'s file list
- **THEN** the system SHALL offer to add `references/art.md` to skill `cowsay`'s declaration
- **AND** skipping the offer SHALL leave the file on disk and undeclared

#### Scenario: A vanished declared companion offers scaffold-or-remove

- **WHEN** skill `cowsay` declares `references/art.md` but the file no longer exists on disk
- **THEN** the system SHALL offer to scaffold a file at that path or remove the declaration

#### Scenario: Adopted supplementary files are added at the correct declaration site

- **WHEN** an author adopts a discovered file inside a skill directory and a discovered root-level `LICENSE`
- **THEN** the skill file SHALL be added to that skill's per-skill declaration
- **AND** `LICENSE` SHALL be added to the top-level declaration
