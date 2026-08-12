# Comparison Review: `design` — add-mcp-json-support

**Main**: `openspec/changes/add-mcp-json-support/design.md`
**Adversary**: `openspec/changes/add-mcp-json-support/adversarial/artifacts/design.md`

Both were derived from the reconciled proposal and the same codebase; the
adversarial version was authored without sight of the main version.

## Grading bar

Design-artifact criteria: correct artifact mechanics (Context / Goals /
Decisions-with-alternatives / Risks / Migration / Open Questions); RFC 2119
keywords on normative statements; implementation-aware accuracy against the
actual protocol/engine/adapter code; coverage of the full proposal scope
(schema, consent, ownership, conflicts, omission, adapters, legacy, reporting,
docs); compliance with the design rules requiring identification of `docs/`
impact; and adherence to the project's type-design discipline (illegal states
unrepresentable, failures as values).

## Coverage comparison

Both designs converge on the same architecture skeleton, which is itself a
useful signal that the skeleton is right: a closed tagged union in the current
facet-manifest schema only; legacy `0.1` untouched and inert; lockfile
unchanged because facet integrity already pins `facet.json`; receipt advanced
to `0.4` carrying keyed deletion authority *and* consent memory as
fingerprints; consent as an injected, batched, machine-local gate with a
non-interactive opt-in flag; configuration composition separate from
`AssetType`; adapter-native read/modify/write with semantic preservation of
unowned state; fail-closed unsupported adapters; conflict-before-mutation;
adopt-if-identical for unowned matching entries; MCP work inside the existing
journal + tri-write transaction; warn-and-skip retained only for legacy;
standalone server artifact model deleted.

They diverge materially in eight places:

1. **Omission storage.** Main: project manifest bumps to `0.2`; omission is a
   per-facet `materialization.servers.<name>: { kind: "omitted" }` arm with
   explicit prune/migration/frozen rules. Adversary: a project-wide
   `mcp: { omit: string[] }` list in `facets.json`, no manifest version bump.
2. **Adapter API compatibility.** Main: API `0.2` with a compatibility window
   — `0.1` adapters keep working for text-only desired state and become
   unsupported only when active MCP declarations exist; capability expressed
   as `configuration: false | ConfigurationCapability`. Adversary: hard bump
   to `0.2` with `configuration` required; installed `0.1` adapters fail
   closed everywhere.
3. **Adapter operation shape.** Main: batch `prepare` (read-only, parses the
   native file once, detects native conflicts, returns per-key outcomes plus
   an opaque plan) then `apply` (one atomic edit, returns `unchanged` or an
   adapter-owned inverse operation for the journal). Adversary:
   `configDocuments` + `readMcpServers` + `applyMcpServers(upserts, deletes)`,
   with the engine journaling byte preimages of the disclosed documents.
4. **Rollback mechanism.** Main: adapter-supplied semantic inverse operations.
   Adversary: engine-captured byte preimages, restored LIFO.
5. **Consent flag surface.** Main: `--accept-mcp` on `add`, `install`, *and*
   `remove` (because all three enter the commit pipeline). Adversary:
   `--allow-mcp` on the install/add path only.
6. **Removal-only refinement.** Main: carry-forward requires the receipt to
   anchor each remaining claim to the same resolved facet integrity (which
   the `0.4` receipt records per facet); otherwise fall back to full
   resolution. Adversary: witnesses remaining keyed entries by declaration
   hash only.
7. **Format discrimination.** Main devotes D9 to a tagged legacy/current
   discriminator threaded through verification, resolution, and prompt
   loading, with no cross-format fallback. Adversary handles legacy in
   passing (schema untouched, warnings retained) without the resolution-path
   type discipline.
8. **Open questions.** Main: ADR-5 supersession governance for the retired
   `authoring__servers` model. Adversary: Codex project-scope/HTTP
   feasibility, adoption-equality semantics (portable vs tool-native
   comparison), OpenCode `.jsonc`/`.json` precedence.

## Divergence judgments

**1. Omission storage — Main is stronger.** Per-facet omission composes with
the existing `materialization` override machinery, makes aliasing
unrepresentable-but-reservable (`{ kind: "omitted" }` as the only arm), and —
decisively — lets a *conflict* be resolved by omitting one claimant while
keeping the other. The adversary's project-wide omit list kills the server
name outright (it concedes this: "at the cost of one server") and skips the
manifest version bump that a schema extension honestly requires. Main also
specifies prune timing (only after a successful non-frozen install proves the
declaration gone) and frozen behavior (report stale intent, never prune),
which the adversary leaves at "pruned like stale overrides."

**2. API compatibility window — Main is stronger, with one caveat.** The
adversary's hard bump strands every installed `0.1` adapter for *all* work,
including text-only installs that MCP doesn't touch — real user pain purchased
for one-dimensionality. Main's `configuration: false | Capability` union
resolves the adversary's own objection (a feature matrix of booleans plus
optional methods that can disagree) in exactly the house type-design style:
the illegal states are unrepresentable in one field. The caveat: main should
state explicitly that `SUPPORTED_ADAPTER_APIS` becomes a two-element set and
that `verifyAdapter`'s npm-vs-runtime equality check stays per-adapter exact —
the window is in the *engine's acceptance set*, not in any loosening of the
token semantics.

**3. Adapter operation shape — Main is stronger.** One read-only parse
producing per-key outcomes and an opaque plan, then one atomic edit, is
cleaner than the adversary's read + apply(upserts, deletes) pair: it makes
"prepare everything before the first mutation" (main D7 step 5) structurally
checkable, folds native-conflict detection into the same parse, and avoids
two document edits when ownership transfers within one file. The adversary's
separate global delete pass is an asset-world habit that keyed entries in a
single document don't need.

**4. Rollback mechanism — Adversary is stronger; recommend a hybrid.** An
adapter-owned inverse operation makes rollback correctness depend on adapter
code being right *twice* (forward and inverse), and a semantic inverse may not
restore comments/formatting it disturbed — precisely the fidelity rollback
exists to guarantee. The engine's existing journal discipline is
preimage-based (the F14 guard exists because undo must be grounded in
witnessed prior state, not inference). The adversary's byte-preimage restore
gives byte-perfect undo with zero adapter involvement, at the cost of the
adapter disclosing which document it will touch — a path, not a format, so
the abstraction leak is minimal. **Hybrid**: keep main's prepare/apply shape,
but have `prepare` disclose the affected document path(s) in its outcome; the
engine captures byte preimages before calling `apply` and journals a byte
restore. Drop the adapter-supplied inverse entirely.

**5. Consent flag on `remove` — Main is stronger.** The observation that
`remove` re-enters the commit pipeline and reconciles remaining facets (so a
changed remaining declaration can need consent there) is a real catch the
adversary missed. Flag naming (`--accept-mcp` vs `--allow-mcp`) is
indifferent; pick one and keep it.

**6. Removal-only anchoring — Main is stronger.** Anchoring carried-forward
claims to recorded facet integrity is a materially better witness than
declaration hash alone: it reuses the existing "witness, don't guess"
refinement philosophy and gives the fallback-to-resolution rule a crisp
trigger (pre-`0.4` receipt).

**7. Format discrimination — Main is stronger.** D9's tagged-result rule
("an invalid current manifest SHALL never fall back to legacy validation";
registry resolution retains the verification-selected version) closes a bug
class the adversary never names.

**8. Open questions — split; merge both lists.** Main's ADR-5 governance item
is required by the constitution's ADR authority and the adversary missed it.
But the adversary's Codex feasibility question is the single most
consequential unknown in the whole design: main's D6 simply asserts project
`.codex/config.toml` + `mcp_servers` tables as a target. If Codex does not
actually honor project-scoped MCP config, then under the fail-closed rule
*every* MCP-declaring install with codex selected fails — a large blast
radius that deserves pre-implementation verification, not discovery in step 3
of the migration plan. The adoption-equality question (compare portable
declaration vs tool-native rendering when deciding "semantically matches")
also genuinely affects D8's adopt path and should be answered in the design.

**Smaller items.**

- *Closed declarations (main D1)* — reject-unknown-members with the
  security rationale (a silently ignored `shell`/`cwd`/`headers` field means
  two consumers execute different configurations) is a strong, adversary-missed
  decision. Keep.
- *Env-name grammar and empty-collection normalization (main D1)* — stronger
  than the adversary's untyped `Record<string,string>`; normalization feeds
  the fingerprint definition. Keep.
- *Fingerprint spec (main D3)* — canonical encoding rules and "receipts never
  store command arguments, URLs, or environment values" beats the adversary's
  bare `declarationHash`. Keep.
- *Outcome classification (main D10)* — mapping declaration/omission changes
  to `updated`, drift rewrite to `repaired`, and counting text assets vs MCP
  configurations separately (so a server-only facet reports meaningful work)
  has no adversary counterpart. Keep.
- *Minimum-content rule* — the adversary states the mechanics explicitly
  (Constraint 1 in the current schema gains `hasServers`; the legacy copy is
  untouched); main carries this only implicitly in Goals and migration step 1.
  Worth one sentence in main's D1 or D9.
- *Adoption consent (main D8)* — requiring consent + read-back before
  adopting an unowned matching entry is more careful than the adversary's
  automatic adoption; adoption grants deletion authority and deserves the
  gate. Keep main's version.
- *Frozen fetch trade-off (main, Risks)* — main honestly flags that frozen
  MCP checks may require fetching locked content since declarations aren't in
  the lockfile; the adversary overclaims that removal paths never need
  fetches. Main's framing is correct.
- *Docs* — main's D11 list is substantially broader (project-manifest.mdx,
  lockfile.mdx, build.mdx, custom-adapters.mdx, add.mdx, guides, README,
  both roadmap pages) and better satisfies the design rules; the adversary
  adds only one item main lacks: a changelog entry.

## Merge recommendations (per decision)

1. **D1 (schema)**: Keep main. Optionally note the Constraint 1 broadening
   mechanics (current schema only) explicitly.
2. **D2 (omission)**: Keep main's per-facet `{ kind: "omitted" }` and the
   project-manifest `0.2` bump. Discard the adversary's project-wide list.
3. **D3 (receipt)**: Keep main.
4. **D4 (composition)**: Keep main.
5. **D5 (consent)**: Keep main, including the flag on `remove`.
6. **D6 (adapter API)**: Keep main's window and `configuration:
   false | Capability`, adding an explicit sentence that the engine's
   supported-API set becomes `{'0.1','0.2'}` while per-adapter verification
   remains exact-equality.
7. **D6/D7 (rollback)**: **Adopt the hybrid** — `prepare` discloses affected
   document path(s); the engine captures byte preimages and journals byte
   restores; delete the adapter-owned inverse-operation clause from D6/D7.
8. **D8 (ownership/adoption)**: Keep main.
9. **D9 (format tags)**: Keep main.
10. **D10 (reporting)**: Keep main.
11. **D11 (docs)**: Keep main; add a changelog entry to the list.
12. **Open Questions**: Keep main's ADR-5 item; **add** the adversary's Codex
    project-scope/HTTP feasibility question (with a note that the answer can
    shrink D6's first-party table or gate the release), the
    adoption-equality-semantics question, and (minor) OpenCode
    `.jsonc`/`.json` precedence if not considered settled by D6's wording.

## Blocking items

- **Codex project-scoped MCP feasibility MUST be verified (or explicitly
  risk-accepted in the design) before this change proceeds to tasks**: the
  fail-closed rule turns a wrong assumption in D6's target table into
  every-install failures for codex users, and the design currently records no
  uncertainty about it.
- **The rollback mechanism divergence (adapter inverse vs byte preimage)
  should be settled in the design, not during implementation** — it changes
  the shape of the SDK's `apply` result and the journal integration, both of
  which the specs and tasks will build on.

## Verdict

Main is the stronger design overall — deeper on omission semantics, receipt
fingerprinting, compatibility windowing, format discrimination, and outcome
classification, and its D6 capability union and D1 closed-schema rationale are
better type-design than the adversary's equivalents. The adversary
nevertheless lands four things reconciliation should take: the byte-preimage
rollback hybrid, the Codex feasibility blocking question, the
adoption-equality open question, and the changelog line in the docs list.
