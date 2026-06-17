## Context

The facet manifest schema already recognizes an optional top-level `private` boolean. `private: true` declares private publish intent; `false` or omission is public-by-default. Validation does not synthesize a default — omission stays omission in validated data — so tooling sees exactly what the author wrote (`packages/protocol/src/schemas/facet-manifest.ts`; `docs/specification/manifest.md` Privacy section). Everything downstream of the manifest already honors this field: build embeds it verbatim into the `.facet` artifact, publish carries it to the registry as ordinary manifest content, publish-time drift detection treats a flipped `private` as content drift, and immutability forces a version bump to change visibility on an already-published version (`docs/specification/publish.md`, `docs/guides/publish-a-facet.md`).

The gap is entirely at the front of the authoring workflow. The interactive `facet create` wizard and `facet edit` workbench collect and display the facet's identity fields (name, description, version) and asset sets, but never surface `private`. The only documented way to set or flip visibility is to hand-edit `facet.json` (`docs/guides/publish-a-facet.md` "Making a published facet private (or public)"). This is hidden functionality: authors do not discover the field, cannot observe a facet's current visibility while editing, and risk typos the manifest validator only catches later.

Current implementation state relevant to this design:

- **Shared form state** (`packages/cli/src/tui/context/form-state-context.ts`) models identity fields as `FieldState` (a `{ value: string; status }` shape) and three asset sections. There is no boolean-backed field and no boolean input primitive anywhere in `packages/cli/src/tui`. The closest focusable patterns are `components/button.tsx` (Enter-to-act) and `components/editable-field.tsx` (string-field lifecycle, hard-typed to `RequiredFieldKey`).
- **Focus order** (`context/focus-order-context.ts`) is an ordered array of string IDs, computed per-view by a duplicated `computeFocusIds(form)` in `views/create/create-view.tsx` and `views/edit/edit-view.tsx`.
- **Confirmation pages** (`views/create/confirm-view.tsx`, `views/edit/edit-confirm-view.tsx`) render Name/Description/Version rows before applying.
- **Scaffold generation** (`packages/engine/src/scaffold/index.ts`) builds the manifest object via conditional key assignment — `name`/`version` always written, `description`/asset sections written only when non-empty — then `JSON.stringify(manifest, null, 2)`. There is no `private` and no `author` in `ScaffoldOptions`.
- **Edit result construction** (`packages/cli/src/tui/views/edit/use-edit-session.ts` `buildManifest`) rebuilds the manifest by spreading `...original` then overwriting identity fields and rebuilding asset sections (empty sections are `delete`d). Because of `...original`, any existing `private` already survives an edit untouched even though no UI references it. The write goes through engine's `edit/manifest-writer.ts` (`Bun.write(path, JSON.stringify(manifest, null, 2))`).
- **Edit seeding** (`views/edit/manifest-to-form.ts`) maps `name`/`description`/`version` and assets into form state; it does not read `private`.

Constraints:

- The change MUST NOT alter the schema, build embedding, publish behavior, or registry semantics. It is an authoring affordance only.
- Public-by-default MUST remain omission, not `private: false` — including when an author moves a previously private facet back to public. This is the proposal's settled rule and matches the schema's "omission is not synthesized" guarantee, so an in-tool toggle round-trips to a manifest byte-identical to what a careful author would hand-write.
- Constitution Article III: this change alters documented CLI behavior, so the affected docs MUST be identified and updated as scoped work.

## Goals / Non-Goals

**Goals:**

- Make publish visibility a first-class, observable choice in both interactive authoring tools, so authors can set it on create and inspect/change it on edit without leaving the TUI or hand-editing JSON.
- Preserve the manifest's existing serialization contract exactly: `private: true` is written only when selected; every public selection omits the key, never emitting `private: false`.
- Surface, at the point of toggling, the consequence that visibility is manifest content — it requires a rebuild to take effect and a version bump if the current version is already published — so authors meet the existing publish-time rules at decision time rather than at failure time.
- Keep documentation aligned: update create/edit docs to mention the new step, and rewrite the publish guide's hand-edit instruction to lead with the in-tool toggle while preserving rebuild/version-bump discipline.

**Non-Goals:**

- No schema change, no change to `private` validation, build embedding, or how it travels to the registry.
- No registry-side visibility enforcement or access control.
- No standalone non-interactive command (`facet private` / `facet public`).
- No automatic rebuild or republish on toggle; build and publish remain separate explicit steps.
- No privacy controls for composed dependencies or installed facets.
- No new option for non-interactive create/edit (e.g., a `--private` flag). Scope is the interactive flows only; a flag is a possible future addition.

## Decisions

### Decision 1: Model visibility as a dedicated boolean field, not a `FieldState`

`FormState.fields` holds `FieldState` values whose `value` is a `string`. Visibility is a two-state boolean (private vs. public-by-default), so reusing the string `FieldState` shape would force an illegal-state-prone encoding (what string means "public"? is `""` public or unset?).

**Decision:** Add a dedicated boolean-backed entry to `FormState` — `private: boolean` (default `false`) — separate from the string `fields` map, and add a `setPrivate(value: boolean)` mutator to the form-state context. Both `facet create` and `facet edit` share this single field because they share `FormStateProvider`.

**Why over alternatives:**

- *Reuse `FieldState` with `value: 'public' | 'private'`* — overloads a string field to carry an enum, reintroduces the "what is empty?" question, and would require special-casing every `FieldState` consumer. Rejected: it makes an illegal state (`value: ""` on a non-optional toggle) representable.
- *Store visibility only as the raw `private` value (`boolean | undefined`)* — mirrors the manifest's `boolean | undefined`, but the UI never needs three states: the toggle is binary, and "omitted" and "false" are the same user-facing choice (public). Carrying `undefined` into the form would push manifest-serialization concerns up into the UI. Rejected: the form should model the *user's* binary choice; the omit-vs-write distinction belongs at serialization (Decision 3).

The toggle defaults to public (`private: false`) on create, so a scaffolded manifest with the author taking no action is byte-identical to today's output.

### Decision 2: A new reusable focusable toggle component

No boolean input primitive exists in the TUI. The toggle must participate in the existing focus-order array (Enter/Space to flip, arrow/Tab to move on) and render its current state plus the public-by-default explanation.

**Decision:** Add one reusable toggle component under `packages/cli/src/tui/components/` modeled on `button.tsx`: it reads `focusedId` from `useFocusOrder()` to compute `isFocused`, binds `useInput` while focused to flip the bound boolean on Enter (and Space), and renders a focus prefix consistent with the other focusable rows. It reads/writes the form-state `private` field via the context mutator from Decision 1. The component is shared by both create and edit views.

**Why over alternatives:**

- *A select/radio prompt (two options: Public / Private)* — heavier, visually inconsistent with the single-line identity rows, and `select-prompt.tsx` is documented as single-select "without selection toggle." Rejected: a binary toggle is simpler and matches the row-based form.
- *Inline the toggle logic in both views* — duplicates focus/keybinding logic across create and edit. Rejected: violates single-source-of-truth; a shared component is the established pattern (`button.tsx`, `editable-field.tsx`).

### Decision 3: Omission-preserving serialization at the manifest-construction boundary

This is the load-bearing decision. The settled rule is: write `private: true` only when private is selected; otherwise omit the key entirely, including when an author returns a previously private facet to public. The two write paths (scaffold and edit) have different starting points and so need different mechanics to reach the same guarantee.

**Scaffold (`generateScaffoldManifest`):** the manifest is built from scratch by conditional assignment. Add `private?: boolean` to `ScaffoldOptions` and a conditional block matching the existing `description` precedent:

```
if (opts.private) {
  manifest.private = true
}
```

A truthy check means `false`/`undefined` never assigns the key, so `JSON.stringify` omits it. Placed after `version` to match schema field order. `toCreateOptions` and the form defaults in `form-state-context.ts` thread the new field through.

**Edit (`buildManifest`):** the manifest is rebuilt via `...original`, which *reintroduces* any pre-existing `private`. A truthy-only set is therefore insufficient for the public case — moving private→public would leave the spread-in `private: true` in place. The construction MUST explicitly delete the key when public:

```
if (form.private) {
  manifest.private = true
} else {
  delete manifest.private
}
```

This mirrors the asset-section set/`delete` pattern already in `buildManifest` (not the `description` pattern, which has a known stale-value quirk when a field is cleared). The result: private→public writes a manifest with no `private` key at all (omission, not `private: false`), satisfying the settled rule.

**Why over alternatives:**

- *Write `private: false` for public* — simpler and schema-valid, but contradicts the proposal's settled rule and the schema's "omission is not synthesized" guarantee, and would make an in-tool public selection produce a different on-disk manifest than a hand-written one. Rejected by the proposal.
- *Centralize a single shared manifest writer that strips falsey `private`* — attractive (scaffold and edit currently duplicate `JSON.stringify(x, null, 2)`), but consolidating the two writers is out of scope and the divergent starting points (build-from-scratch vs. spread-original) still need different upstream handling. Noted as a follow-up, not done here.

### Decision 4: Seed edit visibility from the loaded manifest, treating `false` and omission identically

`manifestToFormState` currently ignores `private`. To let the workbench display current visibility, it MUST read it.

**Decision:** In `manifestToFormState`, set the form's `private` field to `manifest.private === true`. Both `private: false` and an omitted field map to `false` (public), because they are the same user-facing state. This is a deliberate normalization at the read boundary: the workbench shows two states, and a manifest that happened to carry an explicit `private: false` is displayed as public. Note the round-trip consequence: opening such a manifest and applying any edit will, per Decision 3's edit `delete`, rewrite it to omit `private` — converging the on-disk form to the canonical omission representation. This is acceptable and arguably desirable (it removes a redundant `private: false`), and MUST be called out in the spec scenarios so it is intended behavior, not a surprise.

### Decision 5: Visibility consequence messaging lives at the toggle, statically

The author must learn that toggling is a content change requiring rebuild (and a version bump if already published). The tools cannot know whether the current version is already published without a registry round-trip, which is out of scope.

**Decision:** Render a short static note adjacent to the toggle (in both create and edit) stating that changing visibility is a manifest content change that takes effect only after a rebuild, and requires a version bump if the current version has already been published. The note is informational and unconditional; it does not query the registry and does not gate the toggle.

**Why over alternatives:**

- *Detect whether the version is published and warn conditionally* — requires a network call and credentials inside the authoring flow, expanding scope into publish/registry concerns the proposal excludes. Rejected.
- *Surface the warning only at publish time* — that path already exists (drift detection), but the goal is to inform the author at the decision point, not at the failure point. The static note complements, not replaces, the publish-time messaging.

### Decision 6: Confirmation summary shows visibility as a labeled row

Both confirmation pages list identity fields before applying. Visibility is now part of that identity decision.

**Decision:** Add a "Visibility" row to both `confirm-view.tsx` and `edit-confirm-view.tsx`, rendering "Private" when selected and "Public (default)" otherwise. This keeps the summary a faithful preview of what will be written. Because the create confirmation already previews files via `previewScaffoldFiles(opts)`, the threaded `private` option is reflected there automatically once `toCreateOptions` carries it.

## Risks / Trade-offs

- **[Spread reintroduces `private` on edit → private→public would silently stay private]** → Decision 3 mandates an explicit `delete manifest.private` in the public branch of `buildManifest`, mirroring the existing asset-section delete pattern. Spec scenarios MUST cover the private→public round-trip asserting the key is absent (not `false`).
- **[A manifest with explicit `private: false` is normalized to omission on the next edit-apply]** → This is intended (Decision 4). The risk is an author perceiving an unexpected diff. Mitigation: a spec scenario documents this normalization as expected behavior; the on-disk meaning (public) is unchanged.
- **[Two divergent write paths drift apart]** → Scaffold and edit already serialize independently with identical formatting. This change adds parallel `private` logic to both, increasing the surface that must stay in sync. Mitigation: identical guarantee expressed as spec scenarios that apply to both flows; a future consolidation of the two writers is noted but explicitly out of scope.
- **[Boolean field breaks `FieldState`-shaped consumers]** → A new boolean field on `FormState` outside the string `fields` map could be missed by code that iterates `fields`. Mitigation: keep the boolean as a sibling of `fields`, not a member, and add it to defaults, `toCreateOptions`, and `manifestToFormState` in one change so all construction sites are covered.
- **[Focus-order duplication]** → The new toggle's focus ID must be inserted into the duplicated `computeFocusIds` in both create and edit views, and its `onConfirm`/focus chaining wired in both. Missing one yields a non-reachable or mis-ordered control. Mitigation: add to both views in the same change; cover focus reachability where practical in tests.
- **[Documentation drift]** (Article III) → `docs/cli/authoring/create.md` and `docs/cli/authoring/edit.md` describe the wizard fields and do not mention visibility; they MUST gain the new step. `docs/guides/publish-a-facet.md` "Making a published facet private (or public)" leads with hand-editing `facet.json`; it MUST be rewritten to lead with the in-tool toggle while preserving the rebuild + version-bump steps. `docs/specification/manifest.md` Privacy section SHOULD note the field is now author-settable through the tools. No behavior change is expected in `docs/specification/publish.md` (publish-time handling is unchanged), but its drift-detection text already correctly describes a flipped `private` as content drift and need not change.

## Migration Plan

No data migration. This is additive UI plus serialization wiring with no schema or on-disk format change. Existing manifests are unaffected until an author opens one in `facet edit` and applies a change, at which point a redundant `private: false` (if any) normalizes to omission (Decision 4) — a no-op in meaning. No rollback concern beyond reverting the code; reverted tools simply stop showing the toggle, and any `private: true` previously written remains valid and honored by build/publish.

## Open Questions

- Should the toggle expose a third explicit "public (`private: false`)" state for authors who want the field written explicitly? The proposal's settled rule (always omit for public) argues no, and a third state reintroduces the illegal-state surface Decision 1 avoids. Treated as resolved against a third state unless a concrete need surfaces.
- Should a non-interactive `--private` flag for `facet create` be added so CI/scripted scaffolds can declare visibility without the wizard? Out of scope here (Non-Goals), but the threaded `ScaffoldOptions.private` from Decision 3 makes it a small future addition.
