# Design comparison: Main vs. Adversary

This review compares **Main** at `design.md` with **Adversary** at `adversarial/artifacts/design.md`.

## Grading bar

The designs were graded for value delivered against the reconciled proposal, RFC 2119 precision, atomic and testable requirements, correct OpenSpec/design mechanics, explicit compatibility and rollout boundaries, security completeness at archive/path trust boundaries, and coverage sufficient to derive specs and tasks without inventing policy later.

## Coverage summary

Both versions correctly preserve explicit archive membership, reject globs, keep supplementary files distinct from independently installable assets, treat supplementary content as opaque bytes, materialize companions only for skills, leave the lockfile asset model unchanged, conditionally preserve legacy `0.1` output for asset-only facets, and require the registry to understand the new archive format before accepting it.

Main is stronger on author-facing declaration ergonomics, choosing the format revision `0.2` consistently with the current `0.1` convention, concrete scaffold/edit surfaces, and explicitly keeping archive-only files out of adapter inputs. Adversary is substantially stronger at the security and lifecycle boundaries: one normalized archive plan, exhaustive collision and tar-entry validation, strict version dispatch, tagged adapter and receipt contracts, explicit atomic replacement/rollback semantics, consumer-first rollout, old-builder behavior, and protocol-package semantic versioning.

The central difference is that Main often expresses invariants through optional parallel fields and prose (“only ever populated for `type === 'skill'`”), while Adversary encodes variants as tagged data and requires shared derivation. That difference is material because adapter operations, receipt deletion, and archive membership are security and data-loss boundaries.

## Decision-by-decision divergences and merge recommendations

### D1–D2: Declaration shape and exact enumeration

**Main is stronger on ownership ergonomics.** `SkillDescriptor.files` makes companion ownership visible where the skill is declared, while a disjoint top-level `files` list cleanly expresses archive-only metadata. Adversary's single root-relative list is simpler and makes archive membership literal in one place, but skill ownership must then be inferred from path containment.

Main overstates that invalid ownership is “structurally impossible”: both lists still contain unrestricted strings, and disjointness, path safety, declared-skill membership, and collision freedom remain runtime schema constraints. Its two declaration sites also require a single downstream normalization step or they will encourage duplicated build/verifier logic.

**Merge recommendation:** keep Main's two authoring sites, but require one pure protocol operation to validate both and normalize them into the tagged archive plan described by Adversary (`manifest`, `primary-asset`, `skill-companion`, `archive-only`). Build, hashing, verification, parsed results, and installation MUST consume that plan. Preserve exact enumeration/no globs and Main's embedded-manifest rationale.

### D3: Build-manifest shape and version boundaries

**Main is stronger on the archive revision identifier:** `0.2` follows the documented numeric progression from `0.1`; Adversary's `1` is an unnecessary naming jump. Both correctly retain byte-identical `0.1` output when no supplementary files are present.

**Adversary is stronger on hash-map authority.** Main's parallel `assets` and `files` maps duplicate classification already derivable from the embedded manifest and permit overlap/disagreement states that must be detected later. The reconciled proposal requires an unambiguous distinction, but it does not require that distinction to be duplicated in the build manifest. One all-entry path-to-hash table plus the embedded manifest and normalized archive plan is unambiguous and has one completeness rule.

Main also calls the protocol work “additive” in Migration Plan step 1 and names only the adapter SDK major release. That conflicts with the reconciled proposal's explicit protocol/archive breaking boundary and `openspec/specs/protocol/spec.md`, which requires backward-incompatible protocol requirements to ship in a new major version.

**Merge recommendation:** use conditional `facetVersion: 0.2`, retain the exact `0.1` schema for legacy output, and use a single `files` hash map containing every inner entry in `0.2`; derive classification only from embedded `facet.json`. Require strict one-time dispatch by version with no malformed-`0.2` fallback to `0.1`. State separately that the published protocol package ships this in a new major release, as does the adapter SDK.

### D4 and D6: Shared derivation, path safety, and archive verification

**Adversary is decisively stronger and exposes a blocking gap in Main.** Main covers traversal, absolute paths, backslashes, primary-path collisions, duplicates, missing declarations, and exact observed membership. It does not settle several ways those checks can be bypassed or become platform-dependent: empty/`.` segments, NUL and drive-prefixed paths, canonical Unicode/case aliases, resolved source identity, file/directory prefix collisions, symlinks/hard links, non-regular tar entries, duplicate tar headers, and parsers that first collapse entries into a lossy path map.

Adversary also catches two operational details Main omits: source inputs must be validated before any `dist/` cleanup can destroy a declared input, and every expected parser/build failure must remain a structured result rather than an exception.

**Merge recommendation:** add Adversary's shared archive-plan decision and exhaustive path/tar checks to Main. Specify that verification validates raw headers before constructing a map, rejects duplicate and non-regular entries, compares expected and observed canonical path sets exactly, and verifies exactly one hash per expected path. Specify regular-file containment and source-identity checks at build time, including symlink/hard-link policy and portable alias/prefix collisions. Add a test matrix for every named failure class. This is blocking before specs/tasks because it defines the supply-chain boundary.

### D5: Opaque bytes and parsed representation

**Main is stronger on a concrete implementation touchpoint** by widening `ArchiveEntry.content` and explicitly preserving binary/empty content. Adversary agrees on exact bytes but goes further by requiring the successful parsed result to keep primary assets, skill companions grouped by owner, and archive-only supplementary files as distinct tagged data.

`string | Uint8Array` alone does not encode which content is prompt text and which is opaque, so downstream code can still apply the wrong transformation.

**Merge recommendation:** keep Main's opaque-byte requirements, but make the normalized and parsed public results tagged by entry kind as Adversary requires. Text decoding/front-matter logic applies only after narrowing to a primary asset; supplementary data remains bytes.

### D7: Adapter contract and atomic skill lifecycle

**Adversary is decisively stronger and exposes a blocking type/atomicity defect in Main.** Main proposes optional `companions`/`companionPaths` parameters beside `assetType` and relies on the prose invariant that they are populated only for skills. That represents illegal combinations (agent with companions, skill call accidentally omitting its bundle) and gives implementations no exhaustive branch. The widened methods also do not, by themselves, guarantee that custom adapters stage a complete replacement or roll back partial writes/deletes.

Adversary uses tagged variants keyed by asset type, makes a skill bundle one operation, requires removal of formerly owned but now absent companions, and explicitly requires stage/commit/rollback plus structured expected failures.

**Merge recommendation:** replace Main's optional-parameter trio with tagged request/result unions. A skill variant MUST carry primary text and a canonical companion-byte map (empty is legal); agent/command variants MUST NOT carry companions. Define one atomic replacement/delete contract for the entire skill bundle, including rollback and stale-owned-file removal, and return structured failure values. Centralize containment, staging, commit/rollback, owned-path deletion, and empty-directory pruning in SDK helpers, while requiring equivalent behavior from custom-I/O adapters. Add injected-failure tests at every write/delete/commit boundary.

### D8: Receipt ownership and drift removal

**Adversary is stronger.** Main again uses an optional companion list whose legal presence depends on `type`, and its migration explanation is internally inconsistent: a truly legacy receipt cannot refer to companions because legacy archives could not install them, so there is no justified “one-install-cycle” unknown companion orphan. Conversely, once a supporting version installs companions, forgetting their ownership is unacceptable because offline removal can no longer be exact.

Adversary requires a tagged receipt record and a complete owned set for skills, keeps archive-only files out of receipts, validates receipt paths as untrusted input, and couples receipt rollback to adapter rollback.

**Merge recommendation:** parse persisted legacy records at the receipt boundary and refine them into an internal tagged union: agent/command records have no companion field; skill records require a complete canonical owned-path set (with legacy skill tuples migrated to the known primary plus an empty companion set). Persist the refined shape after a successful install. Store canonical paths relative to the adapter-owned skill root, validate containment and project identity before deletion, never delete unowned paths, and journal receipt plus materialization as one rollback unit. Remove the unsupported orphan-cycle claim.

### D9–D10: Authoring and materialization boundary

**Main is stronger on authoring coverage** by addressing `facet edit`, and its D10 data-flow boundary is excellent: archive-only files cannot be materialized accidentally because adapters never receive them. Adversary should have named both explicitly.

However, Main's recommendation that `facet create` scaffold and declare a README by default makes every newly scaffolded facet opt into `0.2`, old-client rejection, and the old-builder-ignore hazard. That conflicts with consumer-first rollout and weakens the practical value of conditional legacy output.

**Merge recommendation:** retain D10 and edit-flow discovery/add/remove support, but do not make supplementary README declaration an unconditional scaffold default. Make it an explicit author choice or gate the default until the producer minimum version and registry/consumer rollout are in place. If removal of vanished declarations is in scope, decide it now with deterministic behavior; do not leave it as “if cheap” task policy.

### Rollout, documentation, risks, and open questions

**Adversary is stronger on rollout.** It explicitly sequences verifier consumers and cafe before producers, requires immutable cross-version fixtures, warns that tolerant old builders may accept `files` but silently omit the bytes, and states that verifier support cannot be rolled back after `0.2` artifacts are published. Main only partially captures registry sequencing and does not address old builders ignoring the new manifest fields.

**Main is stronger on documentation breadth** by adding install documentation and concrete authoring guidance. Its open question about registry README presentation is already a declared non-goal, and archive policy limits can be explicitly deferred to consumer configuration rather than left unresolved. The `facet edit` removal behavior needs a decision if it is to generate tasks.

**Merge recommendation:** adopt Adversary's consumer-first rollout and rollback constraints, including minimum-producer documentation and cross-version accept/reject fixtures; retain Main's added install documentation. Close the README-presentation question as out of scope, state that size/count policy remains consumer configuration for this change, and settle edit removal behavior before task generation.

## Blocking cross-cutting items

1. **Security boundary:** define the shared normalized archive plan and exhaustive raw-tar/path/collision/regular-file checks before specs or implementation tasks are considered complete.
2. **Atomic lifecycle:** replace optional adapter/receipt companion fields with tagged variants and specify observable all-or-nothing install/update/delete plus rollback and offline removal behavior.
3. **Compatibility boundary:** state both archive revision (`0.2` conditionally) and package major-version requirements; require strict version dispatch, consumer-first cafe rollout, old-builder warnings, and immutable compatibility fixtures.
4. **Single source of truth:** avoid parallel build-manifest classification maps; membership/classification comes from embedded `facet.json` through the shared archive plan, while the build manifest carries hashes.

## Overall merge recommendation

Use Main as the structural base because its two declaration sites, `0.2` naming, authoring flow, and materialization boundary are concrete and useful. Replace its parallel hash-map, optional adapter parameters, optional receipt ownership, partial path grammar, and under-specified rollout with Adversary's single normalized plan, one all-entry hash map, tagged unions, atomic rollback contract, exhaustive security checks, and consumer-first compatibility plan. The four blocking items above should be resolved in the design before delta specs or tasks lock in weaker contracts.
