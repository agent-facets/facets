# Comparison Review: `specs` — support-non-asset-files

**Main**: `openspec/changes/support-non-asset-files/specs/**/*.md` (7 capability delta specs)
**Adversary**: `openspec/changes/support-non-asset-files/adversarial/artifacts/specs/**/*.md` (7 capability delta specs)

Both versions were derived from the same reconciled proposal and design. Both landed on the **identical capability set**: `protocol`, `protocol__schemas`, `protocol__content-hashing`, `protocol__integrity`, `authoring__facets`, `installation`, `adapter__assets`. No capability-selection divergence — the interesting divergences are in delta mechanics, requirement placement, and coverage depth.

## Grading bar

- **Value-centric** (spec-governance): observable behavior, no internal module/class names, no domain-name subjects.
- **RFC 2119**: normative keywords throughout.
- **Atomic + testable**: one concern per requirement; scenarios concrete enough to be test cases.
- **Delta mechanics**: MODIFIED headers match existing requirement headers exactly; MODIFIED blocks carry full replacement content (nothing silently lost at archive time); ADDED used where behavior is new.
- **Coverage**: every proposal/design commitment (D1–D12) represented in the right capability.

Both versions pass value-centric, RFC 2119, and scenario-format checks. Both use matching MODIFIED headers throughout. The material differences are below.

## The one systemic difference: rewrite vs. copy-and-edit

**Main condensed-rewrites its MODIFIED requirements**; **Adversary copy-and-edits the original text verbatim**. Main's rewrites are tighter and more readable, but MODIFIED blocks *replace* the original at archive time, so every dropped clause is a silent spec regression. I found concrete drops in Main (details per capability below):

1. **Receipt requirement** (installation): Main's rewrite drops (a) the original's frozen-mode ordering clause — "in frozen-lockfile mode, this cleanup applies only after the frozen consistency check passes; an orphaned entry the check rejects fails before any cleanup" — and (b) the per-project isolation/concurrency clause ("two distinct projects never share a receipt and concurrent operations in different projects never contend on one").
2. **Edit detects new files** (authoring): Main drops "all items SHALL be resolved before proceeding to editing" (the all-at-once reconciliation-gate behavior).

These are the only clause-level losses I could find, but the reconciler should diff each Main MODIFIED block against the live spec before syncing — that is the systematic hazard of the rewrite style. Adversary's copy-and-edit style has no such losses but produces bulkier deltas and, in two places, left a stale original requirement *unmodified* when it actually conflicts with the change (see authoring and content-hashing below) — the mirror-image failure, and the worse one.

## Per-capability comparison

### protocol — Main stronger

Both modify the semver-discipline requirement with the pre-1.0 minor / post-1.0 major rule. Main additionally: constrains **patch** releases ("patch releases SHALL NOT remove, tighten, or incompatibly change requirements from their minor release") and adds a "removing legacy artifact support is breaking" scenario that directly anchors the future `0.1` deprecation. Adversary's version keeps the original scenario headers but adds nothing Main lacks.
**Merge**: take Main as-is.

### protocol__schemas — Main slightly stronger; take two Adversary details

Same three requirements modified by both (facet manifest, build manifest, lockfile). Substantively convergent on: single-segment Agent Skills asset-name grammar with ASCII interpretation, shared skill/command namespace, agents separate, two exact-path declaration sites with disjoint regions, `0.2` build manifest with all-entry `files` map and no `assets`, exact-equality version dispatch with no cross-version fallback, structured unsupported-version failures, lockfile `0.2` per-asset `files` records with archive-only exclusion.

Divergences:
- Main pushes the **full D7 path/collision grammar into manifest validation** (unsafe paths, Unicode/case-fold aliases, prefix conflicts rejected by any manifest consumer). Adversary keeps schema constraints lighter (site rules + exact paths) and carries the grammar in authoring build validation + verification. Main's placement is stronger: the embedded manifest is the trust root, so *every* consumer validating it should reject unsafe declarations — this matches D3's "the plan operation validates both declaration sites."
- Main states archive-format and lockfile-format version constants are **interpreted independently even when numerically equal** (D10); Adversary omitted this. Take Main.
- Adversary's lockfile modification includes an "asset entry missing its `files` array is rejected" scenario at the schema level (Main has it only in installation) — harmless duplication; optional.
- Adversary's manifest text requires naming documentation to link the Agent Skills convention (D9's doc mandate); Main links the convention inline in the requirement itself, which is arguably sufficient. Optional.

**Merge**: Main as base. Nothing blocking from Adversary; optionally add the schema-level missing-`files` rejection scenario.

### protocol__content-hashing — Main stronger; one placement note

Main modified all six existing requirements; Adversary modified three and ADDED a verbatim-bytes requirement. Main caught a requirement Adversary **missed**: "Build output contains the self-contained archive" still mandates "remove previous `dist/` contents before writing" with no validation-ordering qualifier — Main's modification ("previous output removed only after all source input validation succeeds", plus the invalid-rebuild-preserves-output scenario) is necessary; Adversary only fixed this ordering in `authoring__facets`, leaving the protocol-side requirement in conflict. Main also updated the display requirement (emitted `facetVersion` + full entry listing) where that requirement actually lives.

Adversary's ADDED "Supplementary file content is archived verbatim" lives on the protocol side; Main's equivalent ("Build ships supplementary files as opaque bytes") lives in `authoring__facets`. Coverage is equivalent; Main's modified "Content hashes…" requirement already states supplementary hashes use exact bytes with no transformation, so the interop property is on the protocol surface either way.
**Merge**: take Main as-is.

### protocol__integrity — near parity; take two Adversary security scenarios

Both rewrote the archive-verification operation to full depth: exact-once version dispatch, no fallback, raw-entry validation before lossy collapse, manifest-derived membership, exact set equality, per-entry hash verification, tagged success result (primary / companion-with-owner / archive-only), structured failures, decompressor contract preserved. Main adds a sharp "empty primary rejected / empty supplementary allowed" scenario and folds unsupported-version shape into the structured-failures requirement. Good.

Adversary has two scenarios Main lacks, both genuinely adversarial:
1. **A build-manifest-only entry does not expand the expected set** — a crafted archive whose build manifest records an extra path *and* whose inner tar contains that file must still be rejected; the hash map must never legitimize membership. Main's prose implies this (triple set equality), but the explicit attack scenario is the test a security reviewer wants.
2. **Alias-duplicate tar entries** — two inner paths that collide only by Unicode normalization or case folding, rejected at raw-entry validation. Main rejects duplicates "with the same path" and handles aliases at manifest validation, but aliased *tar* paths are a distinct smuggling vector on case-insensitive filesystems.

Adversary's ADDED "Legacy archives remain verifiable during the compatibility window" is mostly redundant with Main's in-requirement legacy handling; its "legacy verifier fails closed on current archives" scenario documents ecosystem posture but isn't testable against the current system — skip it.
**Merge**: Main as base; add the two scenarios above to Main's verification requirement (or as an ADDED membership requirement).

### authoring__facets — Main clearly stronger; restore one clause, keep Adversary's fidelity check

Main's coverage is broader: it modified **"Content files contain no front matter"** (supplementary files exempted — without this, any supplementary file containing front-matter-like bytes *violates the live spec*; Adversary missed this entirely, its worst gap), modified **"Edit parses front matter"** (supplementary/README bytes never parsed or stripped), modified **"Edit is transactional"** to enumerate README/companion deltas, and its ADDED declaration requirement explicitly **rejects glob patterns** (D2) where Adversary deliberately under-specified ("docs/**" would just be a missing file — Main's clear rejection is the better author experience). Main also permits inner paths named `build-manifest.json`/`archive.tar.gz` (D7 allowance Adversary dropped) and specs missing-`LICENSE` scaffold-or-remove.

Adversary's advantages are mechanical, not substantive: its scaffold-wizard and build MODIFIED blocks are verbatim-copy-and-edit, so no original clause is lost; Main's condensed rewrites drop "all items SHALL be resolved before proceeding to editing" from edit reconciliation and compress several scenario texts. Adversary's per-skill-declaration-on-undeclared-skill check is structurally vacuous under D1's shape (companion lists live *inside* skill descriptors) — ignore it.
**Merge**: Main as base. Restore the "all items resolved before proceeding" clause to Main's edit-reconciliation requirement; spot-diff Main's other condensed rewrites against the live spec for further quiet drops.

### installation — Main stronger; take Adversary's upgrade-guidance specificity, restore two receipt clauses

Main integrates per-file verification into the existing "Integrity is verified before any asset is written" requirement (cleaner than Adversary's parallel ADDED requirement, which leaves the original untouched and overlapping), modifies "Removing a facet uninstalls it" (Adversary left it stale at asset granularity), adds the per-locked-file drift requirement with canonical-read comparison and "reinstall repairs one drifted file", and its lockfile-version modification carries two D10 details Adversary dropped: **frozen mode requires a `0.2` lockfile for a `0.2` archive**, and the **stable-v1 numeric-`1` reclamation path** (delete-and-regenerate guidance, no shape sniffing).

Adversary wins on one point: its unsupported-version requirement specs the concrete guidance behavior — for a **known** newer format, name the minimum release that supports it; for an **unknown** format, advise updating to latest without inventing a minimum (D4). Main's "SHALL direct the user to upgrade when a newer consumer may support the format" is materially vaguer.

Main's receipt rewrite drops two normative clauses from the original (frozen-cleanup ordering; per-project receipt isolation/concurrency) — see the systemic section.
**Merge**: Main as base; replace Main's unsupported-version guidance sentence with Adversary's known/unknown split; restore the two dropped receipt clauses.

### adapter__assets — Main slightly stronger

Convergent on the tagged payload contract (skill = primary + companion byte map, empty map valid; agent/command = single content, structurally companion-free; no supplementary variant), atomic bundle replacement with removal of dropped companions, verbatim companion bytes, canonical logical read content, containment rejection, unowned-file preservation. Main additionally: folds "archive-only files are withheld from adapters" into the modified "Asset methods are the only interface" requirement (better home than Adversary's standalone ADDED requirement), specs **directory pruning limited to directories emptied by owned-file removal**, and adds a **failed-deletion-restores-prior-bundle** scenario (delete-side atomicity; Adversary only specced install-side rollback).
**Merge**: take Main as-is.

## Blocking items before archive

1. **Restore dropped clauses in Main's condensed MODIFIED blocks** — confirmed drops: receipt frozen-cleanup ordering, receipt per-project isolation/concurrency (installation), "all items resolved before proceeding to editing" (authoring). The reconciler should also diff every other Main MODIFIED block against the live spec; the rewrite style makes silent loss easy.
2. **Add the two Adversary security scenarios to `protocol__integrity`**: build-manifest-only entries cannot legitimize membership; alias-duplicate (Unicode/case-fold) tar entries rejected at raw-entry validation.
3. **Adopt Adversary's known/unknown upgrade-guidance split** in installation's unsupported-version requirement.

## Overall merge recommendation

**Keep Main as the base across all seven capabilities.** Main caught two conflicts Adversary missed outright (front-matter prohibition vs. supplementary bytes in `authoring__facets`; `dist/` cleanup ordering in `protocol__content-hashing`), integrates changes into the requirements where they live rather than adding parallel overlapping ones, and carries several design details Adversary dropped (patch-release constraint, version-constant independence, frozen `0.2`-lockfile gate, stable-v1 reclamation, glob rejection, outer-filename allowance, delete-side rollback). Fold in the three blocking items above — they are small, targeted edits, all strengthening Main's weakest spots: silent clause loss from condensed rewrites and two missing adversarial test scenarios at the trust boundary.
