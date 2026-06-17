## Context

The manifest schema already accepts optional top-level `private?: boolean`, and build/publish flows already treat privacy as manifest content embedded in the built artifact. The missing surface is authoring: `facet create` currently collects `name`, `description`, `version`, and assets, while `facet edit` hydrates those fields from the manifest and preserves unknown/non-asset fields through `...original`, but neither flow lets the author inspect or change `private`.

The affected implementation is intentionally split across layers:

- `packages/engine/src/scaffold/index.ts` owns create-time scaffold data and generated `facet.json` bytes.
- `packages/cli/src/tui/context/form-state-context.ts` owns shared create/edit wizard form state and conversion to `ScaffoldOptions`.
- `packages/cli/src/tui/views/create/*` and `packages/cli/src/tui/views/edit/*` own focus order, rendered fields, confirmation summaries, and editor round-trips.
- `packages/cli/src/tui/views/edit/manifest-to-form.ts` hydrates edit form state from `FacetManifest`.
- `packages/cli/src/tui/views/edit/use-edit-session.ts` converts edit form state back into a manifest before `writeManifest` serializes JSON.

User-facing documentation currently covers the manifest privacy field and publish implications, but authoring docs do not mention a TUI privacy control. `docs/guides/publish-a-facet.md` currently instructs authors to hand-edit `facet.json`; that guidance will diverge once the TUI exposes privacy.

## Goals / Non-Goals

**Goals:**

- Add a single shared public/private form value used by both create and edit flows.
- Make privacy a focusable TUI control that behaves consistently with the existing keyboard-driven wizard model.
- Generate or write `private: true` only when the author selects private.
- Omit `private` when the author selects public, including when an existing manifest had `private: true` and is edited back to public.
- Show privacy in confirmation summaries so authors can review the final manifest intent before writing.
- Surface concise rebuild/version-bump guidance near the privacy choice or confirmation summary without changing build or publish behavior.
- Update create/edit and publish-guide documentation so docs match the new authoring surface.

**Non-Goals:**

- No manifest schema change and no protocol validation change.
- No registry API change, publish flag, access-control behavior, or registry-side enforcement work.
- No standalone non-interactive command such as `facet private` or `facet public`.
- No automatic rebuild or republish after a privacy edit.
- No privacy controls for composed dependencies, installed facets, or per-asset visibility.

## Decisions

### 1. Model privacy as a required boolean sibling of the string fields map

`FormState` SHALL gain a dedicated boolean named `private: boolean`. This boolean SHALL be a sibling of `fields`, not a member of `fields`, because `FormState.fields` is a fixed map of `FieldState` values whose `value` is a string. The default form SHALL set `private` to `false`.

All form construction sites SHALL be updated together: `defaultForm`, `FormStateContext`'s default value, `toCreateOptions()`, and `manifestToFormState()`. `manifestToFormState()` SHALL hydrate the boolean with `private: manifest.private === true`, treating `false` and omission identically as the public UI state.

Rationale: the authoring UI has exactly two visible states: public and private. The form state should mirror the manifest field name directly instead of introducing a second name such as `isPrivate`; TypeScript already carries the boolean type, so an `is` prefix adds no useful information and makes create/edit/output mappings less direct. A required `private: boolean` makes illegal UI states unrepresentable in the UI: the form cannot carry both a public choice and a separate serialization preference.

The UI boolean does not mean edit output always rewrites public manifests to omission. Omission versus explicit `private: false` is a manifest serialization detail handled at output boundaries. Create defaults to omission for public, while edit preserves an original explicit `private: false` unless the user changes privacy to private.

Alternatives considered:

- **Tri-state (`public-omitted` / `public-false` / `private`) in the form**: rejected because it exposes schema trivia to authors and adds a third UI state even though the author-facing choice is binary.
- **Name the form field `isPrivate`**: rejected because the manifest field is already named `private`, TypeScript already identifies it as a boolean, and using a second name creates unnecessary mapping friction.
- **Store privacy in generic `fields` as a string**: rejected because `FieldState.value` is a string and would make invalid values such as `"maybe"` or an empty string representable.
- **Store raw manifest privacy as `boolean | undefined` in the form**: rejected because the UI should model the author's binary visibility choice; omission versus explicit false is a serialization concern handled when writing manifests.

### 2. Extend engine `ScaffoldOptions` with optional `private?: true`

`ScaffoldOptions` SHALL carry privacy to the engine as an optional true-only field: `private?: true`. `toCreateOptions()` SHALL include `private: true` only when `form.private` is true. `generateScaffoldManifest()` SHALL write `manifest.private = true` only when that option is present, using the same conditional-assignment style as existing optional scaffold fields. The generated key SHOULD be placed after `version`/`description` and before asset sections to align with manifest field order.

Rationale: the generated manifest should omit public privacy. Encoding the scaffold option as true-only mirrors the output contract and prevents callers from passing a meaningful `false` value that the engine would then need to interpret or discard.

Alternatives considered:

- **`private: boolean` on `ScaffoldOptions`**: rejected because it makes `false` look semantically meaningful even though scaffold output must omit it.
- **Keep privacy entirely in CLI and post-process generated JSON**: rejected because scaffold generation belongs in engine, and create should pass structured intent into the engine rather than mutate generated JSON in the CLI layer.

### 3. Add a small reusable focusable `BooleanToggle`/`ToggleField` TUI component

The CLI SHALL add a dedicated focusable toggle component rather than overloading `EditableField`. The component SHALL accept an `id`, `label`, `value`, `onToggle`, and optional `hint`/`dimmed` props. It SHALL render public/private labels clearly, support keyboard activation with Enter (and Space if consistent with existing input handling), and use the existing focus-order/button visual language.

Create and edit views SHALL insert the privacy toggle after `Version` and before asset sections. Focus order SHALL become `field-name`, `field-description`, `field-version`, `field-private`, then asset controls and the submit button. Version confirmation SHALL move focus to `field-private`, and toggling/confirming privacy SHALL move to the first asset add control. Because `computeFocusIds(form)` is duplicated in both `create-view.tsx` and `edit-view.tsx`, both lists SHALL be updated in the same implementation step so one wizard cannot ship with an unreachable toggle.

Rationale: privacy is not free-form text; a boolean toggle avoids validation errors and makes both choices discoverable. Placing it before assets keeps it with identity/manifest metadata and ensures authors see it before confirmation.

Alternatives considered:

- **Reuse `select-prompt`**: rejected because the wizard already uses inline focus navigation rather than modal selection for form fields.
- **Represent privacy as an `EditableField` expecting `true`/`false`**: rejected because it is easier to mistype and contradicts the goal of replacing hand-edited JSON with safe UI.

### 4. Edit manifest output SHALL preserve explicit public `private: false`

`buildManifest(original, form)` in the edit session SHALL continue preserving unrelated top-level fields from `original`, but privacy SHALL be handled after spreading `original`:

- If `form.private` is true, set `manifest.private = true`.
- If `form.private` is false and `original.private === false`, preserve `manifest.private = false`.
- If `form.private` is false and `original.private !== false`, delete `manifest.private`.

Rationale: the form has only two author-facing states, but the source manifest can legally represent public visibility either by omitting `private` or by writing `private: false`. Create should continue omitting public privacy, and toggling an originally private manifest back to public should remove `private: true`. However, if an author hand-authored `private: false`, opening and applying `facet edit` should not erase that explicit representation as an incidental formatting side effect.

This SHALL still be explicit privacy handling after `...original`; relying on preservation alone is insufficient because a private-to-public edit must actively remove a spread-in `private: true`. The specs SHALL include scenarios for private-to-public deletion, omitted-public preservation, and explicit `private: false` preservation.

Alternatives considered:

- **Set `manifest.private = false` for every public edit output**: rejected by product decision and because create/public-by-default output should omit `private`.
- **Normalize every public edit output to omitted `private`**: rejected because it erases an explicitly hand-authored `private: false` even when the author did not ask for formatting normalization.
- **Only delete `private` when the user changed it**: rejected because the output rules should be derivable from the current form state plus the original manifest representation, not hidden UI touched-state.
- **Copy the `description` conditional-assignment pattern**: rejected because it is the wrong local precedent for fields that must be removable after `...original`.

### 5. Confirmation summaries SHALL show privacy and brief publish guidance

Create and edit confirmation views SHALL include a `Privacy:` row with `Public` or `Private`. The form view or confirmation summary SHALL also include concise guidance that privacy is manifest content and takes effect in built/published artifacts only after rebuild; if the version is already published, visibility changes require a version bump. This text SHOULD be short enough not to overwhelm the wizard, for example: `Privacy is embedded at build time; rebuild after changing it. Published versions require a version bump.`

Rationale: the proposal requires authors not to discover rebuild/version rules only at publish time. Confirmation is the last safe point before writing the source manifest and is an appropriate low-friction place to remind them.

Alternatives considered:

- **Warn only in docs**: rejected because the author can toggle privacy without reading publish docs.
- **Add a blocking modal warning on every toggle**: rejected as too disruptive for a local manifest edit that does not itself publish anything.
- **Warn conditionally only when the current version is already published**: rejected because that requires a registry lookup, credentials, and network failure handling inside an authoring flow. Build/publish state remains outside this change.

### 6. Documentation updates SHALL align the new authoring flow with existing publish semantics

The implementation SHALL update:

- `docs/cli/authoring/create.md`: add Privacy/Public-vs-Private to the wizard flow and clarify public default/omission.
- `docs/cli/authoring/edit.md`: add privacy editing to the editing phase and confirmation summary.
- `docs/guides/publish-a-facet.md`: replace hand-edit-first guidance with `facet edit` as the primary interactive path, while preserving the rebuild and version-bump instructions.

`docs/specification/manifest.md` and `docs/specification/publish.md` already describe the field and publish behavior correctly; they MAY receive a short cross-reference to the TUI, but they do not require semantic changes.

Rationale: the design changes observable CLI behavior covered by authoring docs and changes the recommended workflow in the publish guide. The specification docs remain the source of truth for the manifest and publish contract.

## Risks / Trade-offs

- **Risk: Focus-order regressions in create/edit wizards** → Mitigation: update both duplicated `computeFocusIds(form)` implementations and add tests or focused component coverage where existing test patterns allow; manually verify keyboard order if no reliable Ink test exists.
- **Risk: Public selection accidentally leaves stale `private: true` during edit** → Mitigation: make `buildManifest()` explicitly delete `manifest.private` whenever the form boolean is false; add a unit test for private-to-public editing.
- **Risk: Explicit `private: false` preservation adds a small output-branch exception** → Mitigation: keep the UI state binary, document that omission versus explicit false is handled only at the manifest output boundary, and specify tests for omitted-public preservation, explicit-false preservation, and private-to-public deletion.
- **Risk: Implementers copy the wrong local optional-field pattern** → Mitigation: design and tasks SHALL call out that privacy should mirror asset-section set/delete behavior, not description's truthy-only assignment after `...original`.
- **Risk: `ScaffoldOptions` optional true-only type is unfamiliar** → Mitigation: document the type at the interface boundary and test both absent and true generation paths.
- **Risk: Guidance text adds visual clutter** → Mitigation: keep guidance as a dimmed one-line hint near the toggle or confirmation summary rather than a modal or multi-paragraph explanation.
- **Risk: Docs overstate publish behavior changes** → Mitigation: update docs to say authoring changed, while build, publish, registry enforcement, and version immutability remain unchanged.

## Migration Plan

This is an additive local authoring change. Existing manifests remain valid and require no migration.

Implementation rollout:

1. Add privacy state and scaffold generation support.
2. Add the toggle component and wire it into create/edit views, focus order, snapshots, and confirmation summaries.
3. Update edit manifest construction to make privacy state authoritative.
4. Add/adjust tests for scaffold output, form hydration, edit output, and confirmation/toggle behavior where practical.
5. Update docs listed above.
6. Run `bun check` before implementation is considered complete.

Rollback strategy: revert the TUI/scaffold/edit changes. Manifests created with `private: true` remain valid because schema support already exists independently of this change.

## Open Questions

None. The key product choice — public selections omit `private` rather than writing `private: false` — is resolved by the proposal and this design.

Future-scope items explicitly resolved out of this change:

- A third explicit-public state that writes `private: false` is out of scope because it reintroduces UI states this design intentionally avoids.
- A non-interactive `facet create --private` flag is out of scope because the proposal targets interactive authoring flows. The true-only `ScaffoldOptions.private?: true` shape would support that future addition without changing manifest serialization.
