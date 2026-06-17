# Comparison Review: `design` — expose-facet-privacy-toggle

**Sources compared**
- **Main**: `design.md` (authored by the main agent, status `done`)
- **Adversary**: `adversarial/artifacts/design.md` (authored blind by `/run-adversary`)

Both designs converge on the same load-bearing architecture: a dedicated boolean form value shared by create and edit; a new reusable focusable toggle component (not an overloaded `EditableField`); a true-only/truthy-check scaffold path; an explicit `delete manifest.private` on the edit public branch; hydrate from `manifest.private === true`; a "Visibility/Privacy" confirmation row; static rebuild/version-bump guidance at the toggle; and the same four-area documentation update. The proposal was already reconciled, so the disagreements here are not about *what* to build but about *how precisely the design pins the mechanics to the actual code* and *which downstream consequences become mandated spec scenarios*. That is exactly where the adversary pulls ahead.

## Grading bar

Scoped to a design artifact:
1. **Decisions are real decisions** — each names the chosen approach, the rejected alternatives, and *why*, not just a restatement of the goal.
2. **Illegal states unrepresentable** — the type/serialization model is audited (project Type-Design rules), not asserted.
3. **Grounded in the actual code** — decisions cite the real files, functions, and existing patterns they extend, so an implementer can act without re-deriving the codebase.
4. **Consequences surfaced as testable obligations** — edge cases (round-trips, normalization, focus order) become explicit spec scenarios / risks, not prose asides.
5. **Correct artifact mechanics** — Context / Goals-Non-Goals / Decisions / Risks / Migration / Open Questions, all present and non-empty.
6. **Open Questions discipline** — genuinely open items are flagged; settled items are stated as settled with the resolving authority.

## Coverage comparison

| Dimension | Main | Adversary |
|---|---|---|
| Decisions count / structure | 6 decisions, each with rationale + alternatives. Clean. | 6 decisions, each with rationale + alternatives. Decision 3 explicitly labeled "the load-bearing decision." |
| Form-state model | `isPrivate: boolean` (or `private`), default `false`, hydrate `=== true`. Notes illegal-state avoidance. | `private: boolean` sibling of `fields` (not inside the string `fields` map), default `false`, `setPrivate` mutator. Calls out that `FieldState.value` is a *string* and reusing it is illegal-state-prone. |
| Scaffold path | `ScaffoldOptions.private?: true` (true-only). `toCreateOptions` adds `private: true` only when set; generate writes only when present. | `ScaffoldOptions.private?: boolean`, truthy guard `if (opts.private) manifest.private = true`. Cites the existing `description` conditional precedent and field-order placement after `version`. |
| Edit serialization | Decision 4: after `...original`, set `true` or `delete`. Mirrors "set/delete." | Decision 3: same set/`delete`, but explicitly says mirror the **asset-section** delete pattern **not** the `description` pattern, "which has a known stale-value quirk when a field is cleared." |
| Edit hydration | Decision 1 folds in `manifestToFormState` hydrating `=== true`, `false`/omission both → public. | Decision 4 (dedicated): same, **plus** spells out the round-trip consequence — opening a `private: false` manifest and applying any edit rewrites it to omission — and mandates a spec scenario so it is intended, not surprising. |
| Toggle component spec | "BooleanToggle/ToggleField" with `id`/`label`/`value`/`onToggle`/`hint`. Enter (and Space if consistent). Focus order named explicitly: `field-private` after `field-version`. | Modeled on `button.tsx`; reads `focusedId` from `useFocusOrder()`, binds `useInput` while focused, Enter/Space. Cites `select-prompt.tsx` "without selection toggle" as the rejected alternative. |
| Focus-order mechanics | States the new order and the focus transitions (version-confirm → `field-private` → first asset add). | Names the *duplication*: `computeFocusIds(form)` is duplicated in `create-view.tsx` and `edit-view.tsx`, and both must be edited or one control is unreachable. |
| Guidance messaging | Decision 5: static one-line note at toggle/confirmation; rejects per-toggle modal and docs-only. | Decision 5: static, unconditional note; rejects *registry round-trip to detect published state* (scope) and docs-only. Slightly sharper on *why* it can't be conditional. |
| Risks section | 5 risks, each with mitigation. | 6 risks, each tied back to a decision and several mandating spec scenarios. |
| Open Questions | "None" — declares the omit-when-public choice settled by proposal. | Two genuinely-open future-scope questions (third explicit-`false` state; non-interactive `--private` flag), each treated as resolved-against / out-of-scope with reasoning. |
| `author` field aside | Not mentioned. | Notes in passing that `ScaffoldOptions` has "no `private` and no `author`" — minor, slightly out of scope. |

## Material divergences

### 1. The edit serialization pattern citation — Adversary is stronger, and code-verified

Both designs mandate `delete manifest.private` on the public branch. But Main's Decision 4 lists "mirror the `description` pattern" as a *considered* approach (it doesn't pick it) without noting that `description` is a *bad* pattern to copy. I verified against `packages/cli/src/tui/views/edit/use-edit-session.ts`: `buildManifest` handles `description` as `if (form.fields.description.value) { manifest.description = ... }` with **no `else delete`**. Because of `...original`, clearing a description in the UI leaves the stale original description on disk. The asset sections, by contrast, use the correct set/`delete` shape (lines 30–38). The adversary explicitly says: mirror the asset-section set/`delete` pattern, *not* the `description` pattern, "which has a known stale-value quirk when a field is cleared." That is a precise, correct, code-grounded instruction that steers the implementer away from the one wrong local precedent. **Stronger: Adversary.** Fold the "mirror assets, not description" guidance into Main's Decision 4.

### 2. The `private: false` → omission round-trip — Adversary is stronger

Main hydrates `manifest.private === true` (Decision 1) and deletes on public (Decision 4), which means a manifest carrying an explicit `private: false` will, on the next edit-apply, be silently rewritten to omit `private`. This is a real observable behavior — an author sees a diff (`-"private": false`) they didn't intentionally make. Main never names it. The adversary makes it an explicit, deliberate normalization (Decision 4 + a dedicated risk) and **requires a spec scenario** documenting it as intended. This is the single most important coverage gap in Main: an undocumented behavior change that a reviewer or author could mistake for a bug. **Stronger: Adversary.** Recommend Main add this as an explicit design note and flag it for a specs scenario.

### 3. Form-state placement specificity — Adversary is stronger, code-verified

Main says add `isPrivate`/`private` to `FormState`. The adversary is more precise: keep the boolean a **sibling of `fields`, not a member of the string `fields` map**, because `FieldState.value` is typed `string` and consumers iterate `fields`. I confirmed in `form-state-context.ts`: `fields` is a fixed `{ name, description, version }` of `FieldState` (`value: string`), and there is no boolean primitive anywhere. The adversary also enumerates *all* the construction sites that must be touched in one change (defaults, `toCreateOptions`, `manifestToFormState`) so a `FieldState`-iterating consumer can't miss it. **Stronger: Adversary** on implementer-actionability. Main is not wrong, just less specific.

### 4. Focus-order duplication call-out — Adversary is stronger

Main correctly states the new focus order and the inter-field focus transitions — arguably *more* explicit than the adversary on the exact transition chain (version-confirm → `field-private` → first asset control). But Main does not name that the focus ID list is computed by a **duplicated `computeFocusIds(form)`** in both `create-view.tsx` and `edit-view.tsx`, so missing one view yields an unreachable control. The adversary names the duplication as a risk. **Mixed:** Main is stronger on the *desired* order/transitions; Adversary is stronger on the *implementation hazard* (the duplication). The merge should take both — Main's transition chain is genuinely useful and the adversary omits it.

### 5. Where Main is actually stronger: focus-transition detail and the true-only scaffold type

- **Focus transitions:** Main's Decision 3 spells out the runtime focus *movement* ("Version confirmation SHALL move focus to `field-private`, and toggling/confirming privacy SHALL move to the first asset add control"). The adversary describes the toggle's keybindings but not the confirm-chaining. This is real, fiddly behavior the tasks author needs. **Stronger: Main.**
- **Scaffold option type:** Main types `ScaffoldOptions.private?: true` (true-only), which is a slightly *tighter* type than the adversary's `private?: boolean` — it makes a meaningless `private: false` unrepresentable at the engine boundary, consistent with the project's Type-Design rules. The adversary relies on a truthy guard at the call site to get the same on-disk result but leaves `false` representable in the type. **Stronger: Main** on type-design rigor here; this is a genuine point in Main's favor and should be kept.

### 6. Open Questions discipline — roughly equal, slight edge Adversary

Main declares "None" and states the omit-when-public choice is settled by the proposal — defensible, since the proposal *did* settle it. The adversary lists two genuinely *future-scope* questions (a third explicit-`false` state; a non-interactive `--private` flag) and resolves both against/out-of-scope with reasoning. Neither is a true open question for *this* change, so Main's "None" is acceptable. But the adversary's framing surfaces the `--private` flag as a cheap future affordance enabled by the threaded `ScaffoldOptions.private`, which is useful forward-looking context. **Slight edge: Adversary**, but not blocking — Main's "None" is honest.

## Merge recommendation (per decision)

Keep **Main as the base** — its focus-transition detail (Decision 3) and the tighter true-only `ScaffoldOptions.private?: true` type (Decision 2) are real assets the adversary lacks — and fold in the adversary's code-grounded sharpening:

- **Decision 1 (form model):** Adopt the adversary's specificity — state the boolean is a **sibling of `fields`, not inside the string `fields` map**, and enumerate the construction sites (defaults, `toCreateOptions`, `manifestToFormState`) that must change together. Keep Main's wording otherwise.
- **Decision 2 (scaffold):** **Keep Main's `private?: true` true-only type** — it is the stronger type-design choice. Optionally borrow the adversary's note about matching the existing `description` *conditional-assignment* precedent and placing the key after `version`.
- **Decision 3/4 (edit serialization):** Fold in the adversary's **"mirror the asset-section set/`delete` pattern, NOT the `description` pattern (stale-value quirk)"** instruction — code-verified, and it steers away from the one wrong local precedent. Keep Main's explicit focus-transition chain.
- **Decision 1/4 (hydration + round-trip):** Add the adversary's **explicit `private: false` → omission normalization** as a stated, intended behavior, and flag it to become a specs scenario. This is the top gap to close.
- **Decision 3 (toggle component) + focus order:** Keep Main's named order and transitions; add the adversary's **`computeFocusIds` duplication** hazard (both `create-view.tsx` and `edit-view.tsx` must be edited) as a risk/implementation note.
- **Decision 5 (messaging):** Equivalent; optionally borrow the adversary's sharper "no registry round-trip to detect published state (out of scope)" justification for why the note is unconditional.
- **Open Questions:** Main's "None" is acceptable. Optionally record the adversary's two future-scope items (third explicit-`false` state; `--private` flag) as resolved-against/out-of-scope notes for forward context.

## Blocking cross-cutting item

**The `private: false` → omission round-trip behavior (§2) must be made explicit before this change is archived.** As designed by *both* versions, applying any edit to a manifest that carries `private: false` will rewrite it to omit the key — a real, observable diff. Main does not state it; the adversary does and mandates a spec scenario. This must be (a) acknowledged in `design.md` as intended and (b) carried forward into a specs scenario, or a reviewer will reasonably read it as an unintended side effect. Everything else in this review is improvement, not a gate.
