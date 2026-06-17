# Adversarial Comparison Review — `proposal`

**Sources compared**
- **Main**: `openspec/changes/add-facet-visibility-to-manifest/proposal.md` (the main agent's version)
- **Adversary**: `openspec/changes/add-facet-visibility-to-manifest/adversarial/artifacts/proposal.md` (authored blind by `/run-adversary`)

Both were authored from the same inputs (proposal instructions, constitution, the `protocol__schemas` / `authoring__facets` / `publishing` specs, and the manifest/publish docs). The adversary never saw Main while authoring; this review reads both for the first time.

## Grading bar

Proposal-scoped rubric:
1. **Value-centric** — frames the customer/author problem, not the implementation.
2. **Smallest valuable slice** — distilled scope, tradeoffs surfaced.
3. **Correct artifact mechanics** — required sections present (Why / What Changes / **Non-goals** / Capabilities / Impact), word budget (300–1000 target, <1500 hard), domain-named capabilities.
4. **Capabilities contract** — the proposal→specs handshake: every modified domain named correctly, no invented domains.
5. **Documentation citation** (Article III) — cites the docs that informed it.
6. **Coverage** — does it surface the real downstream consequences a specs/design author will need?

## Coverage comparison

| Dimension | Main | Adversary |
| --- | --- | --- |
| `private` boolean, public-by-default, omission == public | ✅ | ✅ |
| Backward-compat / no BREAKING | ✅ (states it) | ✅ (explains *why* — schema already tolerates+preserves unknown fields) |
| Non-goals section | ✅ **present, strong** | ❌ **MISSING — rule violation** |
| Carried verbatim in embedded manifest to registry | ✅ | ✅ (slightly sharper: ties to existing `name`/`version` upload contract) |
| Capabilities: 3 modified domains, no new | ✅ | ✅ (identical set + rationale) |
| **Build/publish drift consequence of editing `private`** | ✅ **calls it out as content drift** | ❌ **absent** (and implicitly contradicted by "out of scope" framing) |
| Richer-visibility tradeoff (boolean vs `visibility` string) flagged for design | ⚠️ one line ("Do not introduce a new visibility state unless…") | ✅ **explicit, framed as the central design open question** |
| Value-type discipline (RFC2119 in modified-cap bullets) | ✅ uses SHALL | ➖ descriptive (acceptable for a proposal; specs phase owns normative language) |
| Docs cited | ✅ manifest.md, publish.md, **+ guides/publish-a-facet.md** | ✅ manifest.md, publish.md |
| Word budget | ✅ ~330 words, comfortably in band | ✅ ~480 words, in band |

## Material divergences — which is stronger and why

1. **Non-goals (BLOCKING, Main wins).** The proposal rules explicitly require a "Non-goals" section. **Main has one and it is excellent** — it pre-empts the four most dangerous scope-creep vectors (registry authz/billing/grants/search, org-membership semantics, auth-model changes, retroactive migration of published records). **The adversary omits the section entirely** — a hard rule violation. This is the clearest case in the review where Main is decisively stronger, and it is not close.

2. **Drift consequence (Main wins, and it's correct).** Main's Impact section observes that "changing `private` after build is content drift and must be surfaced consistently with other manifest edits." I verified this against the `publishing` spec: content drift is defined as same name+version but differing manifest content. `private` is manifest content, so editing it post-build is content drift by the existing definition. Main surfaces a real, correct downstream consequence that the specs/design author must honor; **the adversary misses it** and its "out of scope: tooling reads what the author wrote" framing slightly undersells that the drift machinery already in `publishing` will interact with this field. Fold Main's point in — it is load-bearing for the `publishing` delta spec.

3. **Visibility-model tradeoff (Adversary wins, but it's a design concern).** The adversary frames boolean-vs-`visibility`-string as *the* central open question and explains the migration cost of guessing wrong. Main mentions it in a single deferral bullet. The adversary's framing is more useful **as input to the design phase**, but note: a proposal should not over-index on a design decision. The right resolution is a one-line pointer in the proposal plus a real Open Question in `design.md` — not expanding the proposal.

4. **"Why" quality (Adversary marginally stronger).** The adversary's Why articulates the concrete pain — source-of-truth `facet.json` and the registry disagreeing via out-of-band config — which is a sharper value statement than Main's "encode that intent in the artifact of record." Minor; Main's is adequate.

5. **Docs citation breadth (Main marginally stronger).** Main also cites `docs/guides/publish-a-facet.md`, a third surface that will need updating. The adversary cites only the two specification pages. Pull the guide reference into the reconciled Impact so the docs-update scope is complete (Article III).

## Merge recommendation (per section)

- **Why** — Keep Main's structure; optionally graft the adversary's sharper framing ("`facet.json` and the published artifact disagree about a property the author cares about via out-of-band config"). Low priority.
- **What Changes** — Keep Main. Optionally adopt the adversary's explicit "only legal values are `true`/`false`; non-boolean MUST be rejected" clause — it tightens the specs handshake. Keep Main's "do not introduce a new visibility state unless design shows otherwise" bullet.
- **Non-goals** — **Keep Main's section verbatim.** This is the section the adversary lacks; nothing to merge, everything to preserve.
- **Capabilities** — Identical across both (`protocol__schemas`, `authoring__facets`, `publishing`; no new). No change.
- **Impact** — Keep Main, including the **content-drift observation** (it is correct and important). Ensure all three doc surfaces are listed (`manifest.md`, `publish.md`, `guides/publish-a-facet.md`).
- **Visibility-model tradeoff** — Do **not** expand the proposal. Carry it forward as an explicit Open Question in `design.md`: "boolean `private` vs. string `visibility` discriminator — is any third audience state (unlisted / org / invite-only) anticipated near-term?" The adversary's reasoning is the raw material for that Open Question.

## Blocking cross-cutting items (settle before archiving the change)

1. **Main is missing nothing structurally; the adversary's omission of Non-goals is the only hard rule violation — and Main already satisfies it.** No blocking edit to Main is required on that axis. ✅
2. **Carry the boolean-vs-`visibility` decision into `design.md` as an Open Question** before specs are frozen. If design concludes a richer model is plausible near-term, the specs MUST model `visibility` from the start to avoid a breaking migration — this decision gates the `protocol__schemas` delta. ⛔ until resolved in design.

**Net:** Main is the stronger proposal and is ready to proceed largely as-is. The reconciliation work is small: (a) optionally tighten the `private` value constraint using the adversary's wording, (b) ensure the content-drift point and the third doc surface survive into the final Impact, and (c) seed the design phase with the visibility-model Open Question the adversary articulated.
