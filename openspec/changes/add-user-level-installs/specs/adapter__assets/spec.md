## ADDED Requirements

### Requirement: Asset plans disclose a stable storage root

Every asset installation plan and every asset removal plan SHALL disclose the absolute storage root the adapter resolved for that request, whether the outcome is a set of changes, already matching, or nothing there. For a given adapter, installation target, location inputs, and asset type, the disclosed root SHALL be the same for every asset regardless of its effective name, and every planned change and authorized directory SHALL lie at or below it. Disclosing a root SHALL NOT confer ownership of anything below it, SHALL NOT cause any file to be written, and SHALL NOT require a separate location-discovery call.

#### Scenario: A no-op install still discloses its root

- **WHEN** a user-target skill already matches its desired bytes
- **THEN** the plan SHALL report the asset as already matching with no file change
- **AND** the plan SHALL disclose the adapter's user skill storage root

#### Scenario: An absent removal still discloses its root

- **WHEN** removal targets a user-scope command that does not exist
- **THEN** the plan SHALL report that nothing is there
- **AND** the plan SHALL disclose the adapter's user command storage root

#### Scenario: The root does not depend on the asset name

- **WHEN** an adapter plans user-target agents named `reviewer` and `planner` with identical location inputs
- **THEN** both plans SHALL disclose the same storage root

#### Scenario: Changes stay below the disclosed root

- **WHEN** a plan contains changes for a skill with companions
- **THEN** every changed path and every authorized directory SHALL be at or below the disclosed storage root

#### Scenario: Separate project and user targets disclose separate roots

- **WHEN** Claude Code plans the same skill for project `/work/app` and for user home `/home/alice`, with no configuration override or filesystem alias between their storage trees
- **THEN** the plans SHALL disclose different storage roots, at or below `/work/app/.claude` and `/home/alice/.claude` respectively

### Requirement: User-scope skill bundles are complete and bounded

A user-target skill installation SHALL plan the primary file and every supplied companion, including binary companions, with companion bytes reproduced verbatim. Cleanup at user scope SHALL follow the same ownership bounds as at project scope: only the primary and the caller-supplied previously-owned companion paths MAY be removed, empty directories left behind SHALL be pruned only below the authorized directory, and the authorized directory, the adapter's storage root, the tool's configuration directory, and the home directory SHALL never be removed. Planning SHALL NOT create missing parent directories itself.

#### Scenario: Binary companion is installed verbatim at user scope

- **WHEN** a user-target skill request includes companion `assets/logo.png` containing non-UTF-8 bytes
- **THEN** the plan SHALL write that companion below the user skill directory with byte-identical content

#### Scenario: Obsolete owned companion is removed at user scope

- **WHEN** a user-target skill is reinstalled without companion `references/old.md`, which appears in the previously-owned set
- **THEN** the plan SHALL remove `references/old.md`
- **AND** it SHALL preserve every file in that skill directory not named in the previously-owned set

#### Scenario: User-scope removal never prunes shared roots

- **WHEN** removing the only user-scope skill leaves the user skills directory empty
- **THEN** the plan SHALL NOT remove the authorized directory, the tool's configuration directory, or the home directory

### Requirement: First-party adapters place user assets at native user locations

Each first-party adapter SHALL resolve user-target asset destinations at its tool's native user-level locations, using the supplied home directory and declared location overrides, while retaining its existing project destinations unchanged:

- Claude Code SHALL use the directory named by `CLAUDE_CONFIG_DIR` when set, otherwise `~/.claude`, with skills, agents, and commands in its existing subdirectories.
- Codex SHALL place skills and their companions under `~/.agents/skills/<name>/`, agents under the Codex home's `agents/` directory, and commands as top-level Markdown custom prompts under the Codex home's `prompts/` directory, invocable as `/prompts:<name>`. The Codex home SHALL be `CODEX_HOME` when set, otherwise `~/.codex`. `CODEX_HOME` SHALL NOT relocate the `~/.agents` skill tree. User commands SHALL NOT be translated into skills, and project command placement SHALL NOT be redirected into user prompts.
- OpenCode SHALL use `$XDG_CONFIG_HOME/opencode` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/opencode`, with skills, agents, and commands in its existing subdirectories.

A location override used for user placement SHALL be absolute. A relative, malformed, or unsupported override SHALL produce a structured failure before mutation; the adapter SHALL NOT ignore it and plan to a guessed default. A user layout whose consumption by the target tool has not been established SHALL fail before mutation rather than guess a destination or omit content. Home resolution SHALL work on every supported platform, including Windows.

A relative location override SHALL be rejected before any filesystem inspection.

#### Scenario: Claude Code honours its configuration override

- **WHEN** a user-target Claude Code skill `review` is planned with `CLAUDE_CONFIG_DIR` set to `/home/alice/claude-alt`
- **THEN** the skill SHALL be planned below `/home/alice/claude-alt/skills/review/`

#### Scenario: Claude Code defaults below home

- **WHEN** a user-target Claude Code command is planned with home `/home/alice` and no override
- **THEN** it SHALL be planned below `/home/alice/.claude/commands/`

#### Scenario: Codex home does not move user skills

- **WHEN** a user-target Codex skill `review` and agent `planner` are planned with home `/home/alice` and `CODEX_HOME` set to `/opt/codex-alice`
- **THEN** the skill SHALL be planned below `/home/alice/.agents/skills/review/`
- **AND** the agent SHALL be planned below `/opt/codex-alice/agents/`

#### Scenario: Codex user commands become custom prompts

- **WHEN** a user-target Codex command `deploy` is planned with home `/home/alice` and no override
- **THEN** it SHALL be planned as `/home/alice/.codex/prompts/deploy.md`
- **AND** no skill SHALL be planned for it

#### Scenario: OpenCode honours XDG configuration home

- **WHEN** a user-target OpenCode agent is planned with `XDG_CONFIG_HOME` set to `/home/alice/.xdg`
- **THEN** it SHALL be planned below `/home/alice/.xdg/opencode/agents/`

#### Scenario: Relative override fails closed

- **WHEN** a user-target plan is requested with a relative `CODEX_HOME` value `codex`
- **THEN** the adapter SHALL return a structured failure
- **AND** it SHALL NOT plan any change at the default Codex home
- **AND** it SHALL NOT inspect any file

#### Scenario: Windows home resolves native user assets

- **WHEN** a supported Windows installation plans Claude Code agent `reviewer` with supplied home `C:\Users\alice` and no configuration override
- **THEN** its destination SHALL be `C:\Users\alice\.claude\agents\reviewer.md`
- **AND** no project root SHALL be required

## MODIFIED Requirements

### Requirement: Adapters plan asset installation without mutating anything

An adapter SHALL accept an installation planning request whose content shape is determined by asset type. Every planning request SHALL carry the explicit installation target and location inputs of its planning context, and its asset name. A project-target request SHALL identify the project root it targets; a user-target request SHALL NOT require or carry a project. An adapter SHALL NOT derive the target, project, or home directory from the process working directory or ambient environment, so a caller installing into a project it is not running inside, or into the user scope from any directory, resolves the same destinations as one that is not. A skill request SHALL carry the primary `SKILL.md` text, per-asset metadata, a canonical map from companion paths relative to the skill root to opaque bytes, and the caller-verified set of previously-owned companion paths; an empty companion map and an empty previously-owned set SHALL each be valid. Adapters SHALL NOT persist ownership metadata or infer ownership from disk contents. Each request SHALL carry both, from separate sources: the content to write comes from the caller's verified resolved state, while the previously-owned paths a write may remove come exclusively from the caller's machine-local record of what it materialized for the selected collection. An adapter SHALL treat the supplied owned set as the complete extent of what it may remove, and SHALL NOT widen it by convention, by filename pattern, or by any legacy storage format. Agent and command requests SHALL each carry one text content value and per-asset metadata and SHALL NOT carry companions or ownership sets. No installation request SHALL represent archive-only supplementary files.

The adapter SHALL own path resolution, containment, storage format, metadata assembly, and deciding which owned files are obsolete. It SHALL NOT write, delete, or create anything: planning SHALL leave every inspected file byte-for-byte unchanged, including its modification time.

A plan SHALL report either that the asset already matches its desired state, or the complete set of file changes that would realize it. Each planned change SHALL name an absolute path, the exact state that path was observed in, and — for a write — the exact bytes to commit. Each planned change SHALL also carry the directory it is authorized to work inside; every planned path SHALL be strictly below it. A file already holding its desired bytes SHALL contribute no change, so re-planning an unchanged asset yields no work at all.

Skill installation SHALL plan the complete owned bundle as one set of changes: the new primary, the new companions, and the removal of previously-owned companion paths absent from the new request. Removal SHALL be limited to the supplied previously-owned set. Companion bytes SHALL be stored verbatim; metadata or front-matter transformation SHALL apply only to the primary file. Unowned files SHALL NOT be removed.

Before any filesystem access, every supplied companion path — new or previously owned — SHALL be validated as relative, canonical, and confined below the resolved skill root; a request containing a malformed or escaping path SHALL be rejected without reading anything. Expected failures SHALL be returned as structured results.

#### Scenario: Install a skill with companions

- **WHEN** a skill request contains primary content and companions `references/api.md` and `assets/logo.png`
- **THEN** the plan SHALL contain a write for the primary and for both companions below that skill's storage location
- **AND** planned companion bytes SHALL be byte-identical to the request
- **AND** primary metadata SHALL NOT be inserted into companion files

#### Scenario: Planning writes nothing

- **WHEN** an adapter plans any installation
- **THEN** no file SHALL be created, modified, or removed
- **AND** no inspected file's modification time SHALL change

#### Scenario: An unchanged asset plans no change

- **WHEN** the destination already holds exactly the bytes the request would write
- **THEN** the plan SHALL report the asset as already matching
- **AND** the plan SHALL contain no file change

#### Scenario: A planned change states what it was computed from

- **WHEN** a plan contains a write to an occupied destination
- **THEN** that change SHALL carry the exact state the destination was observed in

#### Scenario: Install a skill with no companions

- **WHEN** a skill request contains an empty companion map
- **THEN** the adapter SHALL install the primary as a valid companion-less skill

#### Scenario: Install an asset at user scope

- **WHEN** installation requests a user target
- **THEN** the adapter SHALL use its user-level storage root resolved from the supplied home directory and declared location overrides
- **AND** the request SHALL NOT require a project root

#### Scenario: Project destinations do not depend on the working directory

- **WHEN** a project-target request names project root `/work/app` and the process runs in `/tmp`
- **THEN** every planned path SHALL be below the adapter's project storage location inside `/work/app`

#### Scenario: Reinstall replaces the owned skill bundle

- **WHEN** an existing skill is reinstalled with one previously owned companion omitted from the new bundle but present in the request's previously-owned set
- **THEN** the adapter SHALL replace the primary and current companions
- **AND** remove the omitted owned companion
- **AND** preserve every file not named in the previously-owned set

#### Scenario: A refused bundle change leaves no partial bundle

- **WHEN** any part of a planned skill bundle cannot be committed
- **THEN** the operation SHALL report structured failure data
- **AND** the complete prior bundle SHALL remain intact

#### Scenario: Escaping companion path is rejected

- **WHEN** a skill request contains an absolute companion path or a path that escapes the skill root — in the new bundle or in the previously-owned set
- **THEN** the adapter SHALL reject the request without reading, writing, or deleting any file

#### Scenario: Agent and command contain one primary value

- **WHEN** an agent or command is installed
- **THEN** its request SHALL contain exactly one primary text value and no companion map

### Requirement: Adapters plan asset removal without mutating anything

An adapter SHALL accept a type-specific removal planning request for an explicit installation target. Every removal request SHALL carry the installation target and location inputs of its planning context, its asset type, and its asset name; a project-target request SHALL identify its project root, and a user-target request SHALL NOT require one. A skill removal request SHALL additionally carry the caller-verified owned companion path set.

A removal plan SHALL report either that nothing is there, or the complete set of file removals that takes the asset away: the primary plus exactly the supplied owned companion paths. Each planned removal SHALL name an absolute path and the exact state that path was observed in. Every other file SHALL be preserved. Directories left empty by removing owned files SHALL be pruned, bounded by the adapter's authorized directory and never removing it.

A skill whose primary file is already gone SHALL still have its owned companions planned for removal: each has an exact observed state of its own, so removing them remains reversible.

Before any filesystem access, every supplied owned path SHALL be validated as relative, canonical, and confined below the resolved skill root; a request containing a malformed or escaping path SHALL be rejected without reading anything.

#### Scenario: Remove an existing multi-file skill

- **WHEN** removal targets a skill and the request supplies its two owned companion paths
- **THEN** the plan SHALL contain a removal for the primary and for both supplied owned files

#### Scenario: A bundle whose primary is gone still removes its owned companions

- **WHEN** a skill's primary file is already absent and its owned companions are present
- **THEN** the plan SHALL contain a removal for each present owned companion

#### Scenario: Removing an absent asset plans nothing

- **WHEN** the requested asset does not exist at that scope
- **THEN** the plan SHALL report that nothing is there
- **AND** the plan SHALL contain no file change

#### Scenario: User-scope removal leaves the project copy alone

- **WHEN** removal targets user-scope skill `review` while a project also contains skill `review`
- **THEN** the plan SHALL name only paths below the adapter's user storage root

#### Scenario: Escaping owned path is rejected before deletion

- **WHEN** a deletion request's owned path set contains `../outside.md` or an absolute path
- **THEN** the adapter SHALL reject the request as structured failure data
- **AND** SHALL delete nothing

#### Scenario: Skill deletion preserves unowned file

- **WHEN** the skill directory contains `notes.txt` that is not recorded as owned
- **THEN** skill deletion SHALL leave `notes.txt` unchanged
- **AND** SHALL leave any directory needed to contain it

#### Scenario: A refused removal restores the prior bundle

- **WHEN** a planned removal cannot be completed after one owned file has already been removed
- **THEN** the operation SHALL report structured failure data
- **AND** every removed file SHALL be restored to its exact prior bytes

### Requirement: Adapter planning is the only interface for asset storage decisions

The system SHALL decide every primary text-asset and skill-companion storage question through the selected adapter's planning operations. It SHALL NOT choose asset paths, storage encodings, or metadata conventions itself, and SHALL NOT inspect adapter asset directories to discover what is there. The adapter SHALL own its tool's asset storage format, project and user roots, path resolution, metadata conventions, and skill-bundle composition. Archive-only supplementary files SHALL never be passed to an adapter. Keyed entries inside shared tool-owned project or user configuration SHALL use their dedicated capability rather than masquerading as text assets.

An adapter SHALL declare whether it materializes assets at all. An adapter that declares no asset capability SHALL still validate manifest metadata and SHALL NOT be offered as a text-asset materialization target. Absence of asset support SHALL NOT block an operation requiring only that adapter's supported MCP planning capability.

#### Scenario: System delegates primary and companion planning

- **WHEN** a skill primary and companions must be installed for an adapter
- **THEN** the system SHALL submit one skill planning request
- **AND** it SHALL NOT choose any file path itself

#### Scenario: System does not choose user-scope paths

- **WHEN** a user-scope agent must be installed for an adapter
- **THEN** the destination SHALL be the one the adapter's plan names
- **AND** the system SHALL NOT substitute the home directory as a project root

#### Scenario: Archive-only supplementary file is withheld

- **WHEN** a verified archive includes root `README.md`
- **THEN** the system SHALL NOT include that file in any adapter request

#### Scenario: MCP configuration is not an asset request

- **WHEN** a facet contributes an MCP server declaration
- **THEN** the system SHALL NOT represent it as a skill, agent, or command or pass it to asset storage methods

#### Scenario: MCP-only operation does not require asset support

- **WHEN** a user operation has only active MCP declarations and no owned asset cleanup, and a selected adapter declares `assets: false` but supports MCP planning at user scope
- **THEN** the operation SHALL use that adapter's MCP capability without invoking or requiring asset planning

### Requirement: Untracked occupied asset destinations require just-in-time confirmation

When an interactive installation reaches a desired effective asset identity whose destination is occupied but not covered by the selected collection's machine-local ownership, the system SHALL disclose the destination and its installation scope and ask whether to continue before adopting or replacing it. Continue SHALL be the default. Equivalent content SHALL be adopted without rewriting it; divergent content SHALL be replaced only after continuation. Cancellation SHALL restore every file the operation already changed to its exact prior bytes. Non-interactive callers SHALL continue automatically, preserving the existing reconciliation behavior.

The confirmation SHALL remain separate from MCP declaration consent and MCP configuration takeover. Supplying MCP approval SHALL NOT approve an asset takeover. Receipt-owned destinations SHALL reconcile without a takeover confirmation, and destinations outside the desired set SHALL NOT be inspected merely to search for takeovers. Ownership recorded by another collection SHALL NOT count as ownership for the selected collection.

#### Scenario: Interactive user continues an untracked takeover

- **WHEN** a desired asset reaches an occupied untracked destination and the user continues
- **THEN** the system SHALL reconcile the destination and record ownership only after successful commit

#### Scenario: Equivalent content is adopted without writing

- **WHEN** the untracked destination already contains the desired rendered asset
- **THEN** the system SHALL leave its bytes unchanged and record it as reconciled after success

#### Scenario: Divergent content is replaced after continuation

- **WHEN** the untracked destination differs and the user continues
- **THEN** the system SHALL replace it transactionally with the desired asset

#### Scenario: Cancellation restores the complete operation

- **WHEN** the user cancels at an asset takeover after earlier asset mutations
- **THEN** the system SHALL restore every prior mutation and commit no change to the selected collection's state

#### Scenario: Non-interactive takeover preserves existing behavior

- **WHEN** a non-interactive install reaches an occupied untracked asset destination
- **THEN** the system SHALL continue reconciliation without opening a prompt or requiring MCP approval

#### Scenario: Owned destination does not prompt

- **WHEN** machine-local ownership already covers the desired effective asset identity
- **THEN** the system SHALL reconcile it without a takeover confirmation

#### Scenario: User takeover discloses its scope

- **WHEN** an interactive user installation reaches an occupied untracked user-scope destination
- **THEN** the confirmation SHALL identify the destination as user scope
