# Comparison Review: `tasks`

**Main:** `openspec/changes/support-non-asset-files/tasks.md` (7 blocks, 14 numbered groups, 62 tasks)
**Adversary:** `openspec/changes/support-non-asset-files/adversarial/artifacts/tasks.md` (9 blocks + final verification, 18 numbered groups, 71 tasks)

Both were derived from the same reconciled proposal, design, and delta specs; the adversarial version was authored blind to Main.

## Grading bar

Scoped to a tasks artifact:

1. **Artifact mechanics** — required preamble, checkbox format the apply phase can parse, VIPER type prefixes, Research/Implementation block pattern, Explore→Propose→Implement→Verify ordering rules, Step Types legend.
2. **Dependency ordering** — consumer-first sequencing per the design's Migration Plan; no task depends on work scheduled later.
3. **Atomicity and verifiability** — each task completable in one session, with a clear done condition; Verify gates after every Implement batch.
4. **Coverage** — every design decision (D1–D12), every delta-spec requirement, the Migration Plan steps, and the Article III documentation obligations map to at least one task.
5. **Parallelizable research** — Explore steps scoped to independent topics.

## Coverage comparison

Both versions cover the same core arc in the same dependency-safe order: protocol schemas/naming → archive plan and path grammar → versioned build manifest and verification → lockfile `0.2` → engine consumer bridge → adapter SDK bundles → producer/build pipeline → materialization/install reconciliation → create/edit README authoring → docs. Both satisfy the preamble rule, checkbox format, typed prefixes, the Research/Implementation split, and the Explore→Propose gate before every Implementation group. Neither has a dependency-order defect.

The material divergences:

| Area | Main | Adversary |
|---|---|---|
| Step Types legend | Present (verbatim) | **Missing** |
| Block granularity | 7 coarse blocks | 9 finer blocks (protocol split into 4) + dedicated final-verification block |
| First-party adapter migration | claude-code, **opencode, and codex** (6.3) | claude-code only (12.4) |
| Producer readiness gate | Explicit in-plan gate task (10.1) recording consumer + registry readiness before `0.2` emission | Only a documentation cross-check in final verify (18.2) |
| Registry client / cache audit | Explicitly updated (4.5) | Loaders/cache covered (10.1) but registry download not named |
| Docs scope | Audit-first Research block; adds publish, terminology, troubleshooting, skills, and **custom-adapter guide** pages beyond the design's list; schema-derived generated references; changeset metadata (13–14) | Flat block limited to the design's enumerated doc list (17) |
| Protocol release-policy update | Implicit (release notes 14.4, adapter release metadata 6.5) | **Explicit task** encoding the pre-1.0 minor-release rule in the permanent policy (17.4) |
| Full-cycle e2e test | Spread across blocks; no single full-cycle task | **Explicit** build→verify→install→drift→remove cycle incl. legacy `0.1` install (14.8) |
| Spec-coverage sweep | Strict OpenSpec validation in 14.5 | Scenario-by-scenario delta-spec coverage check (18.2) |
| D7 failure-class test matrix | Referenced generically ("full build failure-class matrix", 10.6) | Classes **enumerated inline** (4.5) |
| Edit/create implementation realism | Deep: headless create, focus management, state snapshotting, stable structured reconciliation identities replacing string-parsed keys, tagged operation variants (11–12) | Requirement-level only (15–16) |
| Explore scoping | Flow-scoped, some broad ("trace X, Y, Z, and W across protocol and engine") | File-anchored, more independently parallelizable |

## Divergence judgments

1. **Step Types legend — Main stronger, and this is a compliance defect in Adversary.** The VIPER planning rules require the legend verbatim at the top of every plan. Main includes it; Adversary relies on the preamble's skill reference alone. Main's form is correct.

2. **First-party adapter migration — Main stronger, materially.** The design says "adapter SDK … + first-party adapters; claude-code migrates" and the repo carries a first-party adapter list beyond claude-code. Adversary followed the proposal's Impact section (which names only claude-code) and would leave opencode and codex uncompiled against a breaking SDK contract. Main's 6.3 is the correct scope.

3. **Producer readiness gate — Main stronger.** The Migration Plan makes cafe a *hard gate* before producer enablement. Main turns that into a checkable in-plan task (10.1: "do not enable `0.2` producer output if either consumer class is not ready"), which is exactly how a sequencing constraint should surface in a checklist. Adversary only verifies that the constraint is *documented* (18.2) — weaker, because nothing in its plan blocks flipping the producer on.

4. **Docs breadth — Main stronger.** Main's docs Research block audits `docs/` rather than trusting the design's enumeration, and it caught the custom-adapter contract page the design's Migration Plan omitted — precisely the Article III behavior ("existing documentation MUST always be considered"). Its schema-derived reference generation task also honors the project's single-source-of-truth rule. Adversary's flat block reproduces the design list faithfully but adds nothing; for a breaking change touching this many surfaces, a docs audit is warranted.

5. **Edit/create implementation realism — Main stronger.** Main's 11.3/12.5 anticipate real workbench constraints (exhaustive UI switches representing two independent README paths, replacing string-parsed reconciliation keys with tagged structured identities). These translate the repo's illegal-states-unrepresentable rule into concrete tasks. Adversary restates the spec requirements without this depth.

6. **Full-cycle e2e test — Adversary stronger.** Main's tests are thorough per-block but no single task proves the whole pipeline end to end (build a facet with companions + archive-only files, verify, install, drift, repair, remove) plus a legacy `0.1` install through the same path. That integration seam — where protocol, engine, adapter, and CLI meet — is where per-block tests miss regressions. Worth one explicit task.

7. **Protocol release-policy update — Adversary stronger, minor.** D4 says the permanent protocol release policy "SHALL be updated by this change to encode the pre-1.0 rule." The `protocol` delta spec carries the requirement, and spec sync will land it, but neither Main task explicitly performs/verifies the policy-text update outside release notes. Adversary's 17.4 names it.

8. **Spec-coverage sweep — Adversary slightly stronger.** Main runs strict OpenSpec validation (structural); Adversary's 18.2 additionally walks the delta specs scenario-by-scenario against the implementation. For a 7-capability change this is a cheap, high-value final gate.

9. **D7 matrix enumeration — Adversary slightly stronger.** Enumerating the failure classes inline (traversal, NUL, Unicode/case aliases, prefix collisions, links, duplicates, reserved root `facet.json`, …) makes the task's done-condition self-contained; Main's "full failure-class matrix" requires the executor to reopen design D7. Low cost to inline.

10. **Block granularity — wash.** Adversary's four protocol blocks give more frequent Verify gates; Main's two blocks honor the "closely related groups SHOULD be combined" rule. Adversary's lockfile-schema block (7/8) is thin (one Explore); Main's protocol explores are broad multi-topic traces that partially defeat parallel-subagent scoping. Neither is wrong; no change recommended on structure.

## Merge recommendation

**Retain Main as the base.** It is legend-compliant, broader on adapters and docs, encodes the producer hard gate as a task, and is more implementation-aware in the authoring block. Fold in from Adversary:

- **Block 8 or 10 (tests):** add one explicit end-to-end cycle task — build a facet with skill companions and archive-only files, verify, install, detect + repair single-file drift, remove via receipt offline; run the same install path against an immutable legacy `0.1` archive (Adversary 14.8).
- **Block 10 (10.6):** inline the D7 failure-class enumeration into the test-matrix task so its done-condition is self-contained (Adversary 4.5).
- **Block 14:** add or extend a task to update the permanent protocol release policy encoding the pre-1.0 minor-release rule (or explicitly note it lands via spec sync of the `protocol` delta) (Adversary 17.4).
- **Block 14 (14.5):** extend the final Verify with a scenario-by-scenario coverage check of all seven delta specs against the implementation (Adversary 18.2).

Nothing in Adversary's structure (4-way protocol split, flat docs block, separate final block) should displace Main's organization.

## Blocking items

None. All four merge items are additive; no Main task is incorrect or mis-ordered. The one compliance defect found (missing Step Types legend) is in the adversarial artifact, not Main, and requires no action.
