---
"agent-facets": minor
"@agent-facets/protocol": patch
---

Refactor the install pipeline into a plan/commit architecture with delta-based flow

**`facet add` with an exact version and a warm cache no longer contacts the registry.** Previously, `facet add cowsay@0.0.1` always fetched from the registry (~1.45s) because the add flow wrote `facets.json` first and then ran install, making an explicit add indistinguishable from reproduction. Now the cache is keyed on the fully-qualified version — a warm cache serves the content directly with no download.

### Plan/commit split

`add`, `remove`, and `install` now share a single commit path. The plan phase produces a delta (additions with the user's specifier verbatim, removals by name; `install` produces an empty delta) with no network I/O, no lockfile reads, and no cache reads. The commit phase owns all resolution, materialization, and a transactional tri-write of `facets.json`, `facets.lock`, and the machine-local receipt — a failure at any point rolls back all three files plus assets.

The write-ahead manifest mutation and snapshot/restore in `facet add` and `facet remove` are removed. The manifest is never written before install succeeds.

### Structural discriminator

Whether the lockfile is trusted for version resolution depends on where an entry comes from:

- **In additions** (explicit request): the lockfile is not trusted. An exact specifier needs no version resolution; a non-exact specifier (`bare`, `latest`, `*`, `0.*`) always re-resolves to the newest matching version, even when the lockfile already satisfies it.
- **From the manifest, not in additions** (reproduction): the lockfile is trusted. A satisfying recorded version needs no resolution; only absent or stale entries trigger it.

A bare add is pinned to the resolved exact version in `facets.json`; an explicit specifier is written verbatim and floats.

### Cache audit and integrity chain

Cache hits are no longer taken at face value. Every materialization from cache recomputes per-asset and canonical-archive hashes against the integrity sidecar. A tampered slot is evicted and re-fetched — tampered content is never installed and never seeds a lockfile entry. After self-audit, the content is anchored: against the locked integrity when pinned (hard failure on mismatch), or via registry integrity confirmation when creating a new lockfile entry (fails offline rather than writing an unconfirmed entry).

### Registry metadata: `contentFingerprint`

`RegistryMetadata` now carries both `transportHash` (sha256 of the uploaded `.facet` tarball, used for download verification) and `contentFingerprint` (sha256 of the canonical archive, used for lockfile integrity and confirmation). Previously only `expectedIntegrity` was mapped, conflating the two domains.

### Machine-local install receipt

A per-project receipt under `$FACET_DIR/receipts/` tracks what this machine has materialized, keyed by a truncated SHA-256 of the project's canonical path. Drift removal compares the desired set against the receipt — not the on-disk lockfile — so a `git pull` that drops a lockfile entry no longer orphans assets: the receipt still describes them and removal cleans them up offline with no cache or network access. The receipt is untrusted input; every asset path is resolved and must fall inside the project's adapter trees before deletion.

### Frozen lockfile

A frozen commit with a non-empty delta is rejected immediately. Bidirectional consistency checks run before materialization. The receipt is rewritten during drift removal; the lockfile and manifest are never written.

### `@agent-facets/protocol`

Doc comments on `IntegrityFailure` Check A and `RegistryIntegrityInput.cachedIntegrity` updated to reflect the audited-hit model (content is re-hashed against the sidecar, not trusted post-write).
