# Comparison review: `design` — add-materialization-aliasing

**Main**: `openspec/changes/add-materialization-aliasing/design.md`
**Adversary**: `openspec/changes/add-materialization-aliasing/adversarial/artifacts/design.md`
Both were derived from the reconciled proposal; the adversary authored blind to Main.

**Grading bar**: correct design-artifact mechanics (template sections, RFC 2119
for normative statements, alternatives per decision, Article III documentation
duties), decision quality (rationale grounded in the actual codebase),
coverage of every proposal commitment (transactional whole-set detection,
persisted intent + resolved state, authored/effective identity split,
interactive + structured-failure flows, frozen behavior, compatibility), and
technical correctness against the current engine/protocol implementation.

## Convergence (high confidence)

The two designs independently agree on the architectural spine, which is the
strongest possible signal that it is right:

- Restructure the interleaved per-facet loop into resolve-everything →
  whole-set collision gate → materialize, with the gate on the no-mutation
  path before any adapter write (Main D5, Adversary D1).
- A pure, deterministic planner and the namespace mapping
  (skill+command shared, agent separate) live in **protocol**, not engine
  (Main D1/D4, Adversary D2/D10). Scope participates in the collision key.
- "Keep" is not persisted; only aliases and omissions are recorded, and
  detection is always "apply overrides, require the residual effective set
  to be collision-free" (identical reasoning in both, independently derived).
- Enriched `facets.json` entry: per-facet object with per-type maps keyed by
  authored name; compact string form stays canonical when no overrides
  exist; old CLIs fail loudly on the object shape before any mutation
  (Main D2, Adversary D4).
- Lockfile `0.3` + receipt `0.3` under exact version dispatch; `name` stays
  authored; `files[]` stays canonical archive paths; integrity chains never
  see aliases (Main D3, Adversary D5/D9).
- Engine↔CLI seam is an optional async resolver callback under the held
  install lock; no callback ⇒ structured no-mutation failure with all
  groups; frozen never prompts and never migrates; cancellation is a value
  (Main D6, Adversary D6/D8).
- Adapter API unchanged; adapters receive the effective name and cannot
  tell an alias from an authored name.

None of this needs relitigating at reconciliation.

## Material divergences

### 1. Omitted assets in the lockfile — **Main is stronger**

Main keeps every authored asset in `assets[]` with a required tagged
`materialization` disposition (omitted assets keep their `files[]` hashes);
Adversary drops omitted assets from `assets[]` and derives omission from
manifest intent. Main explicitly anticipated and rejected the adversary's
choice ("Drop omitted assets from the lockfile. Rejected because the
lockfile must record the resolved asset set and compare it with project
intent"). Main's shape is better on three counts: locked-vs-plan
reconciliation stays intent-independent; the tagged union follows the
illegal-states-unrepresentable doctrine where Adversary's optional `as`
plus absence-encoding splits one concept across two mechanisms; and the
frozen consistency check becomes largely lockfile-internal. Adopt Main.

### 2. Lockfile write policy — **genuine decision point; Main is simpler, Adversary preserves more compatibility**

Main migrates every project to `0.3` on the first successful normal install
(precedent: the 1→0.2 rollout). Adversary proposes a **version-preserving
write**: emit `0.2` while the project has zero resolutions, `0.3` once any
exists — confining the BREAKING format to projects that opted in, at the
cost of a bimodal serializer and possible 0.2↔0.3 oscillation. Main's
unconditional migration is simpler and precedent-aligned but breaks older
CLIs for *every* project on next install, not just resolution users —
arguably wider than the proposal's BREAKING bullet implies. **Recommend:**
keep Main's unconditional migration for simplicity, but the design MUST add
the version-preserving write as a named considered-and-rejected alternative
with this compatibility trade-off stated — right now Main's D3 does not
acknowledge that its migration choice breaks uninvolved projects, and Main's
rollback section should note the Adversary's observation that under
unconditional migration, "remove resolutions and reinstall" does NOT return
a project to `0.2`.

### 3. Manifest override value shape — **Main is stronger, with an ergonomics debt**

Main uses tagged objects (`{ "kind": "aliased", "as": ... }` /
`{ "kind": "omitted" }`); Adversary uses compact `string | false`. Main's
shape is the same disposition type as protocol's model (single source of
truth) and extensible; Adversary's is far friendlier to the hand-editing CI
workflow both designs mandate. Keep Main's shape, but fold in the
Adversary's mitigation: the structured `UNRESOLVED_COLLISIONS` rendering
SHOULD print a ready-to-paste `facets.json` fragment per group (Adversary's
open question; Main's failure rendering doesn't commit to this).

### 4. Stale overrides — **Main is stronger, one caveat**

Main: overrides survive collision disappearance (durable intent), absent-
asset overrides are reported and pruned only inside a successful tri-write,
frozen treats them as drift and fails. Adversary: warn-and-ignore, prune
only interactively. Main's frozen-drift failure is the correct
reproducibility stance and auto-prune-on-commit avoids warning fatigue.
Caveat worth carrying: auto-pruning discards intent that a facet
*downgrade* would re-activate; Main already confines pruning to successful
normal installs, which is acceptable — but the prune SHOULD be surfaced as
a distinct stage event, not just a log line.

### 5. Companion-byte lifetime — **Main is stronger**

Adversary keeps plans byte-free and re-reads companion bytes per facet
during materialization; Main holds resolved bytes eagerly through compose
precisely to avoid a time-of-check/time-of-use gap for local sources, and
carries the memory cost as an explicit risk with a deferred lazy-read
optimization. Main caught a correctness hazard the Adversary's "cheap
plans" framing misses. Adopt Main.

### 6. Global ownership transfer and duplicate receipt claims — **Main only; important**

Main's D7 is coverage the Adversary lacks entirely: cross-facet ownership
transfer (an old adapter key retained by any desired asset is never
deleted), aggregation of historical duplicate receipt claims (which
pre-collision-detection installs can legitimately contain — the very bug
this change fixes), and delete-once semantics per adapter key. The
Adversary's per-facet effective-identity diff would mishandle exactly the
broken pre-existing states this feature is built to clean up. Adopt Main
verbatim; this is the single largest quality gap between the two versions,
in Main's favor.

### 7. Portable-name collision keys and duplicate JSON members — **Main only**

Main normalizes collision keys with the existing portable (NFC + case-fold)
rules and rejects duplicate JSON members before schema validation.
Adversary used raw effective names and standard parsing. Both Main
hardenings are correct and cheap; keep them.

## Where the Adversary is stronger

- **No non-interactive resolution flag — decided, not open.** Adversary
  rules out a `--resolve`-style flag with a principled rationale (intent
  belongs in the committed manifest, not pipeline arguments); Main leaves
  the same question open. Recommend Main adopt the Adversary's position and
  close its first open question, or at minimum record the rationale.
- **`facet edit` / other `facets.json` writers.** Adversary explicitly
  flags that the edit machinery (`packages/engine/src/edit/` scanner,
  manifest-writer, reconcile) rewrites `facets.json` and MUST at minimum be
  read-tolerant of expanded entries — silently collapsing an object entry
  back to a string would destroy user intent (data loss). Main's migration
  step 2 covers "manifest mutations and source write policy" but never
  names the edit flow. This is a coverage gap in Main.
- **`remove` path statement.** Adversary explicitly notes `facet remove`
  funnels through the gate and passes trivially without special-casing;
  Main is silent. One sentence of completeness worth adding.

## Artifact mechanics

Both use RFC 2119 correctly, both carry alternatives per decision, both
satisfy Article III with concrete doc lists. Main's documentation section is
broader and more precise (adds `planning.mdx`, `custom-adapters.mdx`,
`instructions.mdx`, changelog, and an explicit README review concluding no
change needed — the Adversary only conditionally mentioned README). Main
also adds an update-classification rule (disposition change ⇒ facet
"updated") and a resolver re-invocation loop for alias-induced collisions —
both good details the Adversary lacks. Main's Migration Plan is more
operationally sequenced (enable `0.3` writes last). Main is the better
artifact overall.

## Merge recommendation (per decision)

1. **D1/D4 (identity model, planner, keys)** — keep Main; no changes.
2. **D2 (manifest shape)** — keep Main; add the ready-to-paste-fragment
   commitment to the failure rendering (from Adversary).
3. **D3 (lockfile/receipt 0.3)** — keep Main's omitted-assets-stay shape;
   ADD the version-preserving write as a named rejected alternative and fix
   the rollback narrative to acknowledge unconditional migration's blast
   radius (from Adversary).
4. **D5 (phases)** — keep Main.
5. **D6 (resolver callback)** — keep Main; close Open Question 1 by
   adopting the Adversary's no-CLI-flag decision with its rationale.
6. **D7 (global ownership)** — keep Main verbatim.
7. **Migration Plan step 2** — extend to name the `facet edit`
   scanner/manifest-writer explicitly: it MUST preserve (not collapse)
   expanded entries, with test coverage (from Adversary).
8. **Add one sentence** noting `remove` passes the gate trivially.

## Blocking items before archive

1. **Lockfile write policy must be settled explicitly** (divergence 2):
   unconditional `0.3` migration vs. version-preserving write changes the
   lockfile spec deltas, the frozen-migration rules, and the rollback
   documentation. The specs artifact cannot be authored coherently until
   the design records the decision *and* its rejected alternative.
2. **`facets.json` writer inventory** (divergence — edit flow): every code
   path that rewrites `facets.json` must be enumerated in the design (or
   tasks) with the preservation requirement, or user intent can be silently
   destroyed — a data-loss class defect, not a polish item.
