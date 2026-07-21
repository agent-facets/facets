# Comparison Review: `design`

**Main:** `openspec/changes/add-adapter-api-version-negotiation/design.md`
**Adversary:** `openspec/changes/add-adapter-api-version-negotiation/adversarial/artifacts/design.md`

Both were derived from the same reconciled proposal; the adversarial version was authored blind.

## Grading bar

- **Artifact mechanics:** required design sections (Context, Goals/Non-Goals, Decisions with alternatives, Risks → Mitigation, Migration Plan, Open Questions) present and substantive.
- **RFC 2119:** normative design statements use keyword vocabulary (Article I).
- **Documentation rules:** design MUST identify affected `docs/`/README files and required updates (Article III + artifact rules).
- **Proposal coverage:** every proposal "What Changes" bullet has a design-level answer (API identity, metadata declaration, compatible selection, exact-version failure, runtime authority, atomic replacement, provenance, pre-materialization gate, list output, diagnostics).
- **House constraints:** errors-as-values, illegal-states-unrepresentable type design, layer boundaries (SDK leaf / engine machinery / CLI rendering), single source of truth.

Both artifacts satisfy mechanics, RFC 2119, and layer boundaries. The material differences are in specific decisions.

## Coverage comparison

| Area | Main | Adversary |
| --- | --- | --- |
| Canonical `ADAPTER_API_VERSION` + stamping, input type excludes `apiVersion` | D1 | D1 (identical conclusion) |
| API identifier syntax | Canonical `MAJOR.MINOR` grammar; distinguishes missing/malformed/unsupported | Fully opaque string; no malformed class |
| Supported set vs canonical version separation | D1 (set derived from SDK constant) | D2 (same conclusion) |
| npm metadata field | Top-level `facetAdapterApiVersion`, field name exported by SDK, injected at prepack, packed-tarball tests | Nested `facetAdapter.apiVersion`, hand-added, CI equality test |
| Version selector grammar | Reuses Facet `VersionSpec` grammar (exact / wildcard / `latest`); rejects npm semver ranges | npm-style ranges via `Bun.semver` |
| Specifier parsing | Tagged non-overlapping variants; aliases derived from first-party catalog | Tagged variants; alias map left duplicated |
| Full-packument rationale | Asserted | Explained (corgi packument strips custom fields) |
| Rebundle-fallback interaction | Explicitly forbids fallback on compatibility failure | Not addressed |
| Installed layout | Generations + `installation.json` receipt pointer; single-file atomic activation; per-adapter lock; import-cache busting; unmanaged-bundle classification | `adapter.js` + `adapter.json` sidecar; two-rename dir swap with acknowledged crash window |
| Provenance integrity for git/local | Not recorded (npm SRI only) | Placed-bundle sha512, tagged by kind |
| Loader policy | Fail closed: any incompatible/broken installed adapter fails loading with collected failures | Classifying loader; gate on adapters actually used |
| Defense-in-depth | Preflight inside `runBuildPipeline`/`runInstall` (`ADAPTER_INCOMPATIBLE` variant) plus command gates | Gate at load boundary only; `runInstall` contract unchanged |
| Docs impact | 8 targets incl. `commit.mdx`, `build.mdx`, `env.mdx`, `scripts/README.md`; README cleared | 5 targets + README cleared |
| Open questions | None (all resolved) | Three (prerelease policy, receipt backfill, orphan sweep) |

## Material divergences and judgment

### 1. Version selector grammar — **Main stronger**

Main reuses the existing Facet `VersionSpec` grammar and `satisfies` predicate as the single source of truth, and returns structured parse failures for npm-style ranges. The adversary reached for `Bun.semver` npm ranges. Main wins on single-source-of-truth grounds and avoids importing npm's caret/tilde/prerelease semantics into a second grammar in the same product. Main also correctly documents the UX risk (authors expect npm conventions) with a mitigation. The adversary's open question about prerelease policy is dissolved by main's "stable `MAJOR.MINOR.PATCH` entries only" rule — a sign the main decision is the more complete one.

### 2. Metadata declaration mechanism — **Main stronger**

Both chose a custom top-level `package.json` field with runtime-declaration authority. Main's mechanism is better on two counts: the SDK exports the *field name* alongside the version (no string literal duplication in engine), and first-party manifests get the field injected during the existing prepack transformation, derived from `ADAPTER_API_VERSION` — eliminating the hand-maintained JSON duplication the adversary could only guard with a CI equality test. Merge from the adversary: the explicit rationale that the abbreviated ("corgi") packument strips custom top-level fields, which is *why* full-packument fetch is required — main asserts the fetch but never justifies it.

### 3. Installed layout and atomic replacement — **Main clearly stronger**

The adversary's stage-and-swap (rename old away, rename staging in, delete old) admits a crash window between the two renames and had to document it as a risk. Main's generation directories plus an `installation.json` pointer make activation a single-file atomic rename, add a per-adapter lock, and — decisively — solve a problem the adversary missed entirely: **ESM dynamic-import caching**. Replacing `adapter.js` at a stable path can return the stale cached module within the same process; unique generation paths make that unrepresentable. Main also classifies unmanaged (hand-copied) bundles gracefully. One trade-off runs the other way: the adversary's layout keeps `adapter.js` at the historical path, so rolling back to an older CLI still finds the adapter; main's layout hides managed installs from older CLIs. Main acknowledges this in risks and the project is forward-only — acceptable, but reconciliation should keep that risk bullet intact.

### 4. Provenance integrity for non-npm sources — **Adversary stronger (merge this)**

The proposal requires provenance including "package integrity." Main records the npm SRI/shasum on the npm variant but records **no content integrity at all** for git and local variants (url/ref/path only) — and none for npm installs that fall back to rebundling, where the placed bundle is not the tarball's bytes. The adversary records a sha512 of the placed `adapter.js` for exactly these cases, tagged so tarball-integrity and bundle-hash cannot be conflated. Recommend adding a tagged bundle-content-hash field to main's receipt for git/local (and optionally for rebundled npm placements).

### 5. Loader policy — **Main stronger, with one caveat**

Main's fail-closed `loadInstalledAdapters` (collect all failures, fail loading) is stricter than the proposal's "selected adapter" wording, but in the current UX every installed installable adapter participates in add/remove/install/build, so "installed" ≈ "selected" and fail-closed prevents the misreporting failure modes main names (incompatible adapter misread as "no adapters installed" → picker). Main also explicitly suppresses the zero-adapter picker in this state — a real UX hole the adversary didn't consider. Caveat for the future: if adapter selection ever becomes per-command, fail-closed-on-any will over-block; the design's shared-inspection structure (tagged per-directory outcomes) already supports relaxing this, so no change needed now.

### 6. Defense-in-depth preflight — **Main stronger**

The adversary deliberately kept `runInstall`'s contract unchanged ("it only ever sees compatible adapters"), gating solely at the load boundary. Main gates at commands *and* adds an `ADAPTER_INCOMPATIBLE` preflight inside `runBuildPipeline`/`runInstall`, routed through the existing no-mutation path before the per-facet loop. Main's belt-and-suspenders is the better call: engine entry points are also driven by tests and future callers that bypass the CLI's load path, and the proposal's "before any materialization writes" guarantee should not depend on every caller remembering the gate. Main also catches a subtle ordering fact the adversary missed: the preflight must precede Git/local facet builds that invoke adapter metadata methods.

### 7. Rebundle-fallback interaction — **Main only (keep)**

Main explicitly forbids the prebuilt-failed→rebundle-from-source fallback from masking a compatibility failure (fallback only for loadability/bundling failures). The adversary never considered this interaction; it is a genuine behavioral hole in the adversarial design. Keep main's rule.

### 8. API identifier syntax — **Main stronger**

Main's canonical `MAJOR.MINOR` grammar gives "malformed" a precise meaning, enables pre-import rejection from the receipt's recorded API, and still mandates exact-equality-only comparison. The adversary's fully opaque string cannot distinguish malformed from merely-unknown, which weakens the proposal-required diagnostics ("declared or missing API").

### 9. Documentation coverage — **Main stronger**

Main identifies all five proposal-named files plus `list.mdx` (which the adversary independently caught) and four more the adversary missed: `docs/specification/commit.mdx`, `docs/specification/build.mdx`, `docs/cli/env.mdx` (required by the layout change), and `scripts/README.md` (prepack injection). Both cleared root `README.md`. No merge needed; main is a superset.

### 10. Context grounding — **Adversary marginally stronger (optional merge)**

The adversary's Context inventories the current seams with concrete file paths (`define-adapter.ts`, `npm.ts`, `verify.ts`, `placement.ts`, `loader.ts`, `specifier.ts`). Main's Context is accurate but abstract. Optional: fold the file-path inventory into main's Context to speed up the tasks artifact and implementation.

## Merge recommendation (per decision)

1. **D1/D2 (identity, supported set, metadata):** keep Main. Add one sentence of rationale from the adversary: full-packument fetch is required because the abbreviated packument strips custom top-level fields.
2. **D3 (specifiers/selection):** keep Main (Facet grammar, catalog-derived aliases, tagged variants).
3. **D4 (verifier):** keep Main; ordering and the metadata/runtime-mismatch arm match the adversary's independent conclusion — high confidence here.
4. **D5 (layout/atomicity):** keep Main's generation+receipt design. **Add** a tagged bundle-content-hash (sha512 of the placed bundle) to the receipt for git/local sources and rebundled npm placements, per adversary D7 — this closes the proposal's "package integrity" provenance requirement for non-npm sources. Consider adding the adversary's `installedAt` timestamp as a cheap diagnostic field.
5. **D6 (inspection/gates):** keep Main, including picker suppression and the in-engine preflight.
6. **D7 (docs):** keep Main's list unchanged.
7. **Context:** optionally merge the adversary's concrete file-path inventory.

## Blocking items

None blocking. The single substantive gap in Main — missing content-integrity provenance for git/local/rebundled installs (item 4) — should be folded in during reconciliation, but it is a receipt-field addition, not a structural change.
