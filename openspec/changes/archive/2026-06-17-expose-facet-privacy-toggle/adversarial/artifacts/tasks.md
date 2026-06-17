> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## Step Types

- **Verify** → CHECK. Run automated checks (tests, lint, type checks).
  If all checks pass, proceed. If anything fails, STOP and notify the user.
- **Implement** → WRITE. Make code changes — create, edit, or delete files.
- **Propose** → READ-ONLY + USER GATE. Present intended changes in your message text first,
  then ask for approval using the `question` tool with a short prompt (Approve / Reject / Request changes).
  Never put details in the question — the question is just the gate. Do not write anything.
- **Explore** → READ-ONLY. Read files, search the codebase, investigate broadly.
  No writes allowed. Use this to understand the problem space before acting.
- **Review** → READ-ONLY + USER GATE. Present findings and analysis in your message text first,
  then ask for feedback using the `question` tool with a short prompt.
  Never put details in the question — the question is just the gate.

## 1. Shared form privacy state and scaffold generation — Research

- [ ] 1.1 Explore: Read `packages/cli/src/tui/context/form-state-context.ts` and catalog every construction site of `FormState` and every place that maps form to output: `defaultForm`, the `FormStateContext` default context value, `toCreateOptions()`, and the `FormStateProvider` initial-state path. Note the exact shape of `FormState` (the `fields` map of `FieldState` whose `value` is a `string`, sibling `assets`) so privacy is added as a sibling boolean, not as a `fields` member or an asset.
- [ ] 1.2 Explore: Read `packages/engine/src/scaffold/index.ts` (`ScaffoldOptions`, `generateScaffoldManifest`, `previewScaffoldFiles`, `writeScaffold`) and the existing conditional-assignment style for optional fields (`description`, `skills`, `agents`, `commands`). Confirm manifest field ordering (`name`, `version`, `description`, then asset sections) so a `private` key can be placed after `version`/`description` and before asset sections. Confirm engine never imports CLI display code (engine `AGENTS.md` boundary).
- [ ] 1.3 Explore: Read `packages/cli/src/tui/views/edit/manifest-to-form.ts` and `packages/cli/src/tui/views/edit/use-edit-session.ts` (`buildManifest`, which spreads `...original`). Determine exactly how a top-level `private` field is currently preserved/erased through `...original` and how asset sections use explicit set-or-`delete` (the correct local precedent for a removable-after-spread field), in contrast to `description`'s truthy-only assignment.
- [ ] 1.4 Propose: Define the engine + shared-state approach for the whole implementation block: the `ScaffoldOptions` privacy field shape (`private?: true`, true-only), the `generateScaffoldManifest` conditional that writes `manifest.private = true` only when the option is present and in the correct field position, the `FormState` sibling `private: boolean` (default `false`), the updates to all four form construction sites, `toCreateOptions()` emitting `private: true` only when `form.private` is true, `manifestToFormState()` hydrating `private: manifest.private === true`, and the `buildManifest()` privacy rules (true → set `private: true`; false + `original.private === false` → preserve `false`; false + `original.private !== false` → `delete manifest.private`). Cite the spec scenarios each rule satisfies.

## 2. Shared form privacy state and scaffold generation — Implementation

- [ ] 2.1 Implement: In `packages/engine/src/scaffold/index.ts`, add `private?: true` to `ScaffoldOptions` (documenting the true-only contract at the interface), and update `generateScaffoldManifest()` to assign `manifest.private = true` only when `opts.private` is present, positioned after `version`/`description` and before asset sections.
- [ ] 2.2 Implement: In `packages/cli/src/tui/context/form-state-context.ts`, add a required sibling `private: boolean` to `FormState`, default it to `false` in `defaultForm` and the context default value, update `toCreateOptions()` to include `private: true` only when `form.private` is true, and add a `setPrivate(value: boolean)` (or equivalent toggle setter) to the context value and provider.
- [ ] 2.3 Implement: In `packages/cli/src/tui/views/edit/manifest-to-form.ts`, hydrate the new boolean as `private: manifest.private === true` so omission and explicit `private: false` both map to the public UI state.
- [ ] 2.4 Implement: In `packages/cli/src/tui/views/edit/use-edit-session.ts`, change `buildManifest()` so privacy is handled explicitly after `...original`: set `private: true` when `form.private` is true; preserve `private: false` when `form.private` is false and `original.private === false`; otherwise `delete manifest.private`. Mirror the asset-section set/delete pattern, not the `description` truthy-only pattern.
- [ ] 2.5 Verify: Run `bun check --filter @agent-facets/engine --filter agent-facets` (or repo-root `bun check`) and confirm types compile across all form construction sites and the engine scaffold change.

## 3. Focusable privacy toggle component and view wiring — Research

- [ ] 3.1 Explore: Read `packages/cli/src/tui/components/button.tsx`, `editable-field.tsx`, and `asset-section.tsx` to learn the focus-order/`useFocusOrder()`/`useInput({ isActive })` conventions, the `▸`-prefix focus affordance, `THEME`/gradient usage, and the `id`/`label`/`onConfirm` prop shape, so a new toggle matches the existing visual and keyboard language.
- [ ] 3.2 Explore: Read `packages/cli/src/tui/views/create/create-view.tsx` and `packages/cli/src/tui/views/edit/edit-view.tsx`. Record both duplicated `computeFocusIds(form)` implementations, the current focus chain (`field-name` → `field-description` → `field-version` → `add-<firstAssetType>` → … → submit), the `onConfirm` transition wiring on the version field, and the layout position where the toggle must be inserted (after Version, before asset sections).
- [ ] 3.3 Explore: Read `packages/cli/src/tui/views/create/confirm-view.tsx` and `packages/cli/src/tui/views/edit/edit-confirm-view.tsx` to find where identity rows (`Name:`, `Description:`, `Version:`) are rendered so a `Privacy:` row and a one-line rebuild/version-bump guidance hint can be added consistently in both.
- [ ] 3.4 Propose: Define the toggle component API (`id`, `label`, `value`, `onToggle`, optional `hint`/`dimmed`), its keyboard activation (Enter, and Space only if consistent with existing input handling), and the exact updated focus chains for both create and edit (`… field-version` → `field-private` → `add-<firstAssetType>` …), including version `onConfirm` → `field-private` and toggle activation → first asset add control. Specify the `Privacy:` confirmation rows and the exact guidance string (e.g. `Privacy is embedded at build time; rebuild after changing it. Published versions require a version bump.`). Emphasize both `computeFocusIds` lists must change in the same step so no wizard ships an unreachable toggle.

## 4. Focusable privacy toggle component and view wiring — Implementation

- [ ] 4.1 Implement: Add a reusable focusable toggle component (e.g. `packages/cli/src/tui/components/boolean-toggle.tsx`) accepting `id`, `label`, `value`, `onToggle`, optional `hint`/`dimmed`, rendering Public/Private clearly using the existing focus affordance and `THEME`.
- [ ] 4.2 Implement: Wire the toggle into `create-view.tsx`: render it after Version and before asset sections, bind it to `form.private`/`setPrivate`, update `computeFocusIds` to insert `field-private` after `field-version`, set the version field's `onConfirm` to `focus('field-private')`, and route toggle activation to the first asset add control.
- [ ] 4.3 Implement: Wire the toggle into `edit-view.tsx` with the same placement, binding, `computeFocusIds` update, and focus transitions, so the duplicated focus list is updated in lockstep with create.
- [ ] 4.4 Implement: Add a `Privacy:` row (`Public`/`Private`) to `confirm-view.tsx` and `edit-confirm-view.tsx`, plus the concise dimmed one-line rebuild/version-bump guidance near the privacy row or summary, without altering build/publish behavior.
- [ ] 4.5 Verify: Run `bun check` and manually exercise `facet create` and `facet edit` keyboard navigation to confirm the toggle is reachable in both wizards, the confirmation summaries show privacy, and no focus id is orphaned.

## 5. Tests — Research

- [ ] 5.1 Explore: Review existing engine scaffold/edit test patterns (`packages/engine/src/__tests__/edit.test.ts`, `manifest-mutations.test.ts`, and any scaffold coverage) and the CLI integration tests (`packages/cli/src/__tests__/edit-integration.test.ts`, `create-build.e2e.test.ts`) to determine where scaffold-output, form-hydration, and edit-output assertions belong and what is practically testable for Ink components (vs. requiring e2e).
- [ ] 5.2 Propose: Map each required spec scenario to a concrete test and location, covering: public-default omission, private-true generation, create select-private-then-revert omission, edit omitted-public preservation, edit explicit `private: false` preservation, edit private-to-public deletion, edit public-to-private write, and confirmation summaries showing privacy. Decide which behaviors are unit-testable at the scaffold/`buildManifest`/`manifestToFormState` boundary and which require component or e2e coverage.

## 6. Tests — Implementation

- [ ] 6.1 Implement: Add engine tests for `generateScaffoldManifest()` covering absent (`private` omitted) and `private: true` paths, including field ordering.
- [ ] 6.2 Implement: Add tests for `manifestToFormState()` mapping omitted, `private: false`, and `private: true` source manifests to the correct public/private UI boolean.
- [ ] 6.3 Implement: Add tests for `buildManifest()` covering all four privacy output rules (true→`private: true`; public+original-false→preserve `false`; public+original-omitted→omit; private-original→public→delete).
- [ ] 6.4 Implement: Add `toCreateOptions()` tests asserting `private` is emitted only as `true` and only when `form.private` is true (absent otherwise), and add component/confirmation coverage for the toggle and privacy summary rows where existing Ink test patterns allow.
- [ ] 6.5 Verify: Run `bun check` and confirm all new and existing tests pass with no type or lint regressions.

## 7. Documentation — Research

- [ ] 7.1 Explore: Read `docs/cli/authoring/create.md`, `docs/cli/authoring/edit.md`, `docs/guides/publish-a-facet.md`, `docs/specification/manifest.md`, and `docs/specification/publish.md`, plus the root `README.md`, to locate the exact sections describing the wizard fields and the current hand-edit-`facet.json` publish guidance that this change makes stale (Article III documentation-drift obligation).
- [ ] 7.2 Propose: Define the precise doc edits: add Privacy/Public-vs-Private to the create and edit wizard descriptions (clarifying public default/omission), replace the publish guide's hand-edit-first guidance with `facet edit` as the primary interactive path while preserving rebuild and version-bump instructions, and add (only if warranted) a short TUI cross-reference in the specification docs without changing their semantics.

## 8. Documentation — Implementation

- [ ] 8.1 Implement: Update `docs/cli/authoring/create.md` to document the privacy choice, public default, and `private` omission.
- [ ] 8.2 Implement: Update `docs/cli/authoring/edit.md` to document inspecting and changing privacy and the privacy confirmation row.
- [ ] 8.3 Implement: Update `docs/guides/publish-a-facet.md` to present `facet edit` as the primary way to change visibility while retaining the rebuild + version-bump discipline; add optional cross-references in `docs/specification/manifest.md`/`publish.md` and root `README.md` only where they reference changed behavior.
- [ ] 8.4 Verify: Re-read updated docs against the implemented behavior to confirm no residual hand-edit-first guidance or stale field descriptions, then run a final repo-root `bun check`.
