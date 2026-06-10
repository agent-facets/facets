> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## 1. Registry fingerprint & cache integrity chain — Research

- [ ] 1.1 Explore: registry client mapping — `engine/src/registry/resolve-metadata.ts`, `wire.ts`, `types.ts`, `fixtures.ts`: how `content_hash`/`content_integrity` flow today, where `RegistryMetadata` is consumed, and what extending it touches
- [ ] 1.2 Explore: cache machinery — `engine/src/cache/operations.ts` + `integrity.ts`: `cacheGet`/`cachePutVerified`/`readCacheIntegrity` contracts, sidecar shape (top-level + per-asset hashes), and how a slot can be safely evicted
- [ ] 1.3 Explore: protocol integrity + hashing — `protocol/src/integrity/verify.ts` + `types.ts` (`verifyRegistryIntegrity`, Check A semantics, currently unwired) and `computeContentHash`/tar layout: exactly what a materialization-time recompute needs as inputs
- [ ] 1.4 Propose: the integrity-chain API — audited cache read (recompute per-asset + canonical hashes vs. sidecar, evict-on-fail → soft miss), lockfile string compare on hit (hard fail on mismatch), integrity confirmation via `content_integrity` (fail closed when offline or when the field is absent — never fall back to `content_hash`), domain-explicit `RegistryMetadata` field names, and error copy for the lockfile-mismatch hard failure (design D3a/D4, open question 3)

## 2. Registry fingerprint & cache integrity chain — Implementation

- [ ] 2.1 Implement: extend `RegistryMetadata` and the `resolve-metadata.ts` wire mapping to carry the canonical fingerprint (`content_integrity`) alongside the transport hash, with domain-explicit names; update `wire.ts`, `fixtures.ts`, and affected unit tests
- [ ] 2.2 Implement: audited cache read — recompute hashes against the sidecar at materialization time, evict the slot on mismatch and report a soft miss; rewrite the `cacheGet` "trusted, NOT re-hashed" doc contract to match (design D4, Article III)
- [ ] 2.3 Implement: the shared per-version materialization chain as a reusable engine unit — hit path: self-audit → lockfile compare (when pinned) → integrity confirmation (when creating an entry); miss path: download → locked compare or registry three-check → verified-put — wiring `verifyRegistryIntegrity` with `expectedIntegrity` = `content_integrity`; update protocol's Check A doc comments (design D3a wiring note)
- [ ] 2.4 Implement: unit tests — tampered cache bytes are evicted and re-fetched (never installed, never seed a lockfile entry); hit with locked mismatch hard-fails; hit without a lock entry confirms against the registry (offline → fail closed; missing `content_integrity` → fail closed)
- [ ] 2.5 Verify: `bun check` passes for `packages/protocol` and `packages/engine`

## 3. Machine-local receipt — Research

- [ ] 3.1 Explore: `FACET_DIR` / cache-root resolution and env-override machinery in engine — where a `receipts/` sibling root slots in, and how tests override it
- [ ] 3.2 Explore: lockfile asset tuples (`protocol/src/schemas/lockfile.ts`) and the materialize/removal asset-path shapes — what the receipt must store for offline deletion, and what defines "inside the project's adapter trees" for containment checks
- [ ] 3.3 Propose: the receipt module API — file keying (`<basename>-<12-hex sha256(realpath)>.json`), embedded canonical path with fail-closed mismatch handling, schema with a `"version": 1` field (design open questions 1–2), bootstrap-from-lockfile, and the realpath-resolve + adapter-tree containment rule for deletions

## 4. Machine-local receipt — Implementation

- [ ] 4.1 Implement: the receipt module under `engine/src/install/` — read/validate/write/bootstrap, per-project files under `$FACET_DIR/receipts/`, result-typed failures (no thrown errors)
- [ ] 4.2 Implement: containment-checked deletion helper — realpath-resolve each recorded asset path, delete only inside the project's adapter trees, report and skip escapes (fail closed)
- [ ] 4.3 Implement: unit tests — embedded-path mismatch is ignored and rebuilt (never acted on); `..`/absolute/symlink-escape paths are reported, not deleted; bootstrap seeds from lockfile asset tuples; move/rename orphans the old receipt and re-bootstraps
- [ ] 4.4 Verify: `bun check` passes for `packages/engine`

## 5. Plan/commit split & frozen gates — Research

- [ ] 5.1 Explore: `engine/src/install/run-install.ts` + `plan-facet.ts` today — how the manifest is read back, where `effectiveLocked` gates the cache, journal usage, and the lockfile write path
- [ ] 5.2 Explore: `run-add.ts` / `run-remove.ts` — the write-ahead manifest write, snapshot/restore, and post-install pin rewrite to be deleted
- [ ] 5.3 Explore: the frozen-lockfile path today (`detect-lockfile-drift.ts`, flag plumbing, failure surfaces) vs. the new bidirectional gates (coverage, orphaned entries, git/local provenance)
- [ ] 5.4 Propose: the delta type (additions carry the verbatim specifier; removals carry names; same-name-in-both unrepresentable per design D1) and the commit orchestration — structural discriminator, version-resolution gating, manifest-write policy (bare pins, explicit verbatim), receipt-driven drift removal, tri-write ordering, and the frozen gate sequence (reject delta → bidirectional consistency → verify-before-materialize → converge, never writing lockfile/manifest)

## 6. Plan/commit split & frozen gates — Implementation

- [ ] 6.1 Implement: delta types + pure plan routing — additions verbatim, removals by name, `install` produces an empty delta; no network/lockfile/cache reads in plan (diagrams/planning.md invariants)
- [ ] 6.2 Implement: commit accepts the delta — in-memory merge; additions resolved fresh (non-exact specifiers always version-resolve; manifest-write policy applied); manifest-not-in-additions reconciliation (satisfying lock = no version resolution; absent/stale = re-resolve); all materialization through block 2's chain
- [ ] 6.3 Implement: receipt-driven drift removal in commit — desired set (manifest + additions − removals) vs. receipt, offline deletion via block 4's containment helper, lockfile + receipt entry drops
- [ ] 6.4 Implement: the transactional tri-write (manifest, lockfile, receipt) under the existing journal; delete the write-ahead snapshot/restore and pin rewrite from `run-add.ts`/`run-remove.ts` and pass deltas instead
- [ ] 6.5 Implement: frozen gates — reject any non-empty delta; bidirectional consistency checks; locked-integrity verification before materialization (cache hits included); drift removal + receipt rewrite allowed; lockfile and manifest never written
- [ ] 6.6 Implement: unit tests for the discriminator — `add foo@0.*` re-resolves although the lockfile satisfies; plain `install` reproduces the satisfying locked version; absent/stale entries re-resolve; frozen scenarios from the spec delta (drift, orphaned entry, source change, frozen orphan-on-pull cleanup)
- [ ] 6.7 Verify: `bun check` passes for `packages/engine` and `packages/cli`

## 7. End-to-end tests & documentation — Research

- [ ] 7.1 Explore: the CLI e2e harness (`packages/cli/src/__tests__`, `*.e2e.test.ts` conventions, registry stubbing patterns) — how to assert "no network call" and simulate offline
- [ ] 7.2 Explore: the docs touchpoints from design's Article III list — current wording of `docs/cli/add.md` steps 6–8 and "Re-adding a facet", `docs/cli/remove.md` step 5, `docs/cli/install.md` frozen section, `docs/alpha/onboarding.md` integrity paragraph, `docs/docs/contributing/architecture.md` components, `docs/cli/env.md` directory table; plus `docs/docs.json` navigation structure and how Mintlify renders `mermaid` fences in this site
- [ ] 7.3 Explore: `docs/specification/install.md` and `integrity.md` against actual post-change behavior — the specification section is known to be very out of date, so audit these two pages fully (not just the lines this change invalidates) and note drift found in the *other* specification pages as input to a separate follow-up docs change (design's Article III caveat)
- [ ] 7.4 Propose: the e2e matrix mapped to the proposal's test list, the docs edit plan per file, and the outline for the new `docs/specification/pipeline.md` page (translated from this change's `diagrams/planning.md` + `diagrams/committing.md` into timeless specification voice, mermaid diagrams carried over)

## 8. End-to-end tests & documentation — Implementation

- [ ] 8.1 Implement: e2e tests per the proposal — exact add with warm cache and no lockfile entry (no download, confirmation required, fails offline with no files written); already-locked exact add succeeds offline; `latest`/`*`/bare add hits the network even when cached and fails offline; bounded-wildcard re-resolution; reproduction skips version resolution but downloads on a miss; add/remove failures leave all three files unchanged; orphan-on-pull cleanup offline (including under `--frozen-lockfile`, receipt-only write); receipt escape path reported, not deleted; removal succeeds with no network and no cache
- [ ] 8.2 Implement: the new `docs/specification/pipeline.md` — the two-phase plan/commit pipeline, additions-vs-manifest discriminator, three registry interactions, per-version materialization integrity chain, frozen-lockfile semantics, machine-local receipt, and transactional tri-write, with the mermaid diagrams; add it to `docs/docs.json` navigation (Specification group, between `install` and `integrity`)
- [ ] 8.3 Implement: reconcile `docs/specification/install.md` (delete the "cached content is trusted — never re-hashed" claim; restructure around plan/commit; cross-link `pipeline.md`) and `docs/specification/integrity.md` (cache self-audit, on-hit lockfile compare, `content_integrity` confirmation vs. `content_hash` transport domains) against post-change behavior per 7.3's audit
- [ ] 8.4 Implement: the remaining docs updates from 7.4 (`docs/cli/add.md`, `remove.md`, `install.md`, `docs/alpha/onboarding.md`, `docs/docs/contributing/architecture.md`, `docs/cli/env.md` — delta + tri-write flow, cache-first exact adds, confirmation + offline behavior, frozen semantics, `$FACET_DIR/receipts/` row)
- [ ] 8.5 Verify: `bun check` passes repo-wide; manual smoke — `facet add cowsay@0.0.1` against a warm cache completes with no archive download and sub-second latency; docs site renders the new page and mermaid diagrams (`mintlify dev` or preview deploy)
