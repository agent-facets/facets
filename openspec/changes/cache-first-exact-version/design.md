## Context

`facet add <name>@<exact>` contacts the registry even with a warm cache (~1.45s vs ~0.10s, hard failure offline) because `run-add.ts` / `run-remove.ts` write `facets.json` first and then invoke the shared install pipeline, which reads the mutated manifest back. By resolution time an explicit add is indistinguishable from reproduction, so cache lookup is gated on a satisfying lockfile entry — which a fresh add never has.

This change splits the pipeline into a **plan** phase (pure routing: request → delta) and a **commit** phase (all resolution, integrity, materialization, and a transactional tri-write of `facets.json`, `facets.lock`, and a new machine-local install receipt). The full control flow is specified in two normative diagrams in this change directory, which are part of this design:

- `diagrams/planning.md` — the plan phase: additions carry the user's specifier verbatim; removals carry names; `install` produces an empty delta.
- `diagrams/committing.md` — the commit phase: the structural additions-vs-manifest discriminator, the three registry interactions, the per-version materialization integrity chain, frozen-lockfile gating, the receipt, and the tri-write.

This document records the decisions behind those flows, the alternatives rejected, and the code/documentation impact. Where the diagrams and this document state behavior, the delta spec (`specs/installation/spec.md`) is the requirements-level source of truth; the diagrams elaborate the mechanism.

**Security posture.** A design review of the diagrams hardened three areas, and the decisions below reflect that review: cache hits were previously trusted post-write (`cacheGet` is existence-only; the sidecar is parsed, never re-hashed), the lockfile integrity comparison only ran on the download path, and the receipt would have been a single shared file whose asset lists drive deletion. The registry's core invariant — **a published `name@version` is immutable in perpetuity** — is assumed, but this design *enforces* it client-side rather than trusting it.

## Goals / Non-Goals

**Goals:**

- An exact-version add with a warm cache MUST NOT download content; with a satisfying lockfile entry it MUST work fully offline.
- A non-exact add (`bare`, `latest`, `*`, `0.*`) MUST resolve fresh against the registry, even when the lockfile satisfies it.
- A lockfile entry for a registry facet MUST NOT be created or replaced without same-operation registry confirmation of its integrity.
- Cached content MUST be re-verified against its recorded integrity on every materialization; tampered content MUST never be installed or seed a lockfile entry.
- `add`, `remove`, and `install` MUST converge on one commit path; failures MUST leave the manifest, lockfile, and receipt untouched (no write-ahead snapshot/restore).
- Orphan-on-pull MUST be recoverable: assets a `git pull` strands (manifest + lockfile entry dropped) MUST be cleaned up offline via the receipt.
- Frozen mode MUST reproduce the locked set byte-exactly, reject drift bidirectionally, and never write the lockfile or manifest.

**Non-Goals:**

- Per-adapter materialization tracking (receipt is adapter-agnostic; adapter-removal cleanup is out of scope).
- Recovering assets orphaned *before* this change ships (bootstrap records what *should* be on disk, per the proposal).
- Changes to git/local source flows beyond what frozen-mode consistency checks already require. Integrity confirmation applies to registry sources only; git sources keep the one-check, local sources stay trust-by-path.
- Multi-registry support or source identity in the cache key (single registry today; the lockfile comparison and integrity confirmation are the substitution defense).

## Decisions

### D1: Plan/commit split with an explicit delta (vs. write-ahead manifest)

Plan is pure routing — no network, no lockfile reads, no cache reads, no resolution. It emits `additions[]` (user's specifier verbatim) and `removals[]` (names). Commit owns everything else and merges the delta in memory.

- **Alternative — keep write-ahead + post-install pin rewrite:** rejected; it is the root cause. Once the manifest is pre-mutated, an explicit request and reproduction are indistinguishable, and failure handling needs snapshot/restore.
- The delta type SHOULD make "same name in both additions and removals" unrepresentable (or define removal-then-addition precedence explicitly); the CLI cannot produce it, but the engine API MUST NOT leave it undefined.

### D2: Structural discriminator, not a flag

Whether the lockfile is trusted for **version resolution** depends on where an entry arrives: in `additions` → not trusted (always re-resolve non-exact specifiers); from the manifest and not in additions → trusted when satisfying. Additions shadow manifest entries: each facet name is processed by exactly one path per commit.

- **Alternative — `isExplicitRequest` boolean threaded through the pipeline:** rejected; flags drift from their origin and invite illegal states. The input channel *is* the discriminator.

### D3: Three independent registry interactions

Version resolution (specifier → exact), archive resolution (bytes on cache miss), and **integrity confirmation** (registry metadata vs. content, required exactly when a lockfile entry is created or replaced) are gated independently. Confirmation rides the same metadata response as version resolution, so the only path paying a *new* network call is an exact specifier served from a warm cache with no satisfying lockfile entry — and that path fails offline rather than writing an unconfirmed entry.

- **Alternative — offline TOFU (trust the verified-put sidecar when creating an entry):** rejected by explicit decision. The trust anchor for every new lockfile entry is the registry at lock time, not whichever earlier install populated the shared cache.
- **Alternative — best-effort confirmation (check when reachable, warn offline):** rejected; a conditional guarantee is not a guarantee.

### D3a: Confirmation compares the canonical content fingerprint — published as a new metadata field

The registry exposes **two hashes in two domains** (originally verified against the live API with `cowsay@0.0.1`):

| Value | Where (per the synced OpenAPI snapshot) | Domain |
| --- | --- | --- |
| `content_hash` | version-metadata body (required) | sha256 of the uploaded `.facet` tarball (includes the gzipped inner tar — delivery bytes) |
| `content_integrity` | version-metadata body (required) and `/contents` body; also the metadata `ETag` | sha256 of the canonical archive — the domain the sidecar, lockfile, and `build-manifest.json` all record |

These are **not interchangeable**: gzip is delivery, outside the hash contract, so the uploaded-tarball hash cannot be recomputed from cached canonical content. Integrity confirmation MUST compare the **canonical content fingerprint** (`content_integrity`).

**Status after the API snake_case migration** (commit `87f1785`, on which this change is rebased): the prerequisite is **satisfied end to end**. The OpenAPI snapshot, generated types, wire layer, and test fixtures declare `content_integrity` as a required version-metadata field, and the production registry serves it (verified live: `cowsay@0.0.1` returns `content_integrity` equal to the local cache sidecar's integrity). What remains is **this change's wiring**: `resolve-metadata.ts` currently maps only `content_hash → expectedIntegrity` and drops `content_integrity`; this change extends `RegistryMetadata` to carry both hashes under domain-explicit names and feeds the fingerprint to confirmation.

`content_hash` keeps its existing single job: `download.ts`'s raw-bytes transport check on freshly downloaded archives. The two values are complementary checks on different byte streams.

- **Alternative — read the existing ETag header:** works today (CloudFront preserves it; the registry deliberately CORS-exposes it) but hangs a security control on an undocumented response header; rejected in favor of a typed body field.
- **Alternative — use `/contents`' `content_integrity`:** documented today, but a second request per facet that hauls every resource body along with the hash; rejected.
- **Wiring note:** protocol's `verifyRegistryIntegrity` is currently **unwired** (no engine call sites). When this change wires it, `RegistryIntegrityInput.expectedIntegrity` MUST be fed the canonical fingerprint (`content_integrity`), never the uploaded-tarball hash (`content_hash`) — Checks A/B compare canonical-domain values and would fail unconditionally otherwise.

### D4: Cache hits are audited, never trusted

Every materialization from cache recomputes the content's hashes (per-asset and canonical-archive, via protocol's existing `computeContentHash` machinery) and compares them to the integrity sidecar. Failure evicts the slot and degrades to a miss. This **reverses the documented contract** of `cacheGet` ("a cache hit is taken at face value and is NOT re-hashed") — that doc comment and the spec line it mirrored are rewritten, not preserved.

After the self-audit, the content is anchored externally: when the lockfile pins the version, audited integrity MUST equal locked integrity (string compare; mismatch is a hard `lockfile`-check failure, the highest-priority failure mode, not a silent re-download); when no entry exists, integrity confirmation (D3) runs. This is protocol's existing `RegistryIntegrityInput` Check A semantics, now invoked on the cache-hit path with real metadata.

- **Alternative — keep trust-post-write:** rejected; tampered cache bytes with an intact sidecar would materialize silently and seed lockfile entries.
- **Alternative — recompute only under `--frozen-lockfile`:** rejected; the cost (one hash pass over skill-sized archives, single-digit milliseconds) does not justify a weaker default.

### D5: Per-project receipt files, keyed by canonical path hash

The receipt lives at `$FACET_DIR/receipts/<basename>-<hash>.json` (honoring the existing `FACET_DIR` override), where `<hash>` is a truncated SHA-256 of the `realpath` of the directory containing `facets.json`. The basename slug is cosmetic; the hash is the identity. The file embeds the canonical path; on load, a mismatch fails closed (treated as absent, re-bootstrapped, never acted on). Contents per facet: `{ name, version, assets[] }` — a self-sufficient deletion record.

- **Alternative — single top-level file keyed by project:** rejected; cross-project commits would race on one file (read-modify-write lost updates → stale deletion records), and key derivation from raw paths invites symlink/case-insensitivity collisions.
- **Alternative — single file + advisory lock:** workable but strictly worse — keeps the collision problem and adds locking complexity per-project files get for free. Same-project concurrency remains covered by the existing install advisory lock.
- Realpath-before-hash makes symlinked and case-variant spellings of one project converge and makes distinct projects collide only via SHA-256 truncation (negligible; the embedded-path check fails closed regardless).

### D6: The receipt is untrusted input; deletion is contained

Receipt-driven deletion realpath-resolves every recorded asset path and deletes only paths inside the project's adapter trees. Escapes (`..`, absolute paths elsewhere, symlinked hops out) are reported and skipped. A corrupted receipt MAY cause a skipped cleanup; it MUST NOT delete outside its sandbox. Drift removal compares the desired set (manifest + additions − removals) against the **receipt**, never the on-disk lockfile — that is what makes orphan-on-pull recoverable.

### D7: Frozen mode constrains the locked set, not materialization state

Frozen rejects any non-empty delta, checks consistency **bidirectionally** (manifest coverage, no orphaned lockfile entries, git/local source provenance unchanged), verifies every facet against its locked integrity **before** materializing, and never performs version resolution or integrity confirmation (it never creates entries — so its only network activity is archive resolution). Receipt-driven drift removal still runs and rewrites the receipt; the lockfile and manifest are never written.

- **Alternative — frozen touches nothing (no drift removal):** rejected; CI working copies would accumulate orphaned assets that frozen mode exists to converge away. Adapter trees and the receipt are machine-local materialization state, like the permitted cache-miss downloads.

### D8: Transactional tri-write under the existing journal

Commit reads all three files, merges in memory, materializes under the journal, then writes `facets.json`, `facets.lock`, and the receipt together. Any failure rolls back all three plus assets. The write-ahead snapshot/restore and post-install pin rewrite in `run-add.ts` / `run-remove.ts` are deleted.

### Code touchpoints

| Area | Change |
| --- | --- |
| `engine/src/install/run-install.ts` | Accept the delta; own resolution + integrity chain; receipt-driven drift removal; tri-write |
| `engine/src/install/plan-facet.ts` (+ entry) | Becomes pure routing per `diagrams/planning.md` |
| `engine/src/install/run-add.ts`, `run-remove.ts` | Drop write-ahead, snapshot/restore, pin rewrite; pass deltas |
| `engine/src/install/` (new module) | Receipt read/write/bootstrap/validate (D5, D6) |
| `engine/src/cache/operations.ts` | Audited read path (recompute vs. sidecar, evict-on-fail); rewrite the trust-post-write doc contract |
| `engine/src/registry/` | Snapshot already declares `content_integrity` (synced in `87f1785`); extend `RegistryMetadata` to carry both hashes with domain-explicit names in `resolve-metadata.ts`; expose metadata-only integrity lookup for confirmation |
| `protocol/src/integrity/` | No schema change expected; Check A is invoked on the hit path with real inputs (canonical fingerprint, per D3a) — doc comments updated to match |
| Registry (facet-cafe repo) | **Prerequisite — already satisfied:** the snake_case + `content_integrity` API is deployed to production and synced into this repo's snapshot; no registry work remains in this change |

## Risks / Trade-offs

- **[Offline exact add now fails without a lockfile entry]** → By decision (D3). The error message MUST name the cause ("cannot create a lockfile entry without registry confirmation") and distinguish it from a download failure. Reproduction paths are unaffected and fully offline-capable.
- **[Self-audit cost on every materialization]** → One hash pass per facet per install over skill-sized archives (milliseconds). Hashing machinery already exists in protocol; no new dependency.
- **[Alpha registry is stubbed]** → `docs/alpha/onboarding.md` notes the registry path already errors in alpha, so integrity confirmation regresses nothing; tests MUST stub the metadata endpoint for confirmation paths.
- **[Receipt orphaned by project move/rename]** → Canonical-path keying means a moved project bootstraps a fresh receipt from its lockfile; the old receipt's embedded path no longer exists and is prunable. Documented behavior, not silent breakage.
- **[Bootstrap is best-effort]** → Seeding from the lockfile records what *should* be on disk; assets orphaned before this change ships are unrecoverable (explicit non-goal).
- **[Cache poisoning between verified-put and use]** → Closed by D4's audit plus D3/D4 anchoring: bytes-tamper is caught by the recompute; coordinated bytes+sidecar tamper is caught by the lockfile compare (locked) or registry confirmation (unlocked).
- **[Engine-internal API break]** → The install entry contract changes from "read the mutated manifest" to "apply a delta." No published surface changes; only `packages/cli` consumes engine.
- **[Stale CDN-cached metadata can lack `content_integrity`]** → Metadata responses are CDN-cached as `immutable, max-age=31536000`; pre-migration cached objects (camelCase, no `content_integrity`) can be served for popular versions until evicted or invalidated (observed live: the plain `cowsay@0.0.1` URL served the old shape from CloudFront while a cache-busted request served the new one). Mitigations: cache invalidation is a facet-cafe operational concern; on this side, a metadata response without a usable `content_integrity` MUST fail confirmation closed (no lockfile entry written) — never fall back to `content_hash` or skip the check. Engine tests stub metadata (no live dependency in CI); the snapshot-freshness CircleCI job surfaces future contract drift.

## Migration Plan

1. Registry prerequisite: **already satisfied** — the facet-cafe snake_case + `content_integrity` API is deployed to production, and the client contract is synced on this branch (snapshot regenerated in `87f1785`). No further codegen is expected unless the registry contract moves again.
2. Land protocol/engine changes behind the same CLI commands — no flag, no opt-in; behavior changes are the fix.
3. First commit on any project bootstraps its receipt from the current lockfile (spec'd scenario). No user action.
4. Rollback = revert. Receipts are additive machine-local state under `$FACET_DIR/receipts/`; an older CLI ignores them. Old orphaned receipts are inert JSON.
5. The cache format is unchanged (same slots, same sidecar); only read-path behavior changes, so existing caches keep working and tampered slots self-heal via evict-and-refetch.

## Documentation updates (Article III)

Behavior covered by existing docs changes; the following MUST be updated in the implementation tasks.

**Caveat — the `docs/specification/` section is known to be very out of date** beyond this change's scope. The rule here: the pages this change touches (`install.md`, `integrity.md`, the new `pipeline.md`) MUST be reconciled against actual post-change behavior — rewritten where stale, not minimally patched around stale claims. A full refresh of the remaining specification pages (`architecture.md`, `manifest.md`, `publish.md`, `servers.md`, `terminology.md`, `index.md`) is **out of scope** and SHOULD be filed as a separate documentation change; the explore task in this change's docs block records what drift it finds there as input to that follow-up.

- `docs/cli/add.md` — steps 6–8 describe write-ahead manifest + snapshot restore; rewrite for the in-memory delta and tri-write. Note exact pins served cache-first, the integrity-confirmation metadata call (and its offline failure) when no lockfile entry exists, and reconcile the "Re-adding a facet" section.
- `docs/cli/remove.md` — step 5 ("run the install pipeline" after editing the manifest); rewrite for delta-based commit and receipt-driven offline removal.
- `docs/cli/install.md` — frozen-lockfile section: bidirectional consistency checks, verify-before-materialize, drift removal under frozen (receipt rewritten, lockfile never written).
- **NEW: `docs/specification/pipeline.md`** — a dedicated specification page translating this change's `diagrams/planning.md` and `diagrams/committing.md` into deployed documentation: the two-phase plan/commit pipeline, the additions-vs-manifest structural discriminator, the three registry interactions, the per-version materialization integrity chain (self-audit → lockfile compare → integrity confirmation), frozen-lockfile semantics, the machine-local receipt, and the transactional tri-write. Mermaid diagrams carry over (Mintlify renders `mermaid` code fences natively); prose is adapted from change-internal voice ("this change fixes…") to timeless specification voice. Add the page to `docs/docs.json` navigation in the Specification group (between `install` and `integrity`).
- `docs/specification/install.md` — the three-check description and install flow: add the cache-hit self-audit, the lockfile comparison on hits, and integrity confirmation at lock-entry creation; **delete the now-false "Cached content is treated as trusted — never re-hashed on read" statement (step 4)**; restructure steps around the plan/commit split and cross-link the new `pipeline.md` page for the normative flow detail.
- `docs/specification/integrity.md` — extend the integrity model with the cache self-audit, the on-hit lockfile comparison, and lock-entry integrity confirmation (`content_integrity`, canonical-fingerprint domain vs. `content_hash` transport domain); cross-link `pipeline.md`.
- `docs/alpha/onboarding.md` — the integrity model paragraph says cached content is trusted post-write; update for the audited-hit model. (The proposal originally claimed this file "remains accurate"; the security-review hardening changed that.)
- `docs/docs/contributing/architecture.md` — add the receipt to the developer-machine components alongside the cache.
- `docs/cli/env.md` — add a `$FACET_DIR/receipts/` row to the directory table.
- Code-level doc contracts: `engine/src/cache/operations.ts` (`cacheGet` trust statement) and `protocol/src/integrity/types.ts` (Check A cache-hit semantics) MUST be rewritten with the code, per Article III's no-silent-drift rule.

## Open Questions

- **Hash truncation length** for receipt filenames (12 vs. 16 hex chars): cosmetic-vs-collision trade-off; default to 12 unless review prefers 16. Fail-closed embedded-path validation makes this low-stakes.
- **Receipt schema versioning**: include a `"version": 1` field now to make future shape changes cheap? Leaning yes (one line, saves a migration headache).
- **Eviction UX on hard lockfile mismatch**: the failure is deliberate (not self-healing); should the error suggest a remediation command (e.g., manual cache eviction) and should `facet` grow one? Out of scope to build here, but the error copy decision lands in this change.
