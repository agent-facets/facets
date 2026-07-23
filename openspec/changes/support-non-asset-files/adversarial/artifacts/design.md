## Context

Facet archives currently have one implicit membership rule: `facet.json` plus the conventional file for every declared skill, agent, and command. The same assumption appears in schema validation, build collection, per-file hashing, archive verification, parsed archive data, installation receipts, and the adapter SDK. Supporting files cannot therefore be added only at archive assembly; their declaration, integrity, classification, and ownership must remain consistent across the whole pipeline.

This design treats the embedded `facet.json` as the single source of truth for archive membership and classification. The build manifest records hashes, not a second description of which paths are assets or supplementary files. A supplementary path inside a declared skill directory belongs to that skill; every other supplementary path is archive-only metadata and is never materialized.

The change crosses the published protocol, engine, adapter SDK, first-party adapters, CLI error presentation, and the cafe registry's verifier. Existing `facetVersion: 0.1` archives must remain consumable, while an archive containing supplementary files is intentionally not consumable by a legacy verifier.

## Goals / Non-Goals

**Goals:**

- Authors MUST be able to explicitly declare regular files to include in a facet archive.
- Build and verification MUST derive exactly the same canonical archive-entry set from `facet.json` and MUST reject missing, extra, unsafe, duplicate, or colliding paths.
- Every inner-archive file MUST have a per-file hash, and supplementary bytes MUST affect the archive integrity hash.
- A declared file below a declared skill directory MUST install, update, and delete as part of one skill operation.
- Supplementary files outside declared skill directories MUST remain verified archive metadata and MUST NOT acquire independent asset identity, scope, lockfile tuples, or install destinations.
- New consumers MUST continue to accept valid legacy `0.1` archives.

**Non-Goals:**

- This change does not add recursive discovery, glob declarations, or implicit inclusion of source-tree files.
- This change does not display README content, add `facet info`, or define a registry presentation API.
- This change does not materialize companion files for agents or commands.
- This change does not preserve symlinks, hard links, directory entries, executable bits, timestamps, ownership, or other filesystem metadata.
- This change does not make supplementary files selectable or independently installable.

## Decisions

### 1. `facet.json` declares an explicit list of canonical file paths

The facet manifest SHALL gain an optional top-level `files` array of strings. Each member names exactly one source-root-relative regular file using `/` as its separator. Patterns, directories, and recursive discovery SHALL NOT be supported.

A declared path MUST:

- be non-empty, relative, and already canonical;
- contain no empty, `.` or `..` segment, backslash, NUL, absolute-path prefix, drive prefix, or URL-like prefix;
- resolve through existing parents to a regular file inside the facet root;
- not be a symlink or hard link;
- not be `facet.json`, `build-manifest.json`, `archive.tar.gz`, or any conventional primary asset path derived from the manifest; and
- not collide with another derived archive path by exact spelling, canonical Unicode form, portable case folding, resolved source identity, or file/directory prefix.

Paths under `skills/<name>/` SHALL be accepted only when `<name>` is a declared skill and the path has content below that directory. `skills/<name>/SKILL.md` remains derived from the skill declaration and MUST NOT also appear in `files`. This makes skill ownership a function of path plus the existing skill declaration rather than a second owner field that could disagree. Declared paths under `agents/` or `commands/` are permitted but remain archive-only metadata.

Supplementary files MAY be empty and MAY contain arbitrary bytes. Asset-specific rules such as non-empty Markdown and no YAML front matter continue to apply only to primary asset files. Build SHALL hash and preserve supplementary bytes exactly.

**Alternatives considered:**

- Glob patterns and directory declarations were rejected because membership would depend on ambient source-tree contents and review of `facet.json` would not reveal the archive's exact file set.
- Descriptor-local companion lists were rejected because they would create two declaration mechanisms and would not cover root metadata files.
- An object per file carrying an asset kind or owner was rejected because kind and ownership are already derivable, and duplicated classification could drift.

### 2. Archive format version 1 carries a path-to-hash table for every file

An archive with a non-empty `files` declaration SHALL use `facetVersion: 1` in `build-manifest.json`. Version 1 SHALL replace the misleading `assets` hash map with a `files` map from canonical inner-archive path to `sha256:<hex>` computed over the exact file bytes. The map SHALL include `facet.json`, every primary asset file, and every declared supplementary file. It SHALL carry hashes only; asset/supplementary classification SHALL be derived from the embedded facet manifest.

The inner archive entry set for version 1 SHALL equal:

1. `facet.json`;
2. each conventional primary asset path derived from the embedded manifest; and
3. each canonical path in `facet.json.files`.

No other entry is valid. Entries SHALL be regular files only and lexicographically ordered by canonical UTF-8 path bytes. Existing deterministic metadata rules remain unchanged. The integrity hash SHALL continue to cover the canonical uncompressed inner tar bytes, so any supplementary-file change alters integrity.

A new producer MAY continue to emit version `0.1` when `files` is absent or empty. This preserves old-consumer interoperability for asset-only facets. A new verifier SHALL dispatch on the build-manifest version: it SHALL apply the exact legacy schema and membership rules to `0.1`, the version 1 rules above to `1`, and reject unsupported versions with structured data. It SHALL NOT reinterpret a malformed version 1 archive as `0.1`.

This archive-version boundary is separate from release versions: publishing version 1 support requires a new major release of the protocol package because archive acceptance and the public parsed result change, and a new major release of the adapter SDK because its asset operations change.

**Alternatives considered:**

- Reusing `facetVersion: 0.1` was rejected because old consumers reject the expanded entry set and the build-manifest hash shape changes.
- Keeping an `assets` map and adding a second `files` map was rejected because the two maps could overlap, omit entries, or disagree about classification.
- Emitting version 1 for every asset-only build was rejected as an unnecessary compatibility loss; content that fits the legacy contract can remain legacy-encoded.

### 3. Build and verification share one path-derivation operation

The protocol package SHALL expose one pure operation that validates a facet manifest's file declarations and derives a tagged archive plan. The plan SHALL distinguish manifest, primary assets, skill companions, and archive-only supplementary files. Build collection and archive verification MUST consume this same operation rather than maintaining separate allowlists.

Build SHALL resolve the plan against the source root, validate containment and regular-file identity, read every planned path as bytes, and fail with structured errors before writing `dist/` if any path is missing, unsafe, duplicated, colliding, or not a regular file. The existing cleanup of `dist/` MUST NOT occur until all declared source inputs have been validated, preventing a declaration from being destroyed before its missing-file error can be reported.

Verification SHALL parse tar headers without normalizing them into a lossy map. It SHALL reject duplicate paths, non-regular entries, non-canonical paths, unsafe paths, and prefix collisions before exposing contents. After validating and parsing `facet.json`, it SHALL derive the expected plan and compare the expected and observed path sets for exact equality. It SHALL then require one version 1 `files` hash for every expected path, no hash for any other path, and byte-verify every hash. All expected failures SHALL remain structured result variants rather than thrown errors.

The successful parsed result SHALL carry the verified manifest, primary assets, skill-companion bytes grouped by owning skill, and archive-only supplementary bytes as distinct tagged data. It SHALL not represent classification through optional fields whose combinations can disagree.

**Alternatives considered:** separate engine and verifier derivation was rejected because the current outer-exclusivity drift demonstrates that duplicated membership logic is a security boundary.

### 4. Skills use a tagged bundle contract; other assets remain single-file

The adapter SDK's install, read, and delete requests/results SHALL become tagged unions keyed by asset type:

- a skill variant carries its `SKILL.md` text plus a canonical map of companion paths relative to the skill root and their bytes;
- agent and command variants carry their existing single Markdown content; and
- no variant for supplementary files exists.

This prevents an agent or command request from accidentally carrying companions and prevents a skill request from omitting its bundle shape. Metadata continues to apply to the primary asset, and adapters SHALL reconstruct tool-specific metadata only in the primary file; companion bytes SHALL be preserved without front-matter transformation.

A skill install SHALL be one adapter operation. It MUST stage the complete replacement, remove previously owned companion paths that are absent from the new bundle, and commit or roll back without leaving a partial bundle. Skill deletion MUST remove the primary file and all recorded owned companions as one operation, while retaining unrelated files not listed as owned. Expected adapter failures MUST be structured result values.

First-party filesystem helpers SHALL centralize containment checks, staging, commit/rollback, owned-file removal, and empty-directory pruning so adapters do not duplicate this security-sensitive behavior. Adapters MAY choose tool-specific roots and representations, but MUST NOT allow a companion path to escape the resolved skill root.

**Alternatives considered:**

- Passing every file as an independently installable asset was rejected because it would create false asset identity, scope, metadata, and lockfile semantics.
- Letting the engine write companions directly was rejected because adapters own all storage paths and formats.
- Deleting the entire skill directory was rejected because it can remove unowned user files; deletion is based on recorded ownership instead.

### 5. The machine-local receipt, not the lockfile, records skill-file ownership

The version-controlled lockfile SHALL retain its existing `{scope, type, name}` asset tuples. Supplementary files SHALL NOT appear as lockfile assets and SHALL NOT require a lockfile-version bump.

The machine-local receipt SHALL replace its uniform asset record with a tagged union. Agent and command records retain scope, type, and name. A skill record additionally requires the complete set of owned installed paths, including its primary file and adapter-derivable companion paths. There is no optional `files` field whose presence implicitly decides the record kind.

On update, the installer SHALL pass the prior owned set and the new verified bundle to each adapter so stale companions are removed. On facet removal, it SHALL use the receipt alone to delete all owned skill files without cache or network access. Receipt path containment and project-identity checks remain mandatory. A legacy receipt containing only skill tuples SHALL be migrated conservatively: the primary skill file is known and removable, but unknown historical companions do not exist because legacy archives could not install them.

The install journal SHALL snapshot receipt changes and adapter operations so a failure restores the previous receipt and materialized state. Archive-only supplementary files SHALL remain in the verified archive/cache and parsed artifact but SHALL never enter the receipt.

**Alternatives considered:** putting companion paths in the lockfile was rejected because the lockfile records facet assets, not machine- and adapter-specific materialization ownership, and because doing so would make supplementary files look independently installable.

### 6. Rollout is consumer-first and documentation is part of the change

Rollout SHALL occur in this order:

1. Release version 1 verification and legacy `0.1` compatibility in every consumer, including the cafe registry, while producers still default to legacy output.
2. Release the adapter SDK major and updated first-party adapters, then update installation receipt migration.
3. Enable producer support for `facet.json.files` and version 1 archives.
4. Publish fixtures proving cross-implementation acceptance and rejection at both version boundaries.

The authoring and build documentation SHALL warn that older builders tolerate unknown manifest fields and can therefore ignore `files`; projects using supplementary files MUST pin or require a producer version that supports archive version 1. Registries that have not deployed version 1 support will reject those archives by design.

The following files MUST be updated together with implementation:

- `docs/specification/archive.mdx`
- `docs/specification/build.mdx`
- `docs/specification/manifest.mdx`
- `docs/specification/integrity.mdx`
- `docs/guides/create-your-first-facet.mdx`
- `docs/guides/install-facets.mdx`
- root `README.md`

`docs/specification/lockfile.mdx` MUST be reviewed and SHOULD explicitly state that companion ownership is receipt-only while lockfile asset tuples remain unchanged. This design does not require a lockfile schema change.

Rollback MAY disable production of version 1 archives, but consumers and the registry MUST retain version 1 verification once such archives have been published. Already-published version 1 artifacts cannot be made consumable by legacy clients without republishing an asset-only version.

## Risks / Trade-offs

- **[Old builders accept but ignore the new unknown `files` field]** → Documentation MUST declare the minimum supporting producer release, examples SHOULD pin it, and CI compatibility fixtures MUST prove that only supporting producers emit the declared files. This cannot be repaired retroactively in already-released tolerant parsers.
- **[Path aliases or crafted tar headers bypass membership checks]** → One canonical path validator and archive-plan derivation MUST be shared; verifier tests MUST cover traversal, absolute and drive paths, backslashes, duplicate headers, Unicode/case aliases, prefix collisions, symlinks, hard links, and undeclared entries.
- **[A failed skill update leaves a half-written directory]** → The adapter contract MUST require stage/commit/rollback behavior, and integration tests MUST inject failure at each write/delete step.
- **[Receipt corruption causes over-deletion]** → Receipts remain untrusted; project identity, adapter-root containment, and exact owned-path validation MUST precede deletion. Unowned paths MUST never be deleted.
- **[Arbitrary companion bytes increase memory or decompression pressure]** → Existing caller-supplied decompression limits SHALL apply to the complete archive, and registry/CLI policy MAY impose total-size, per-file-size, and entry-count limits without changing archive semantics.
- **[Two supported archive versions create implementation branches]** → Version dispatch MUST occur once at parsing, with immutable fixtures for both schemas and no fallback between them.
- **[Cafe accepts producer output before it can verify it]** → Producer enablement MUST remain gated until registry version 1 verification is deployed.
- **[Conditional legacy output surprises authors]** → Build output MUST display the emitted archive version and complete file listing.

## Migration Plan

1. Add canonical path, archive-plan, versioned build-manifest, and parsed-result types in the protocol package with legacy fixtures unchanged.
2. Add version 1 build and verification fixtures, including byte tampering and every path-security failure class.
3. Migrate engine build/load/cache code to consume the tagged parsed result without materializing archive-only files.
4. Release the adapter SDK major, migrate first-party adapters, and add atomic skill-bundle contract tests.
5. Migrate receipt loading/writing and exercise install, update, removal, rollback, frozen install, offline removal, and pulled-lockfile drift scenarios with multi-file skills.
6. Deploy cafe verification for both archive versions before enabling publication of version 1 artifacts.
7. Update all listed documentation and enable producer support.

Rollback SHALL stop new version 1 production and restore the prior adapter package only before multi-file skills are installed. After version 1 publication or materialization, verifier support and receipt-aware deletion MUST remain available even if authoring support is temporarily disabled.

## Open Questions

None. Policy limits for archive size and entry count remain consumer configuration rather than protocol-format decisions.
