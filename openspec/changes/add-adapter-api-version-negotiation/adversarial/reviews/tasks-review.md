# Comparison Review: `tasks`

**Main**: `openspec/changes/add-adapter-api-version-negotiation/tasks.md`
**Adversary**: `openspec/changes/add-adapter-api-version-negotiation/adversarial/artifacts/tasks.md`

Both versions were derived from the same reconciled proposal, design, and specs. The adversarial version was authored blind to the main version.

## Grading bar

Scoped to the tasks artifact type:

1. **Artifact mechanics** — exact preamble, Step Types legend, `- [ ] X.Y` checkbox format, Research/Implementation block pattern, VIPER hard rules (Explore→Propose before Implement; Verify after every Implement batch).
2. **Atomic + testable** — each task independently completable and verifiable in one session.
3. **Dependency ordering** — SDK before engine consumers, resolution/verification before placement, inspection before gates, docs last.
4. **Coverage** — every reconciled spec scenario and design decision (including Decision 7 docs and the migration plan) reaches at least one task.
5. **Actionability** — explores scoped for parallel subagents; tasks name concrete seams so the executor doesn't re-derive the design.

## Mechanics

Both versions are fully compliant: identical preamble, identical legend, correct checkbox format, Research/Implementation splits, and no VIPER rule violations (every Research group ends in Propose; every Implementation group ends in Verify; Main's 18.1–18.2 Implements are followed by Verifies; Adversary's flat block 17 uses Implement→Verify, which is legal without a Propose). No mechanical gate favors either side.

## Coverage comparison

Block-by-block correspondence (Main ↔ Adversary):

| Area | Main | Adversary |
|---|---|---|
| SDK constant + stamping | 1–2 (combined with prepack) | 1–2 |
| First-party prepack metadata | inside 1–2 | 3–4 (separate block) |
| Classifier + verifier | 3–4 | 5–6 |
| Specifier + npm resolution | 5–6 | 7–8 |
| Managed layout + atomic activation | 7–8 | 9–10 |
| Inspection + fail-closed loading | 9–10 | 11–12 (combined with gates) |
| Adapter install/list/remove commands | 11–12 | 13–14 (CLI rendering only) |
| Build + facet-operation gates | 13–14 | inside 11–12 |
| Documentation + rollout | 15–16 | 15–16 + 17.1 |
| Final coverage audit | 17–18 | 17.2 only |

Substantive divergences:

1. **Integrated coverage audit (Main 17–18; no Adversary equivalent).** Main ends with an explicit audit of the finished implementation against every reconciled scenario, a duplication audit (API literals, field names, alias maps, engine-side message strings), `bun format`, strict OpenSpec validation, and representative end-to-end flows across npm/Git/local × managed/unmanaged × compatible/incompatible. The Adversary has only a final `bun check` plus one legacy-bundle smoke check (17.2). **Main is clearly stronger.** For a change this wide, a closing audit block is the difference between "tasks all checked" and "change actually satisfies the specs."

2. **Test-fixture migration (Main 9.1/10.5; absent in Adversary).** Main recognizes that existing engine/CLI tests fabricate flat `adapter.js` bundles and will break under the managed layout, and budgets explicit exploration and migration work. The Adversary never mentions fixtures. **Main is stronger** — this is a real, sizable implementation cost that would otherwise surface as unplanned work mid-block.

3. **Install-service plumbing detail (Main 11–12 vs Adversary's distribution).** Main gives the adapter install service its own block, including converting bundler/verification/placement/cleanup exception boundaries into typed failures *without losing temporary-resource cleanup* (12.2), postpack source-manifest restoration (2.4), and stale-lock-owner handling (8.2). The Adversary covers the same flow but spreads it across blocks 6, 9–10, and 13–14 and omits temp-cleanup preservation, postpack restoration, and stale-lock handling. **Main is stronger** on these operational details.

4. **Rollout (Main 15.3 + 16.5 vs Adversary 17.1).** Main treats release ordering (SDK → first-party `0.0` releases → compatibility-aware CLI) as a proposed plan plus an implemented checklist; the Adversary has a single "release-ordering note" task. **Main is stronger** — the migration plan is a first-class design section and deserves more than a note.

5. **Concrete grounding (Adversary throughout; Main abstract).** The Adversary names actual paths in nearly every Explore and Implement: `packages/engine/src/adapters/verify.ts`, `sources/adapter/specifier.ts`/`npm.ts`, `first-party.ts`, `packages/protocol/src/sources/version-spec.ts`, `install/run-install.ts`, `build/pipeline.ts`, and each of the eight affected doc files individually. Main describes the same seams generically ("adapter source parsing", "the affected adapter CLI ... documentation"). **Adversary is stronger.** Grounded paths make Explore steps immediately dispatchable to parallel subagents and prevent the executor from re-discovering what the planner already knew. The paths are stable enough over this change's lifetime that drift risk is negligible.

6. **Explore scoping for parallelism.** The tasks rules require explores scoped to independent topics. Main's 13.2 is a monolithic seven-topic explore ("add/remove/install adapter discovery, zero-adapter picker behavior, `runInstall` no-mutation exits, Git/local facet builds, drift removal, materialization, and all failure renderers") and 11.1 bundles five topics. The Adversary's explores are mostly one-seam-per-step with paths (its widest, 11.1, is still a single consumer sweep of one function). **Adversary is stronger** on explore granularity.

7. **Spec-scenario test coverage — each side misses items the other has.**
   - Missing from Main: an explicit test that **explicit `latest` selects highest-compatible and ignores the dist-tag** (Adversary 8.5); an explicit test that a **build with no adapters installed still proceeds with unknown-adapter warnings** (Adversary 12.5, from the modified load-at-runtime requirement); an explicit **exact-request metadata optimization must preserve identical validation/failure data** proposal item (Adversary 7.5, from design Risks).
   - Missing from Adversary: **prerelease exclusion** and **integrity-failure** tests in resolution (Main 6.6); **unique-generation import freshness** test (Main 10.6 — Adversary proposes the mechanism in 11.4 but never tests it); **concurrent-replacement** tests (Main 8.6); first-party adapter definition tests staying unchanged (Main 2.3).
   - Net: **Main's test enumeration is broader overall**, but the three Main gaps are genuine reconciled-spec scenarios, not nice-to-haves.

8. **Block organization.** Main combines SDK+prepack (rule-compliant: closely related groups SHOULD combine) where the Adversary splits them; the Adversary combines loading+gates where Main splits them into inspection (9–10), commands (11–12), and gates (13–14). Main's finer split of the largest area of work is the better trade — those three areas have distinct consumers and can be verified independently — while the Adversary's SDK/prepack split is harmless but slightly less rule-aligned. **Main is stronger on structure overall.**

## Merge recommendation

Use **Main as the base** — its block structure, fixture-migration work, install-service detail, rollout treatment, and closing coverage-audit block are the stronger skeleton. Fold in from the Adversary:

1. **Per-block: add concrete file paths** to Main's Explore steps (and Implement steps where a single file is the seam), using the Adversary's path inventory: blocks 1 (`packages/adapter/src/{types,define-adapter,index}.ts`), 3 (`packages/engine/src/adapters/verify.ts`, `install-service.ts` fallback), 5 (`sources/adapter/{specifier,npm}.ts`, `adapters/first-party.ts`, `packages/protocol/src/sources/version-spec.ts`), 7 (`adapters/placement.ts`, common atomic-write helpers), 9 (`adapters/loader.ts`), 13 (`install/run-install.ts`, `build/pipeline.ts`), 15 (the eight individual doc paths from design Decision 7).
2. **Block 6 (Main): add two test items** to 6.6 — explicit `latest` ignores the dist-tag and selects highest compatible; and (if the exact-request metadata optimization is implemented) identical validation and failure data versus the packument path. Source: Adversary 8.5/7.5.
3. **Block 14 (Main): add one test item** — a build with no installed adapters proceeds and emits unknown-adapter warnings for manifest adapter metadata. Source: Adversary 12.5.
4. **Block 13 (Main): split 13.2** into two or three scoped explores (facet-command discovery + picker; `runInstall` no-mutation exits + Git/local facet builds; materialization + failure renderers) so they can run as parallel subagents. Optionally split 11.1 the same way.
5. Do **not** adopt the Adversary's separate first-party-metadata block, its merged loading+gates block, or its thin block 17 — Main's equivalents are stronger.

## Blocking items

None that must be settled before archiving the change. The closest are the two missing reconciled-spec scenario tests in Main (merge items 2–3); they should be folded in at reconciliation so the task list, not executor memory, carries them.
