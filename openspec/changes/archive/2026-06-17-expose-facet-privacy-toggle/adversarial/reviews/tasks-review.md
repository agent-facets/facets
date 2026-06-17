# Adversarial Comparison Review — `tasks`

**Sources compared**

- **Main**: `openspec/changes/expose-facet-privacy-toggle/tasks.md` (the main agent's version).
- **Adversary**: `openspec/changes/expose-facet-privacy-toggle/adversarial/artifacts/tasks.md` (authored blind under `/run-adversary`).

Both are VIPER task lists for the same reconciled `proposal` / `design` / `specs`. The dependency artifacts (`specs`, `design`) are `reconciled`; this review judges the two task lists against that trustworthy state.

## Grading bar (scoped to a tasks artifact)

- **Traceability**: every reconciled spec scenario and design decision has a task that implements *and* verifies it.
- **Atomic + testable**: each task is a single, checkable unit of work with a clear done condition.
- **Correct VIPER mechanics**: Research blocks before Implementation; Explore/Propose are read-only gates; Verify steps run real checks; no Implement step hidden inside a Research block.
- **Correct artifact mechanics**: tasks reference the actual files/symbols in this repo, respect the engine↔CLI boundary, and end with the OpenSpec verification obligation.
- **Coverage**: the union of tasks covers the whole change with no orphaned spec scenario and no scope creep beyond the design's non-goals.

## Coverage comparison

Both lists share the same backbone and the same 8-section, Research-then-Implementation cadence. They diverge mainly in **specificity** and in **how the work is grouped**.

| Area | Main | Adversary |
|---|---|---|
| Section grouping | 4 work areas: (1/2) form+scaffold, (3/4) TUI control, (5/6) **edit manifest output**, (7/8) docs+e2e | 4 work areas: (1/2) form+scaffold, (3/4) toggle+view wiring, (5/6) **tests**, (7/8) docs |
| File/symbol naming | Mostly **abstract** ("shared create/edit form state", "engine scaffold option types") | **Concrete paths/symbols** (`form-state-context.ts`, `generateScaffoldManifest`, `manifest-to-form.ts`, `use-edit-session.ts`, `buildManifest`, `computeFocusIds`) |
| `buildManifest` 3-way rule | Covered (6.2) and tested (6.4) but stated abstractly | Covered (2.4) + dedicated test 6.3 enumerating all four output rules, mirrors design Decision 4's set/preserve/delete branches verbatim |
| Edit hydration (`manifestToFormState`) | 6.1, abstract | 2.3 + test 6.2, names the symbol and `manifest.private === true` rule |
| Focus-chain lockstep risk | 4.2/4.3 separately wire create and edit | 3.2/3.4/4.2/4.3 explicitly call out **both duplicated `computeFocusIds` must change together** so no wizard ships an unreachable toggle (design Risk + Decision 3) |
| Tests as their own block | Interleaved into each work area (2.4, 4.5, 6.4) | Consolidated into Section 5/6 with a per-scenario mapping Propose (5.2) |
| Confirmation guidance string | 4.4 "concise rebuild/version-bump guidance" | 3.4/4.4 quotes the exact design string and names both confirm-view files |
| Final OpenSpec verify | **8.6 present** ("Verify the OpenSpec change … before complete") | **Absent** — final step is `8.4` re-read docs + `bun check` |
| `bun format` guidance | **8.5 present** (Biome formatting via `bun format`) | Absent |

## Material divergences

### D1 — Concreteness of file/symbol references (Adversary stronger)

The adversary names exact files and functions (`form-state-context.ts`, `defaultForm`, `toCreateOptions()`, `generateScaffoldManifest`, `manifest-to-form.ts`, `use-edit-session.ts`/`buildManifest`, `computeFocusIds`, `confirm-view.tsx`/`edit-confirm-view.tsx`). The main list stays abstract ("shared create/edit form state", "edit-session manifest construction"). Both are *executable* because each begins with Explore steps, but the adversary's version removes a discovery round and pins implementers to the design's chosen seams. **Adversary stronger** on traceability and reducing the chance an implementer touches the wrong layer.

### D2 — Final OpenSpec verification step (Main stronger — blocking)

The main list ends with **8.6: "Verify the OpenSpec change with the appropriate OpenSpec validation command before implementation is considered complete."** The adversary list has **no** OpenSpec-validation terminal step — it ends at docs re-read + `bun check`. The OpenSpec apply/verify workflow expects a validation gate before a change is archived; omitting it is a real coverage hole. **Main stronger, and this is the one blocking item** (see below).

### D3 — `bun format` / Biome guidance (Main stronger)

Main 8.5 explicitly instructs using `bun format` for Biome formatting failures, matching this repo's AGENTS.md rule ("run `bun format` — do NOT hand-edit whitespace"). The adversary relies on bare `bun check`. Minor, but the main version encodes the house rule. **Main stronger.**

### D4 — Test organization (toss-up, lean Adversary on mapping rigor)

Main interleaves tests into each work area (closer to TDD-per-feature); the adversary isolates tests into Section 5/6 with an explicit **5.2 Propose that maps each spec scenario to a concrete test + location** and a decision on what is unit-testable vs. needs e2e for Ink components. The mapping Propose is the stronger artifact for guaranteeing scenario coverage; the interleaving is the stronger habit for keeping tests adjacent to the code. Neither is wrong. The adversary's explicit scenario-to-test map is the more valuable single feature here because it makes the spec's eight privacy scenarios auditable.

### D5 — Focus-chain lockstep emphasis (Adversary stronger)

The design lists "focus-order regressions" as the top risk and "both `computeFocusIds` lists in the same step" as the mitigation. The adversary surfaces this in four places (3.2 record both impls, 3.4 both lists change in same step, 4.2/4.3 in lockstep). Main 4.2/4.3 wires each view but does not name the duplication or the "same step" constraint. **Adversary stronger** on encoding a named design risk into the task contract.

### D6 — `ScaffoldOptions` true-only contract callout (Adversary slightly stronger)

Adversary 2.1 says to document the `private?: true` true-only contract *at the interface*, matching design Risk "true-only type is unfamiliar → document at interface boundary." Main 2.3 just adds the field. Minor.

### D7 — Manifest field ordering (Adversary stronger, minor)

Adversary 1.2/2.1/6.1 explicitly place `private` after `version`/`description` and before asset sections (design Decision 2 SHOULD) and test ordering. Main does not mention field position. Minor but it's a stated design SHOULD with a test attached only on the adversary side.

## Where Main is genuinely stronger (not just "adversary wins")

- **D2 OpenSpec verification gate** and **D3 `bun format`** are real, repo-correct obligations the adversary dropped.
- Main's **interleaved Verify steps** (2.5, 4.6, 6.5) are scoped to focused package checks rather than only repo-root `bun check`, which is faster feedback during implementation.
- Main keeps the **edit-output work as its own section (5/6)** with explicit unknown-field-preservation tasks (6.3 "preserve unrelated top-level manifest fields", 6.4 "unknown-field preservation"). The adversary folds edit output into Section 2 and, while it covers the four privacy rules, it does **not** call out unknown/unrelated top-level field preservation as a distinct task — the design's `...original` spread behavior. **Main stronger on this preservation guarantee.**

## Merge recommendation (per work-area)

Recommended base: **Main** (it already carries the OpenSpec verify gate, `bun format` rule, and explicit unknown-field-preservation tasks), folding in the adversary's concreteness and risk callouts.

- **Sections 1/2 (form + scaffold)**: Adopt the adversary's concrete file/symbol references (D1), the true-only `private?: true` interface-doc note (D6), and the field-ordering placement + test (D7). Keep main's separate scaffold/form structure.
- **Sections 3/4 (TUI toggle)**: Adopt the adversary's explicit **"update both `computeFocusIds` in the same step"** lockstep language (D5) and the exact confirmation guidance string + named `confirm-view.tsx`/`edit-confirm-view.tsx` files. Keep main's focused per-view Verify (4.6).
- **Edit output**: **Keep main's dedicated edit-output section** including the unknown/unrelated-field-preservation task. Layer in the adversary's enumerated four-rule `buildManifest` test (D4/edit) and the `manifest-to-form.ts` symbol name.
- **Tests**: Adopt the adversary's **5.2-style scenario→test mapping Propose** as a planning step even if tests stay interleaved — it makes the eight privacy spec scenarios auditable. Ensure the map includes the create *select-private-then-revert* scenario (spec line 135) and explicit `private: false` preservation, both of which the adversary calls out and main covers only implicitly.
- **Docs (7/8)**: Equivalent; keep main. Both cover create/edit/publish-guide and optional spec cross-refs within design Decision 6's bounds.
- **Final verification**: **Keep main 8.5 (`bun format`) and 8.6 (OpenSpec validation).** Do not let the adversary's omission propagate.

## Blocking cross-cutting item

**The merged tasks MUST retain a terminal OpenSpec-validation step (main 8.6).** The adversary's list lacks any OpenSpec verification gate before completion. Whatever structure is adopted, the change cannot be considered implementation-complete/archivable without that validation step. This is the single must-settle item before the artifact is finalized.

Secondary (non-blocking but strongly recommended): ensure the merged list keeps an explicit **unknown/unrelated top-level manifest field preservation** task (main 6.3) — it traces to the design's `...original` spread behavior and the transactional-edit requirement, and the adversary's grouping loses it.
