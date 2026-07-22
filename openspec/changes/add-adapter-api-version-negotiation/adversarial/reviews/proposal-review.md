# Comparison Review: proposal — add-adapter-api-version-negotiation (round 2)

**Main**: `openspec/changes/add-adapter-api-version-negotiation/proposal.md`
**Adversary**: `openspec/changes/add-adapter-api-version-negotiation/adversarial/artifacts/proposal.md`

Context and caveat: the prior adversarial pass was deleted after the proposal pivoted from `legacy-unversioned` to explicit adapter API `0.0`. This round was authored inline without re-reading the main proposal, but the same session produced the main version, so independence is weaker than a spawned blind run — convergence on the core model is expected and observed. The review therefore weights the genuine divergences.

## Grading bar

- Value-centric framing (user-visible behavior, not implementation)
- RFC 2119 keyword discipline (Article I)
- Proposal mechanics (Why / What Changes with **BREAKING** markers / Capabilities mapped to real domains / Impact / Non-goals; Article III docs citation; word limits)
- Coverage of the agreed `0.0` model: designation, SDK stamping, CLI support set, metadata + runtime declarations, compatible resolution, atomic replacement, provenance, pre-materialization gate, npm-`latest` neutrality, intentional break for undeclared bundles
- Sharpness of scope: only this change, no follow-on leakage

## Coverage comparison

Both versions agree on the entire core model: API `0.0` designation independent of package/CLI/SDK semver; `defineAdapter()` stamping without author involvement; CLI support of exactly `0.0`; missing/malformed/unsupported declarations rejected before any method call; npm metadata as pre-download selection aid with the runtime declaration authoritative and conflicts failing verification; highest-compatible selection replacing `/latest`; exact pins failing rather than substituting; unchanged npm `latest` semantics; staged atomic replacement; provenance retention; pre-materialization facet-install gate; the same four documentation pages; the same three modified capabilities; and matching non-goals.

Material divergences:

| Area | Main | Adversary |
|---|---|---|
| API identifier comparison rule | "Discrete contract identifiers," comparison semantics unstated | Explicit: exact-equality token comparison, never semver ranges |
| No-compatible-release outcome | Covers incompatible exact pins only | Also covers "no published release is compatible": structured failure naming the newest release's API and the support set |
| **BREAKING** marker | Breaking-ness stated in a trailing paragraph, unmarked | Explicit **BREAKING** bullet per the artifact instructions |
| `facet adapter list` | Absent | SHOULD surface each installed adapter's API version and compatibility |
| Git/local resolution exemption | Explicit: cannot be version-selected; MUST pass runtime verification as supplied | Implied by "every consumer" but the resolution-side exemption is unstated |
| Why framing | Forward-only rationale for building the versioned boundary now instead of a legacy class | Concrete crash incident + "invisible contract" argument |

## Judgments

**Adversary is stronger on selection/comparison precision.** The exact-equality rule is the guard that stops a future implementer from "helpfully" applying range logic to API identifiers; leaving comparison semantics unstated invites exactly that. The no-compatible-release failure is a real user-reachable outcome (an old CLI facing a package whose every recent release declares a future API) that Main's resolution bullet does not name; without it, the specs phase could omit the scenario.

**Adversary follows the artifact mechanics more precisely on the breaking change.** The proposal instructions require breaking changes to be marked **BREAKING**. Main's trailing paragraph says the right things but skips the marker.

**The `facet adapter list` surfacing is the one genuinely new idea.** It is small, user-visible, and directly serves the diagnostic story (a user told "adapter X is incompatible" can see at a glance which installed adapters are). It is also scope the main version deliberately never had — adopting it or explicitly deferring it is a judgment call, but it should be decided, not lost.

**Main is stronger on the strategic Why and the resolution exemption.** Main's forward-only rationale explains *why now and why not a legacy class* — the actual decision this change embodies — where the Adversary's incident framing re-argues the symptom (which the prior reconciliation already chose to exclude as implementation-specific). Main's explicit statement that git/local adapters cannot be version-selected and must pass runtime verification as supplied closes a gap the Adversary leaves implicit.

**Mechanics.** Both are within word limits and use RFC 2119 keywords consistently. Capabilities map to the same three existing domains in `openspec/specs/` in both versions.

## Merge recommendation (per section)

- **Why**: Keep Main unchanged.
- **What Changes**:
  - Extend Main's first bullet with the comparison rule: adapter API identifiers SHALL be compared for exact equality and SHALL NOT be treated as semver ranges.
  - Extend Main's resolution bullet with the no-compatible-release outcome: when no published release declares a supported API, resolution SHALL fail with structured data naming the newest release's declared API and the CLI's supported set.
  - Mark the trailing breaking statement **BREAKING** (or restate it as a marked bullet).
  - Decide on `facet adapter list` compatibility surfacing: adopt as a SHOULD bullet, or record its exclusion deliberately.
- **Capabilities**: Keep Main's three deltas. If list surfacing is adopted, fold it into the `adapter__management` delta.
- **Impact**: Keep Main (it is a superset). If list surfacing is adopted, add adapter-list output to the CLI line.
- **Non-goals**: Keep Main unchanged.

## Blocking items

None are hard blockers. One decision item before specs: **adopt or explicitly defer the `facet adapter list` API-version/compatibility surfacing**, since it determines whether the `adapter__management` delta spec contains a listing requirement.

## State

- `proposal`: pending_reconciliation (this review)
