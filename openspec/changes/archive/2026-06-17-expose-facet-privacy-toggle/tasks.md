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

## 1. Form State and Scaffold Privacy — Research

- [x] 1.1 Explore: Read `packages/cli/src/tui/context/form-state-context.ts` and catalog every `FormState` construction/mapping site, including `defaultForm`, `FormStateContext` defaults, provider initialization, and `toCreateOptions()`.
- [x] 1.2 Explore: Read `packages/engine/src/scaffold/index.ts` and catalog `ScaffoldOptions`, `generateScaffoldManifest()`, and optional-field serialization/ordering patterns for `description`, `skills`, `agents`, and `commands`.
- [x] 1.3 Explore: Review existing unit and TUI test patterns for scaffold generation, `toCreateOptions()`, and form-state conversion.
- [x] 1.4 Propose: Present the form-state and scaffold implementation approach, including `FormState.private: boolean`, `ScaffoldOptions.private?: true`, true-only interface documentation, manifest field ordering after `version`/`description` and before asset sections, and create-option conversion.

## 2. Form State and Scaffold Privacy — Implementation

- [x] 2.1 Implement: Add `private: boolean` as a sibling of `fields` in `packages/cli/src/tui/context/form-state-context.ts` and initialize it to `false` in `defaultForm`, context defaults, and provider initialization.
- [x] 2.2 Implement: Update `toCreateOptions()` to pass `private: true` only when `form.private` is true.
- [x] 2.3 Implement: Add documented `private?: true` support to `ScaffoldOptions` in `packages/engine/src/scaffold/index.ts`, preserving the true-only contract at the interface boundary.
- [x] 2.4 Implement: Update `generateScaffoldManifest()` to write `manifest.private = true` only when present, with `private` placed after `version`/`description` and before asset sections.
- [x] 2.5 Implement: Add or update tests proving create defaults omit `private`, private create writes `private: true`, no meaningful `false` create option path exists, and scaffold output keeps the intended field ordering.
- [x] 2.6 Verify: Run the focused package checks or tests that cover scaffold generation and form-state conversion.

## 3. Create/Edit TUI Privacy Control — Research

- [x] 3.1 Explore: Review `packages/cli/src/tui/components/button.tsx`, `editable-field.tsx`, `asset-section.tsx`, `useFocusOrder()`, and `useInput({ isActive })` patterns to choose the smallest consistent toggle implementation.
- [x] 3.2 Explore: Review `packages/cli/src/tui/views/create/create-view.tsx` and `packages/cli/src/tui/views/edit/edit-view.tsx`, recording both duplicated `computeFocusIds(form)` implementations, current focus chains, and Version `onConfirm` behavior.
- [x] 3.3 Explore: Review `packages/cli/src/tui/views/create/confirm-view.tsx` and `packages/cli/src/tui/views/edit/edit-confirm-view.tsx` to locate identity rows and summary guidance placement.
- [x] 3.4 Propose: Present the TUI approach for a focusable privacy toggle, including component API, labels, keyboard behavior, focus transitions, exact guidance string, and the requirement that both duplicated `computeFocusIds(form)` lists change in the same implementation pass.

  Decided keys: Space and Left/Right toggle Public/Private; Enter advances to the first asset add control; key hints shown in the TUI. Side fix: Shift+Tab should move focus backward (currently only Tab forward works).

## 4. Create/Edit TUI Privacy Control — Implementation

- [x] 4.1 Implement: Add a reusable focusable boolean toggle component, such as `packages/cli/src/tui/components/boolean-toggle.tsx`, accepting `id`, `label`, `value`, `onToggle`, and optional `hint`/`dimmed` props.
- [x] 4.2 Implement: Wire the privacy toggle into `create-view.tsx` after Version and before asset controls, binding it to `form.private`, inserting `field-private` after `field-version` in `computeFocusIds(form)`, routing Version confirmation to `field-private`, and routing toggle activation to the first asset add control.
- [x] 4.3 Implement: Wire the privacy toggle into `edit-view.tsx` with the same placement, binding, `computeFocusIds(form)` insertion, and focus transitions so create/edit focus lists stay in lockstep.
- [x] 4.4 Implement: Update `confirm-view.tsx` and `edit-confirm-view.tsx` to show `Privacy: Public` or `Privacy: Private` plus the concise guidance string: `Privacy is embedded at build time; rebuild after changing it. Published versions require a version bump.`
- [x] 4.5 Implement: Add or update TUI/component tests where practical for toggle rendering, focus reachability, keyboard toggling, and confirmation-summary privacy display.
- [x] 4.6 Verify: Run the focused CLI tests or snapshots that cover create/edit TUI behavior.

## 5. Edit Manifest Output and Scenario Test Mapping — Research

- [x] 5.1 Explore: Review `packages/cli/src/tui/views/edit/manifest-to-form.ts` and `packages/cli/src/tui/views/edit/use-edit-session.ts`, especially `buildManifest()` and its `...original` preservation plus asset-section set/delete behavior.
- [x] 5.2 Explore: Review existing edit-output tests and fixtures for identity fields, asset sections, unknown fields, transactional apply behavior, and current CLI integration/e2e coverage.
- [x] 5.3 Propose: Present the edit-output rules for privacy, including `manifest.private === true` hydration, omitted/false public hydration, private-to-public deletion, omitted-public preservation, explicit `private: false` preservation, public-to-private writing, and unrelated top-level field preservation.
- [x] 5.4 Propose: Map each privacy spec scenario to a concrete test and location, covering public-default omission, private-true generation, create private-then-public revert, edit omitted-public preservation, edit explicit `private: false` preservation, edit private-to-public deletion, edit public-to-private write, confirmation summaries, and no auto-rebuild/publish/registry contact.

## 6. Edit Manifest Output and Tests — Implementation

- [x] 6.1 Implement: Update `manifestToFormState()` so `private: true` hydrates as private and both omission and `private: false` hydrate as public.
- [x] 6.2 Implement: Update `buildManifest()` so `form.private === true` writes `private: true`, public with original `private: false` preserves `private: false`, and public with original omission or `private: true` omits `private`.
- [x] 6.3 Implement: Ensure edit output preserves unrelated top-level manifest fields while making privacy state authoritative according to the approved output rules.
- [x] 6.4 Implement: Add or update tests covering `manifestToFormState()` privacy hydration for omitted, `false`, and `true`.
- [x] 6.5 Implement: Add or update tests covering `buildManifest()` privacy output for true→`private: true`, public+original-false→preserve false, public+original-omitted→omit, private-original→public→delete, and unknown-field preservation.
- [x] 6.6 Implement: Add or update create/scaffold/TUI tests from the scenario-to-test map, including create private-then-public revert, confirmation privacy rows, and no automatic rebuild/publish/registry contact where practical.
- [x] 6.7 Verify: Run the focused CLI and engine tests for manifest hydration, manifest output, scaffold output, and create/edit TUI behavior.

## 7. Documentation and End-to-End Verification — Research

- [x] 7.1 Explore: Review `docs/cli/authoring/create.md`, `docs/cli/authoring/edit.md`, and `docs/guides/publish-a-facet.md` for privacy-authoring updates and stale hand-edit-first guidance.
- [x] 7.2 Explore: Review `docs/specification/manifest.md`, `docs/specification/publish.md`, `docs/guides/create-your-first-facet.md`, and root `README.md` for cross-references or wording that may need to mention the new TUI privacy control.
- [x] 7.3 Propose: Present the documentation update set, keeping manifest/publish semantics as the source of truth and avoiding claims of registry/API changes.

## 8. Documentation and End-to-End Verification — Implementation

- [x] 8.1 Implement: Update create authoring docs to include the Privacy step, public default, omitted-public serialization, private `true` serialization, and confirmation-summary behavior.
- [x] 8.2 Implement: Update edit authoring docs to include privacy inspection/editing, explicit `private: false` preservation, private-to-public omission, and confirmation-summary guidance.
- [x] 8.3 Implement: Update the publish guide to prefer `facet edit` for changing visibility while preserving rebuild, version-bump, immutable-published-version, and content-drift guidance.
- [x] 8.4 Implement: Add short cross-references in manifest or publish specification docs only if needed to connect the existing privacy semantics to the new TUI authoring surface. (Skipped per review: spec docs already describe privacy correctly; authoring docs link to them, no back-reference needed.)
- [x] 8.5 Verify: Re-read updated docs against the implemented behavior and confirm no residual hand-edit-first guidance or stale wizard-field descriptions remain.
- [x] 8.6 Verify: Run `bun check` and fix any failing tests, type errors, lint errors, or formatting issues using `bun format` for Biome formatting failures.
- [x] 8.7 Verify: Verify the OpenSpec change with the appropriate OpenSpec validation command before implementation is considered complete.
