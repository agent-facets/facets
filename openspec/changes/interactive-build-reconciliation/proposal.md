## Why

After `facet create`, authors must hand-edit `facet.json` to add or remove assets before running `facet build`. The CLI already knows the file conventions and can manage the manifest on the author's behalf. The JSON manifest migration is complete, so the manifest is trivially machine-writable. Now is the right time to close this authoring gap.

## What Changes

- **Skill file convention change**: skills adopt the [Agent Skills](https://agentskills.io/specification) directory convention. Each skill lives at `skills/<name>/SKILL.md` — a directory named after the skill containing a `SKILL.md` file with pure markdown content (no front matter). Flat `.md` files directly in `skills/` are not recognized. Agents and commands retain the flat file convention (`agents/<name>.md`, `commands/<name>.md`).
- **No front matter in persisted files**: the manifest is the single source of truth for asset metadata (name, description, platform config). Content files on disk and in the archive contain pure markdown — zero front matter. Front matter is parsed from incoming files during edit to extract defaults, then stripped. `facet create`, `facet edit`, and `facet build` all enforce this: no front matter survives in any persisted `.md` or `SKILL.md` file. At install time, platform-specific front matter is reconstructed from the manifest — not read from the content file.
- A new **`facet edit`** command is introduced as the full authoring workbench for facet manifests. It is everything `facet create` can do plus automatic reconciliation. Authors build and iterate on their facet manifests with edit, then cut them with build. Scanning covers `skills/*/SKILL.md` for skills and `agents/*.md` / `commands/*.md` for agents and commands. Files outside these patterns are ignored.
- **Identity editing**: the facet's name, description, and version are all editable during an edit session. Edit presents the current values and lets the author change any of them. If version is absent, it defaults to `0.0.0`.
- **Automatic reconciliation — additions**: new `.md` files on disk not in the manifest are presented as a batch selection list. For each file the author chooses to add, a description is required. Files not selected stay on disk but are excluded from the manifest.
- **Automatic reconciliation — missing files**: manifest entries whose files no longer exist on disk offer two choices — remove the entry from the manifest, or scaffold a new template file to restore it.
- **Manual asset scaffolding**: the author can create new skills, agents, and commands from scratch during the edit session, just like the asset sections in `facet create`. New assets are scaffolded with starter template files and added to the manifest. Asset names are validated as kebab-case and checked for uniqueness within their type.
- **Explicit asset deletion**: the author can select existing assets to delete. Deletion removes the entry from the manifest and the file from disk.
- **Front matter parsing during edit**: any file with YAML front matter — whether newly discovered or already in the manifest — is parsed during edit. Front matter `name` and `description` values pre-fill the corresponding fields; if no front matter name exists, the filename is the default. The author confirms or edits each field — every asset coming out of edit has an author-confirmed name and description. The final confirmed name determines the filename on disk. Extra front matter fields beyond `name` and `description` are surfaced to the author, who chooses to either convert them to platform configuration or drop them. If converting, the author selects a platform from the known list (currently opencode, claude-code) or provides a custom platform name — the fields are placed under that platform key in the manifest as-is. Files the author does not add during reconciliation are left untouched.
- **Transactional confirmation**: all changes during an edit session are queued — nothing is written to disk or manifest until the author confirms. Before confirmation, a summary page displays all deltas: identity field changes, files to be added, removed, renamed, stripped of front matter, scaffolded, and manifest entries changed. The author can exit at any point before confirmation with no changes applied.
- **`facet build` simplification**: build becomes purely deterministic — validate, package, archive. No interactivity, no manifest modification. If validation fails, build reports errors and suggests running `facet edit`. No `--strict` flag or CI detection is needed because build is always strict.
- **`facet create` relaxation**: only name and description are required. Version defaults to `0.0.0`. Assets are optional. The wizard form is unchanged — all fields remain available, fewer are mandatory.

## Non-goals

- **Rename detection** — there is no rename concept. A missing file and a new file are independent events.
- **`facet add`** — installs a facet from a registry and updates the lockfile. Unrelated to authoring.
- **Composed facets** — the `facets` section references external facets, not local files. Edit does not touch it.
- **Server declarations** — not part of directory scanning or edit in this change.
- **Description inference from file content** — the system does not guess descriptions from headings or body text. Descriptions come from the author typing them during edit, or from explicit `description` fields in YAML front matter that the author already wrote. There is no magic.
- **Automatic version bumping** — no content-change detection or version bump prompting.
- **Platform config validation at conversion time** — extra front matter fields converted to platform config are passed through as-is. Validation is a future concern.
- **Asset renaming** — renaming an existing asset (changing its key in the manifest and renaming the file on disk) is a natural future addition to edit but is not part of this change.
- **Platform-specific configuration editing** — editing platform config per-asset within the edit workflow is a future capability. Edit will eventually be the place for this, but not now.

## Capabilities

### New Capabilities

_None — all changes fall within existing domains._

### Modified Capabilities

- `authoring__facets`: Skills adopt the Agent Skills directory convention (`skills/<name>/SKILL.md`). New requirements for `facet edit` (identity editing for name/description/version, directory scanning for skills and flat files for agents/commands, batch addition with description entry, missing file handling with scaffold-or-remove, manual asset scaffolding with starter templates, explicit asset deletion from manifest and disk, front matter parsing and normalization, platform config conversion for extra front matter fields, transactional confirmation with delta summary, manifest write-back). Modified requirements for `facet build` (purely deterministic, no interactivity, failure messages suggest edit, updated skill prompt resolution to `skills/<name>/SKILL.md`). Modified requirements for `facet create` (only name and description required, version defaults to `0.0.0`, assets optional, skill scaffolding creates directory with `SKILL.md`).
- `cli`: New command registration for `facet edit`.

## Impact

- ADR-001 (Facet Manifest Schema) informed this proposal. The manifest schema is unchanged — `version` remains required. The CLI ensures a version is always written by defaulting to `0.0.0` in both create and edit. Build never modifies the manifest, preserving ADR-001's immutability principle. The skill file convention changes from `skills/<name>.md` to `skills/<name>/SKILL.md` (Agent Skills standard) — ADR-001 references the `<type>/<name>.md` convention for prompt resolution, which will need a modification note for skills.
- ADR-006 (Manifest Serialization Format) informed this proposal. Manifest write-back follows the established JSON serialization decision.
- The strategy initiative `interactive-build-reconciliation` (proposed, 2026-03-28) describes the original motivation. This proposal refines the approach by separating interactive editing from deterministic building. The initiative's dependency on `json-manifest-migration` is satisfied.
- This change does not correspond to a specific roadmap phase — it enhances the Phase 2 authoring commands. No phase transition is required.
