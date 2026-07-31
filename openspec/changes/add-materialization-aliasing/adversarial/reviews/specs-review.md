# Comparison Review: `specs` — add-materialization-aliasing

**Main**: `specs/installation/spec.md`, `specs/protocol__schemas/spec.md`, `specs/cli/spec.md` (change root)
**Adversary**: `adversarial/artifacts/specs/{installation,protocol__schemas,cli}/spec.md`

Both versions were derived from the reconciled proposal. The adversarial version was authored blind to Main.

## Grading bar

- **Value-centric** (spec-governance litmus: would a user/developer care if it stopped working?)
- **RFC 2119** keyword discipline
- **Atomic + testable** requirements and scenarios
- **Correct delta mechanics** — especially the MODIFIED rule: *copy the ENTIRE requirement block and edit*; partial/condensed content silently loses normative text at archive time
- **Coverage** of the proposal's contract: transactional collision detection on every path, exactly-one resolution per asset, persisted intent, authored-vs-effective identity split, alias grammar, format versioning with exact dispatch, frozen behavior, docs-relevant CLI behavior

## Coverage comparison

Both versions cover the proposal's core: cross-facet collision detection before any write on all install paths, shared skill/command namespace with agents separate, keep/alias/omit with exactly-one resolution per asset and a collision-free result, no silent winner, persisted intent reproduced without prompting, alias grammar enforcement, project-level (never per-adapter) resolutions, authored identities for verification vs effective identities for materialized state, omission excluding companions, lockfile `0.3` with exact dispatch, project-manifest format versioning with legacy string-only manifests still valid, transactional migration, frozen fail-without-rewrite, interactive resolution + structured non-interactive failure.

**Main goes materially further than Adversary in:**

- **Collision identity model** — Main defines collision as same *scope* + namespace + *portable* effective name, and states assets in different scopes don't collide. Adversary never considered the scope dimension or filesystem-portability (case-fold) of effective names. Main is stronger and more correct.
- **Evaluation paths** — Main includes *removal* in the evaluation set (needed for its ownership-transfer semantics). Adversary stopped at the proposal's five paths.
- **Resolution expressiveness** — Main explicitly permits name transfer from an omitted asset and exchanging effective names when the final set is unique. Adversary's "still collides → reject" covers correctness but not these legal-and-useful rearrangements.
- **Ownership reconciliation** ("Materialized ownership is reconciled against the complete effective set") — cross-facet identity transfer without delete-then-lose, duplicate historical claim aggregation, alias-change moves owned files transactionally, omission toggling, disposition-only change reported as an update. Adversary has only drift-repair/removal-at-effective-path scenarios. This is Main's single biggest coverage win; it addresses real correctness failures Adversary's version would leave unspecified.
- **Durable + stale intent** — Main: overrides survive the collision that motivated them (alias remains after the other facet is removed); stale overrides are reported and pruned *only in a successful commit*, preserved on failure, and treated as blocking drift in frozen mode. Adversary's "stale is reported, not fatal, never pruned" is weaker and leaves permanent garbage in the manifest. Main's transactional prune + mandatory CLI notice is the better design.
- **Receipt** — Main modifies the receipt requirement to schema `0.3` with dispositions and omitted-assets-excluded (including bootstrap). Adversary never touched the receipt schema; its omission handling exists only as an ADDED requirement, leaving the receipt version story implicit.
- **Migration decisiveness** — Main: every successful non-frozen install SHALL write `0.3`, resolution-free projects included, and removing all overrides never downgrades. Adversary's "MAY migrate" is indecisive and would permit divergent implementations.
- **Protocol shape** — Main's ADDED "Materialization dispositions use one published tagged shape" (three arms; alias must carry a name; effective name on other arms rejected; project intent admits only `aliased`/`omitted` because absence means authored; resolved state requires all three). This makes illegal states unrepresentable and is cleaner than Adversary's optional alias-or-omission markers with a default. Main's lockfile also *requires* the disposition, catching truncated writes that Adversary's optional-field default would silently accept.
- **Project-manifest schema concreteness** — Main pins `manifestVersion: 0.1` exact dispatch, expanded entries with typed `skills`/`commands`/`agents` maps keyed by authored name, compact-string canonical when no overrides, preservation and collapse rules for producers, duplicate-member rejection, and — correctly — that an override naming an absent asset stays *schema*-valid because document validation must not require source resolution. Adversary left the format version abstract (weakly testable), specified no grouping shape, omitted duplicate-member rejection, and its phrase "a resolution SHALL identify one declared asset of the facet" wrongly implies resolution-time validation inside schema validation. Main wins this file almost wholesale.
- **CLI interaction depth** — Main specifies the overview-then-focused-group workspace, live global revalidation with draft-conflict states that stay editable, status distinguishable without color (accessibility), interrupt-safe cancellation, non-interactive failures that point at the exact `facets.json` location with valid snippets and explicitly never generate a winner, and stale-intent prune notices without `--verbose`. Adversary's CLI file is a correct but thin subset.

**Adversary is stronger in a small number of specific places:**

1. **Preserved normative clauses in "Lockfile declares a version"** — Adversary's MODIFIED block retains (a) the forward-compat guard "Before a future stable lockfile v1 reuses numeric `1`, legacy-alpha support SHALL be removed and old-shape files SHALL receive actionable delete-and-regenerate guidance…" and (b) an updated archive/lockfile frozen pairing rule ("A current `0.2` archive SHALL require a `0.2`-or-current lockfile in frozen mode"). Main's MODIFIED block **drops both sentences**, which deletes them from the permanent spec at archive time.
2. **Frozen + legacy lockfile + resolutions scenario** — Main states the rule in requirement text ("SHALL fail if its schema cannot represent the project manifest's materialization intent") but has no scenario for it. Adversary has a dedicated scenario.
3. **CLI summary surfaces the mapping** — Adversary requires the final summary to show each aliased asset's authored name *together with* its effective name, and to identify omitted assets as omitted. Main only requires classifying a disposition-only change as "updated" — a user watching Main's install never sees what `review` actually materialized as. This is a genuine user-value gap.
4. **Migration preserves entries** — Adversary's scenario asserts a migrated manifest preserves every declared entry with unchanged meaning. Main covers producer preservation in the schemas file but its installation migration requirement doesn't say it.

## Divergences and verdicts

| Topic | Main | Adversary | Stronger |
| --- | --- | --- | --- |
| Collision identity (scope, portability) | scope + namespace + portable name | name + namespace only | **Main** |
| Evaluation paths | + removal | proposal's five | **Main** |
| Ownership reconciliation / transfer | full requirement | partial scenarios | **Main** |
| Stale overrides | transactional prune + notice; frozen = drift | report-only, never prune | **Main** |
| Receipt schema | bumped to 0.3, omitted excluded | untouched | **Main** |
| Lockfile migration | unconditional 0.3 | MAY migrate | **Main** |
| Disposition shape | required tagged three-arm, published | optional markers, default authored | **Main** |
| Manifest schema (version, typed maps, producer rules, dup members) | concrete `0.1`, complete | abstract, thin | **Main** |
| CLI workspace, accessibility, actionable failures, stale notices | rich | thin | **Main** |
| MODIFIED fidelity to permanent spec text | **condenses; drops normative sentences** | preserves full text + edits | **Adversary** |
| Frozen-legacy-lockfile-with-resolutions scenario | text only | scenario present | **Adversary** |
| Summary shows authored→effective / omitted | absent | present | **Adversary** |

## 🚨 Blocking cross-cutting item: Main's MODIFIED blocks condense the permanent spec

The specs instruction is explicit: a MODIFIED requirement must contain the **entire updated requirement block**, because at archive time it *replaces* the permanent requirement wholesale — "using MODIFIED with partial content loses detail at archive time." Main's installation MODIFIED blocks are rewritten summaries, not full-copy-plus-edit. Verified against `openspec/specs/installation/spec.md`, the following normative content would be silently deleted:

- **"Lockfile declares a version"**: the v1-numeric-reuse guard sentence; the frozen archive/lockfile pairing sentence (see Adversary win #1).
- **"Frozen-lockfile install treats the lockfile as authoritative"**: "Because frozen mode never creates a lockfile entry, it SHALL NOT require integrity confirmation against the registry; its only permitted network activity is downloading already-locked content"; the "frozen mode constrains the locked set, not the machine's materialized state" framing; several scenario AND-clauses (e.g., failure messages identifying manifest specifier and locked version).
- **"A machine-local record tracks what each project has materialized"**: per-project receipt isolation ("two projects SHALL never share one", no cross-project contention); "the receipt SHALL survive lockfile changes made outside the system"; the untrusted-receipt validation specifics (project identity, record shape, path containment); the legacy primary-only-ownership refinement rationale.
- **"Integrity is verified before any asset is written"**: "Normal resolution SHALL write a replacement lock entry only after all checks succeed"; "expected and actual integrity when available".
- **"Removing a facet uninstalls it"**: the adapter-compatibility precondition detail (positional `0.0` vs tagged `0.1` axis, precondition requires neither cache nor network, repair-then-offline-removal guarantee) and the "Other facets are left intact" scenario.

Each of these MODIFIED requirements must be re-diffed against the permanent spec and restored to full-text-plus-edits — or each dropped sentence explicitly justified as an intentional removal (which would then belong under REMOVED semantics with reason/migration, not silent omission). **This must be settled before archive.**

Additionally, one apparent drift bug: Main's CLI MODIFIED "unified progress view" scenario changed the stage list from "fetch, verification, build, and materialization" to "fetch, verification, build, **composition**, and materialization". Facet composition is explicitly rejected by the permanent installation spec and this change's proposal touches nothing called composition. Revert the word or justify it.

## Merge recommendation (per capability)

**`installation`** — keep Main as the base; it is broader and better on nearly every axis. Then:
1. **(Blocking)** Restore full permanent-spec text in every MODIFIED requirement, re-applying Main's edits on top (list above).
2. Add Adversary's scenario "Frozen install fails when resolutions require the current format" under "Lockfile declares a version".
3. Consider Adversary's "migration preserves every entry with unchanged meaning" assertion in the manifest-migration requirement (one AND-line).

**`protocol__schemas`** — keep Main wholesale. The tagged disposition requirement, `manifestVersion: 0.1` dispatch, typed override maps, producer preservation/collapse rules, and duplicate-member rejection are all stronger than Adversary's equivalents. No Adversary content needs merging; its "cannot be both aliased and omitted" and "adapter-scoped resolutions rejected" concerns are already made unrepresentable by Main's shapes.

**`cli`** — keep Main as the base. Then:
1. Adopt Adversary's summary requirement: the final summary SHALL show each aliased asset's authored name together with its effective materialized name and SHALL identify omitted assets as omitted (fold into Main's modified progress-view requirement or add as a scenario there).
2. **(Fix)** Revert or justify the "composition" stage word in the modified progress-view scenario.

## Bottom line

Main is the substantially stronger artifact — richer collision model, ownership reconciliation, transactional stale-intent handling, a well-typed published disposition shape, and a far more complete CLI contract. Its one serious defect is mechanical, not conceptual: its MODIFIED blocks are condensations that would silently delete permanent normative text at archive time, plus one drift bug ("composition"). Reconcile by restoring full MODIFIED fidelity, then fold in the three small Adversary wins (frozen-legacy scenario, summary mapping visibility, migration-preserves-entries).
