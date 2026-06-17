# Adversarial comparison review — `specs`

**Change:** `expose-facet-privacy-toggle`
**Artifact:** `specs` (capability `authoring__facets`)
**Main** (the main agent's version): `openspec/changes/expose-facet-privacy-toggle/specs/authoring__facets/spec.md` — one `ADDED` requirement, 8 scenarios.
**Adversary** (the authored version): `openspec/changes/expose-facet-privacy-toggle/adversarial/artifacts/specs/authoring__facets/spec.md` — three `MODIFIED` requirements + one `ADDED` requirement, ~25 scenarios.
**Base spec** (existing, for delta semantics): `openspec/specs/authoring__facets/spec.md`.

---

## Grading bar

Scoped to spec deltas:

1. **Correct OpenSpec delta mechanics** — `MODIFIED`/`ADDED`/`REMOVED` headers used correctly; `MODIFIED` requirements reproduce the *full* requirement text (header + all retained scenarios), not just the changed lines, because the tooling replaces the whole named requirement.
2. **RFC 2119** — normative SHALL/SHOULD/MAY, no ambiguous "should"/"will".
3. **Atomic + testable scenarios** — one observable behavior per scenario, WHEN/THEN(/AND), no compound or untestable assertions.
4. **Value-centric** — requirements describe author-observable outcomes, not implementation.
5. **Coverage** — every behavior the proposal/design promised has a requirement + at least one scenario; no orphan scenarios.

Both versions clear bars 2–4 cleanly. The decisive divergences are on **bar 1 (delta mechanics)** and **coverage completeness**, and there is one **direct behavioral contradiction** on the `private: false` edge case that is blocking.

---

## The headline divergence: delta strategy

The two versions take fundamentally different structural approaches to the same change.

**Main** adds a single self-contained requirement — *"Authors can set facet privacy intent during interactive authoring"* — that describes privacy behavior across create and edit in one place, with 8 scenarios. It does **not** touch the existing `Authors can scaffold…`, `Authors can edit…`, or `Edit is transactional with confirmation` requirements at all.

**Adversary** instead `MODIFIED`s the three existing requirements to weave privacy into them inline (privacy as an optional wizard field, privacy display/toggle in edit, privacy in the confirmation preview), reproducing each requirement in full with its scenarios, and then `ADDED`s one requirement for the rebuild/republish consequence.

**Which is stronger, and why — this is genuinely split:**

- **Adversary is mechanically more correct about where privacy lives.** Privacy *is* a field of the create wizard and the edit workbench and the transactional confirmation summary. The base requirements already enumerate the wizard's fields ("Name", "Description", optional "Version") and the confirmation-summary contents. A reader of the *archived* spec who wants to know "what does the create wizard collect?" should find privacy in that requirement — not in a separate satellite requirement they might miss. The Adversary's confirmation-summary coverage (privacy shown in the create summary, the edit summary, and in "Confirmation summary shows all deltas") is coverage the Main version simply does not have as scenarios — Main folds it into single AND-clauses ("the confirmation summary SHALL show the facet as public/private") without a dedicated transactional-summary scenario.

- **Main is dramatically lower-risk to apply and easier to review.** A single small `ADDED` requirement cannot corrupt the existing three requirements. The Adversary's `MODIFIED` approach reproduces ~200 lines of existing requirement text, and **any drift between that reproduction and the current base spec silently overwrites the base on archive.** I checked: the Adversary's reproductions are *mostly* faithful, but they are not the only delta in flight for this capability — the main spec file shows the base already carries unrelated requirements (build, collisions, front matter) that the Adversary correctly leaves untouched. The danger is concentrated in the three requirements it *does* reproduce: every retained scenario must match the base exactly except for the privacy additions. This is a real reconciliation cost and a real archive-time hazard.

**Merge recommendation (structural):** Adopt the **Adversary's placement philosophy** — privacy belongs inside the create/edit/transactional requirements — but do it with surgical `MODIFIED` blocks and verify each reproduced requirement diff-matches the base spec line-for-line except for the deliberate privacy insertions. Keep Main's standalone-requirement clarity as the model for the *rebuild/republish* concept (see below), where a dedicated requirement genuinely is the right home. Do **not** ship Main's privacy behavior as a lone satellite requirement while the wizard/edit/summary requirements stay silent about privacy — that leaves the archived base spec describing a wizard that doesn't mention a field it now collects.

---

## Behavioral divergence #1 (BLOCKING): `private: false` on edit-left-public

This is a direct contradiction, not a stylistic difference. The two versions specify **opposite** required behavior for the same input.

- **Main** (`spec.md:32-37`, *"Edit preserves explicit public false when left public"*): when the source manifest contains `private: false` and the author leaves the facet public, the applied manifest **SHALL preserve `private: false`** — explicitly framing removal as "an incidental formatting change" to avoid.

- **Adversary** (`spec.md:183-186`, *"Editing an explicit private:false manifest to public removes the field"*): same input, the written manifest **SHALL NOT contain a `private` field** — i.e. it removes `private: false`.

These cannot both be archived. Note the design entry's reconciliation note (`state.json`) records that the *design* was reconciled toward **"explicit private:false-to-omission normalization and required spec scenario"** — i.e. the design landed on the **Adversary's** behavior (normalize to omission). If that design decision stands, **Main's `spec.md:32-37` scenario is wrong and must be replaced** with the Adversary's normalize-to-omission scenario.

**Merge recommendation:** Resolve against the reconciled design. Per the design note, the intended behavior is normalize-`private:false`-to-omission, so adopt the **Adversary's** scenario (`spec.md:183-186`) and **delete Main's "Edit preserves explicit public false when left public."** Before finalizing, confirm the reconciled `design.md` actually says normalize-to-omission and that this does not conflict with the *base* requirement *"Manifest with explicit public publish intent is valid"* (`openspec/specs/authoring__facets/spec.md:37-41`), which says a loaded manifest **SHALL preserve `private: false`**. Loading-preserves-false and editing-normalizes-to-omission are compatible (load is read; edit is rewrite), but the spec should make that distinction explicit so a reader doesn't see a contradiction. **This is the one item that must be settled before archive.**

---

## Behavioral divergence #2: the rebuild/republish consequence

- **Main** captures this as a single scenario (`spec.md:51-55`, *"Authoring guidance explains rebuild and version requirements"*) bolted to the privacy requirement, with two AND-clauses (rebuild needed; published version needs a version bump).

- **Adversary** captures this as a dedicated `ADDED` requirement, *"Authoring workflows make a privacy change's rebuild and republish consequence visible"* (`spec.md:251-270`), with a normative body and **three** scenarios: (a) editing privacy does not rebuild or contact the registry, (b) author informed a rebuild is needed, (c) author informed a published version needs a version bump.

**Adversary is clearly stronger here.** The proposal's reconciliation note explicitly called out "non-goal fences for no standalone privacy command or auto rebuild/republish" and "rebuild/version-bump author guidance." The Adversary's scenario (a) — *the system SHALL update the manifest only, SHALL NOT rebuild, SHALL NOT contact the registry* — is a directly testable negative guarantee that Main does not assert anywhere. Main only states the *positive* guidance ("tell the author…") and never fences the *negative* (no auto-rebuild, no registry contact). Given the proposal explicitly fenced this as a non-goal, the negative guarantee deserves to be a normative, tested requirement.

**Merge recommendation:** Adopt the **Adversary's standalone `ADDED` requirement** verbatim, including all three scenarios. This is the one place where a dedicated requirement (not inline) is the right structure, and it covers a proposal-level non-goal that Main under-specifies.

---

## Behavioral divergence #3: scope of edited privacy scenarios

Both versions cover the core matrix (public→private, private→public, omitted-stays-omitted, new-public-omits, new-private-writes-true). Differences:

- **Adversary adds** *"Author selects private then reverts to public before completing"* (`spec.md:134-137`) — a create-flow round-trip that Main lacks. This is a genuine edge (transient selection must not leak into the manifest) and is testable. **Adversary stronger.**
- **Adversary adds** *"Author inspects current privacy intent"* / *"…on a public facet"* as two separate display scenarios (`spec.md:162-170`). Main folds display into the toggle scenario's AND-clause. The Adversary's split is more atomic. **Adversary slightly stronger.**
- **Main's** *"New facet defaults to public visibility intent"* asserts **both** manifest omission **and** confirmation-summary-shows-public in one scenario (two AND-clauses). The Adversary splits these into *"Privacy defaults to public-by-default with the field omitted"* and *"Confirmation summary reflects the selected privacy intent."* The Adversary split is more atomic and individually testable. **Adversary slightly stronger**, though Main's compound is acceptable.

**Merge recommendation:** Pull the Adversary's create-flow revert scenario and the split display scenarios into the reconciled spec. They are additive and cost nothing.

---

## Where Main is stronger / cleaner

Credit where due:

1. **Main's lead requirement sentence is tighter.** Its single normative paragraph ("Newly scaffolded facets SHALL default to public visibility intent and SHALL omit `private`… Existing facets edited interactively SHALL show… allow… write…") is a crisp value-centric summary. The Adversary's behavior is spread across three requirement bodies and is harder to read end-to-end. If the reconciled spec keeps privacy inline (recommended), borrow Main's phrasing for the inserted privacy sentences so each `MODIFIED` requirement stays readable.
2. **Main avoids the reproduction hazard entirely.** This is a real safety advantage of the satellite-requirement approach, even though I'm recommending against it on coverage grounds. The mitigation is mechanical diffing during reconciliation.
3. **Main names the `private: false` preservation rationale** ("incidental formatting change") — useful framing even though its *conclusion* is the one in dispute (divergence #1). Carry the rationale-awareness forward even when flipping the conclusion.

---

## Per-section merge recommendation summary

| Section | Action |
|---|---|
| **Create wizard requirement** | Use Adversary's placement (privacy as inline optional field + summary scenarios), with Main's tight phrasing. `MODIFIED` block must diff-match base except privacy insertions. |
| **Edit workbench requirement** | Use Adversary's inline privacy display/toggle + the two atomic inspect scenarios. `MODIFIED` block must diff-match base. |
| **Edit-transactional requirement** | Use Adversary's `MODIFIED` adding privacy to the preview + "summary shows privacy intent" + "shows all deltas" (with privacy in the delta list). Verify base reproduction. |
| **`private: false` edit-to-public** | **BLOCKING.** Resolve against reconciled design (design note says normalize-to-omission → adopt Adversary, delete Main's preserve-false scenario). Make load-preserves vs edit-normalizes distinction explicit. |
| **Rebuild/republish consequence** | Adopt Adversary's standalone `ADDED` requirement + all 3 scenarios verbatim (includes the no-auto-rebuild/no-registry negative guarantee Main lacks). |
| **Create-flow private→public revert** | Add Adversary's scenario. |

---

## Blocking item before archive

**One blocker:** the `private: false`-on-edit-left-public contradiction (divergence #1). The reconciled spec must pick exactly one behavior, it must agree with the reconciled `design.md`, and it must be reconciled against the base requirement *"Manifest with explicit public publish intent is valid"* so loading-preserves-false and editing-normalizes-to-omission are not read as a contradiction. Nothing else here blocks archive; the rest are additive coverage and a structural-placement choice.
