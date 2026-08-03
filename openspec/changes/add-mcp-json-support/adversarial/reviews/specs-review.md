# Comparison Review: `specs` — add-mcp-json-support

**Main**: `openspec/changes/add-mcp-json-support/specs/**/*.md` (9 capability delta specs)
**Adversary**: `openspec/changes/add-mcp-json-support/adversarial/artifacts/specs/**/*.md` (same 9 capabilities, authored blind from the reconciled proposal, design, and permanent specs)

## Grading bar

- **Value-centric** (spec-governance litmus: would a user/developer care if it stopped working?)
- **RFC 2119** keyword discipline
- **Atomic, testable requirements and scenarios** (4-hashtag scenarios, WHEN/THEN)
- **Correct delta mechanics** — especially the MODIFIED rule: *copy the ENTIRE requirement block and edit; partial content loses detail at archive time*
- **Coverage** of the reconciled proposal/design (D1–D11) and consistency with the permanent specs at archive time

## Coverage comparison

Both versions independently converged on the same capability split (identical 9 directories) and on the substance of nearly every behavior: closed stdio/http tagged union, single-segment server names, unknown-member rejection as an explicit tolerance exception, legacy `0.1` rejecting `servers`, server-only facets, project manifest `0.2` with a `servers` disposition group, machine-local consent keyed by effective identity + semantic fingerprint, untracked-entry takeover disclosure, read-only prepare / atomic apply / byte-exact restore, `{0.1, 0.2}` exact-token support set, `mcpServers: false | capability`, `--accept-mcp` on add/install/remove, warn-and-skip removal, and separate asset/configuration outcome counting. That convergence is strong evidence the reconciled proposal and design are tight.

**Main is broader.** It covers five things the adversary missed or under-specified:

1. **Non-execution/delegated auth as a requirement.** Main specs "MCP materialization does not run or authenticate servers" (adapter__mcp-servers) plus build-time non-execution (authoring__facets) and an installation scenario. The adversary never turned this proposal non-goal into a testable requirement. Main wins outright.
2. **Protocol-level canonical fingerprint.** Main's `protocol__schemas` requirement (env-order-insensitive, arg-order-sensitive, names excluded, empty≡omitted) is exactly the right home for an interop-critical determinism rule. The adversary only gestured at "canonical semantic form" inside the receipt text. Main wins.
3. **Consistency edits to *existing* requirements the change silently invalidates.** Main modified `authoring__facets` "Unrecognized fields are tolerated" (carving out the closed-declaration exception), installation "Namespace collisions…" (whose permanent text says "MCP server behavior SHALL remain unchanged" — now false), and installation "Project-manifest format migration is transactional" (permanent text writes `0.1`; must write `0.2`). The adversary modified none of these three; its version would archive contradictions. Main wins, decisively.
4. **Interactive server collision resolution.** Main extends the Keep/Alias/Omit workspace, live validation, and cancellation requirements (cli MODIFIED ×3) to server claimants. The adversary chose a fail-only model (conflict → structured failure → durable manifest edit). Design D4's "a resolver response SHALL remain a complete disposition set and SHALL be re-planned" and the proposal's "reuse the effective-name collision semantics of asset materialization" support main's reading. Main wins.
5. **Frozen-mode MCP behavior as a dedicated requirement** with the receipt-only server-orphan cleanup scenario. The adversary scattered frozen behavior across scenarios and missed orphan cleanup. Main wins.

**Adversary is stronger on delta mechanics and a handful of specifics** — see divergences 1–3 below, one of which is blocking.

## Material divergences

### 1. BLOCKING — Main's receipt MODIFIED is a condensed paraphrase that loses permanent-spec content at archive

Installation "A machine-local record tracks what each project has materialized": main rewrote the permanent requirement's ~5 paragraphs into 5 short ones. At archive time the MODIFIED block **replaces** the permanent text wholesale, silently deleting normative sentences, among them:

- "The receipt SHALL survive lockfile changes made outside the system" and the no-cross-project-contention sentence;
- the corrupt/path-mismatched-receipt-is-reported vs. absent-receipt-is-not distinction (main keeps only scenarios);
- the tracked/untracked definitions and "reconciliation is defined by the state it leaves behind";
- the deletion-limited-to-restorable-state rationale and the skill-companion pass-through sentence;
- frozen "cleanup only after the frozen consistency check passes";
- the untrusted-receipt validation sentence (partially kept);
- in scenarios: the `1` → primary-only vs `0.2`/`0.3` → complete-owned-set refinement distinction (main's "retain the version's valid asset ownership" is strictly weaker).

The adversary's version copies the permanent text verbatim and splices in the `0.4`/configuration-claim additions plus new scenarios — exactly what the MODIFIED workflow demands. **Adversary wins.** The same defect, smaller, affects main's MODIFIED "Facet operations require compatible selected adapters before mutation": the permanent paragraph on removal's cache/network independence ("Facet removal of tracked materialization SHALL remain independent of cached facet content…") and its post-repair scenario clauses are dropped.

**Reconcile:** rebuild both MODIFIED blocks from the full permanent text (the adversary's receipt block is a usable base), then merge main's genuinely new content: configuration claims carrying the witnessed facet integrity, the "claim proves approval without revealing declaration" scenario, and the MCP-support preflight paragraph + scenarios for the compat requirement.

### 2. Adversary scenarios main should absorb

- **"Approval does not travel to another machine"** (installation consent): the teammate-must-consent scenario is the single most user-visible consequence of machine-local approval; main states the property but never tests it.
- **"User-level configuration is never touched"** (adapter__mcp-servers): main's text says "project-scoped" but has no scenario enforcing the user/system-scope non-goal.
- **"No second MCP override flag SHALL be introduced"** (cli, from design D5): main's `--accept-mcp` requirement doesn't pin this down.
- Optional: an explicit "0.1 project-manifest document declaring a `servers` group is rejected" scenario (main's `serverz` scenario covers undeclared groups generally; the version-scoped group is a distinct, likelier mistake).

### 3. Duplication inside main (cleanup, not blocking)

- **JIT asset takeover appears twice**: installation "Asset takeover confirmation is independent and just in time" and adapter__assets "Untracked occupied asset destinations require just-in-time confirmation" are near-duplicates. The proposal maps this to `adapter__assets`; keep one authoritative home (adapter__assets) and cut or minimize the other before two copies drift.
- **Lockfile-unchanged is stated twice**: protocol__schemas "MCP declarations and dispositions remain outside the lockfile" and installation "Server declarations remain integrity-pinned without lockfile duplication". Defensible as protocol-view vs. behavior-view, but tighten wording so the two can't diverge.
- **`{0.1, 0.2}` set is restated in adapter__sdk's compat MODIFIED, adapter__management (three MODIFIEDs), and installation.** The adversary kept the SDK spec set-agnostic ("membership in an explicit exact-token support set") and stated the concrete set once in management — cleaner single-source-of-truth. At minimum, verify the four statements agree verbatim.

### 4. Where main is simply stronger (adopt as-is)

- Cross-arm rejection scenario (stdio declaration with `url`, http with `command`) — sharper than the adversary's generic unknown-member case.
- Concrete env-name grammar (letter/underscore start) vs. the adversary's undefined "portable ASCII grammar".
- Closed-object rule as its own requirement with the "top-level extension remains tolerated" contrast scenario.
- "Preparation does not write a new document" (prospective-document) scenario.
- Build-time declaration validation with previous-output preservation (authoring__facets ADDED).
- The management/npm rewrite replacing conditional 0.0/0.1 scenarios with "highest package version wins across supported tokens".

## Merge recommendation (actions on main, per capability)

- **protocol__schemas** — Keep main. Optionally add the 0.1-with-`servers`-group rejection scenario.
- **authoring__facets** — Keep main unchanged.
- **authoring__servers** — Keep main unchanged (the two versions are functionally identical).
- **adapter__mcp-servers** — Keep main; add the "user-level configuration is never touched" scenario.
- **installation** — **Blocking rework**: restore full permanent text in the receipt MODIFIED and the adapter-compat MODIFIED, merging main's additions (see divergence 1). Add the teammate consent scenario. Resolve the asset-takeover duplication with adapter__assets.
- **adapter__sdk** — Keep main; consider dropping the concrete `{0.1, 0.2}` set from the compat requirement in favor of management owning it (or verify verbatim agreement).
- **adapter__management** — Keep main unchanged.
- **cli** — Keep main; add the "no second MCP override flag" sentence to the `--accept-mcp` requirement.

## Blocking items before archive

1. **Installation MODIFIED partial-content loss** (receipt requirement; adapter-compat requirement). Archiving main as-is deletes normative permanent-spec content, including the `1` vs `0.2`/`0.3` receipt refinement distinction and removal's cache/network-independence guarantees. Must be rebuilt from full permanent text.
2. **Duplication audit** (asset takeover ×2, lockfile-unchanged ×2, supported-set ×4): not strictly blocking, but each duplicate pair should be checked for verbatim agreement now — divergence after archive becomes a two-sources-of-truth bug in the permanent specs.
