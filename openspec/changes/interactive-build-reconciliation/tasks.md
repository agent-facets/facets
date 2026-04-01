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

- [ ] 5.1 Explore: Review the current build pipeline validation steps — what checks exist today, where new checks for front matter detection and empty file validation would be inserted
- [ ] 5.2 Explore: Review the build command's error output and TUI — how errors are currently displayed, where the "suggest facet edit" message would be added
- [ ] 5.3 Propose: Approach for adding front matter detection, empty file validation, and "suggest edit" messaging to the build pipeline

## 6. Build Command Hardening — Implementation

- [ ] 6.1 Implement: Add front matter detection to the build pipeline — fail with an error identifying the file if any content file contains YAML front matter
- [ ] 6.2 Implement: Add empty file validation to the build pipeline — fail with an error if any content file is empty (zero bytes or whitespace only)
- [ ] 6.3 Implement: Add "run `facet edit` to fix" suggestion to all build failure messages
- [ ] 6.4 Implement: Add tests for build failing on files with front matter
- [ ] 6.5 Implement: Add tests for build failing on empty content files
- [ ] 6.6 Verify: Run `bun check` — all tests pass, types check, lint clean

## 7. Core Edit Logic — Research

- [ ] 7.1 Explore: Review the existing create wizard TUI architecture — component structure, state management, how user input flows to the scaffold function, and what can be reused for the edit command
- [ ] 7.2 Explore: Review YAML front matter parsing libraries available in the Bun ecosystem — identify a well-tested parser that handles the edge cases (malformed front matter treated as absent)
- [ ] 7.3 Explore: Review how the manifest is currently loaded and written — the loader in `packages/core/src/loaders/`, the serialization format from ADR-006, and whether a write-back utility already exists
- [ ] 7.4 Propose: Approach for the edit command's core logic — session state model (queued changes), reconciliation algorithm (scan → diff → present), manifest write-back, and TUI component reuse from create

## 8. Core Edit Logic — Implementation

- [ ] 8.1 Implement: Directory scanner — scan `skills/*/SKILL.md`, `agents/*.md`, `commands/*.md` and return discovered assets with their paths
- [ ] 8.2 Implement: Reconciliation diff — compare discovered assets against manifest entries, produce lists of additions (on disk, not in manifest) and missing files (in manifest, not on disk)
- [ ] 8.3 Implement: YAML front matter parser — extract `name`, `description`, and extra fields from file content, return clean markdown body. Treat parse failures as "no front matter"
- [ ] 8.4 Implement: Manifest write-back utility — `JSON.stringify(data, null, 2)` to `facet.json`, per ADR-006
- [ ] 8.5 Implement: Edit session state model — queue identity changes, asset additions, deletions, scaffolds, front matter strips, and file renames. Apply atomically on confirmation.
- [ ] 8.6 Implement: Add unit tests for scanner, reconciliation diff, front matter parser, and manifest write-back
- [ ] 8.7 Verify: Run `bun check` — all tests pass, types check, lint clean

## 9. Edit TUI — Research

- [ ] 9.1 Explore: Review the create wizard's Ink component library — which form components exist (text input, select, checkbox list), how confirmation summaries are rendered, and what can be shared with edit
- [ ] 9.2 Propose: Approach for the edit TUI — component composition (identity form, reconciliation list, scaffolding section, deletion section, front matter resolution, platform config conversion, confirmation summary), and which create wizard components to reuse vs build new

## 10. Edit TUI — Implementation

- [ ] 10.1 Implement: Identity editing section — display and allow editing of name, description, version (default `0.0.0` if absent)
- [ ] 10.2 Implement: Reconciliation additions section — batch checkbox list of discovered files not in manifest, with name/description fields pre-filled from front matter
- [ ] 10.3 Implement: Reconciliation missing files section — for each missing file, offer remove-from-manifest or scaffold-template
- [ ] 10.4 Implement: Manual asset scaffolding section — create new skills/agents/commands from scratch with name validation and description entry (reuse create wizard asset components)
- [ ] 10.5 Implement: Explicit deletion section — select existing assets to delete from manifest and disk
- [ ] 10.6 Implement: Front matter resolution — pre-fill name/description from front matter, surface extra fields with convert-to-platform-config-or-drop choice, platform selection (known list + custom kebab-case input)
- [ ] 10.7 Implement: Confirmation summary page — display all queued deltas before applying
- [ ] 10.8 Implement: Exit-safe behavior — allow exiting at any point with no changes applied
- [ ] 10.9 Verify: Run `bun check` — all tests pass, types check, lint clean

## 11. CLI Registration — Implementation

- [ ] 11.1 Implement: Register the `edit` command in the CLI command registry with its description and optional directory argument
- [ ] 11.2 Implement: Wire the edit command handler to launch the edit TUI view
- [ ] 11.3 Implement: Add test that `edit` appears in help output and dispatches correctly
- [ ] 11.4 Verify: Run `bun check` — all tests pass, types check, lint clean

## 12. Integration Tests — Implementation

- [ ] 12.1 Implement: End-to-end test — create a project, add files to disk outside the manifest, run edit to reconcile, confirm, then build successfully
- [ ] 12.2 Implement: End-to-end test — edit with front matter files, verify front matter is stripped and metadata is in manifest
- [ ] 12.3 Implement: End-to-end test — edit with missing files, choose scaffold, then build successfully
- [ ] 12.4 Implement: End-to-end test — edit with missing files, choose remove, verify manifest entry is gone
- [ ] 12.5 Implement: End-to-end test — create with only name and description (no assets), verify manifest is valid but unbuildable
- [ ] 12.6 Verify: Run `bun check` — all tests pass, types check, lint clean

## 13. Documentation Updates — Implementation

- [ ] 13.1 Implement: Update `docs/cli/build.mdx` — build is purely deterministic, failure messages suggest `facet edit`
- [ ] 13.2 Implement: Update `docs/cli/create.md` — relaxed requirements (name + description only, version defaults `0.0.0`, assets optional), cross-reference to edit
- [ ] 13.3 Implement: Create `docs/cli/edit.mdx` — reference page for the new edit command
- [ ] 13.4 Implement: Update `docs/cli.mdx` — add `facet edit` to common commands, update `facet build` description
- [ ] 13.5 Implement: Update `docs/specification/publish.mdx` — build steps reflect simplified deterministic pipeline
- [ ] 13.6 Verify: Review all updated docs for consistency with specs and design
