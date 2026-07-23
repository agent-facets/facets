## Context

The facet pipeline enforces one file per asset end to end. Build collects only `facet.json` plus conventional asset paths (`collectArchiveEntries`, `packages/protocol/src/build/content-hash.ts`); archive verification rejects every other inner-tar entry at Step 6b outer-exclusivity (`packages/protocol/src/integrity/validate-archive.ts`); the adapter contract carries exactly one content string per asset (`installAsset(scope, type, name, content, metadata)`, `packages/adapter/src/types.ts`); and the machine-local receipt records only `(scope, type, name)` asset tuples (`packages/engine/src/install/receipt.ts`).

The reconciled proposal introduces **supplementary files**: manifest-declared non-asset files that ship in the archive, are integrity-protected like everything else, and — only when they live inside a skill's directory — materialize atomically with that skill. Files elsewhere (root-level `README.md`, `LICENSE`, extras near agents/commands) ship but never touch disk at install time.

Constraints inherited from the proposal:

- Every archive entry MUST be derivable from an explicit declaration in the embedded `facet.json` (the outer-exclusivity trust root). No auto-discovery.
- Supplementary files MUST NOT become independently addressable assets (no asset type, adapter metadata, install scope, or lockfile asset tuples).
- The change is **BREAKING** at the archive-format level and MUST have an explicit version boundary; legacy asset-only archives MUST remain valid.

A single principle organizes this design: **the embedded `facet.json` is the sole source of truth for archive membership and entry classification.** The build manifest records hashes, never a second description of which paths are assets or supplementary files. Every stage — build collection, hashing, verification, parsing, installation — derives membership and classification from the manifest through one shared operation (D3), so the classifications cannot drift apart.

## Goals / Non-Goals

**Goals:**

- Define the manifest declaration shape, archive/build-manifest representation, verification rules, materialization boundary, and adapter contract for supplementary files.
- One shared derivation of the archive-entry set, consumed by build and verification alike — no duplicated allowlist logic.
- Preserve deterministic output within each archive format. Every build produced after the format transition MUST emit canonical `facetVersion: 0.2` output; consumers MUST continue accepting valid legacy `0.1` archives during the compatibility window.
- Make lockfile `0.2` the adapter-agnostic source of truth for every materialized logical file and its canonical per-file integrity, while the machine-local receipt records what this machine owns for rollback and offline removal.
- Make illegal states unrepresentable at the security- and data-loss-critical boundaries (adapter operations, receipt records, parsed archive results) via tagged unions, not optional fields plus prose invariants.

**Non-Goals:**

- No `facet info` command or README rendering (future capability; this change only makes the bytes available).
- No companion-directory semantics for agents or commands.
- No filesystem metadata preservation (exec bits, symlinks, hard links, timestamps, ownership) for supplementary files.
- No glob/pattern declaration in v1 (see D2).
- No registry-side (cafe) implementation — sequencing is a hard constraint in the Migration Plan, but the code is out of this repo.

## Decisions

### D1: Declaration shape — per-skill `files` plus top-level `files`

The facet manifest gains two declaration sites, each owning a disjoint region of the tree:

- **`SkillDescriptor.files?: string[]`** — companion files for one skill, as paths **relative to the skill directory** (e.g. `references/art.md` resolves to `skills/cowsay/references/art.md`). These are the only supplementary files that materialize, and they install/remove atomically with their owning skill.
- **Top-level `files?: string[]`** — repo-relative paths for everything else (`README.md`, `LICENSE`, `agents/notes.md`, `ideas.txt`). Shipped and hashed, never materialized. Top-level entries MUST NOT resolve under `skills/` — skill companions have exactly one declaration site.

Rationale: ownership (which skill do these files belong to?) is the load-bearing semantic — it drives materialization, atomic lifecycle, and receipt bookkeeping. Giving each tree region exactly one declaration site makes ownership unambiguous at the point of declaration. The lists themselves are unrestricted strings, so disjointness, path safety, declared-skill membership, and collision freedom are enforced as schema-narrowing constraints by the shared archive-plan operation (D3) — the schema shape makes ownership *unambiguous*, and the validator makes it *checked*; neither claim substitutes for the other.

*Alternative considered:* a single top-level `files` list with ownership derived by `skills/<name>/` path prefix. Rejected: one declaration site is simpler, but ownership becomes an inferred invariant instead of a declaration-site fact, and a path under `skills/<undeclared>/` needs a bespoke validation rule instead of failing the obvious "companion declared on a skill that exists" check.

### D2: Explicit per-file enumeration; no globs

Both `files` lists enumerate exact paths. The embedded `facet.json` is the trust root for outer exclusivity; a glob (`skills/cowsay/**`) in the embedded manifest would let an attacker add undeclared files to a materialized skill directory while still "deriving" from the manifest — precisely the supply-chain hole Step 6b exists to close. Authoring ergonomics are addressed by the edit flow (D11), not by the artifact format.

*Alternative considered:* glob expansion at build time (source manifest has globs, embedded manifest gets exact paths). Rejected for v1: the archive currently embeds the source `facet.json` verbatim (its per-file hash equals the source file's), and rewriting it at build breaks that property. MAY be revisited as a pure authoring convenience later.

### D3: One shared archive-plan derivation

The protocol package SHALL expose a single pure operation that validates both declaration sites (per D7's grammar) and derives a **tagged archive plan**: every planned entry is classified as exactly one of `manifest`, `primary-asset`, `skill-companion` (carrying its owning skill), or `archive-only`. Build collection, per-entry hashing, archive verification, the parsed archive result, and installation MUST all consume this one operation. No stage maintains its own membership or classification logic.

Rationale: today's outer-exclusivity check and `collectArchiveEntries` already construct membership independently — the exact duplicated-allowlist drift this change would otherwise multiply across four more call sites. Membership is a security boundary; it gets one implementation.

*Alternative considered:* separate build-side and verify-side derivations (the status quo, extended). Rejected: duplicated membership logic at a trust boundary is how producers and verifiers drift into accepting different sets.

### D4: Build manifest — unconditional 0.2 output; strict version dispatch; pre-1.0 minor releases

Every build produced by the final CLI release SHALL emit `facetVersion: 0.2`, whether or not the facet declares supplementary files. Asset-only facets therefore use the same current format as facets with supplementary files. Producers SHALL NOT conditionally emit `0.1`; `0.1` remains a legacy input format supported by consumers during a compatibility window and MAY be deprecated by a separate future change. "By the final CLI release" distinguishes source implementation from publication: the complete producer may be implemented, tested, and merged while the released CLI still emits `0.1`, because no `agent-facets` Changeset is merged during that preparation window. A protocol-only consumer release and the registry deployment precede the held CLI release gate; withholding that release is the activation mechanism, not a runtime dual-format flag.

The `0.2` build manifest SHALL replace the `assets` map with a single `files` map: canonical inner-tar path → `sha256:<hex>`, covering every entry — `facet.json`, primary asset files, and supplementary files. The map carries hashes only. Asset/supplementary classification is NEVER read from the build manifest; it is derived from the embedded `facet.json` via the archive plan (D3). The completeness rule is single: the `files` key set MUST exactly equal the observed inner-tar entry set.

Verifiers SHALL dispatch on `facetVersion` exactly once, at parse time: the exact legacy schema and rules apply to `0.1`; the rules above apply to `0.2`; any other version returns a structured `UNSUPPORTED_FACET_VERSION` failure carrying the observed version and supported versions. A malformed `0.2` manifest MUST NOT be reinterpreted as `0.1` — no fallback between versions. A `files` key in a `0.1` manifest (or an `assets` key in `0.2`) fails schema validation, making the illegal combinations unrepresentable in validated data.

The CLI SHALL render unsupported-version failures as upgrade guidance. For a known format transition, one CLI-side compatibility table SHALL map the facet format to the minimum supporting CLI release, producing guidance such as: “This facet uses archive format 0.2, which this CLI does not support. Update agent-facets to <minimum version> or later.” For an unknown future format, the CLI SHALL advise updating to the latest release without inventing a minimum version. Already-released CLIs cannot be retrofitted and MAY continue showing their existing generic validation error. The final CLI release includes both the consumer rendering and producer switch after the protocol package and registry are already ready; a separately published bridge CLI is optional rather than a prerequisite.

This archive-format boundary is distinct from package release versioning. While `@agent-facets/protocol` and `@agent-facets/adapter` remain pre-1.0, breaking contract changes SHALL increment each package's minor version rather than its major version. This change therefore ships in the next minor release of each package. The permanent protocol release policy SHALL be updated by this change to encode the pre-1.0 rule; after 1.0, breaking changes SHALL require a major release.

*Alternatives considered:* conditional `0.1`/`0.2` producer output (rejected: creates two current producer modes and prolongs ambiguity about which format a newly built facet uses; the user-facing rule is simpler when all new output is `0.2`); parallel `assets` + `files` maps (rejected: duplicates classification already derivable from the embedded manifest and violates the single-source-of-truth principle); dropping `0.1` verification immediately (rejected: existing published facets remain valid and require a compatibility window); package major releases (rejected: project policy uses minor releases for breaking changes while packages remain pre-1.0).

### D5: Verification — raw-header validation, exact set equality, fail-closed

Verification of a `0.2` archive SHALL:

1. Validate raw tar entries **before** constructing any path-keyed map (a lossy map silently collapses duplicate paths — a smuggling vector). Duplicate paths, non-regular entries (symlinks, hard links, directories, devices), and unsafe or non-canonical paths (per D7) are each structured rejections. The same raw validation applies to the **outer** container before either required entry is selected: duplicate, portable-alias, or non-regular outer entries are rejected rather than letting parser-dependent collapse decide which `build-manifest.json` or `archive.tar.gz` is authoritative. JSON artifacts consumed during verification (the build manifest and the embedded `facet.json`) SHALL reject duplicate object member names before schema validation — `JSON.parse`'s last-key-wins behavior would otherwise let two parsers see different hash maps in one document.
2. Validate the embedded `facet.json` and derive the expected entry set via the archive plan (D3) — never from the build manifest.
3. Compare expected and observed canonical path sets for **exact equality** (undeclared extra entries and declared-but-missing entries are both rejections, as today).
4. Require exactly one `files` hash per expected path and no hash for any other path, then byte-verify every entry against its hash.

Every expected failure mode SHALL remain a structured result variant — no thrown errors escape the verification contract. Older verifiers fail closed on `0.2` archives (unknown entries → outer-exclusivity rejection), which is the correct security posture for a consumer that cannot enforce the new rules.

### D6: Supplementary files are opaque bytes; parsed results are tagged

Supplementary content is read, hashed, archived, and written **verbatim**: no front-matter merge, no line-ending normalization, no empty-content rule, binary permitted. `ArchiveEntry.content` widens to `string | Uint8Array` (hashing and `nanotar` already accept bytes).

`string | Uint8Array` alone does not encode which content is prompt text and which is opaque, so the successful parsed/verified archive result SHALL carry entries as **tagged data**: primary assets, skill companions grouped by owning skill, and archive-only supplementary bytes are distinct variants (mirroring the D3 plan). Text decoding and front-matter reconciliation apply only after narrowing to a primary asset; supplementary data stays bytes end to end. Classification via optional fields whose combinations can disagree is prohibited.

### D7: Path validation grammar

At build (inside the D3 operation) and at archive verification, every declared supplementary path MUST satisfy:

- non-empty, relative, and already canonical: no empty, `.`, or `..` segments; no backslashes; no NUL bytes; no absolute-path, drive, or URL-like prefixes;
- **portable across supported filesystems**: no control bytes (0x00–0x1F) or the characters `<`, `>`, `:`, `"`, `|`, `?`, `*` in any segment; no segment equal (case-insensitively, with or without an extension) to a Windows-reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`); no segment ending in a dot or a space — otherwise an archive valid on Linux fails only at materialization on a supported Windows client;
- **regular files only** at build time: the declared path MUST resolve through existing parents to a regular file inside the facet root — symlinks and hard links are rejected (resolved source identity is checked, not just spelling);
- the exact root path `facet.json` is excluded because it is the authoritative embedded manifest; the basename `facet.json` MAY appear at any other path (for example, `skills/example/examples/facet.json`);
- supplementary entries MUST NOT collide with any conventional primary asset path derived from the manifest; names owned only by the outer archive, including `build-manifest.json` and `archive.tar.gz`, MAY appear as supplementary inner-archive paths;
- site rules: top-level entries MUST NOT resolve under `skills/`; per-skill entries MUST NOT be `SKILL.md` and MUST resolve below their skill's directory;
- collision-free across the whole planned entry set, where collision includes: exact spelling, canonical Unicode form (NFC/NFD aliases), portable case folding (case-insensitive filesystems), resolved source identity, and file/directory prefix conflicts (`foo` as a file vs. `foo/bar`).

Missing declared files fail the build with structured errors, and **all source inputs SHALL be validated before any `dist/` cleanup runs** — a declared input must never be destroyed before its missing-file error can be reported. Each failure class above maps to a distinct structured `ValidationError`, and the test suite SHALL carry a matrix with at least one case per class (traversal, absolute/drive paths, backslashes, NUL, empty/`.` segments, Unicode/case aliases, Windows-reserved names and trailing dot/space, forbidden portable characters, prefix collisions, symlinks, hard links, duplicates, exact-root-`facet.json` collisions, conventional-primary-path collisions, undeclared entries, missing declarations, tampered bytes).

### D8: Adapter contract — tagged asset payloads, atomic skill bundles (BREAKING)

The adapter SDK's install, read, and delete requests/results SHALL become **tagged unions keyed by asset type**:

- the **skill** variant carries the `SKILL.md` text plus a canonical map of companion paths (relative to the skill root) to bytes — an empty map is legal and is how a companion-less skill is expressed;
- **agent** and **command** variants carry their existing single content string and structurally cannot carry companions;
- no variant exists for supplementary files (they never reach adapters — D12).

Ownership is **engine-supplied, per operation**: adapters never persist ownership metadata or infer it from disk. A skill install request carries the new bundle plus the engine-verified set of previously-owned companion paths (from the lockfile/receipt), so replacement removes exactly the owned paths absent from the new bundle. A skill delete request carries the engine-verified owned companion path set; only those paths (plus the primary) are deleted. A skill read request carries the owned companion path set to return, so reads cannot sweep user files into ownership. Agent and command variants structurally carry no ownership sets. Every engine-supplied companion path — new or previously owned — SHALL be validated as relative, canonical, and confined below the resolved skill root **before any filesystem access**, in all three operations; a malformed or escaping path rejects the whole request.

*Alternative considered:* adapter-managed ownership metadata (a manifest file inside the skill directory). Rejected: it duplicates ownership state the engine already owns, turns adapter storage into a trusted input, and breaks the D10 rule that the receipt mirrors the lockfile as the single ownership record.

This replaces the earlier optional-parameter shape (`companions?` beside `assetType`), which represented illegal combinations (an agent with companions; a skill call silently omitting its bundle) and policed them only by prose. Tagged variants give implementations an exhaustive branch.

**Adapter API identifier: `0.0` → `0.1` (hard cutover, no bridge).** The `adapter__sdk` spec binds identifier `0.0` to "the current positional method contract." Replacing that contract with the tagged unions above is exactly the event that identifier is designed to signal, so the SDK's canonical `ADAPTER_API_VERSION` SHALL advance from `0.0` to `0.1`. That constant is the single source of truth: `SUPPORTED_ADAPTER_APIS` SHALL continue to derive from it (yielding a `{0.1}` support set), first-party adapters SHALL derive their package/runtime declaration from it, and no consumer SHALL hardcode the token. The compatibility machinery classifies by exact-identifier equality and cannot inspect method signatures, so a `0.0`-declaring adapter built against the tagged contract and one built against the positional contract are indistinguishable to the verifier — leaving the identifier at `0.0` would let a positional adapter and a tagged CLI both classify as `supported` yet be wire-incompatible, the precise silent-incompatibility failure the identifier exists to prevent. A `0.0` adapter therefore SHALL be well-formed but unsupported by a `0.1` CLI and SHALL fail closed before any contract method or state write, surfacing the existing reinstall diagnostic.

*Alternatives considered:* a dual `{0.0, 0.1}` support window with runtime dispatch between positional and tagged calls (rejected: it requires the CLI to carry and translate both call shapes indefinitely, and the verifier cannot tell which shape a `0.0` bundle actually implements, so the "support" would be unsound; a single-token cutover with fail-closed `0.0` and explicit reinstall is simpler and safe); leaving the identifier at `0.0` and relying on package semver (rejected: `adapter__sdk` forbids inferring the API identifier from package versions, and semver cannot gate the wire contract). The adapter API axis is independent of the archive `facetVersion` and lockfile/receipt versions; a consumer classifies each separately.

A skill install SHALL be **one adapter operation with all-or-nothing semantics**: stage the complete replacement bundle, remove previously-owned companion paths absent from the new bundle, and commit — or roll back leaving no partial bundle. Skill deletion likewise removes the primary file plus all recorded owned companions as one operation, never touching unowned files. Expected failures are structured result values. These atomicity guarantees cover **handled failures within a running operation** (staged writes plus journal-driven rollback); they are not a durable write-ahead log. Recovery from a process crash mid-operation is defined as **idempotent re-install convergence**: re-running install compares every locked per-file integrity against disk and repairs or completes the bundle, so a crash can leave at most a state the next run converges from — never a state that deletes unowned files.

The SDK's filesystem helpers SHALL centralize the security-sensitive machinery — companion-path containment within the resolved skill root, staging, commit/rollback, owned-path removal, empty-directory pruning — so adapters built on the helpers (including `claude-code`) inherit correct behavior. Custom-I/O adapters MUST satisfy the same observable contract. Integration tests SHALL inject failures at every write/delete/commit boundary. Front-matter reconciliation applies only to the primary file; companion bytes are written verbatim.

Engine's skip-if-identical logic extends per-companion: unchanged companions are skipped; changed ones are journaled with previous bytes for rollback.

*Alternatives considered:* optional `companions?` parameters (rejected: optional-fields-as-discriminator, see above); separate per-companion install/delete methods (rejected: multiplies journal entries and failure surfaces, and permits a partially-companioned skill between calls); engine writing companions directly (rejected: adapters own all storage paths and formats); deleting the whole skill directory (rejected: destroys unowned user files — deletion is ownership-based).

### D9: Asset names follow Agent Skills, remain single-segment, and share defined namespaces

The canonical `0.2` asset-name grammar SHALL follow the Agent Skills `name` field convention: https://agentskills.io/specification#name-field. Facets normatively interprets the specification's enumerated character ranges as ASCII: an asset name MUST contain 1–64 lowercase ASCII letters (`a-z`), digits (`0-9`), or hyphens; MUST NOT start or end with a hyphen; and MUST NOT contain consecutive hyphens. `/` is invalid in every asset name.

Facets SHALL apply this same grammar to skills, commands, and agents. Applying the Agent Skills grammar to commands and agents is a Facets extension that gives all asset types one naming convention and one protocol validator. Protocol schemas, validator comments, generated schema documentation, and user-facing naming documentation MUST link to the Agent Skills `name` field as the external convention being implemented while stating Facets' normative ASCII interpretation.

A skill named `review` is represented by the top-level directory `skills/review/`, whose required primary file is `skills/review/SKILL.md`. The manifest skill name, installed directory name, and materialized `SKILL.md` name metadata MUST agree. Declared companion paths beneath that root MAY contain directories of arbitrary safe depth, such as `scripts/run.ts`, `references/api.md`, or `assets/logo.png`; those path separators are not part of the skill name. A command named `review` is represented by `commands/review.md`, and an agent named `review` by `agents/review.md`.

Skills and commands SHALL occupy one logical namespace: the skill-name and command-name sets MUST be disjoint. A facet declaring both skill `review` and command `review` fails with a structured collision error identifying `skills.review` and `commands.review`. Agents remain in a separate namespace and MAY share a name with a skill or command.

The single-segment grammar and shared namespace SHALL be validated before archive planning, adapter selection, or filesystem writes. Local `0.2` builds and `0.2` archive verification MUST consume the same protocol validation. Legacy `0.1` verification SHALL retain the previous multi-segment and cross-type-collision rules so existing archives remain consumable; there is no fallback from an invalid `0.2` manifest to the `0.1` grammar.

`parseAssetNameSegment` becomes the canonical current-format asset-name parser. Multi-segment parsing remains isolated to the legacy `0.1` verifier and MUST NOT appear in current manifest types or authoring APIs. Internally composed or slash-namespaced assets are not part of the `0.2` model; any future composition design must preserve single-segment asset identities rather than encoding hierarchy into names.

*Alternatives considered:* retaining slash-separated internal names (rejected: conflates asset identity with filesystem hierarchy and contradicts the one-directory/one-file source model); using a Facets-only naming grammar without citing Agent Skills (rejected: loses the shared ecosystem convention even though the effective constraints align); interpreting “Unicode lowercase alphanumeric” beyond the specification's explicit `a-z` and `0-9` ranges (rejected: Unicode category and normalization behavior would make portable validation weaker and less deterministic); validating skill/command collisions only after adapter selection (rejected: facet validity would vary by adapter); putting agents in the shared namespace (rejected: agents do not occupy the skill/command invocation namespace).

### D10: Lockfile 0.2 pins every materialized file; receipt mirrors machine ownership

`facets.lock` SHALL use `lockfileVersion: 0.2` for the current alpha schema. Version dispatch MUST use exact equality, never numeric ordering: legacy numeric `1` identifies the previous alpha schema, while numeric `0.2` identifies this schema. `FACET_ARCHIVE_VERSION` and `LOCKFILE_VERSION` SHALL remain separate constants that both currently equal `0.2`; their equality is release alignment, not a permanent invariant, because archive and resolution formats may evolve independently.

Every lockfile asset entry SHALL contain its adapter-agnostic identity (`scope`, `type`, `name`) plus a required, deterministically sorted `files` array. Each file record SHALL be `{ path, integrity }`, where `path` is the canonical inner-archive path and `integrity` is the `sha256:<hex>` hash of that archive entry's exact canonical bytes.

- A skill entry's `files` SHALL contain `skills/<name>/SKILL.md` plus every declared companion beneath `skills/<name>/`.
- An agent entry's `files` SHALL contain exactly `agents/<name>.md`.
- A command entry's `files` SHALL contain exactly `commands/<name>.md`.
- Archive-only supplementary entries, including root `README.md`, SHALL NOT appear in `assets[].files` because they are not materialized; the facet-level integrity continues to pin them.
- Companion files remain subordinate file-integrity records inside their owning skill entry. They SHALL NOT become independent assets, acquire scopes, or receive standalone asset tuples.

The lock writer SHALL derive `assets[].files` from the verified D3 archive plan's materialized subset. For every included path, it SHALL persist the recomputed hash that has already been reconciled with the 0.2 build manifest's `files` map; it MUST NOT trust or blindly copy a self-declared build-manifest value.

Before any materialization, install SHALL require exact agreement among:

1. the lockfile facet-level integrity and the recomputed archive integrity;
2. the lockfile asset identities and the verified materialization plan;
3. every lockfile asset's complete file path set and the files owned by that planned asset;
4. every lockfile per-file integrity, the recomputed archive-entry hash, and the corresponding verified build-manifest hash.

Any disagreement SHALL return structured failure data containing the facet, asset, canonical path, expected integrity, and actual integrity when available. Frozen mode SHALL fail without rewriting. Normal resolution MAY write a new lock entry only after all checks against the newly resolved artifact succeed.

Drift checking SHALL operate per locked file. Verbatim companion files are hashed directly from disk. For primary files whose adapter representation differs from archive bytes, the adapter `readAsset` contract SHALL return canonical logical content so the engine can compare the corresponding locked canonical integrity without encoding adapter-specific bytes in `facets.lock`. Because archived primary files contain no YAML front matter (the manifest is the metadata source of truth), the canonical logical content of an undrifted primary equals its archive bytes — adapter-added storage encoding is stripped by `readAsset`, so the locked hash is reproducible offline. Reports SHALL identify the exact locked path that drifted.

The machine-local receipt SHALL mirror the successfully committed lockfile asset/file ownership set so offline removal and rollback remain exact even after a pulled lockfile drops an entry. Receipt-driven removal supplies that validated ownership set to the adapter delete request (D8), so offline cleanup after a pulled lockfile drops an entry deletes exactly the recorded owned files. The receipt remains adapter-agnostic and stores no adapter-encoded hashes. Receipt and lockfile changes SHALL commit in the same install transaction as materialization; rollback restores all three. Receipts remain untrusted input: identity, path containment, and file-integrity record validation MUST precede deletion, and unowned paths MUST never be deleted. The receipt schema version SHALL become `0.2`; legacy receipt version `1` MAY be refined to primary-only file sets because the legacy system could not install companions.

A current loader SHALL recognize legacy numeric lockfile version `1` only as the previous alpha schema. Normal install MAY migrate a verified legacy lockfile to `0.2`; frozen legacy installs retain legacy behavior and do not rewrite. A `0.2` archive requires a `0.2` lockfile. When the stable lockfile v1 schema is eventually released, support for legacy-alpha numeric `1` SHALL be removed rather than reinterpreted or shape-sniffed: an old alpha lockfile SHALL fail with an actionable instruction to delete and regenerate it. The future stable v1 schema then owns numeric `1` exclusively.

*Alternatives considered:* facet-level integrity alone (rejected: cryptographically protects the archive but cannot directly attribute drift to one materialized file); companion paths without per-file hashes (rejected: records ownership but not file-level integrity); adapter-encoded hashes in the lockfile (rejected: makes a portable facet resolution vary by adapter and machine); independent companion asset tuples (rejected: companions have no independent identity or scope); permanently coupling lockfile and archive version constants (rejected: they describe different artifacts and will eventually diverge); preserving legacy numeric `1` after stable v1 launches (rejected: one version identifier cannot safely select two schemas).

### D11: `README.md` is first-class in create and edit; extensionless `README` is supported

`README.md` SHALL be the preferred conventional facet document. `facet create` SHALL generate `README.md` by default in both interactive and headless invocations: a flag-driven headless create writes the same seeded, declared `README.md` unless the author passes an explicit opt-out flag, so the two entry points never produce different manifests by default. The exact extensionless path `README` SHALL also be recognized as a first-class README by `facet edit` and the build/manifest workflow. Both remain normal top-level supplementary-file declarations in `facet.json.files`; the manifest SHALL NOT gain a README-specific field or duplicate source of truth.

The interactive `facet create` wizard SHALL include a dedicated README step or card, separate from asset management. README SHALL be enabled by default but optional. The wizard SHALL seed editable `README.md` content from the facet name and description, allow the author to open and edit that content before confirmation, and allow the author to disable README creation. The confirmation preview SHALL list `README.md` explicitly. On apply, the wizard SHALL atomically write `README.md` and add its exact path to top-level `files`. The generated template is an initial value only; later identity edits MUST NOT silently regenerate or overwrite authored README content.

The `facet edit` wizard SHALL show the exact root paths `README.md` and `README` in a dedicated facet-level README panel rather than generic supplementary-file reconciliation. For each recognized path, behavior depends on its current state:

- present and declared: offer Edit or Remove;
- present but undeclared: offer Adopt or Edit-and-Adopt;
- declared but missing: offer Scaffold at that same path or Remove Declaration;
- absent and undeclared: offer Create, defaulting to `README.md`.

If both `README.md` and `README` exist, the dedicated panel SHALL show both independently; neither file is silently ignored or overwritten. Adopt SHALL preserve existing bytes unless the author explicitly edits them. Remove SHALL queue both file deletion and declaration removal. Scaffold/Create SHALL queue the file write and declaration addition. All README operations remain transactional: no file or manifest change occurs until the existing Apply confirmation, and the confirmation summary SHALL identify the exact README path and operation.

`facet edit`'s generic scanner SHALL still detect undeclared files inside declared skill directories and offer to add them to that skill's `files`. It SHOULD detect other common root-level supplementary files such as `LICENSE`, but `README.md` and `README` SHALL be routed only through the dedicated README panel so they do not appear twice.

For any declared supplementary file other than `README.md` or `README` that has vanished from disk, edit SHALL offer scaffold-or-remove, mirroring the existing missing-asset flow.

*Alternatives considered:* always requiring README (rejected: first-class does not mean mandatory); generating extensionless `README` by default (rejected: `README.md` is the preferred authored format); adding a README-specific manifest field (rejected: duplicates top-level `files` membership); silently regenerating README after identity edits (rejected: destroys authored documentation); treating README only as a generic discovered file (rejected: misses the intended first-class authoring experience).

### D12: Materialization boundary is engine logic, not adapter logic

Engine passes companions only inside skill-variant payloads (D8); archive-only supplementary files never reach `materialize`. Adapters never see non-skill supplementary files, so the "ships but does not materialize" rule cannot be violated by an adapter bug — the data simply isn't handed over.

### D13: Adapter-compatibility preflight precedes archive dispatch and materialization

The `installation` spec's "Facet operations require compatible selected adapters before mutation" gate runs *before* archive-version dispatch (D4), per-file integrity reconciliation (D5/D10), the tagged skill-bundle contract (D8), and any project or materialized-state write. A selected adapter declaring the positional `0.0` API is unsupported by a `0.1` CLI and SHALL cause the operation to fail at this preflight — before the archive is even parsed for `facetVersion` — with the reinstall diagnostic. Ordering the adapter-API check ahead of the archive-format check keeps the two version axes independent: a `0.2` archive with an incompatible `0.0` adapter fails on the adapter, not the archive, and the user is told to reinstall the adapter rather than shown an archive-format message. This ordering is stated once here and referenced by the `installation` delta rather than duplicated per requirement.

*Alternative considered:* checking archive format first (rejected: it would surface an archive-upgrade message when the real, blocking problem is an incompatible adapter, and would parse untrusted archive bytes before confirming the adapter that will consume them is even loadable).

## Risks / Trade-offs

- **[Old builders silently ignore `files`]** — manifest validation tolerates unrecognized fields, so an old CLI builds a facet that *declares* supplementary files but *omits* the bytes, with no error. → Documentation MUST state the minimum producer version for `0.2`; examples SHOULD pin it; compatibility fixtures MUST prove which producer versions emit declared files. This hazard cannot be repaired retroactively in already-shipped tolerant parsers — docs and fixtures are the only lever.
- **[Path aliases or crafted tar headers bypass membership checks]** → One shared plan derivation (D3) + the D7 grammar + raw-header validation before lossy maps (D5); the per-failure-class test matrix is mandatory.
- **[A failed skill update leaves a half-written directory]** → Atomic stage/commit/rollback in the adapter contract (D8) with injected-failure tests at every write/delete/commit boundary.
- **[Receipt corruption causes over-deletion]** → Receipts are untrusted (D10): containment + project-identity checks precede deletion; unowned paths are never deleted.
- **[Lockfile growth from per-file integrity]** → Only materialized files are copied into `assets[].files`; archive-only metadata remains covered by facet integrity. File records are canonical and sorted for stable, reviewable diffs.
- **[Legacy alpha numeric `1` conflicts with future stable v1]** → Current releases explicitly classify it as legacy-alpha-1 and migrate to `0.2`; stable v1 removes that parser and emits an actionable delete-and-regenerate error for old-shape numeric-1 files.
- **[Adapter transformations obscure raw drift comparison]** → Lockfile hashes remain canonical and adapter-agnostic; `readAsset` must project installed primary content back into its canonical logical form. Adapter-specific bytes never enter version-controlled resolution state.
- **[Generated README content overwrites author edits]** → The template is applied only on explicit Create or Scaffold. Identity changes and ordinary edit sessions MUST preserve existing README bytes unless the author chooses to edit them.
- **[All newly built facets require a 0.2-capable consumer]** → Verification support SHALL deploy consumer-first, including cafe, before producer enablement. A bridge CLI SHOULD recognize `0.2` and render the D4 upgrade message; older pre-bridge CLIs may still show a generic validation failure. Immutable fixtures MUST prove that new consumers continue accepting valid `0.1` archives.
- **[Two supported archive versions create implementation branches]** → Version dispatch happens exactly once at parse time, with no cross-version fallback and immutable fixtures for both schemas (D4/D5). Removing `0.1` support requires a separate future deprecation change.
- **[Arbitrary companion bytes inflate archives / decompression pressure]** → Size/count limits are consumer and registry policy, not protocol format (see Open Questions closure); existing decompression handling applies to the whole archive.
- **[Unsupported format surprises installers]** → Build output SHALL display the emitted `facetVersion` and complete entry listing; install SHALL return a structured unsupported-version failure, and the CLI SHALL render actionable upgrade guidance from its single compatibility table.
- **[Third-party adapter breakage]** → SDK-helper adapters inherit companion support via the helpers; only custom-I/O adapters must implement the widened contract. The tagged unions make the migration mechanical and exhaustively checkable.
- **[A positional `0.0` adapter is silently accepted by a tagged CLI]** → The identifier bump to `0.1` (D8) makes the wire-contract change visible to exact-identifier compatibility; a `0.0` adapter is unsupported and fails closed before any contract method or state write. Fixtures MUST prove a positional `0.0` bundle is rejected by a `{0.1}` CLI.
- **[Old `0.0` adapters break at the CLI cutover]** → Staged release ordering: SDK and all three first-party adapters publish `0.1` before the held CLI-only Changeset is merged; existing `0.0` CLIs keep selecting compatible `0.0` releases. Recovery from a broken install is the reinstall command the compatibility diagnostic already surfaces.
- **[Two declaration sites could confuse authors]** → The disjointness rule (D1/D7) yields a precise error pointing at the correct site; edit-flow detection (D11) writes declarations to the right place automatically.
- **[Existing source manifests use slash-namespaced assets or duplicate skill/command names]** → Their published `0.1` archives remain consumable, but rebuilding as `0.2` fails with actionable validation errors before output is changed. Authors MUST rename the assets; invalid `0.2` manifests are never interpreted using legacy rules.

## Migration Plan

Consumer-first publication is controlled by package-specific Changesets. Source implementation may continue in parallel, but no released producer emits the new format until both consumer and adapter gates are proven.

1. **Protocol-only release (first handoff)**: merge the proposal, protocol-model, and archive-verification stack; adopt the pre-1.0 breaking-release policy; publish the D3 plan operation, D7 path grammar, D9 current-format asset-name grammar and shared namespace validation, D4 versioned build-manifest schemas with strict dispatch and structured unsupported-version results, D5 verification, D6 tagged parsed results, and D10 lockfile `0.2` schemas — plus immutable fixtures for both archive versions. Its pre-1.0 minor Changeset names only `@agent-facets/protocol`: no adapter package and no `agent-facets` CLI release is attached.
2. **Parallel registry lane (out of repo)**: after the protocol release is published, the cafe registry pins that npm version directly, migrates to the tagged verifier and complete file-hash view, proves `0.1` retention plus `0.2` acceptance, and deploys. It does not require a local facets checkout or a released `0.2` CLI. The deployed registry remains a hard gate for the final CLI release.
3. **Parallel facets source lane (unreleased)**: engine and CLI loaders, lockfile/receipt migration, per-file materialization, producer output, create/edit authoring, diagnostics, and documentation may be completed, reviewed, and merged while the registry lane proceeds. The candidate source emits `0.2` for tests and stage interoperability, but no `agent-facets` Changeset is merged, so released CLIs continue emitting `0.1`. There is no long-lived runtime flag or dual current-producer mode.
4. **Adapter SDK + first-party adapter release**: publish the tagged payload unions, atomic bundle helpers, and injected-failure coverage; bump `ADAPTER_API_VERSION` `0.0`→`0.1`; and publish claude-code, opencode, and codex with package/runtime API `0.1`. This Changeset names only the SDK and three adapters. Existing `0.0` CLIs keep selecting the highest compatible `0.0` releases; no CLI whose supported set is `{0.1}` ships until all three first-party adapters have published `0.1`.
5. **Held final CLI gate**: prepare a tiny, unmerged `agent-facets`-only Changeset PR after source implementation is complete. Before the user authorizes its merge, verify the published protocol API from a clean install, all three published adapter declarations, the deployed registry's dual-version behavior, the full repository suite, and a candidate CLI `0.2` build/publish/readback against stage. Merging the held Changeset and generated version-package PR is the sole public activation: every new build then emits archive `0.2`, lockfiles/receipts use `0.2`, materialization passes skill bundles, and create/edit ship the first-class README and supplementary-file flows.
6. **Documentation and release notes (Article III)**: complete documentation before the held CLI gate is authorized. Update `docs/specification/archive.mdx` (membership rules, single `files` hash map, version dispatch), `build.mdx` (plan derivation, validation-before-cleanup, displayed version), `manifest.mdx` (both `files` fields, minimum-producer-version warning, linked Agent Skills naming convention, single-segment asset names versus nested companion paths, shared skill/command namespace), `integrity.mdx` (all-entry and per-locked-file coverage), `lockfile.mdx` (lockfile `0.2`, per-materialized-file integrity, legacy-alpha-1 migration, stable-v1 regeneration boundary), `commit.mdx` (receipt ownership and transactional reconciliation), `install.mdx` (materialization boundary, atomic skill bundles, mismatch diagnostics), `docs/guides/create-your-first-facet.mdx` and `docs/guides/install-facets.mdx` (asset-only phrasing, README workflow), root `README.md`, and the protocol-only, adapter-only, and final CLI release notes without duplicating version sources.

Before the future stable lockfile v1 release, legacy-alpha-1 parsing SHALL be removed and replaced with actionable delete-and-regenerate guidance for old-shape numeric-1 files.

Rollback: before the held CLI Changeset is merged, public producer rollout is cancelled simply by leaving that release gate unmerged; the published protocol, deployed registry, and adapter releases remain backward-compatible consumer preparation. After a `0.2` artifact is published or a multi-file skill is materialized, producer emission MAY be paused, but consumers MUST retain `0.1` and `0.2` verification plus receipt-aware deletion. Removing `0.1` support requires a separately reviewed deprecation change. For the adapter API axis, rollback means restoring/reinstalling compatible adapter and CLI releases: because compatibility is exact-identifier and cannot be inferred from package semver, a `0.1` CLI cannot be made to accept a `0.0` adapter by changing versions — recovery is reinstalling a `0.1` adapter (or downgrading the CLI to a `0.0` release paired with `0.0` adapters), never a version bump alone.

## Open Questions

None remaining — the three raised during drafting are closed as decisions:

- Registry README presentation: out of scope (proposal non-goal); the all-entry `files` map makes it cheap for a future change.
- Archive size/entry-count limits: consumer and registry configuration policy, not protocol format, for this change.
- Edit behavior for vanished declared files: decided in D11 (scaffold-or-remove, mirroring the missing-asset flow).
