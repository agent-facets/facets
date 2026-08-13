## Purpose

A facet author writes a facet manifest to declare their facet's identity, text assets, composed facets, and server references. The system validates and loads this manifest so authors get fast, clear feedback when something is wrong, and downstream tools get a reliable typed representation of the manifest.
## Requirements
### Requirement: Valid facet manifests are accepted

The system SHALL accept a facet manifest that conforms to the manifest schema. A valid current manifest has a name, a version, and at least one text asset, composed facet, or concrete MCP server declaration. The name SHALL be either an unscoped kebab-case facet identity or a scoped `@scope/name` identity. A manifest MAY include an optional top-level `private` boolean and supplementary-file declarations. Skills, agents, and commands SHALL use descriptors with required descriptions and optional platform metadata; prompt content SHALL be inferred from conventional paths rather than descriptor references.

Current-format skill, agent, command, and server names SHALL be single segments of 1–64 lowercase ASCII letters, digits, or hyphens, with no leading, trailing, or consecutive hyphens. Skills SHALL use `skills/<name>/SKILL.md`, agents `agents/<name>.md`, and commands `commands/<name>.md`. Skills and commands SHALL use disjoint names; agents and servers occupy separate namespaces and MAY share a name with another contribution kind.

#### Scenario: Minimal valid manifest with a skill

- **WHEN** an author provides a name, version, and one valid skill descriptor with a description
- **THEN** the system SHALL accept the manifest

#### Scenario: Valid manifest with a scoped facet identity

- **WHEN** an author provides name `@julian/cowsay`, a version, and one valid skill descriptor
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with all sections

- **WHEN** an author provides identity fields, skill, agent, and command descriptors, composed facets, concrete MCP server declarations, and supplementary declarations
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with only composed facets is valid

- **WHEN** an author provides `name`, `version`, and `facets` but no local skills, agents, commands, or servers
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with only a server is valid

- **WHEN** an author provides `name`, `version`, and one concrete MCP server but no text asset or composed facet
- **THEN** the system SHALL accept the manifest

#### Scenario: Manifest with private publish intent is valid

- **WHEN** an author provides `private: true`, valid identity fields, and at least one deliverable
- **THEN** the system SHALL accept and preserve `private: true`

#### Scenario: Manifest with explicit public publish intent is valid

- **WHEN** an author provides `private: false`, valid identity fields, and at least one deliverable
- **THEN** the system SHALL accept and preserve `private: false`

#### Scenario: Manifest with omitted privacy remains public by default

- **WHEN** an author omits `private` from an otherwise valid manifest
- **THEN** the system SHALL accept the manifest
- **AND** loaded data SHALL NOT synthesize `private`

#### Scenario: Valid current-format asset name is accepted

- **WHEN** an author declares assets named `a`, `code-review`, and `review2`
- **THEN** the system SHALL accept those names

### Requirement: Invalid facet manifests are rejected with actionable errors

The system SHALL reject a facet manifest that does not conform to the manifest schema. Each error SHALL identify the location of the problem and describe what was expected so the author can fix it without guessing.

#### Scenario: Missing required identity field

- **WHEN** an author provides a manifest without a `name` or `version` field
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify which required field is missing

#### Scenario: Manifest has no deliverable

- **WHEN** an author provides identity fields but no skills, agents, commands, composed facets, or concrete MCP server declarations
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL indicate that at least one deliverable is required

#### Scenario: Agent missing its description

- **WHEN** an author defines an agent without a `description` field
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the agent by name and the missing field

#### Scenario: Selective facets entry with no asset selection

- **WHEN** an author writes a selective facets entry with `name` and `version` but no `skills`, `agents`, or `commands`
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL indicate that at least one asset type must be selected

#### Scenario: Server declaration omits its type

- **WHEN** an author writes a server declaration without `type`
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the server by name and the missing field

#### Scenario: Server declaration has an invalid connection field

- **WHEN** an author writes an empty standard-input command or a non-absolute HTTP URL
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify the server and invalid field

#### Scenario: Privacy declaration is not boolean

- **WHEN** an author writes `private` as a string, number, object, array, or null
- **THEN** the system SHALL reject the manifest
- **AND** the error SHALL identify `private` and indicate that a boolean value is expected

### Requirement: Unrecognized fields are tolerated

The system SHALL accept manifests containing fields not defined in the current schema and SHALL preserve them, except that unrecognized members inside an MCP server declaration SHALL be rejected. This boundary allows top-level and descriptor extensions while preventing silent disagreement about execution-affecting server configuration.

#### Scenario: Top-level unknown field

- **WHEN** an author includes a field not defined in the schema, such as `license: "MIT"`
- **THEN** the system SHALL accept the manifest
- **AND** the field SHALL be present in the loaded result

#### Scenario: Unknown field nested in an asset descriptor

- **WHEN** an agent descriptor includes a field not defined in the schema
- **THEN** the system SHALL accept the manifest
- **AND** the field SHALL be present in the loaded result

#### Scenario: Unknown field nested in a server declaration

- **WHEN** an MCP server declaration includes a field not defined by its selected declaration type
- **THEN** the system SHALL reject the manifest and identify that field

### Requirement: Authors can declare portable MCP server connections

An author SHALL be able to declare project-scoped standard-input and Streamable HTTP MCP servers directly in `facet.json`. The declaration SHALL use the published portable shape and SHALL remain independent of any one coding tool's native configuration format. Validation failures SHALL identify the server name, field path, and expected constraint.

#### Scenario: Author declares a standard-input server

- **WHEN** an author declares a server with a valid command, arguments, and literal environment assignments
- **THEN** the system SHALL accept the declaration without requiring a separate server project

#### Scenario: Author declares an HTTP server

- **WHEN** an author declares a server with an absolute `http:` or `https:` URL
- **THEN** the system SHALL accept the declaration

#### Scenario: Unsupported server option is actionable

- **WHEN** an author declares headers, credentials, a working directory, shell behavior, variable substitution, or another unsupported field
- **THEN** the system SHALL reject the declaration and identify the server and unsupported field

### Requirement: Build validates MCP declarations without launching or contacting servers

The system SHALL validate every MCP declaration before replacing previous build output and SHALL preserve valid declarations in the embedded facet manifest. Building SHALL NOT install an executable, start a process, connect to a URL, authenticate, or create a server-specific archive entry. Invalid declarations SHALL fail the build with actionable field errors while preserving previous build output.

#### Scenario: Valid declaration is embedded without execution

- **WHEN** an author builds a facet containing a valid standard-input declaration
- **THEN** the build SHALL preserve the declaration in the embedded manifest
- **AND** it SHALL NOT locate or start the declared command

#### Scenario: HTTP declaration is not probed

- **WHEN** an author builds a facet containing a valid Streamable HTTP declaration
- **THEN** the build SHALL NOT connect to the URL or require it to be reachable

#### Scenario: Invalid declaration preserves previous output

- **WHEN** declaration validation fails and a previous successful build exists
- **THEN** the system SHALL report the server and invalid field
- **AND** the previous build output SHALL remain unchanged

#### Scenario: Server-only facet builds successfully

- **WHEN** a valid facet declares one MCP server and no text assets or composed facets
- **THEN** the build SHALL succeed with the declaration embedded in `facet.json`
- **AND** the declaration SHALL add no independent content-archive entry

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

The system SHALL provide an interactive wizard that collects a valid facet identity, non-empty description, optional SemVer version defaulting to `0.0.0`, and privacy intent defaulting to public. The author SHALL be able to add, rename, and remove multiple skills, commands, and agents. Asset names SHALL be validated in real time using the current single-segment grammar. Names SHALL be unique within each type; skills and commands SHALL additionally be unique across their shared namespace, while agents MAY share names with skills or commands. The first asset of each type SHOULD suggest the unscoped facet-name segment. At least one asset SHALL be required.

The wizard SHALL include a dedicated README step separate from asset management. README creation SHALL be enabled by default but optional. The wizard SHALL seed editable `README.md` content from the facet name and description, permit editing before confirmation, and permit disabling creation. Changing identity fields after README editing SHALL NOT silently regenerate or overwrite the edited content. The confirmation SHALL show privacy, declared assets, and every file to be created, including `README.md` when enabled.

All fields SHALL remain editable. Exit confirmation SHALL prevent accidental loss. Upon Apply, the system SHALL atomically create the project manifest and starter files. Skill files SHALL use `skills/<name>/SKILL.md`; agent and command files SHALL use their flat conventional paths. Starter asset files SHALL contain no YAML front matter. Every starter asset file SHALL contain template content that guides the author about what belongs in each section. When README is enabled, Apply SHALL write exact `README.md` content and declare that path in top-level `files`. Private intent SHALL write `private: true`; public intent SHALL omit `private`. The resulting project SHALL be immediately buildable.

#### Scenario: Author scaffolds a scoped project with a named skill

- **WHEN** the author provides `@julian/cowsay`, description `Cowsay tools`, and skill `cowsay`
- **THEN** the system SHALL create a manifest named `@julian/cowsay`
- **AND** create `skills/cowsay/SKILL.md`

#### Scenario: Author scaffolds a project with multiple named skills

- **WHEN** the author provides `viper-plans` and skills `viper-planning` and `viper-execution-rules`
- **THEN** the manifest SHALL contain both descriptors
- **AND** both conventional skill files SHALL be created

#### Scenario: Author accepts the default skill name

- **WHEN** the author names the facet `code-review` and accepts the first skill-name suggestion
- **THEN** the skill SHALL be named `code-review`
- **AND** its file SHALL be `skills/code-review/SKILL.md`

#### Scenario: Author cannot complete without a description

- **WHEN** the author attempts completion without a description
- **THEN** completion SHALL be blocked with a description-required message

#### Scenario: Scoped facet identity is accepted

- **WHEN** the author enters `@acme/deploy-tools`
- **THEN** the system SHALL accept the facet identity

#### Scenario: Invalid facet identity is rejected

- **WHEN** the author enters `@acme/Deploy_Tools`
- **THEN** the system SHALL reject the identity and explain the constraint

#### Scenario: Asset names use the current grammar

- **WHEN** the author enters an asset name with uppercase letters, spaces, underscores, slashes, leading or trailing hyphens, consecutive hyphens, or more than 64 characters
- **THEN** the wizard SHALL reject the name and explain the constraint

#### Scenario: Duplicate asset names within a type are rejected

- **WHEN** the author adds a skill with the same name as an existing skill
- **THEN** the wizard SHALL reject the duplicate

#### Scenario: Skill and command cannot share a name

- **WHEN** the author adds skill `review` and then command `review`
- **THEN** the wizard SHALL reject the command name as a shared-namespace collision

#### Scenario: Agent may share a name with a skill

- **WHEN** the author adds skill `review` and agent `review`
- **THEN** the wizard SHALL accept both

#### Scenario: Author edits an existing asset name

- **WHEN** the author changes an asset to a valid name free of applicable collisions
- **THEN** the wizard SHALL update the asset name

#### Scenario: Author removes an asset

- **WHEN** the author removes a previously added asset
- **THEN** the asset SHALL no longer appear in the wizard or confirmation

#### Scenario: Author exits with unsaved work

- **WHEN** the author confirms exit before Apply
- **THEN** no files or directories SHALL be created

#### Scenario: Version accepts valid SemVer

- **WHEN** the author enters `1.0.0` or `100.2.1`
- **THEN** the wizard SHALL accept the version

#### Scenario: Version rejects invalid input

- **WHEN** the author enters a value outside the `N.N.N` pattern
- **THEN** the wizard SHALL identify the version as invalid

#### Scenario: Version defaults to zero

- **WHEN** the author does not change the version
- **THEN** the manifest SHALL contain `0.0.0`

#### Scenario: New facet defaults to public intent

- **WHEN** the author accepts the default privacy choice
- **THEN** the manifest SHALL omit `private`
- **AND** confirmation SHALL show public intent

#### Scenario: New private facet writes private true

- **WHEN** the author selects private intent
- **THEN** the manifest SHALL contain `private: true`
- **AND** confirmation SHALL show private intent

#### Scenario: Author reverts private choice before completion

- **WHEN** the author selects private and then returns to public before Apply
- **THEN** the manifest SHALL omit `private`

#### Scenario: Target directory already contains a manifest

- **WHEN** a manifest exists in the target directory
- **THEN** the wizard SHALL warn and require confirmation before overwriting

#### Scenario: README is created by default

- **WHEN** the author accepts the default README choice
- **THEN** confirmation SHALL list `README.md`
- **AND** Apply SHALL write `README.md` and add it to top-level `files`

#### Scenario: README may be disabled

- **WHEN** the author disables README creation
- **THEN** no README file or declaration SHALL be created

#### Scenario: Edited README content is preserved

- **WHEN** the author edits seeded README content and later changes the facet name
- **THEN** Apply SHALL write the author's edited content without regenerating it

### Requirement: Authors can build a facet locally for validation and inspection

The system SHALL compile a facet project into a deterministic `.facet` archive after validating the manifest and every source input. It SHALL verify that primary asset files exist, are non-empty, and resolve from their conventional paths. Author-supplied YAML front matter in a primary asset SHALL be permitted and preserved verbatim in the archive; the manifest remains the source of truth for asset metadata, and front matter is reconciled with the manifest at install time rather than rejected at build. It SHALL verify that every declared supplementary file exists as a regular file at a safe, collision-free path. It SHALL archive the embedded manifest, every primary asset, and every declared supplementary file, and SHALL record a content hash for every entry. Validation SHALL finish before previous `dist/` output is removed. The build SHALL NOT modify source files and SHALL behave identically in interactive and non-interactive environments.

For a scoped facet identity or other slash-containing output name, the system SHALL create required parent directories below `dist/`. On success, the system SHALL display pipeline progress, the emitted archive-format version, complete entry listing, and integrity hash, followed by a persistent summary. On failure, it SHALL identify the failed stage and structured field or path errors and SHALL suggest the editing command when appropriate.

#### Scenario: Successful build of a valid facet

- **WHEN** a valid facet has all primary and supplementary source files
- **THEN** the system SHALL write the `.facet` archive and build manifest to `dist/`
- **AND** the archive SHALL contain the manifest and every declared primary and supplementary entry
- **AND** the build manifest SHALL record the integrity and a hash for every entry
- **AND** the display SHALL show the format version, complete entry listing, and integrity

#### Scenario: Successful build of a scoped facet identity

- **WHEN** the author builds facet `@julian/cowsay`
- **THEN** the archive SHALL be written below `dist/` without failing on the slash
- **AND** embedded `facet.json` SHALL preserve the scoped name

#### Scenario: Build output creates nested parent directories

- **WHEN** an archive filename renders as a nested path below `dist/`
- **THEN** the system SHALL create required parent directories before writing

#### Scenario: Build includes supplementary files at canonical paths

- **WHEN** a facet declares top-level `README.md` and skill companion `references/api.md`
- **THEN** the archive SHALL contain `README.md` and `skills/<name>/references/api.md`

#### Scenario: Build fails on invalid manifest

- **WHEN** the manifest fails schema validation
- **THEN** the system SHALL report errors with field paths and write no new output

#### Scenario: Build fails on missing primary asset

- **WHEN** a declared asset's conventional primary file is missing
- **THEN** the system SHALL identify the asset and expected path and write no new output

#### Scenario: Primary asset front matter is preserved in the archive

- **WHEN** a primary asset file contains author-supplied YAML front matter
- **THEN** the build SHALL succeed and archive the primary bytes verbatim
- **AND** the manifest SHALL remain the source of truth for that asset's metadata

#### Scenario: Build fails on empty primary asset

- **WHEN** a primary asset file is empty or whitespace-only
- **THEN** the system SHALL identify the file and require content

#### Scenario: Empty supplementary file remains valid

- **WHEN** a declared supplementary file is empty
- **THEN** the build SHALL NOT fail merely because that file is empty

#### Scenario: Build with no manifest

- **WHEN** the build runs where no facet manifest exists
- **THEN** the system SHALL report that no manifest was found

#### Scenario: Valid build cleans previous output

- **WHEN** every source input validates and `dist/` contains a previous build
- **THEN** the system SHALL remove previous output before writing new output

#### Scenario: Invalid build preserves previous output

- **WHEN** any source input fails validation and `dist/` contains a previous build
- **THEN** the previous output SHALL remain unchanged

### Requirement: Build detects naming collisions between local assets

The system SHALL reject duplicate names within each asset type. It SHALL also reject any name shared by a skill and command because those types occupy one logical namespace. Agents SHALL remain separate and MAY share a name with a skill or command. Collision failures SHALL identify every conflicting declaration.

#### Scenario: Two skills share a name

- **WHEN** a facet declares two skills with the same name
- **THEN** the build SHALL fail and identify both skill declarations

#### Scenario: Skill and command share a name

- **WHEN** a facet declares skill `review` and command `review`
- **THEN** the build SHALL fail with structured collision data identifying both declarations

#### Scenario: Skill and agent share a name

- **WHEN** a facet declares skill `review` and agent `review`
- **THEN** the build SHALL succeed without a naming collision

#### Scenario: Command and agent share a name

- **WHEN** a facet declares command `review` and agent `review`
- **THEN** the build SHALL succeed without a naming collision

#### Scenario: Distinct applicable names do not collide

- **WHEN** all names are distinct within their applicable namespaces
- **THEN** the build SHALL succeed without naming-collision errors

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

The system SHALL provide an interactive authoring workbench for identity, privacy, assets, README, and supplementary-file reconciliation. It SHALL scan conventional asset paths and declared supplementary regions, present detected drift before editing, and reject an invalid source manifest with actionable errors. Asset names SHALL use the current single-segment grammar; skills and commands SHALL be unique across their shared namespace while agents remain separate.

The workbench SHALL display current privacy intent. Setting or retaining private intent SHALL write `private: true`; changing private to public SHALL omit `private`; leaving a public facet unchanged SHALL preserve whether public intent was omitted or explicitly `false`.

#### Scenario: Author edits facet identity fields

- **WHEN** the author opens a facet for editing
- **THEN** current name, description, and version SHALL be editable
- **AND** absent version SHALL default to `0.0.0`

#### Scenario: Author inspects private manifest as private

- **WHEN** source contains `private: true`
- **THEN** edit SHALL show private intent and permit switching to public

#### Scenario: Author inspects omitted privacy as public

- **WHEN** source omits `private`
- **THEN** edit SHALL show public intent

#### Scenario: Author inspects explicit false as public

- **WHEN** source contains `private: false`
- **THEN** edit SHALL show public intent

#### Scenario: Omitted public privacy remains omitted

- **WHEN** public intent was omitted and remains public
- **THEN** Apply SHALL continue omitting `private`

#### Scenario: Explicit public false is preserved

- **WHEN** source contains `private: false` and remains public
- **THEN** Apply SHALL preserve `private: false`

#### Scenario: Private facet changes to public omission

- **WHEN** the author changes private intent to public
- **THEN** Apply SHALL omit `private`

#### Scenario: Public facet changes to private

- **WHEN** the author changes public intent to private
- **THEN** Apply SHALL write `private: true`

#### Scenario: Author changes facet scope

- **WHEN** the author changes `@julian/cowsay` to `@acme/cowsay`
- **THEN** the system SHALL treat it as a normal local identity edit

#### Scenario: Author creates a new skill

- **WHEN** the author adds skill `code-review`
- **THEN** Apply SHALL create `skills/code-review/SKILL.md` and its descriptor

#### Scenario: Author creates a new agent

- **WHEN** the author adds agent `reviewer`
- **THEN** Apply SHALL create `agents/reviewer.md` and its descriptor

#### Scenario: Author creates a new command

- **WHEN** the author adds command `run-review`
- **THEN** Apply SHALL create `commands/run-review.md` and its descriptor

#### Scenario: Author deletes an asset

- **WHEN** the author queues an asset deletion
- **THEN** Apply SHALL remove its descriptor and its conventional primary file
- **AND** for a skill, Apply SHALL additionally remove only that skill's declared companion files
- **AND** undeclared files inside the skill directory SHALL remain on disk unchanged

#### Scenario: Asset names are validated during edit

- **WHEN** the author enters an invalid asset name or a skill/command shared-namespace collision
- **THEN** the workbench SHALL reject the name with an actionable error

### Requirement: Edit detects new files on disk and offers to add them

The system SHALL detect undeclared conventional assets, undeclared files inside declared skill directories, and common root-level supplementary files. It SHALL present all generic discoveries together in one reconciliation phase with per-item actions, and every discovery SHALL be resolved before asset or manifest editing begins. Asset additions SHALL require descriptions; supplementary-file adoptions SHALL not. Skipped files SHALL remain on disk and undeclared. `README.md` and `README` SHALL be excluded from generic reconciliation and shown only in the dedicated README panel.

#### Scenario: New skill directory is discovered

- **WHEN** `skills/code-review/SKILL.md` exists but is undeclared
- **THEN** edit SHALL offer skill `code-review` for addition or skip

#### Scenario: New agent file is discovered

- **WHEN** `agents/reviewer.md` exists but is undeclared
- **THEN** edit SHALL offer agent `reviewer` for addition or skip

#### Scenario: New command file is discovered

- **WHEN** `commands/start-review.md` exists but is undeclared
- **THEN** edit SHALL offer command `start-review` for addition or skip

#### Scenario: Multiple new files are discovered

- **WHEN** three generic discoveries exist
- **THEN** edit SHALL present all three and permit any combination of actions

#### Scenario: Asset addition requires a description

- **WHEN** the author chooses to add a discovered asset
- **THEN** edit SHALL require a description before accepting it

#### Scenario: Unselected file remains on disk

- **WHEN** the author skips a discovery
- **THEN** its bytes SHALL remain unchanged and no declaration SHALL be added

#### Scenario: Empty discovered primary file is selectable

- **WHEN** a discovered conventional asset file is empty
- **THEN** edit SHALL still allow the author to select and repair it

#### Scenario: Undeclared skill companion is discovered

- **WHEN** declared skill `review` contains undeclared `references/api.md`
- **THEN** edit SHALL offer to add that relative path to the skill's `files`

#### Scenario: Common root file is discovered

- **WHEN** undeclared root `LICENSE` exists
- **THEN** generic reconciliation SHALL offer top-level adoption

#### Scenario: README is not duplicated in generic reconciliation

- **WHEN** undeclared root `README.md` exists
- **THEN** it SHALL appear only in the README panel

### Requirement: Edit detects missing files and offers scaffold-or-remove

The system SHALL detect missing conventional asset files and missing declared supplementary files. For each missing primary asset, it SHALL offer to remove the asset declaration or scaffold its starter file. For each missing supplementary file other than `README.md` or `README`, it SHALL offer to remove the exact declaration or scaffold a replacement at the exact declared path. Conventional README paths SHALL use the dedicated README panel.

#### Scenario: Missing skill primary is removed

- **WHEN** skill `code-review` is declared without `skills/code-review/SKILL.md` and the author chooses Remove
- **THEN** Apply SHALL remove the skill descriptor

#### Scenario: Missing skill primary is scaffolded

- **WHEN** skill `code-review` is declared without its primary and the author chooses Scaffold
- **THEN** Apply SHALL create `skills/code-review/SKILL.md` and preserve the descriptor

#### Scenario: Missing agent primary is removed

- **WHEN** agent `reviewer` is declared without `agents/reviewer.md` and the author chooses Remove
- **THEN** Apply SHALL remove the agent descriptor

#### Scenario: Missing skill companion is reconciled

- **WHEN** skill `review` declares missing `references/api.md`
- **THEN** edit SHALL offer Scaffold at that exact path or Remove Declaration

#### Scenario: Missing root supplementary file is reconciled

- **WHEN** top-level `files` declares missing `LICENSE`
- **THEN** edit SHALL offer Scaffold at `LICENSE` or Remove Declaration

### Requirement: Edit confirms asset identity and preserves primary content

The system SHALL require the author to confirm every asset's name and description during edit, defaulting the name to the conventional filename or skill-directory name. The final author-confirmed asset name SHALL determine that asset's conventional path on disk, and confirmed metadata SHALL be written to the manifest, which remains the source of truth. Edit SHALL NOT strip author-supplied front matter from a primary asset file; primary content SHALL be preserved verbatim unless the author explicitly edits it, and manifest metadata is reconciled with any front matter at install time. Supplementary files, including README, SHALL NOT be parsed and SHALL retain exact bytes unless explicitly edited.

#### Scenario: Missing metadata uses conventional name

- **WHEN** `skills/code-review/SKILL.md` is reconciled during edit
- **THEN** edit SHALL default the name to `code-review` and require confirmation

#### Scenario: Confirmed metadata is written to the manifest

- **WHEN** the author confirms an asset's name and description
- **THEN** Apply SHALL persist that metadata in the manifest
- **AND** the confirmed name SHALL determine the conventional file path

#### Scenario: Primary content is preserved verbatim

- **WHEN** an existing primary asset file contains author-supplied front matter and the author does not edit its body
- **THEN** Apply SHALL preserve the primary file bytes unchanged

#### Scenario: Supplementary front matter-like bytes are preserved

- **WHEN** an adopted supplementary file begins with valid YAML front matter
- **THEN** Apply SHALL preserve those bytes unless the author explicitly edits them

### Requirement: Edit is transactional with confirmation

All identity, privacy, asset, README, supplementary-file, and manifest changes SHALL remain queued until the author selects Apply. Confirmation SHALL show identity, privacy, asset summaries containing each asset's name and truncated description, and every file/declaration operation with its exact path. Apply SHALL commit all queued changes atomically. Exiting before Apply SHALL leave every file and the manifest unchanged.

#### Scenario: Author confirms changes

- **WHEN** the author selects Apply from confirmation
- **THEN** all queued disk and manifest changes SHALL commit atomically

#### Scenario: Author exits before confirmation

- **WHEN** the author exits before Apply
- **THEN** no file SHALL be created, modified, or deleted
- **AND** the manifest SHALL remain unchanged

#### Scenario: Confirmation shows privacy intent

- **WHEN** confirmation is displayed
- **THEN** it SHALL show privacy alongside identity fields

#### Scenario: Confirmation shows all deltas

- **WHEN** a session includes identity, privacy, asset, README, and companion changes
- **THEN** confirmation SHALL list each change and exact affected path

#### Scenario: README and companion changes wait for Apply

- **WHEN** the author queues `README.md` creation and companion adoption
- **THEN** confirmation SHALL list both exact paths
- **AND** neither disk nor manifest SHALL change before Apply

### Requirement: The manifest is the source of truth for primary asset metadata

The manifest SHALL remain the single source of truth for primary skill, agent, and command metadata. Author-supplied YAML front matter in a primary asset file SHALL be permitted: build SHALL preserve it verbatim in the archive, and materialization SHALL reconcile it with the manifest by merging manifest-owned metadata on top of any author front matter (the manifest wins on conflicting keys) before writing the asset to a selected adapter. Scaffolded starter files SHALL contain pure markdown with no front matter. Supplementary files SHALL be opaque bytes and may contain any content, including front-matter-like text, without reconciliation.

#### Scenario: Scaffolded primary files have no front matter

- **WHEN** create or edit scaffolds a primary asset file
- **THEN** the file SHALL contain markdown without YAML front matter

#### Scenario: Primary front matter is preserved and reconciled at install

- **WHEN** a primary asset file contains author-supplied YAML front matter
- **THEN** the build SHALL archive those bytes verbatim
- **AND** materialization SHALL merge manifest-owned metadata on top of the author front matter, with the manifest winning on conflicting keys

#### Scenario: Archive preserves primary bytes

- **WHEN** a facet is built
- **THEN** every primary asset entry SHALL contain the author's exact source bytes

#### Scenario: Supplementary front matter is allowed

- **WHEN** a supplementary file contains front-matter-like text
- **THEN** the build SHALL preserve it byte-for-byte and SHALL NOT reject it for that content

### Requirement: Built facet artifacts preserve manifest privacy declarations

When an author builds a facet, the built artifact SHALL preserve the source manifest's privacy declaration in its embedded facet manifest. If the source manifest contains `private: true` or `private: false`, the embedded manifest SHALL contain the same boolean value. If the source manifest omits `private`, the embedded manifest SHALL also omit `private`; build SHALL NOT inject a default privacy field.

#### Scenario: Build preserves private publish intent

- **WHEN** an author builds a facet whose source manifest contains `private: true`
- **THEN** the built artifact's embedded facet manifest SHALL contain `private: true`
- **AND** verification of the built artifact SHALL treat that value as part of the embedded manifest content

#### Scenario: Build preserves omitted privacy declaration

- **WHEN** an author builds a facet whose source manifest omits `private`
- **THEN** the built artifact's embedded facet manifest SHALL omit `private`
- **AND** build SHALL NOT inject `private: false` into the embedded manifest

### Requirement: A privacy change does not rebuild, republish, or contact the registry

Because privacy intent is manifest content embedded in the built artifact, changing it in the create or edit workflows SHALL NOT, on its own, alter any already-built artifact or any already-published version. The authoring workflows SHALL NOT automatically rebuild, republish, or contact the registry as a result of a privacy change. The rebuild-after-change and version-bump-for-published-versions consequences are documented in the authoring and publish guides rather than surfaced as confirmation-time messaging.

#### Scenario: Editing privacy does not rebuild or publish

- **WHEN** the author changes a facet's privacy intent in the edit workflow and confirms
- **THEN** the system SHALL update the source manifest only
- **AND** the system SHALL NOT rebuild the facet
- **AND** the system SHALL NOT publish the facet
- **AND** the system SHALL NOT contact the registry

### Requirement: Facet manifests declare supplementary files explicitly

Authors SHALL be able to declare supplementary files without representing them as independently installable assets. A top-level `files` array SHALL enumerate exact repository-relative paths for archive-only files and MUST NOT contain paths below `skills/`. Each skill descriptor MAY contain a `files` array of exact paths relative to that skill's directory; those paths MUST resolve below the skill directory and MUST NOT name `SKILL.md`. Omitted or empty arrays SHALL be valid. Glob and pattern declarations SHALL NOT be expanded or accepted.

#### Scenario: Top-level supplementary files are declared

- **WHEN** an author declares top-level `files` as `README.md` and `LICENSE`
- **THEN** the system SHALL accept both as archive-only supplementary declarations

#### Scenario: Nested skill companions are declared

- **WHEN** skill `review` declares `references/api.md`, `scripts/run.ts`, and `assets/logo.png`
- **THEN** the system SHALL accept all three paths as companions owned by that skill

#### Scenario: Companion-less skill remains valid

- **WHEN** a skill omits `files` or declares an empty array
- **THEN** the system SHALL accept the skill as having no companions

#### Scenario: Top-level declaration cannot own a skill companion

- **WHEN** an author places `skills/review/references/api.md` in top-level `files`
- **THEN** the system SHALL reject the declaration
- **AND** the error SHALL identify the owning skill's `files` array as the correct declaration site

#### Scenario: Skill declaration cannot name its primary file

- **WHEN** skill `review` declares `SKILL.md` in its `files` array
- **THEN** the system SHALL reject the declaration

#### Scenario: Patterns are rejected

- **WHEN** an author declares `docs/**` or `references/*.md`
- **THEN** the system SHALL reject the declaration as not being an exact path

### Requirement: Build validates supplementary file declarations and path safety

Before changing previous build output, the system SHALL validate that every declared supplementary path is non-empty, relative, canonical, and inside its permitted declaration region; resolves through existing parents to a regular file inside the facet root; and does not collide with any primary asset or other inner content-archive entry. Collision checking applies to the inner content archive only; the fixed outer wrapper entry names (`build-manifest.json`, `archive.tar.gz`) remain permitted as inner paths. Paths containing empty, `.` or `..` segments, backslashes, NUL bytes, or absolute, drive, or URL-like prefixes SHALL be rejected. Paths SHALL be portable: segments containing control bytes or `<`, `>`, `:`, `"`, `|`, `?`, `*`, segments equal to a Windows-reserved device name (case-insensitively, with or without an extension), and segments ending in a dot or space SHALL be rejected. Symbolic and hard links SHALL be rejected. The exact root path `facet.json` SHALL be reserved, while that basename MAY appear below another directory. Collisions SHALL include exact duplicates, Unicode-normalization aliases, portable case-fold aliases, resolved-source aliases, and file/directory prefix conflicts. Each failure SHALL be structured data identifying the path and declaration site.

#### Scenario: Missing supplementary file is rejected

- **WHEN** `files` declares `LICENSE` but no such file exists
- **THEN** the build SHALL fail with structured data identifying `LICENSE`

#### Scenario: Traversal and absolute paths are rejected

- **WHEN** a declaration contains `../secret`, `/secret`, `C:/secret`, or `https://example.com/file`
- **THEN** the build SHALL fail with structured data identifying the unsafe path

#### Scenario: Backslash and empty segments are rejected

- **WHEN** a declaration contains `docs\guide.md`, `docs//guide.md`, or `docs/./guide.md`
- **THEN** the build SHALL reject the non-canonical path

#### Scenario: Link source is rejected

- **WHEN** a declared path resolves through a symbolic or hard link
- **THEN** the build SHALL fail before writing output

#### Scenario: Root manifest path is reserved

- **WHEN** top-level `files` declares the exact path `facet.json`
- **THEN** the build SHALL reject the declaration

#### Scenario: Manifest basename below a companion directory is permitted

- **WHEN** skill `review` declares `examples/facet.json` and that regular file exists
- **THEN** the build SHALL accept the declaration

#### Scenario: Primary asset path collision is rejected

- **WHEN** an agent named `reviewer` is declared and top-level `files` also declares `agents/reviewer.md`
- **THEN** the build SHALL fail with structured collision data identifying both declarations

#### Scenario: Inner path may match an outer archive filename

- **WHEN** top-level `files` declares a regular source file named `build-manifest.json` or `archive.tar.gz`
- **THEN** the build SHALL accept that inner-archive path

#### Scenario: Portable aliases are rejected

- **WHEN** declarations include paths that differ only by case or Unicode normalization
- **THEN** the build SHALL fail with structured collision data

#### Scenario: Windows-reserved declaration is rejected

- **WHEN** a declaration contains `references/con`, `aux.txt`, `notes:draft.md`, or a segment ending in a dot or space
- **THEN** the build SHALL fail with structured data identifying the non-portable segment

#### Scenario: File and directory prefix conflict is rejected

- **WHEN** declarations include both `docs` as a file and `docs/guide.md`
- **THEN** the build SHALL fail with structured collision data

#### Scenario: Validation failure preserves previous build output

- **WHEN** supplementary-file validation fails and `dist/` contains a previous successful build
- **THEN** the previous output SHALL remain unchanged

### Requirement: Build ships supplementary files as opaque bytes

The system SHALL read, hash, and archive supplementary files byte-for-byte. Supplementary content SHALL NOT undergo front-matter parsing, line-ending normalization, empty-content validation, or text decoding. Empty and binary supplementary files SHALL be permitted, and every supplementary entry SHALL receive its own content hash.

#### Scenario: Binary companion is preserved

- **WHEN** a skill declares binary file `assets/logo.png`
- **THEN** the archived entry SHALL be byte-identical to the source file

#### Scenario: Empty supplementary file builds successfully

- **WHEN** a declared supplementary file contains zero bytes
- **THEN** the build SHALL succeed and record that entry's hash

#### Scenario: Front-matter-like supplementary content is preserved

- **WHEN** a declared supplementary file begins with valid YAML front matter
- **THEN** the build SHALL archive those bytes unchanged

### Requirement: Edit provides dedicated README authoring

`README.md` SHALL be the preferred conventional facet document, and the exact extensionless root path `README` SHALL also receive first-class support. Both SHALL remain ordinary top-level `files` declarations rather than using a README-specific manifest field. The edit workflow SHALL display them in a dedicated facet-level README panel and SHALL NOT duplicate them in generic file reconciliation.

For each exact path, the panel SHALL offer Edit or Remove when present and declared; Adopt or Edit-and-Adopt when present and undeclared; Scaffold at the same path or Remove Declaration when declared and missing; and Create when absent and undeclared, defaulting to `README.md`. If both paths exist, the system SHALL display and manage both independently. Adopt SHALL preserve existing bytes unless the author explicitly edits them. Remove SHALL queue file deletion and declaration removal together; Scaffold and Create SHALL queue file creation and declaration addition together. No operation SHALL change disk or manifest state before Apply.

#### Scenario: Present declared README can be edited or removed

- **WHEN** `README.md` exists and appears in top-level `files`
- **THEN** the README panel SHALL offer Edit and Remove
- **AND** Remove SHALL queue both file deletion and declaration removal

#### Scenario: Present undeclared README is adopted without byte changes

- **WHEN** `README.md` exists but is not declared and the author chooses Adopt
- **THEN** Apply SHALL add `README.md` to top-level `files`
- **AND** the existing file bytes SHALL remain unchanged

#### Scenario: Missing extensionless README keeps its path

- **WHEN** top-level `files` declares `README` but the file is missing
- **THEN** the panel SHALL offer Scaffold at `README` or Remove Declaration

#### Scenario: Create defaults to README dot md

- **WHEN** neither conventional README path exists or is declared
- **THEN** Create SHALL default to `README.md`

#### Scenario: Both conventional README paths are independent

- **WHEN** both `README.md` and `README` exist
- **THEN** the panel SHALL display both independently
- **AND** neither SHALL be ignored or overwritten implicitly

#### Scenario: README operation appears in confirmation

- **WHEN** an author queues a README operation
- **THEN** the confirmation SHALL identify the exact path and operation
- **AND** exiting before Apply SHALL leave the file and manifest unchanged
