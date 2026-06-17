## Why

Facet manifests already support a top-level `private` boolean, and publish documentation already tells authors to edit `facet.json` by hand to change visibility. That leaves private publish intent as hidden functionality in the authoring workflow: users can create and edit facets interactively, but they cannot set or inspect registry visibility intent without leaving the TUI.

## What Changes

- The `facet create` wizard SHALL add an interactive privacy choice so authors can decide whether a newly scaffolded facet declares private publish intent.
- The `facet edit` workbench SHALL add the same privacy choice so authors can inspect and change an existing facet between public-by-default and private publish intent without hand-editing JSON.
- Newly created facets SHALL default to public-by-default, and the generated manifest SHALL omit the `private` field unless the author selects private.
- The authoring workflows SHALL preserve the manifest schema's existing serialization model: `private: true` is written when selected; public selections omit `private` rather than injecting `private: false`, including when editing a previously private facet back to public.
- The authoring workflows SHALL make clear that changing privacy is a manifest content change that requires a rebuild before it affects the built artifact, and a version bump if the current version has already been published.
- User-facing authoring documentation SHALL describe the new privacy step in `facet create` and `facet edit`, and publish guidance SHALL stop presenting hand-editing `facet.json` as the primary way to change visibility.

## Non-goals

- This change will not alter manifest validation semantics; `private` remains an optional boolean where omission and `false` are public-by-default.
- This change will not add a separate publish flag, registry API behavior, or registry-side visibility enforcement. The registry continues to read privacy intent from the built artifact's embedded manifest.
- This change will not add a standalone command such as `facet private` or `facet public`.
- This change will not automatically rebuild or republish when the author toggles privacy; build and publish remain explicit steps.
- This change will not add privacy controls for composed dependencies or installed facets.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `authoring__facets`: The interactive facet authoring workflows SHALL expose manifest privacy intent during both create and edit flows, while preserving public-by-default omission semantics.

## Impact

- CLI/TUI authoring code in `packages/cli`, especially the shared create/edit form state, focus order, confirmation summaries, and a new focusable privacy toggle component.
- Engine scaffold generation in `packages/engine/src/scaffold`, so create options can carry the selected privacy state into generated `facet.json`.
- Edit result construction in the CLI TUI, so privacy changes are written to the manifest and public selections omit any existing `private` key.
- Tests covering scaffold manifest generation, create/edit form state mapping, privacy toggle behavior, and user-visible confirmation behavior where practical.
- Documentation informed by `docs/cli/authoring/create.md`, `docs/cli/authoring/edit.md`, `docs/specification/manifest.md`, `docs/specification/publish.md`, and `docs/guides/publish-a-facet.md`. The create/edit docs SHALL be updated because they currently describe the wizard fields but do not mention privacy. The publish guide's hand-edit guidance SHALL be updated to describe the new in-tool toggle while preserving the existing rebuild and version-bump discipline.
