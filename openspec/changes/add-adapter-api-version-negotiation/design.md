## Context

Adapter bundles cross two durable boundaries: npm publication and `$FACET_DIR/adapters/` persistence. Today neither boundary carries a machine-readable adapter API identifier. `@agent-facets/adapter` exposes one unversioned `Adapter` shape, `defineAdapter()` returns that shape unchanged, npm installs resolve only the `/latest` document, installation writes one `adapter.js` directly over the live file, and runtime loading imports every discovered bundle without reusing installation verification. A stale or future bundle can therefore reach an adapter method before the CLI detects a call-contract mismatch.

The implementation spans the published Adapter SDK, first-party adapter packages, engine source resolution and placement, build and facet-install consumers, and CLI diagnostics. The design MUST preserve these constraints:

- The current positional method contract is adapter API `0.0`; its method signatures SHALL remain unchanged.
- Adapter API identifiers SHALL be exact contract tokens, not semantic-version compatibility ranges, and SHALL remain independent of CLI, SDK-package, adapter-package, and facet versions.
- The SDK SHALL remain a leaf package; npm selection, filesystem state, and CLI rendering SHALL remain in engine/CLI layers.
- Expected parse, resolution, verification, placement, and compatibility failures SHALL be represented by discriminated result values rather than escaping as exceptions.
- First-party and third-party adapters SHALL use the same metadata, verification, and loading path.
- Existing undeclared releases and installed bundles SHALL be incompatible with the new CLI; no permanent legacy-compatible state will be introduced.

## Goals / Non-Goals

**Goals:**

- Establish one canonical SDK-owned API `0.0` declaration and stamp it into every runtime adapter returned by `defineAdapter()`.
- Select the highest npm package version that satisfies both the user's package-version request and the CLI's exact adapter-API support set.
- Verify compatibility before activating a candidate bundle, whenever an installed bundle is loaded, and before any adapter method or facet materialization write can occur.
- Activate a verified replacement atomically while retaining source, resolved-package, API, and integrity provenance.
- Return structured failures that support actionable CLI errors and compatibility-aware `facet adapter list` output.
- Publish replacement first-party releases and align all affected user-facing documentation.

**Non-Goals:**

- This change SHALL NOT introduce adapter API `0.1` or alter the positional `0.0` method contract.
- This change SHALL NOT infer compatibility from CLI, SDK-package, or adapter-package semantic versions.
- This change SHALL NOT manipulate npm dist-tags, retain multiple active adapter versions, or auto-upgrade adapters during `facet install`.
- This change SHALL NOT add general npm-semver syntax. Adapter package selectors SHALL use the existing Facet grammar: exact `1.2.3`, major wildcard `1.*`, minor wildcard `1.2.*`, `*`, or `latest`.
- This change SHALL NOT add compatibility negotiation to facet archives or the facet registry protocol.

## Decisions

### 1. The SDK owns the canonical runtime declaration

`packages/adapter/` SHALL expose a canonical `ADAPTER_API_VERSION` constant with value `0.0`. The public runtime `Adapter` type SHALL contain a required, readonly `apiVersion` field whose value is stamped by `defineAdapter()`. The factory's input type SHALL exclude that field, so an author cannot provide a conflicting value in the definition object. First-party and third-party source code will continue to call `defineAdapter({...})` without repeating `0.0`.

An adapter API identifier SHALL use the canonical two-component decimal form `MAJOR.MINOR` with no sign, suffix, build metadata, or leading zeroes except the number zero itself. The engine SHALL distinguish missing, malformed, well-formed-but-unsupported, and supported declarations. Well-formed identifiers SHALL be compared only by exact string equality; numeric ordering SHALL have no compatibility meaning.

The engine SHALL define its support set from the SDK constant rather than duplicating the `0.0` literal. The initial support set is exactly `{ ADAPTER_API_VERSION }`. The canonical SDK version and the CLI support set remain separate concepts: a later change MAY make a CLI support multiple exact APIs without changing how the SDK selects the API stamped into newly built adapters.

**Alternative rejected:** inferring the adapter API from the SDK package version. Adapter packages bundle the SDK, npm manifests can omit the build-time SDK dependency, and SDK semver also covers non-contract changes; inference would couple independent version domains.

**Alternative rejected:** asking authors to set `apiVersion` in `defineAdapter()`. That creates two author-maintained declarations and permits source/runtime drift that the factory can prevent by construction.

### 2. npm package metadata uses a dedicated pre-download field

Published adapter package manifests SHALL advertise the contract through the top-level package field:

```json
{
  "facetAdapterApiVersion": "0.0"
}
```

The SDK SHALL export the metadata-field name alongside the canonical version so engine resolution and first-party release tooling do not duplicate string literals. First-party package manifests SHALL receive this field during the existing prepack transformation, derived from `ADAPTER_API_VERSION`; packed-tarball tests SHALL prove the field is present. Third-party publishers MUST declare the field in their published `package.json`, because npm metadata is required before their runtime bundle can be downloaded.

The npm declaration is a selection hint, not proof. The runtime declaration stamped into the loaded bundle SHALL remain authoritative. A missing or malformed runtime declaration, an unsupported runtime API, or disagreement between npm metadata and runtime export SHALL be a terminal verification failure. Compatibility failures SHALL NOT trigger the current “prebuilt failed, rebundle from source” fallback; fallback MAY continue only for loadability or bundling failures that do not contradict a declared contract.

**Alternative rejected:** inspecting dependency ranges or bundled source to infer the SDK version. Published adapters can inline the SDK and remove development dependencies, making either signal absent or misleading.

### 3. npm specifiers become a tagged package/version request

The adapter specifier parser SHALL preserve source intent with non-overlapping variants rather than optional version fields:

- npm package with an implicit selector (bare package or first-party alias);
- npm package with an exact version;
- npm package with an explicit Facet-style wildcard/`latest` selector;
- Git source; or
- local source.

Scoped npm names SHALL be split at the version delimiter after the package name, so `@scope/name` remains a bare package while `@scope/name@1.*` carries a selector. The existing Facet `VersionSpec` grammar and satisfaction predicate SHALL be reused as the single source of truth; caret, tilde, comparator, OR, hyphen, prerelease, and `x` ranges SHALL return structured parse failures with the supported forms. Explicit `latest` means “highest compatible published version” and SHALL NOT force use of npm's `latest` dist-tag.

The first-party adapter catalog SHALL become the source of truth for alias-to-package mapping as well as picker content; the parser SHALL derive aliases from it instead of maintaining a second literal map.

For non-exact npm requests, the resolver SHALL fetch the full package document, parse stable `MAJOR.MINOR.PATCH` entries, constrain them by the requested package selector, discard entries whose `facetAdapterApiVersion` is missing, malformed, or unsupported, and choose the highest remaining semantic package version. For an exact request, only that package version SHALL be considered; incompatibility SHALL fail instead of substituting another release. The resolved success value SHALL carry the exact package version, declared adapter API, tarball URL, and the registry's SRI or shasum anchor so download and provenance use the same selected record.

The resolver MUST request npm's full packument rather than the abbreviated `application/vnd.npm.install-v1+json` representation, because the abbreviated representation can omit custom per-version fields such as `facetAdapterApiVersion`.

When no compatible candidate exists, the failure SHALL carry the package, requested selector, CLI support set, and the newest considered release with its missing, malformed, or unsupported declaration. npm `latest` SHALL continue advancing normally and SHALL not participate in compatibility policy.

Git and local sources cannot be version-selected. They SHALL proceed directly to runtime verification and MUST declare a supported runtime API.

### 4. One verifier owns runtime shape and compatibility classification

`verifyAdapter` SHALL return a discriminated `VerifyAdapterResult` rather than throw for import, export-shape, name, API declaration, support-set, or metadata/runtime mismatch failures. Its success arm SHALL return a verified adapter and its supported API identifier. The verifier SHALL validate, in order:

1. the bundle can be imported;
2. it has a default object export;
3. the runtime API declaration is present and syntactically valid;
4. the declaration is in the CLI support set;
5. any expected npm API equals the runtime declaration; and
6. the `0.0` object has the required name and method shape.

This ordering classifies a contract mismatch before any adapter method is invoked. Importing an ESM bundle necessarily runs its top-level initialization; preventing arbitrary module initialization is outside this change, but no adapter contract method SHALL run until verification succeeds.

A shared pure compatibility classifier SHALL produce one failure union used by npm selection, candidate verification, installed loading, build preflight, and facet-install preflight. The union SHALL encode missing, malformed, unsupported, and metadata/runtime-mismatch states as separate variants, each carrying the adapter/package identity, the found declaration when one exists, and the supported API set. CLI renderers SHALL map these values to prose; engine code SHALL NOT construct user-facing message strings.

### 5. Managed installations use an atomic active-generation receipt

Managed adapters SHALL use this engine-owned layout:

```text
$FACET_DIR/adapters/<name>/
├── installation.json
└── generations/
    └── <generation-id>/
        └── adapter.js
```

`installation.json` is the atomic activation record. It SHALL contain a schema version, the active generation identifier, the verified adapter API, and a tagged source record:

- npm: original specifier, resolved package name/version, and the exact SRI or shasum used to verify the tarball;
- Git: original specifier, URL, and optional requested ref; or
- local: original specifier and resolved source path.

Package integrity is npm source provenance: an npm receipt SHALL retain the registry SRI or shasum that authenticated the selected package, including when extracted source is subsequently rebundled before placement. Git and local sources have no npm package-integrity field. This change SHALL NOT add a placed-bundle content hash because it defines no load-time byte-integrity contract that would consume one; runtime API verification remains authoritative for compatibility. A broader installed-bundle tamper-detection policy requires a separate threat model and change.

Source-specific fields SHALL live only on their tagged variant so impossible npm/Git/local combinations cannot be constructed. The generation identifier SHALL be validated as a single safe path segment, and every derived path SHALL be containment-checked before reading or deleting files.

Replacement SHALL proceed as follows:

1. resolve, download/build, and verify a candidate in temporary storage;
2. acquire a per-adapter replacement lock after the runtime name is known;
3. copy the verified bundle into a new unique generation on the same filesystem;
4. verify the generation from its final staged path;
5. atomically replace `installation.json` with a receipt pointing to the new generation; and
6. remove the previous generation and legacy direct bundle after activation.

Before step 5, the existing receipt and active generation remain untouched. Therefore any resolution, build, verification, staging, or receipt-write failure SHALL leave the existing installation active and byte-for-byte unchanged. A cleanup failure after the atomic receipt switch SHALL be reported as a warning, not as a failed installation that claims the old version remains active. Later placement/removal MAY clean inactive generations left by a crash.

Exactly one receipt generation is active. Transient staging and crash leftovers are not selectable installed versions and SHALL be ignored by loaders and listing.

An adapter manually copied to the historical direct path `<name>/adapter.js` has no managed provenance. The inspector SHALL classify it as an unmanaged installation and verify its runtime declaration directly. A newly copied `0.0` bundle MAY load; an existing undeclared bundle SHALL fail as missing its API. Reinstalling through the CLI converts the directory to the managed generation layout.

**Alternative rejected:** overwriting `adapter.js` and `installation.json` independently. Two renames cannot atomically switch the pair, and a failure between writes can associate a new bundle with stale provenance.

**Alternative rejected:** renaming one staged directory over a populated live directory. Portable filesystems do not provide a reliable replace-nonempty-directory operation, and a two-directory swap creates crash windows. An atomic receipt pointer makes activation a single-file rename.

### 6. Inspection is shared; consumers fail closed

Installed-adapter inspection SHALL be the single path used by loading and `facet adapter list`. Each directory SHALL produce one tagged outcome:

- compatible, with a verified adapter and supported API;
- incompatible, with a structured compatibility failure and repair source; or
- broken, with a structured receipt/import/shape failure.

For managed installations, inspection SHALL validate `installation.json`, reject an unsupported recorded API before import, import the uniquely named active generation, and compare the runtime declaration with the receipt. Unique generation paths also prevent dynamic-import caching from returning a bundle that was replaced earlier in the same process. For unmanaged direct bundles, inspection SHALL import and verify the bundle without inventing provenance.

`loadInstalledAdapters` SHALL return a result value. If any installed adapter is incompatible or broken, loading SHALL fail with all collected failures instead of warning and silently skipping it. This prevents an incompatible-but-present adapter from being misreported as “no adapters installed” or as an unknown metadata schema.

The command gates SHALL be:

- `facet build` and publish-build SHALL stop before `runBuildPipeline` when inspection fails.
- `facet add`, `facet remove`, and `facet install` SHALL stop before invoking `runInstall` when inspection fails; they SHALL NOT launch the zero-adapter picker for this state.
- `runBuildPipeline` and `runInstall` SHALL retain a defense-in-depth API preflight before any adapter method. Build failure data SHALL distinguish adapter incompatibility from content validation. `RunInstallFailure` SHALL add an `ADAPTER_INCOMPATIBLE` variant and route it through the existing no-mutation path before the per-facet loop, which also precedes Git/local facet builds that invoke adapter metadata methods.
- Materialization MAY retain an in-loop compatibility assertion as an invariant check, but it SHALL NOT be the primary gate.
- `facet adapter remove` SHALL continue to remove the whole adapter directory without loading it.

`facet adapter list` SHALL inspect every entry and display its API as `0.0`, `missing`, or `malformed`, plus `supported`, `unsupported`, or `broken` compatibility status. Listing SHALL remain available when entries are incompatible so it can guide recovery.

Compatibility failures SHALL carry a repair discriminator. Managed installations use the recorded original specifier to render `facet adapter install <specifier>`. Unmanaged first-party names use the canonical alias. Other unmanaged entries use the directory/runtime name as the best available specifier and explicitly report that original source provenance is unavailable.

### 7. Documentation follows the observable contract

The implementation SHALL update:

- `docs/cli/adapters/install.mdx` for package selectors, highest-compatible resolution, incompatibility failures, atomic replacement, and the managed layout;
- `docs/cli/adapters/list.mdx` for API and compatibility status output;
- `docs/guides/custom-adapters.mdx` for SDK stamping, `facetAdapterApiVersion`, publishing, and rebuilding/reinstalling adapters;
- `docs/guides/troubleshooting.mdx` for missing, malformed, unsupported, and metadata/runtime-mismatch recovery;
- `docs/specification/install.mdx` and `docs/specification/commit.mdx` for the compatibility gate before the per-facet loop and materialization;
- `docs/specification/build.mdx` for failure on an incompatible installed adapter before metadata validation;
- `docs/cli/env.mdx` for the receipt/generation layout under `$FACET_DIR/adapters/`; and
- `scripts/README.md` for first-party API metadata injection during prepack.

The root `README.md` only describes the zero-adapter picker; that statement remains accurate and requires no change. Its package-table omissions and broken links are unrelated existing documentation defects and SHALL remain outside this change.

## Risks / Trade-offs

- **[Full npm package documents are larger than `/latest` responses]** → The resolver SHALL parse only version, API field, and dist metadata needed for candidates; an exact request MAY use exact-version metadata as an optimization if it preserves identical validation and failure data.
- **[Mirrors or publishers can omit custom metadata]** → Missing metadata SHALL make that release ineligible before download. Documentation and first-party packed-manifest tests SHALL make the requirement visible and deterministic.
- **[Package metadata can drift from bundled runtime code]** → Runtime verification SHALL be authoritative and SHALL reject mismatches before activation.
- **[All existing managed and manually installed bundles are undeclared]** → New first-party releases SHALL be published before the compatibility-aware CLI, and diagnostics SHALL provide a reinstall command. No automatic migration will guess compatibility.
- **[A crash after activation can leave inactive generations]** → The receipt identifies the sole active generation; loaders ignore all others, and later placement/removal SHALL clean safe inactive generations.
- **[Concurrent installs could race generation cleanup]** → Replacement SHALL be serialized per adapter; cleanup SHALL never delete the generation named by the current receipt.
- **[The constrained package-range grammar differs from npm's caret/tilde conventions]** → Parsing SHALL fail with supported alternatives, and command documentation SHALL show exact and wildcard examples.
- **[Runtime verification imports third-party module initialization]** → Managed receipts allow known unsupported APIs to fail before import, but final runtime authority still requires import. Sandboxing module initialization is a separate security concern.
- **[Rolling back to an older CLI after managed-layout activation hides adapters from that CLI]** → The project is forward-only; rollback instructions SHALL require reinstalling an adapter release understood by the older CLI rather than maintaining two layouts as active.

## Migration Plan

1. Add and publish the SDK `0.0` runtime declaration and release-tool metadata injection. Packed first-party adapter artifacts MUST contain both the npm field and the SDK-stamped runtime export.
2. Publish new `0.0`-declaring releases of Claude Code, OpenCode, and Codex adapters while preserving normal npm `latest` advancement. Their method contract remains unchanged, so existing CLIs continue to consume them as before.
3. Release the compatibility-aware CLI only after those releases are available. A plain first-party install can then always select a compatible candidate.
4. On first use, existing direct bundles are inspected as unmanaged. Because today's bundles have no runtime API, build and facet-install commands fail before adapter methods or project writes and direct the user to `facet adapter install <specifier>`.
5. A successful reinstall stages a managed generation, atomically activates its receipt, then removes the old direct bundle. Project manifests, facet lockfiles, receipts, and materialized assets are not migrated or rewritten.
6. If the new CLI release is rolled back, the older CLI can require an adapter reinstall because it only recognizes the direct `adapter.js` layout. No compatibility promise is made for already-published older CLIs.

## Open Questions

None. The package-selector decision is resolved: adapter npm requests SHALL use the existing Facet exact/wildcard/`latest` grammar rather than full npm-semver ranges.
