## Why

The facet pipeline enforces a one-file-per-asset invariant end to end: build collects only `facet.json` plus conventional asset paths, and archive verification rejects every other inner-tar entry ("outer exclusivity"). Real facets need more than prompts — a README for humans browsing the source or a registry listing, a LICENSE, development notes — and skills routinely ship supporting files (references, scripts, templates) alongside `SKILL.md` per the Agent Skills convention. Today those files are silently dropped at build time and hard-rejected at archive verification, so authors cannot ship them at all. These files need a way to travel with the facet without being falsely treated as independently installable assets — that distinction frames the whole change.

## What Changes

- **Facets can track non-asset files.** The facet manifest gains a way to declare files that are not skills, agents, or commands (e.g. `README.md`, `LICENSE`, `DEVELOPMENT.md`, `ideas.txt`). Every supplementary archive entry — including every skill companion file — MUST be derivable from an explicit manifest declaration; archive membership stays explicit and reviewable, with no recursive auto-discovery. Declaration syntax (per-file vs. pattern) is a design decision. Missing declared files, undeclared entries, unsafe paths (traversal, absolute, backslashes), and colliding resolved paths SHALL fail build validation.
- **Asset identity is simplified in 0.2.** Skill, command, and agent names MUST follow the Agent Skills `name` field convention as a single ASCII segment; slash-namespaced assets are no longer valid in current-format manifests. Skills and commands SHALL share one logical namespace and MUST NOT use the same name; agents remain separate. Legacy 0.1 archives retain their legacy validation during the compatibility window.
- **Integrity covers every file, not just assets.** Non-asset files MUST be hashed per-entry in the build manifest and included in the tar bytes that produce the content-integrity hash. Verification MUST recompute hashes for all entries, asset or not.
- **Lockfile integrity becomes file-addressable.** Lockfile `0.2` SHALL record the verified canonical path and integrity of every materialized primary or companion file inside its owning asset entry. Install MUST reconcile those records against recomputed archive hashes and fail with the exact mismatching path. Archive-only supplementary files remain protected by facet-level integrity without becoming lockfile assets.
- **Outer exclusivity is relaxed, not abandoned.** Every inner-tar entry MUST still be derivable from the embedded `facet.json` — the derivable set expands to include declared non-asset files. Undeclared extra files remain a rejection; the supply-chain rationale for the rule is preserved.
- **Skill directories become multi-file.** Declared files under `skills/<name>/` (beyond `SKILL.md`) SHALL be shipped and SHALL be installed and removed atomically with their owning skill through the adapter contract, with receipt/ownership data sufficient for drift removal. **BREAKING** for the adapter SDK: the adapter asset contract is one content string per asset today, so installing and deleting multi-file skills changes the adapter interface for third-party adapters.
- **Everything else ships but does not materialize.** Non-asset files outside skill directories — root-level files like `README.md`, or extra files under `agents/` and `commands/` — SHALL NOT be written to disk at install time. They travel with the archive as facet metadata, available to future surfaces (e.g. a `facet info` command, registry listings). README is the motivating example of a file worth surfacing; this change only makes it shippable and verifiable, not displayed. Supplementary files SHALL NOT become independently addressable assets: no asset type, no adapter metadata, no independent install scope, no lockfile asset tuples.
- **README receives first-class authoring support.** Create SHALL offer editable `README.md` content enabled by default. Edit SHALL expose dedicated create/edit/adopt/scaffold/remove actions for both exact conventional paths, `README.md` and extensionless `README`. README remains optional and uses the same top-level supplementary-file declaration mechanism as every other archive-only file.
- **BREAKING (protocol/archive format).** All builds produced after this change SHALL use `facetVersion: 0.2`; consumers SHALL continue accepting legacy `0.1` archives during a compatibility window. Unsupported versions MUST produce structured failures that the CLI renders as actionable upgrade guidance. Protocol and adapter packages SHALL use their next minor releases for these breaking changes while pre-1.0; removing `0.1` support is a separate future change.

## Non-goals

- No `facet info` command or README rendering in the CLI — shipping README enables that future capability; this change does not build it.
- No independent installation of supplementary files: they gain no install destinations of their own.
- No companion-directory install semantics for commands or agents — only skills materialize companion files.
- No preservation of filesystem metadata (executable bits, symlinks) for supplementary files.
- No automatic packaging of untracked source-tree files; archive membership remains explicitly declared.

## Capabilities

### New Capabilities

None — this change modifies existing domains rather than introducing a new one.

### Modified Capabilities

- `protocol`: pre-1.0 breaking protocol changes increment the package minor version; 1.0-and-later breaking changes require a major version.
- `protocol__schemas`: the facet manifest schema gains a declaration for non-asset files; current-format asset names follow the single-segment Agent Skills convention and skill/command names are disjoint; the build manifest represents and hashes every tracked entry; lockfile `0.2` requires canonical path/integrity records for every materialized file inside its owning asset entry.
- `protocol__content-hashing`: archive assembly collects declared non-asset files and skill-directory files at their source paths; per-entry hashes are recorded for all entries.
- `protocol__integrity`: the outer-exclusivity derivation set expands to declared non-asset files and skill-directory files; verification requirements apply to every inner-tar entry.
- `authoring__facets`: build resolves, validates, and archives supplementary files; create/edit provide dedicated transactional `README.md` and extensionless `README` authoring plus generic supplementary-file reconciliation; missing declarations, unsafe paths, collisions, slash-containing asset names, and skill/command name collisions are structured failures.
- `installation`: materialization requirements change — skill-directory files install with their skill; non-asset files elsewhere are shipped but never written to disk; install reconciles lockfile `0.2` per-file hashes before writes and reports exact drift paths; the machine-local receipt mirrors committed ownership for offline removal and rollback.
- `adapter__assets`: the adapter install/read/delete contract extends from one file per asset to multi-file skills.

## Impact

**Code**

- `packages/protocol`: `schemas/facet.ts` (manifest declaration), `loaders/facet.ts` (`resolvePromptsFromMap` currently ignores non-conventional paths), `build/content-hash.ts` (`collectArchiveEntries` collects only conventional asset paths), `integrity/validate-archive.ts` (Step 6b outer-exclusivity allowlist), `build/validate-content.ts`.
- `packages/engine`: `loaders/facet.ts` (disk reads limited to conventional paths), `build/pipeline.ts`, `install/materialize.ts` (one content string per asset; asset-tuple receipt).
- `packages/adapter`: `types.ts` (`installAsset`/`deleteAsset` single-file contract), `asset-fs.ts` (single-file write/delete with dir pruning).
- `packages/adapters/claude-code`: path resolution for skill-directory files.
- `packages/cli`: `build`/`install` command surfaces largely unchanged; error rendering for new validation failures.
- Tests: compatibility coverage for legacy asset-only artifacts and the new archive format, plus security coverage for traversal, collisions, undeclared entries, and tampering with non-asset files.

**Documentation (Article III)**

This proposal was informed by `docs/specification/archive.mdx` (content rules: path safety, manifest completeness, outer exclusivity), `docs/specification/build.mdx` (steps 2 and 5), `docs/specification/manifest.mdx` (text-asset conventional paths), and `docs/specification/integrity.mdx` (hash definitions, receipt asset tuples). All four SHALL be updated as scoped work in this change, together with the authoring and installation guides (`docs/guides/create-your-first-facet.mdx`, `docs/guides/install-facets.mdx`) and root `README.md`, which describe facets in asset-only terms today. `docs/specification/lockfile.mdx` SHALL be updated for lockfile `0.2`, per-materialized-file integrity, legacy-alpha-1 migration, and the distinction between version-controlled canonical hashes and machine-local receipt ownership.

**Systems**

The cafe registry (separate implementation of the spec) will need the same relaxed verification rule before it can accept archives containing non-asset files.
