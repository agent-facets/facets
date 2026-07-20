---
"@agent-facets/protocol": minor
---

**Consumer support for archive format `0.2` (pre-1.0 breaking minor).** The protocol now verifies both legacy `0.1` and current `0.2` `.facet` archives with strict, exact `facetVersion` dispatch and no fallback between versions. This is the consumer-first release: verification support ships before any producer emits `0.2`.

**Breaking API — `validateFacetArchive`.** The result shape is now `{ ok: true; data: VerifiedFacetArchive } | { ok: false; failure: ArchiveVerificationFailure }`. The previous `{ ok: false; errors: ValidationError[] }` arm is replaced by a single tagged `failure`. The success payload type `VerifiedArchive` is renamed to `VerifiedFacetArchive` and is now a discriminated union on `archiveVersion`: the legacy `0.1` arm keeps the flat `assets: VerifiedAsset[]` list, while the current `0.2` arm exposes `entries: VerifiedEntry[]` (each tagged `manifest` | `primary-asset` | `skill-companion` | `archive-only`). Consumers that read `.assets` unconditionally should migrate to the version-agnostic helpers `listVerifiedFiles(archive)` and `verifiedFileHashes(archive)`.

**Structured failures.** `ArchiveVerificationFailure` is a tagged union (`container`, `invalid-json`, `duplicate-members`, `unsupported-facet-version`, `schema-violation`, `decompression`, `integrity`, `entry-integrity`, `validation`); classify on `failure.code` rather than parsing messages. No expected failure mode throws.

**New public API.** `VerifiedFacetArchive`, `VerifiedEntry`, `ArchiveVerificationFailure`, `ValidateFacetArchiveResult`, `listVerifiedFiles`, `verifiedFileHashes`; versioned build-manifest and lockfile schemas plus their exact-dispatch parsers `parseBuildManifestDocument` and `parseLockfileDocument`; the shared archive plan (`planArchiveEntries`, `validateSupplementaryPath`, `portableCollisionKey`); strict raw tar-header validation (`validateRawTarEntries`, `RawTarValidationOptions`); and the archive-format constants `FACET_ARCHIVE_VERSION` (`0.2`), `LEGACY_FACET_ARCHIVE_VERSION` (`0.1`), and `SUPPORTED_FACET_VERSIONS`. `parseFacetArchive` now returns a version-tagged parsed build manifest and a structured `failure`.

**Transitional exports retained.** `BuildManifestSchema`/`BuildManifest`, `LockfileSchema`/`Lockfile`, and `LOCKFILE_VERSION` (which equals the legacy value `1`, not the current `0.2`) remain exported and `@deprecated` for the compatibility window; they are removed once the engine lockfile-migration and producer work lands. Prefer the versioned parsers and `CURRENT_LOCKFILE_VERSION` in new code.

This release intentionally carries **no** `@agent-facets/adapter` or `agent-facets` (CLI) version bump: the adapter API `0.0`→`0.1` cutover and the CLI `0.2` producer ship in later, separately gated releases. Other implementations of the spec (e.g. the registry) adopt this published package to gain dual-format verification.
