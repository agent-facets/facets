## Context

The facet authoring lifecycle currently has two commands: `facet create` (scaffolds a project) and `facet build` (validates and packages). Between them, the author must hand-edit `facet.json` to add, remove, or modify assets. This gap exists because there is no CLI command for iterating on a manifest after initial scaffolding.

ADR-001 establishes that the build and publish pipelines SHALL NOT modify the manifest — but says nothing about authoring-time mutation. ADR-006 explicitly states that "the CLI creates and mutates [manifests]" and that "authors edit `.md` content files, not manifests directly." A CLI command that manages the manifest on the author's behalf aligns with this established model.

The JSON manifest migration is complete, so the manifest is trivially machine-writable via `JSON.stringify(data, null, 2)` per ADR-006.

## Goals / Non-Goals

**Goals:**

- Introduce `facet edit` as the full authoring workbench — everything `facet create` can do, plus automatic reconciliation of disk vs. manifest
- Make `facet build` purely deterministic — validate, package, done. No interactivity, no manifest modification, same behavior everywhere.
- Simplify `facet create` to require only name and description
- Handle YAML front matter as a smooth onramp for files coming from other platforms

**Non-Goals:**

- Rename detection, `facet add` (registry install — unrelated), composed facets, server declarations, description inference from file content, automatic version bumping, platform config validation at conversion time, asset renaming, platform-specific configuration editing (see proposal for rationale on each)

## Decisions

### Decision 1: Three-command authoring model (create → edit → build)

The authoring lifecycle splits into three commands:

- **`facet create`** — one-time scaffold. Name and description required. Version defaults to `0.0.0`. Assets optional. Produces a project directory with a manifest.
- **`facet edit`** — repeatable authoring workbench. Everything create can do plus automatic reconciliation. All changes are queued and applied transactionally on confirmation.
- **`facet build`** — deterministic validate and package. Reads the manifest, validates, resolves prompts, assembles archive, writes to `dist/`. Never modifies the manifest. Fails with errors and suggests `facet edit` on failure.

Edit is optional — if an author scaffolds with create and doesn't change anything, build works immediately. Edit is a convenience for iterative authoring, not a required step. An author who prefers to hand-edit `facet.json` can still do so and go straight to build.

**Alternative considered:** Bundling reconciliation into `facet build`. Rejected because it makes build's behavior context-dependent — interactive locally, strict in CI. The three-command model makes each command predictable regardless of environment. Build is always strict because build is never interactive.

### Decision 2: Edit is transactional

All changes during an edit session — identity field edits, asset additions, deletions, scaffolds, front matter stripping, file renames — are queued in memory. Nothing touches disk or the manifest file until the author sees a confirmation summary showing every delta and explicitly confirms. The author can exit at any point before confirmation with zero side effects.

**Alternative considered:** Apply changes incrementally as the author makes them. Rejected because it makes exiting risky — partial changes leave the project in an intermediate state. Transactional confirmation is safer and lets the author review everything before committing.

### Decision 3: Skills adopt the Agent Skills directory convention

Skills follow the [Agent Skills](https://agentskills.io/specification) standard: each skill lives at `skills/<name>/SKILL.md` — a directory named after the skill containing a `SKILL.md` file. Flat `.md` files directly in `skills/` are not recognized. Agents and commands retain the flat file convention (`agents/<name>.md`, `commands/<name>.md`).

This aligns facets with the cross-platform Agent Skills ecosystem, which is supported by Claude Code, OpenCode, Cursor, Codex, and many other agent products. The convention naturally supports the Agent Skills progressive disclosure model — skills can include `scripts/`, `references/`, and `assets/` subdirectories alongside `SKILL.md` in the future.

**Alternative considered:** Keeping the flat `skills/<name>.md` convention and supporting both flat and directory patterns. Rejected — conforming to the established Agent Skills standard is worth the migration. Dual-pattern support adds complexity without clear benefit.

### Decision 4: Edit scans conventional patterns per asset type

`facet edit` scans using asset-type-specific patterns:
- **Skills**: `skills/*/SKILL.md` (directory convention)
- **Agents**: `agents/*.md` (flat file convention)
- **Commands**: `commands/*.md` (flat file convention)

Files outside these patterns are invisible.

### Decision 5: Deletions offer scaffold-or-remove, explicit deletion removes from disk

Two deletion scenarios:

**Missing file (manifest entry exists, file gone from disk):** The author chooses to either remove the entry from the manifest, or scaffold a new starter template file to restore it. Both options are legitimately useful — the author may have accidentally deleted a file, or intentionally wants to drop the asset.

**Explicit deletion (author selects an existing asset to delete):** The entry is removed from the manifest and the file is removed from disk. This is a deliberate action — the author is actively choosing to discard both the manifest entry and the content.

Both types of deletion appear in the confirmation summary before anything is applied.

### Decision 6: Manifest is the single source of truth for metadata — no front matter in persisted files

Content files on disk and in the archive contain pure markdown — zero front matter. The manifest holds all asset metadata (name, description, platform config). This eliminates divergence between front matter and manifest, simplifies content hashing, and makes platform-specific front matter reconstruction at install time straightforward — you generate it from the manifest, not by reading and hoping the file matches.

All three commands enforce this:
- **`facet edit`**: parses front matter from incoming files to extract defaults, then strips it on confirmation
- **`facet create`**: scaffolded starter files contain no front matter
- **`facet build`**: expects clean markdown files with no front matter. Files with front matter are a validation error.

### Decision 7: Front matter pre-fills fields, author always confirms

When edit encounters a file with YAML front matter (newly discovered or already in the manifest):

- Front matter `name` pre-fills the name field. If no front matter `name`, the filename (or directory name for skills) is the default.
- Front matter `description` pre-fills the description field.
- The author confirms or edits each field — they're text inputs with defaults, not pick-one selectors. Every asset coming out of edit has an author-confirmed name and description.
- The final confirmed name determines the filename on disk. If it differs from the current filename, the file is renamed.
- **Extra front matter fields** beyond `name` and `description` are surfaced to the author with their values. The author chooses to convert them to platform configuration or drop them. If converting, the author selects a platform from the known list (currently opencode, claude-code) or types a custom platform name validated as kebab-case. The fields are placed under the chosen platform key in the manifest as-is.
- Files not added during reconciliation are left completely untouched.
- Malformed front matter is treated as "no front matter."

**Alternative considered:** Preserving front matter in files and keeping it in sync with the manifest. Rejected — dual sources of truth for the same metadata creates divergence risk and makes integrity checking harder. The manifest is the authority; content files are pure content.

### Decision 8: Version defaults to 0.0.0, schema unchanged

The manifest schema keeps `version` as required per ADR-001. Both `facet create` and `facet edit` default version to `0.0.0` when not provided, ensuring the written manifest always includes a version. `0.0.0` is a neutral starting point. `facet edit` displays the version and lets the author change it.

### Decision 9: Build never modifies the manifest

`facet build` validates and packages. If validation fails, it reports errors and suggests `facet edit`. No `--strict` flag needed — build is always strict. No CI detection needed — build behaves identically everywhere. This preserves ADR-001's immutability guarantee cleanly.

## Risks / Trade-offs

**[Extra command in workflow]** → Authors now have three commands instead of two for create-to-build. Mitigation: edit is optional. Authors who scaffold everything in create or hand-edit `facet.json` can go straight to build. Edit is a convenience, not a gate.

**[Transactional complexity]** → Queuing all changes and applying them atomically on confirmation adds implementation complexity compared to immediate writes. Mitigation: the complexity is contained in the edit command's session state. The payoff is a safe, reviewable authoring experience where the author can always back out.

**[Front matter edge cases]** → YAML front matter parsing introduces edge cases (malformed YAML, mixed encodings, deeply nested structures). Mitigation: any parse failure is treated as "no front matter" and the file is processed normally. Only `name` and `description` are extracted as defaults; everything else is offered for platform config conversion or dropped.

**[Skill convention migration]** → Existing facets use `skills/<name>.md`. The new convention is `skills/<name>/SKILL.md`. Any existing scaffolded projects will need migration. Mitigation: there are no published facets yet — this is pre-release. The migration cost is near zero.

**[Edit produces potentially unbuildable state]** → After edit, the manifest may have name + description + version but no assets. Build will reject this. Mitigation: this is by design. Edit is for authoring; build enforces the full contract. The author iterates between edit and build until complete.

## Documentation Impact

The following docs files need updating:

- `docs/cli/build.mdx` — build is now purely deterministic, failure messages suggest `facet edit`
- `docs/cli/create.md` — relaxed requirements (only name and description required, version defaults to `0.0.0`, assets optional), cross-reference to edit instead of "hand-edit the manifest"
- `docs/cli.mdx` — add `facet edit` to the common commands card grid, update `facet build` description
- New `docs/cli/edit.mdx` — reference page for the new edit command
- `docs/specification/publish.mdx` — build steps section may need minor updates to reflect the simplified pipeline description

## ADR Compliance

- **ADR-001 (Facet Manifest Schema):** Build never modifies the manifest. Edit modifies the manifest as an authoring tool — ADR-001's immutability guarantee is scoped to build and publish. The manifest schema is unchanged; `version` remains required. However, ADR-001 references the `<type>/<name>.md` prompt resolution convention — the skill convention change to `skills/<name>/SKILL.md` requires a modification note on ADR-001 for the skill path pattern.
- **ADR-006 (Manifest Serialization Format):** Aligned. ADR-006 states "the CLI creates and mutates [manifests]" — edit is the CLI doing exactly that. Manifest write-back uses `JSON.stringify(data, null, 2)`. No conflict.
- **TERMINOLOGY.md:** No conflict. `edit` fits within the existing "Authoring" lifecycle stage. No new terms needed.
- **No other ADRs are affected.**

## Implementation Notes (from prototyping and design iteration)

These notes capture decisions made during implementation that refine or extend the original design. The delta specs should be updated to reflect these after implementation is complete.

### Edit command UX model

- **Two sequential phases**: reconciliation (if drift detected) → editing. Not a single mixed form. Reconciliation is a gate — you clear it, then you edit. If nothing to reconcile, skip straight to editing.
- **Hard error on invalid manifest**: If the manifest fails schema parsing, show errors (same pattern as build) and exit. No attempt to fix — the user must repair `facet.json` manually or delete and re-create.
- **Three edit states**: (1) manifest broken → hard error/exit, (2) manifest valid + drift → reconciliation then edit, (3) manifest valid + no drift → edit directly.

### Reconciliation view

- **All items shown at once** (not one-at-a-time wizard), grouped by category: new files on disk, missing from disk, front matter detected.
- **Inline actions per item**: each item has two options to its right. Navigation: up/down between items, left/right between options, Enter to lock in.
- **Visual states**: unfocused = normal text; focused = animated gradient on highlighted option; resolved = checkbox + static gradient on selected, dim on unselected. Can re-focus resolved items to change selection.
- **Resolution options**: new files → "Add to manifest" / "Ignore for now"; missing → "Scaffold template" / "Remove from manifest"; front matter → "Strip front matter" / "Remove from manifest".
- **All items must be resolved** before "Continue to edit" is enabled.

### Asset interaction model (applies to both create and edit)

- **Two-level navigation**: level 1 = up/down between assets; level 2 = field picker (name/description).
- **Level 1**: focused asset shows `Enter edit · Del remove`. Pressing Enter enters level 2.
- **Level 2**: `AssetFieldPicker` component renders the arrow to the left of either the name row or description row. `↑↓ select · Enter edit · Esc back`. Enter on name = inline text edit. Enter on description = opens `$EDITOR`.
- **Descriptions always visible** below each asset name, truncated to ~50 chars, first line only with ellipsis if multiline.

### Editor integration (description editing)

- **Ink unmount → `$EDITOR` via `openInEditorSync` (spawnSync) → remount** pattern validated on create command.
- **`WizardSnapshot`** is the single state object for surviving the unmount/remount cycle. Contains form state, focused ID, and optionally which asset/field was being edited.
- After editor closes, user lands back on the asset at level 1 (not inside field picker).
- `$VISUAL` → `$EDITOR` → `vi` fallback chain.

### Build command improvements (implemented)

- **Granular pipeline stages** shown in TUI: Parsing manifest, Resolving prompts, Validating assets, Checking collisions, Validating platforms, Assembling archive, Writing output. Each gets its own `StageRow`.
- **Errors render inline under the failed stage** (not in a separate section). Deferred exit via `pendingExit` state ensures React paints errors before Ink unmounts.
- **Predicate errors** (from Arktype `.narrow()`) formatted via `err.expected` for clean standalone sentences.
- **`BUILD_STAGES` constant** and `BuildStage` type exported from core for type-safe stage references.

### Schema/validation improvements (implemented)

- **Manifest constraints moved into Arktype `.narrow()`**: "at least one text asset" and "selective entry must select at least one type" are now schema-level checks. `checkFacetManifestConstraints` eliminated.
- **Front matter detection and empty file validation** added as build pipeline stage using DIY `hasFrontMatter()` with `yaml` package (not `gray-matter` or `front-matter` — both unmaintained with CVEs).

### Confirmation page

- Shows a **pretty manifest preview** — identity fields (name, description truncated, version) + asset sections (bullet list with name + truncated description). Not raw JSON, not categorized diffs, not file operation lists.
- "Apply" / "Go back" buttons.

## Spec Updates Needed (post-implementation)

The following delta specs should be revisited after implementation to reflect design refinements:

1. **`specs/authoring__facets/spec.md`**: Update reconciliation requirements to reflect the all-at-once UI model, inline actions, resolution options, and the two-phase (reconciliation → editing) flow. Add requirement for description editing via `$EDITOR`. Update confirmation summary requirement to reflect manifest preview design.
2. **`specs/cli/spec.md`**: Add edit command registration details including the loading screen stages and hard error behavior on invalid manifests.
3. **Build command spec requirements**: Update to reflect granular pipeline stages, inline error display, and the `BUILD_STAGES` constant.
4. **ADR-006**: Already updated during implementation to remove false claims about deterministic serialization and key ordering.

## Open Questions

_None remaining — all questions resolved during design and implementation._
