# Adversarial Comparison Review — `design`

**Sources compared**
- **Main**: `openspec/changes/add-facet-visibility-to-manifest/design.md`
- **Adversary**: `openspec/changes/add-facet-visibility-to-manifest/adversarial/artifacts/design.md` (authored blind by `/run-adversary`, against the reconciled `proposal`)

The adversary never saw Main while authoring. Both built on the reconciled proposal and the permanent schema/integrity/publish specs and docs. This review reads both for the first time and verifies the load-bearing engineering claims against the actual code.

## Grading bar

Design-scoped rubric:
1. **Decision quality** — each key choice has a rationale and alternatives considered (the `design.md` instruction's core demand).
2. **Technical correctness** — claims about the codebase are *true*; the design would actually work if implemented.
3. **Risk/trade-off coverage** — the dangerous interactions are surfaced, not just the happy path.
4. **Doc-impact discipline** (Article III + design rules) — names the doc files that need updating.
5. **Migration/rollback realism**.
6. **Open Questions** — surfaces what genuinely must be settled before specs freeze.

## Code verification (the part that decides this review)

I checked the two designs' contested factual claims against source:

- **`packages/protocol/src/loaders/facet.ts:13–44`** — `ResolvedFacetManifest` enumerates only `name, version, description, author, skills, agents, commands, facets, servers`. No `private`.
- **`facet.ts:151–161`** — `resolvePromptsFromMap` rebuilds the resolved object field-by-field with conditional spreads. **Any field not explicitly listed is silently dropped.** A new `private` on `FacetManifest` would NOT survive into `ResolvedFacetManifest` without an added line here.
- **`packages/protocol/src/build/content-hash.ts:30–31`** — `collectArchiveEntries` embeds `facet.json` from the **original `manifestContent` string**, not from the resolved object. So the **archive bytes** keep `private` regardless of the resolved-object gap.
- **`packages/protocol/src/integrity/validate-archive.ts:323–329`** — archive verification **reconstructs** a `ResolvedFacetManifest` via `resolvePromptsFromMap` and runs build validators on it. This is a second consumer of the resolved representation, beyond build/materialize/tests.

**Verdict on the contested claims:**
- Main's **"Preserve `private` in `ResolvedFacetManifest`"** decision is **correct and necessary**. Without the added field + the added copy line in `resolvePromptsFromMap`, the resolved representation drops `private`. The adversary **missed this entirely** — its "zero new transport plumbing" framing is true for the *archive bytes* but false for the *resolved in-memory representation* that engine, archive-verification, and tests consume.
- The adversary's **`content_integrity` fingerprint** observation (toggling `private` changes the canonical hash → re-publishing flipped visibility at the same version collides with registry immutability) is **correct and Main does not mention `content_integrity` at all**. Main covers the *content-drift* consequence (same conclusion at the publish-prompt layer) but never connects it to the integrity fingerprint or the immutability collision.

Both designs caught a real thing the other missed. Neither is strictly dominant.

## Coverage comparison

| Dimension | Main | Adversary |
| --- | --- | --- |
| Boolean over `visibility` enum, with alternatives | ✅ | ✅ (also rejects nested `registry`/`publish` object — extra alternative) |
| Omission == public | ✅ (states it) | ✅ + **explicitly forbids schema-injected default**, with arktype `= false` rejected and the drift-false-positive reason |
| `private` recognized, non-boolean rejected | ✅ | ✅ (adds the field-pathed error + the `private: "true"` typo motivation) |
| **`ResolvedFacetManifest` must carry `private`** | ✅ **caught — correct & load-bearing** | ❌ **missed** |
| **`content_integrity` fingerprint / immutability collision** | ❌ not mentioned | ✅ **caught — correct** |
| No new drift class (content drift reuse) | ✅ (names `detectManifestDrift`, `reason: 'content'`) | ✅ (same conclusion, no internal names) |
| No lockfile/project/build-manifest/server changes | ➖ implicit | ✅ **explicit decision with rationale** |
| Concrete code path / file map | ✅ **names exact files + functions** (`facet-manifest.ts`, `loaders/facet.ts`, `build/pipeline.ts`, `publish/index.ts`, `detectManifestDrift`) | ➖ names schema file + behavior, fewer internal anchors |
| Doc surfaces (Article III) | ✅ all three + per-file what-changes in migration | ✅ all three + per-file what-changes |
| Open Questions | ⚠️ **"None."** | ✅ three (visibility confirm; accept `false` explicitly; registry echo) |
| Risks | 4, solid | 4, incl. the fingerprint/immutability one and the stale-`dist/` example |
| RFC 2119 usage | ✅ SHALL/SHOULD throughout | ⚠️ MUST in places, more prose elsewhere (acceptable for design, not a spec) |

## Material divergences — which is stronger and why

1. **`ResolvedFacetManifest` preservation (Main wins, decisively, verified).** This is the single most important finding in the review. Main identified that a recognized manifest field silently dies in `resolvePromptsFromMap` unless explicitly copied, and that the resolved representation is consumed independently of the archive bytes. The adversary's design is **incomplete without this** — implementing only the adversary's plan would ship a `private` that's in the archive but absent from the resolved object that archive-verification and materialize see. **Fold Main's decision in as-is.**

2. **`content_integrity` fingerprint + immutability collision (Adversary wins, verified).** The adversary connected `private` to the canonical hash and spelled out the immutability consequence (flip visibility → new fingerprint → same-version re-publish is a 409). Main reaches the adjacent content-drift conclusion but never names the fingerprint or the version-bump requirement. **Fold the adversary's risk bullet into Main's Risks**, and carry the "visibility change needs a version bump, like any content edit" note into the publish docs.

3. **Open Questions (Adversary wins).** Main declares **"None."** — but the proposal reconciliation explicitly seeded the boolean-vs-`visibility` question as the gate before specs freeze, and the adversary preserved it plus two more (accept `false` explicitly; does the registry expect a separate publish parameter vs. reading the embedded manifest). Main closing this to "None" is the one place Main is **weaker than the reconciled proposal already established**. **Restore at least the visibility-confirmation Open Question**; it is load-bearing for the `protocol__schemas` delta.

4. **Concrete code anchoring (Main wins).** Main names exact files and the `detectManifestDrift` function, which makes the `tasks` artifact easier to derive. The adversary stayed one level more abstract. Minor, but real for the next phase.

5. **"No changes to adjacent schemas" explicitness (Adversary marginally wins).** The adversary made it a numbered decision with rationale (visibility is publish-time intent, not install-time resolution); Main leaves it implicit. Cheap to adopt.

## Merge recommendation (per decision)

- **Decision: model as `private?: boolean`** — Keep Main. Optionally add the adversary's rejected "nested object" alternative for completeness. Low priority.
- **Decision: omission == public** — **Strengthen Main with the adversary's framing**: state explicitly that the schema MUST NOT inject a default and no command may write `private` into the on-disk manifest, citing the drift-false-positive reason and the rejected arktype `= false` alternative. This is a genuine hardening.
- **Decision: recognized + non-boolean rejected** — Keep Main; adopt the adversary's concrete `private: "true"` typo motivation as the rationale.
- **Decision: preserve in `ResolvedFacetManifest`** — **Keep Main verbatim. Verified necessary.** Ensure the resulting `tasks` artifact includes the one-line edit to `resolvePromptsFromMap` (facet.ts:151–161) and an update to the `ResolvedFacetManifest` interface.
- **Decision: reuse content drift** — Keep Main (it names the function). Append the adversary's fingerprint/immutability consequence as the rationale for *why* a visibility change is real content drift.
- **NEW decision to add (from adversary):** "No changes to lockfile/project/build-manifest/server-manifest schemas," with the publish-time-intent rationale.
- **Risks** — Add the adversary's `content_integrity`/immutability risk and the stale-`dist/` example.
- **Open Questions** — **Replace "None." with at least the boolean-vs-`visibility` confirmation** (proposal reconciliation already flagged this as the spec-freeze gate), plus the "accept `false` explicitly" confirmation.

## Blocking cross-cutting items (settle before archiving the change)

1. ⛔ **`ResolvedFacetManifest` + `resolvePromptsFromMap` must be updated.** Verified against `loaders/facet.ts`. If the `specs`/`tasks` phase does not capture this, the implementation will silently drop `private` from the resolved representation consumed by archive-verification (`validate-archive.ts:329`) and materialize. This must be reflected in the `tasks` artifact.
2. ⛔ **Reinstate the boolean-vs-`visibility` Open Question.** Main's "None." regresses a decision the reconciled proposal deliberately left open as the gate for the `protocol__schemas` delta. Resolve it (or keep it explicitly open) before specs freeze — if a third audience state is anticipated near-term, the spec MUST model `visibility` from the start.
3. ✅ Doc-impact: both designs agree on the three surfaces; no conflict. Ensure the publish docs gain the "visibility change is content drift; bump the version" note (from divergence #2).

**Net:** Main is the stronger, more implementable design — it caught the one verified must-fix engineering gap (`ResolvedFacetManifest`) the adversary missed, and it anchors to concrete files the `tasks` phase needs. But Main has two real regressions against the reconciled proposal that the adversary got right: it omits the `content_integrity`/immutability consequence, and it closes the visibility Open Question to "None." Reconcile by keeping Main's structure and folding in the adversary's fingerprint risk, the explicit "no schema-injected default" hardening, the "no adjacent-schema changes" decision, and the restored Open Question.
