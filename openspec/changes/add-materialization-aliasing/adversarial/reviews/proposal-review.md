# Comparison Review: `proposal` — add-materialization-aliasing

**Main**: `openspec/changes/add-materialization-aliasing/proposal.md`
**Adversary**: `openspec/changes/add-materialization-aliasing/adversarial/artifacts/proposal.md`

The adversarial proposal was authored from the main proposal's intent (the `proposal` exception) but re-derived its framing independently from `docs/specification/*` and the permanent specs (`installation`, `protocol__schemas`, `cli`, `spec-governance`).

## Grading bar

- Proposal mechanics: Why / What Changes / Capabilities / Impact per template; Non-goals section present; under word limits; docs citation rule satisfied.
- RFC 2119 keywords for normative statements.
- Capabilities name product domains that match `openspec/specs/` (the contract for the specs phase).
- Smallest customer-valuable scope; "why" not "how".
- Coverage: does each version capture the full behavioral surface (detection, resolution, persistence, reproduction, integrity, lifecycle, docs)?

Both versions pass the mechanical bar: correct sections, Non-goals present, BREAKING marked, docs cited, RFC 2119 used, within word limits (Main ~700 words, Adversary ~850).

## Coverage comparison

Shared coverage (equivalent substance, differing wording): pre-write collision evaluation over the complete desired asset set; skills+commands in one namespace, agents separate; per-asset keep/alias/omit with a collision-free result; alias grammar reuse; interactive collection vs. structured non-interactive failure leaving all state untouched; persistence as version-controlled intent with compact string entries preserved; lockfile distinguishing authored from effective identities; receipt/repair/removal operating on effectively-owned files; integrity anchored to authored archive identities; one project-level resolution for all adapters; omission excluding a skill's companions; BREAKING tooling requirement; docs updates including troubleshooting and changelog; no new runtime dependency.

Material divergences:

### 1. Why framing — Adversary stronger

Main states the gap abstractly ("the current install contract does not resolve collisions … facets cannot be composed safely"). Adversary names the concrete present-day failure: undefined behavior today means silent overwrite / order-dependent state, and — sharper — **receipt-driven removal of one facet can delete a file another facet still claims**, since both record ownership of the same conventional path. That reframes the change from "feature gap" to "latent correctness bug in the core install path," which is a materially stronger "why now" and directly motivates the transactional pre-write gate.

**Recommendation**: merge the Adversary's concrete failure mode (silent overwrite, order dependence, cross-facet receipt deletion hazard) into Main's Why. Keep Main's composability sentence as the lead.

### 2. Capabilities — Main stronger (Adversary's omission of `cli` is wrong)

Adversary lists only `installation` and `protocol__schemas`, arguing prompting requirements live in `installation` (citing the adapter-selection prompt precedent there) and that the `cli` spec covers only generic argv/dispatch/help. That argument is factually incomplete: the `cli` spec *also* carries command-level requirements for exactly this territory — "Add launches adapter selection when none is selected," "Add and install render a unified progress view," "Add and install report integrity failures clearly." A collision-resolution prompt and structured-failure rendering would need `cli` deltas by direct analogy. Main's three-capability list is correct.

**Recommendation**: keep Main's Capabilities section as-is. Carry forward one useful residue of the Adversary's argument as guidance for the specs phase: behavior-level requirements (what must be detected, resolved, persisted, failed) belong in `installation`; the `cli` delta should carry only command/presentation-level requirements (prompt flow, rendering of collision groups and failures), mirroring how adapter selection is split between the two specs today.

### 3. Detection on every install — Adversary explicit, Main implicit

Adversary states detection "SHALL run on every install, not only on add," calling out that **facet updates can introduce new collisions** (the sneaky path: a teammate updates a facet, and a previously clean project collides in CI). Main's "before any materialization write … complete desired asset set" technically implies this, but never names the update-introduced case, and its frozen-mode mention is buried in the reproduction bullet.

**Recommendation**: make it explicit in Main's What Changes that evaluation happens on every install path (add, install, update, frozen, repair) and that a frozen install encountering an unresolved collision fails without rewriting any state.

### 4. Resolution-group flexibility — Main stronger

Main explicitly says "A resolution MAY alias multiple assets or omit every asset in the group" — preempting a plausible misreading that exactly one asset must keep the authored name. Adversary's per-asset "choose exactly one resolution: keep/alias/omit" plus the collision-free constraint is equivalent but leaves that MAY to inference.

**Recommendation**: keep Main's sentence. Optionally adopt the Adversary's crisp per-asset enumeration ("exactly one of keep, alias, omit per asset") as the lead-in, since it is the cleaner contract statement, with Main's MAY clause as the clarifier.

### 5. Non-goals — minor Adversary addition

The lists are otherwise equivalent (per-adapter resolution, publisher-side aliasing, silent winner selection, within-facet validation, MCP/future asset types). Adversary adds one Main lacks: **renaming facet identities (the `facets.json` keys) is out of scope — only materialized asset names are affected**. Cheap to add and closes a real ambiguity (a user hitting a collision might expect to rename the facet instead).

**Recommendation**: add that non-goal to Main.

### 6. Impact — equivalent

Both name the same package surfaces, the lockfile exact-version-dispatch design question, unchanged adapter contract shape, and the same docs set (Main's "troubleshooting guidance" ≈ Adversary's explicit troubleshooting page). No merge needed beyond what #1 and #3 already imply.

## Merge recommendation (summary, per section)

- **Why**: adopt Adversary's concrete failure-mode framing (silent overwrite, order dependence, receipt cross-deletion) into Main.
- **What Changes**: add Adversary's explicit "detection on every install, updates can introduce new collisions, frozen fails without rewriting"; keep everything else from Main, including the multi-alias/omit-all MAY clause.
- **Capabilities**: keep Main (three capabilities). Note the behavior-vs-presentation split between `installation` and `cli` for the specs phase.
- **Non-goals**: add "facet identity renaming is out of scope."
- **Impact**: no change.

## Blocking items

None. The one contract-level divergence (whether `cli` is a modified capability) resolves in Main's favor on the evidence of existing `cli`-spec requirements, so the Capabilities contract feeding the specs phase stands as written.
