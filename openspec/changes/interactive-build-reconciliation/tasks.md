> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## 1. Skill Convention Migration — Research

- [x] 1.1 Explore: Review current skill file path resolution in the build pipeline — how `skills/<name>.md` is resolved, where the convention is hardcoded, and what tests cover it
- [x] 1.2 Explore: Review the create wizard's skill scaffolding — how skill starter files are generated and where the flat file path is constructed
- [x] 1.3 Explore: Review existing tests that assert skill file paths (`skills/<name>.md`) — enumerate all tests that will need updating for the directory convention
- [x] 1.4 Propose: Approach for migrating skill resolution from `skills/<name>.md` to `skills/<name>/SKILL.md` across the build pipeline, create wizard, and tests

## 2. Skill Convention Migration — Implementation

- [x] 2.1 Implement: Update prompt content resolution to resolve skills from `skills/<name>/SKILL.md` instead of `skills/<name>.md`
- [x] 2.2 Implement: Update the create wizard's skill scaffolding to create `skills/<name>/SKILL.md` inside a directory instead of a flat file
- [x] 2.3 Implement: Update all existing tests that assert skill file paths to use the new directory convention
- [x] 2.4 Implement: Update ADR-001 with a modification note for the skill path convention change
- [x] 2.5 Verify: Run `bun check` — all tests pass, types check, lint clean

## 3. Create Wizard Relaxation — Research

- [x] 3.1 Explore: Review the create wizard's validation logic — what fields are currently required, how `canCreate` is gated, and where the "at least one asset" requirement is enforced
- [x] 3.2 Explore: Review the version field default value and where `0.1.0` is currently set — identify all places the default needs to change to `0.0.0`
- [x] 3.3 Propose: Approach for relaxing create requirements (name + description only, version defaults `0.0.0`, assets optional) while keeping the form unchanged

## 4. Create Wizard Relaxation — Implementation

- [x] 4.1 Implement: Change the create wizard so only name and description are required to complete — remove the "at least one asset" gate
- [x] 4.2 Implement: Change the version default from `0.1.0` to `0.0.0` in both the create wizard and any test fixtures
- [x] 4.3 Implement: Ensure scaffolded starter files contain no YAML front matter (verify current behavior, fix if needed)
- [x] 4.4 Implement: Add test for scaffolding a minimal project with only name and description (no assets)
- [x] 4.5 Implement: Add test for version defaulting to `0.0.0`
- [x] 4.6 Verify: Run `bun check` — all tests pass, types check, lint clean

## 5. Build Command Hardening — Research

- [x] 5.1 Explore: Review the current build pipeline validation steps — what checks exist today, where new checks for front matter detection and empty file validation would be inserted
- [x] 5.2 Explore: Review the build command's error output and TUI — how errors are currently displayed, where the "suggest facet edit" message would be added
- [x] 5.3 Propose: Approach for adding front matter detection, empty file validation, and "suggest edit" messaging to the build pipeline

## 6. Build Command Hardening — Implementation

- [x] 6.1 Implement: Add front matter detection to the build pipeline — fail with an error identifying the file if any content file contains YAML front matter
- [x] 6.2 Implement: Add empty file validation to the build pipeline — fail with an error if any content file is empty (zero bytes or whitespace only)
- [x] 6.3 Implement: Add "run `facet edit` to fix" suggestion to all build failure messages
- [x] 6.4 Implement: Add tests for build failing on files with front matter
- [x] 6.5 Implement: Add tests for build failing on empty content files
- [x] 6.6 Verify: Run `bun check` — all tests pass, types check, lint clean

## 7. Core Edit Logic — Research

- [x] 7.1 Explore: Review the existing create wizard TUI architecture — component structure, state management, how user input flows to the scaffold function, and what can be reused for the edit command
- [x] 7.2 Explore: Review YAML front matter parsing libraries available in the Bun ecosystem — identify a well-tested parser that handles the edge cases (malformed front matter treated as absent) (completed: DIY with `yaml` package)
- [x] 7.3 Explore: Review how the manifest is currently loaded and written — the loader in `packages/core/src/loaders/`, the serialization format from ADR-006, and whether a write-back utility already exists
- [x] 7.4 Propose: Approach for the edit command's core logic — session state model (queued changes), reconciliation algorithm (scan → diff → present), manifest write-back, and TUI component reuse from create

## 8. Core Edit Logic — Implementation

- [x] 8.1 Implement: Directory scanner — scan `skills/*/SKILL.md`, `agents/*.md`, `commands/*.md` and return discovered assets with their paths
- [x] 8.2 Implement: Reconciliation diff — compare discovered assets against manifest entries, produce lists of additions (on disk, not in manifest) and missing files (in manifest, not on disk)
- [x] 8.3 Implement: YAML front matter parser — extract `name`, `description`, and extra fields from file content, return clean markdown body. Treat parse failures as "no front matter" (completed as `packages/core/src/front-matter.ts` using DIY + `yaml` package)
- [x] 8.4 Implement: Manifest write-back utility — `JSON.stringify(data, null, 2)` to `facet.json`, per ADR-006
- [x] 8.5 Implement: Add unit tests for scanner, reconciliation diff, front matter parser, and manifest write-back
- [x] 8.7 Verify: Run `bun check` — all tests pass, types check, lint clean

## 9. Edit TUI — Research

- [x] 9.1 Explore: Review the create wizard's Ink component library — which form components exist (text input, select, checkbox list), how confirmation summaries are rendered, and what can be shared with edit
- [x] 9.2 Propose: Approach for the edit TUI — component composition (identity form, reconciliation list, scaffolding section, deletion section, front matter resolution, platform config conversion, confirmation summary), and which create wizard components to reuse vs build new

## 10. Edit TUI — Implementation

> Design decisions from research phase (9.1-9.2):
> - Edit has two sequential phases: reconciliation (if drift detected), then editing
> - Reconciliation shows all items at once with inline actions per item (not one-at-a-time wizard)
> - Reconciliation actions: new files → "Add to manifest" / "Ignore for now"; missing → "Scaffold template" / "Remove from manifest"; front matter → "Strip front matter" / "Remove from manifest"
> - Reconciliation uses animated gradient on focused option, checkbox + static gradient on selected, dim on unselected — same interaction pattern as create wizard buttons
> - Every reconciliation item must be resolved before "Continue to edit" is available
> - Edit phase reuses `AssetSection`, `AssetItem`, `AssetFieldPicker`, `AssetDescription` components from the create wizard prototype
> - Assets use two-level navigation: level 1 (up/down between assets), level 2 (field picker for name/description editing)
> - Description editing opens `$EDITOR` via `openInEditorSync`, Ink unmounts/remounts using `WizardSnapshot` for full state restore
> - Confirmation page shows a pretty manifest preview (identity fields + asset sections with truncated descriptions) — not raw JSON, not categorized diffs
> - Hard error on invalid manifest (show errors like build does, exit)
> - All changes are transactional — nothing written until confirmation, exit at any point = no changes

- [x] 10.1 Implement: Edit command entry point and wizard wrapper — load manifest (hard error if invalid), scan disk, run reconciliation, determine if reconciliation phase is needed, launch TUI with `WizardSnapshot` state management for editor round-trips
- [x] 10.2 Implement: Edit loading screen — deferred (loading happens synchronously in command handler before TUI launches)
- [x] 10.3 Implement: Reconciliation view — all-at-once list grouped by category (new files, missing files, front matter). Each item has inline action options to the right. Navigation: up/down between items, left/right between options on focused item, Enter to lock in selection. Visual states: unfocused (normal text), focused (animated gradient on highlighted option), resolved (checkbox + static gradient on selected, dim on other). "Continue to edit" button enabled only when all items resolved.
- [x] 10.4 Implement: Edit view — identity fields (name, description, version) pre-filled from manifest using `EditableField`. Asset sections using `AssetSection` component (skills, agents, commands) with existing assets loaded from manifest. Add/remove/rename/edit-description all work via the level 1/level 2 navigation and `AssetFieldPicker`. "Review & Confirm" button at bottom.
- [x] 10.5 Implement: Confirmation view — pretty manifest preview showing identity (name, description truncated, version) and asset sections (bullet list with name + truncated description per asset). "Apply" / "Go back" buttons.
- [x] 10.6 Implement: Apply logic — on confirmation, write updated manifest via `writeManifest`, scaffold new asset files (skills as `skills/<name>/SKILL.md`, agents/commands as flat `.md` files), delete removed asset files from disk, strip front matter from flagged files by rewriting with `extractFrontMatter` body content
- [x] 10.7 Implement: Exit-safe behavior — double-Esc exits at any point with no changes applied (reuse `useExitKeys`), all changes queued in session state until apply
- [x] 10.8 Verify: Run `bun check` — all tests pass, types check, lint clean

## 11. CLI Registration — Implementation

- [x] 11.1 Implement: Register the `edit` command in the CLI command registry with its description and optional directory argument
- [x] 11.2 Implement: Wire the edit command handler to launch the edit TUI view
- [x] 11.3 Implement: Add test that `edit` appears in help output and dispatches correctly
- [x] 11.4 Verify: Run `bun check` — all tests pass, types check, lint clean

## 12. Integration Tests — Implementation

- [x] 12.1 Implement: End-to-end test — detect new files on disk, detect missing files, detect front matter
- [x] 12.2 Implement: End-to-end test — apply scaffolding, front matter stripping, file deletion
- [x] 12.3 Implement: End-to-end test — scaffold then build succeeds
- [x] 12.4 Implement: (removed — create now requires at least one asset, no "only name and description" scenario)
- [x] 12.5 Verify: Run `bun check` — all tests pass, types check, lint clean

## 13. Documentation Updates — Implementation

- [x] 13.1 Implement: Update `docs/cli/build.mdx` — build is purely deterministic, granular pipeline stages, failure suggests `facet edit`, skill path convention, front matter/empty validation
- [x] 13.2 Implement: Update `docs/cli/create.md` — version defaults `0.0.0`, skill directory convention, description editing, cross-reference to edit
- [x] 13.3 Implement: Create `docs/cli/edit.mdx` — reference page for the new edit command covering reconciliation and editing phases
- [x] 13.4 Implement: Update `docs/cli.mdx` — add `facet edit` to common commands, update descriptions
- [x] 13.5 Implement: Update `docs/specification/publish.mdx` — add front matter and empty file validation note
- [x] 13.6 Verify: All 121 tests pass, types check, lint clean, docs updated
