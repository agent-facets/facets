# Comparison Review: `proposal` — expose-facet-privacy-toggle

**Sources compared**
- **Main**: `proposal.md` (authored by the main agent, status `done`)
- **Adversary**: `adversarial/artifacts/proposal.md` (authored blind by `/run-adversary`)

Both proposals agree on the core shape of the change: the `private` field already exists end-to-end (schema, build embedding, publish drift), and the only gap is that the interactive create wizard and edit workbench never surface it, forcing hand-editing of `facet.json`. Neither invents a new capability; both modify `authoring__facets`. The disagreement is in rigor, coverage of consequences, and adherence to the proposal rules.

## Grading bar

Scoped to a proposal artifact:
1. **Value-centric** — frames the customer problem, not the implementation. (Article II / spec-governance.)
2. **RFC 2119** — normative statements use MUST/SHALL/SHOULD/MAY. (Article I; enforcement says proposals without RFC 2119 in requirement-bearing sections SHALL be rejected.)
3. **Correct artifact mechanics** — Why / What Changes / Non-goals / Capabilities (domain-named, new vs. modified) / Impact; capabilities map to real `openspec/specs/` domains.
4. **Coverage** — names the downstream consequences a specs/design/tasks author must not miss.
5. **Documentation citation** — Article III + the explicit rule require citing the `docs/` that informed the proposal and the updates required.
6. **Word budget** — SHOULD 300–1000, MUST be < 1500.

## Coverage comparison

| Dimension | Main | Adversary |
|---|---|---|
| Why (problem framing) | Concise: "hidden functionality in the authoring workflow." Correct but thin. | Longer: names discoverability, current-visibility blindness, typo risk, and cites the doc that *instructs* hand-editing. |
| RFC 2119 in What Changes | **Absent.** Uses "Add…", "Default…", "Preserve…", "Update…" — informal imperatives. | Every bullet uses SHALL. |
| Public-by-default omission preserved | Yes (bullet 4 + non-goal). | Yes (bullet 3), and ties it explicitly to the existing "omission is not synthesized" spec rule. |
| Private→public transition representation | Not addressed. | Explicitly flagged as a real case and **deferred to design.md** (omit `private` vs. write `private: false`). |
| Rebuild + version-bump consequence | Not mentioned. | Bullet 5: author SHALL be shown that toggling is a manifest content change requiring rebuild + version bump if published. |
| Documentation citation | Cites `create.md`, `edit.md`, `manifest.md`, `publish-a-facet.md`; says create/edit docs SHOULD be updated. | Cites `publish-a-facet.md` (with the exact misleading line), `manifest.md`, `publish.md`; specifies the *required* update to the hand-edit guide and the rebuild/version discipline. |
| Non-goals | 4 bullets; adds "no composed/installed facet privacy" (good extra fence). | 4 bullets; adds "no new top-level `facet private`/`facet public` command" and "no auto-rebuild/republish" (both relevant fences the main omits). |
| Word count | ~430 words — comfortably in budget. | ~620 words — in budget. |

## Material divergences

### 1. RFC 2119 keywords in "What Changes" — Adversary is stronger, and this is blocking

Main's What Changes uses no RFC 2119 keywords ("Add an interactive privacy choice…", "Default newly created facets…", "Preserve the manifest schema's…"). Article I's enforcement clause is explicit: "Proposals without RFC 2119 keywords in requirements sections SHALL be rejected." The Capabilities/Modified bullet *does* use SHALL, so the proposal isn't wholly devoid of normative keywords — but the change-bearing bullets are the requirement substance and they read as informal imperatives. Adversary uses SHALL throughout What Changes. **Stronger: Adversary.** This is the one item I'd call blocking against the constitution.

### 2. Rebuild + version-bump consequence — Adversary is stronger

The biggest *product* gap in Main is silence on what happens after the author flips visibility. Privacy lives in the built/embedded manifest and is governed by publish-time drift + immutability rules; flipping the source toggle does nothing until rebuild, and re-publishing an already-published version is blocked. An author who toggles in the TUI and assumes it "took effect" will be confused at publish time. Adversary surfaces this as an explicit author-facing requirement (bullet 5). Main's non-goals even *touch* the adjacent fact ("will not change build or publish drift behavior") but never states the author must be *told*. **Stronger: Adversary.** Recommend folding this in as a What-Changes bullet, not just a non-goal.

### 3. Private→public transition representation — Adversary is stronger

Main bullet 10-equivalent only covers create-time defaulting and the public-omission rule. It never addresses the *edit* case where a facet was `private: true` and the author flips to public: do we delete the key or write `private: false`? The existing spec accepts both, but the on-disk result differs and someone must decide. Adversary names this and defers it to design.md — exactly the right move for a proposal. Main's Impact line ("public selections remove any existing `private` key") actually *makes* this decision implicitly, in the Impact section, without flagging it as a decision. **Stronger: Adversary** for surfacing it as a deferred decision; Main has pre-committed to "delete the key" buried in Impact, which is a design call leaking into a proposal.

### 4. Where Main is actually stronger: Impact specificity on the code surface

Main's Impact is more concrete about the *CLI form mechanics* that will actually carry this: "shared create/edit form state, focus order, confirmation summaries, and any new focusable toggle component," plus "Edit result construction … public selections remove any existing `private` key." This is sharper guidance for the eng/tasks author about *where the work lands in the TUI* than Adversary's more spec-and-engine-pathway-oriented Impact. Adversary lists more packages (`manifest/`) but is vaguer about the TUI focus-order/summary work, which is the genuinely fiddly part. **Stronger: Main** on implementation-surface concreteness — though note the caveat in §3 that one of these Impact lines smuggles a design decision.

### 5. Non-goals fences — Adversary is slightly stronger, Main has one Adversary lacks

Adversary fences off "no new `facet private` command" and "no auto-rebuild/republish on toggle" — both are realistic scope-creep vectors a reader might assume. Main fences off "no privacy controls for composed dependencies or installed facets" — a vector Adversary omits. The ideal non-goals section is the **union** of all three.

### 6. Documentation citation — Adversary is stronger on the "drift" obligation

Both cite docs. Adversary is sharper on Article III's *drift* obligation: it names the specific misleading sentence in `publish-a-facet.md` ("set 'private': true") and states that guidance MUST be updated, not just that docs SHOULD mention the new step. Main cites `publish-a-facet.md` in its informing-docs list but frames only create/edit docs as needing updates ("SHOULD be updated"), underselling that the publish guide currently gives instructions that the change makes obsolete. **Stronger: Adversary.**

## Merge recommendation (per What-Changes bullet / section)

Keep **Main as the base** (its word budget and TUI-surface Impact are assets) and fold in the following:

- **What Changes — convert to RFC 2119.** Rewrite all five Main bullets with SHALL (matching Adversary). *Blocking* per Article I.
- **What Changes — add the consequence bullet.** Add Adversary bullet 5: the tools SHALL inform the author, at the point of toggling, that visibility is a manifest content change requiring rebuild before effect and a version bump if the current version is already published. This is the most important coverage gap in Main.
- **What Changes / Capabilities — surface the private→public representation as a deferred decision.** Adopt Adversary's framing (defer omit-vs-`false` to design.md). Remove Main's Impact line "public selections remove any existing `private` key," or move it into design.md as the proposed resolution rather than a pre-decided Impact fact.
- **Non-goals — take the union.** Keep Main's "no composed/installed facet privacy"; add Adversary's "no new top-level `facet private`/`facet public` command" and "no automatic rebuild/republish on toggle."
- **Impact — keep Main's TUI-surface detail**, and merge Adversary's explicit doc-drift requirement: state that `docs/guides/publish-a-facet.md`'s hand-edit guidance MUST be updated (not merely that create/edit docs may be), and that `docs/specification/manifest.md`'s Privacy section SHOULD note the field is now author-settable.
- **Why — optional enrichment.** Main's Why is in-budget and adequate; optionally borrow Adversary's discoverability/typo-risk framing if word budget allows after the above additions.

## Blocking cross-cutting item

**RFC 2119 in What Changes (§1).** Per Article I's enforcement clause, a proposal whose requirement-bearing section lacks RFC 2119 keywords SHALL be rejected. Main's What Changes must be converted to SHALL/MUST language before this proposal is archived. Everything else is improvement, not a gate.
