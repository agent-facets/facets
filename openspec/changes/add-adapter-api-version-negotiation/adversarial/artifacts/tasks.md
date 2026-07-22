> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

## Step Types

- **Verify** → CHECK. Run automated checks (tests, lint, type checks).
  If all checks pass, proceed. If anything fails, STOP and notify the user.
- **Implement** → WRITE. Make code changes — create, edit, or delete files.
- **Propose** → READ-ONLY + USER GATE. Present intended changes in your message text first,
  then ask for approval using the `question` tool with a short prompt (Approve / Reject / Request changes).
  Never put details in the question — the question is just the gate. Do not write anything.
- **Explore** → READ-ONLY. Read files, search the codebase, investigate broadly.
  No writes allowed. Use this to understand the problem space before acting.
- **Review** → READ-ONLY + USER GATE. Present findings and analysis in your message text first,
  then ask for feedback using the `question` tool with a short prompt.
  Never put details in the question — the question is just the gate.

## 1. SDK API `0.0` Declaration — Research

- [ ] 1.1 Explore `packages/adapter/` (`types.ts`, `define-adapter.ts`, `index.ts`, `__tests__/`): the current `Adapter` type, factory validation, public exports, and how tests are structured
- [ ] 1.2 Explore how the `Adapter` type and `defineAdapter()` are consumed across `packages/adapters/*`, `packages/engine/`, and `packages/cli/` (type imports, call sites, re-exports) to find every surface the new required `apiVersion` field touches
- [ ] 1.3 Propose the SDK change: `ADAPTER_API_VERSION` constant (`0.0`), exported npm metadata field name (`facetAdapterApiVersion`), required readonly `apiVersion` on the runtime `Adapter`, factory input type excluding `apiVersion`, and the export surface for engine consumption

## 2. SDK API `0.0` Declaration — Implementation

- [ ] 2.1 Implement `ADAPTER_API_VERSION = "0.0"` and the metadata field-name constant in `packages/adapter/`, exported from the package entry point
- [ ] 2.2 Implement the required readonly `apiVersion` field on the runtime `Adapter` type, stamped by `defineAdapter()`, with the factory definition input type excluding it so authors cannot supply a conflicting value
- [ ] 2.3 Implement SDK tests: factory stamps `0.0` onto every returned adapter; the definition object neither requires nor accepts an API identifier; the exported canonical constant equals `0.0`
- [ ] 2.4 Verify: run `bun check` for `packages/adapter` and dependent type-checks across the workspace

## 3. First-Party Release Metadata — Research

- [ ] 3.1 Explore `scripts/prepack.ts`, `scripts/postpack.ts`, `scripts/lib/`, and `scripts/release/` to understand the existing first-party manifest transformation and where packed-tarball tests live
- [ ] 3.2 Propose how prepack derives `facetAdapterApiVersion` from `ADAPTER_API_VERSION` (no duplicated `0.0` literal) and how packed-tarball tests prove both the npm field and the SDK-stamped runtime export are present

## 4. First-Party Release Metadata — Implementation

- [ ] 4.1 Implement prepack injection of `facetAdapterApiVersion` (derived from the SDK constant) into first-party adapter package manifests during the existing prepack transformation
- [ ] 4.2 Implement packed-tarball tests proving each first-party adapter artifact contains the top-level `facetAdapterApiVersion` field and a runtime bundle whose default export carries `apiVersion: "0.0"`
- [ ] 4.3 Update `scripts/README.md` to document first-party API metadata injection during prepack
- [ ] 4.4 Verify: run the scripts test suite and a local pack of one first-party adapter to confirm the transformed manifest

## 5. Compatibility Classification & Runtime Verification — Research

- [ ] 5.1 Explore `packages/engine/src/adapters/verify.ts` and its current throw-based failure behavior, plus every current caller (bundler, install-service, loader)
- [ ] 5.2 Explore the repo's discriminated-result conventions (`IntegrityResult`, `LoadLockfileResult`, `RunInstallFailure`) and where a shared pure compatibility classifier should live in engine
- [ ] 5.3 Explore the "prebuilt failed, rebundle from source" fallback path in `packages/engine/src/adapters/install-service.ts` to determine exactly which failure classes may still trigger fallback
- [ ] 5.4 Propose: the API-identifier parser (`MAJOR.MINOR`, no signs/suffixes/leading zeroes), the shared compatibility failure union (missing / malformed / unsupported / metadata-runtime mismatch, each carrying identity, found declaration, support set), the engine support set defined as exactly `{ ADAPTER_API_VERSION }`, and the ordered `VerifyAdapterResult` checks (import → default export → declaration present/valid → in support set → equals expected npm API → `0.0` name/method shape)

## 6. Compatibility Classification & Runtime Verification — Implementation

- [ ] 6.1 Implement the adapter API identifier parser and pure compatibility classifier as a shared engine module, with the support set derived from the SDK constant (no duplicated `0.0` literal) and exhaustive unit tests for well-formed, missing, malformed, unsupported, and mismatch classifications
- [ ] 6.2 Implement `verifyAdapter` returning a discriminated `VerifyAdapterResult` with the ordered checks from the proposal; success carries the verified adapter and its supported API; no adapter contract method runs before verification succeeds
- [ ] 6.3 Implement fallback gating in the install service: compatibility failures never trigger source-rebundling fallback; fallback remains only for loadability/bundling failures that do not contradict a declared contract
- [ ] 6.4 Implement unit tests for verifier ordering (mismatch classified before any method invocation), npm expected-API equality, and fallback gating
- [ ] 6.5 Verify: run `bun check` for `packages/engine`

## 7. npm Specifier & Compatible Version Resolution — Research

- [ ] 7.1 Explore `packages/engine/src/sources/adapter/specifier.ts` and `npm.ts`: current specifier parsing, the `/latest` fetch, download/extract, and integrity handling
- [ ] 7.2 Explore `packages/engine/src/adapters/first-party.ts` (alias catalog) and every consumer of the alias map, including the zero-adapter picker
- [ ] 7.3 Explore the protocol `VersionSpec` grammar and satisfaction predicate (`packages/protocol/src/sources/version-spec.ts`) for reuse as the single source of truth for package selectors
- [ ] 7.4 Propose: the tagged specifier union (bare/first-party-alias implicit selector, exact version, explicit wildcard/`latest`, Git, local) with scoped-name delimiter handling; alias derivation from the first-party catalog; full-packument fetch (never the abbreviated install-v1 representation) parsing only version/API/dist fields; highest-compatible selection; exact-version no-substitution; and the structured no-compatible-release failure carrying package, selector, support set, and newest considered release with its declaration state
- [ ] 7.5 Propose how the resolved success value (exact package version, declared API, tarball URL, registry SRI/shasum) flows into download so selection and provenance use the same record, and how an exact request may optimize with exact-version metadata while preserving identical validation and failure data

## 8. npm Specifier & Compatible Version Resolution — Implementation

- [ ] 8.1 Implement the tagged adapter specifier parser with structured parse failures for caret, tilde, comparator, OR, hyphen, prerelease, and `x` syntax that name the supported exact/wildcard/`latest` forms; derive first-party aliases from the catalog
- [ ] 8.2 Implement full-packument resolution: constrain stable `MAJOR.MINOR.PATCH` entries by the package selector, discard releases with missing/malformed/unsupported `facetAdapterApiVersion`, choose the highest remaining version; exact requests consider only that version and fail rather than substitute
- [ ] 8.3 Implement the resolved-candidate success value carrying package version, declared API, tarball URL, and registry integrity anchor, and thread it through download so provenance uses the selected record
- [ ] 8.4 Implement the structured no-compatible-release failure (package, requested selector, CLI support set, newest considered release with its missing/malformed/unsupported declaration)
- [ ] 8.5 Implement unit tests: bare-name skips newer incompatible release; wildcard constrains compatible selection; exact incompatible fails without substitution; unsupported range syntax rejected with accepted forms; no-compatible-release failure data; scoped-name specifier splitting; explicit `latest` ignores the dist-tag and selects highest compatible
- [ ] 8.6 Verify: run `bun check` for `packages/engine`

## 9. Managed Installation Layout & Atomic Replacement — Research

- [ ] 9.1 Explore `packages/engine/src/adapters/placement.ts` and `install-service.ts`: current direct `adapter.js` placement, `$FACET_DIR/adapters/` handling, and any existing lock or atomic-write helpers (including `@agent-facets/common` atomic file writes)
- [ ] 9.2 Explore how Git and local adapter installs produce bundles (`sources/adapter/git.ts`, `local.ts`) and what provenance is available at placement time for each source kind
- [ ] 9.3 Propose: the `installation.json` receipt schema (schema version, active generation id, verified API, tagged npm/Git/local source record with source-specific fields only on their variant), generation-id validation as a single safe path segment with containment-checked derived paths, the six-step replacement sequence (temp verify → per-adapter lock → stage generation → verify from staged path → atomic receipt replace → cleanup), post-activation cleanup-failure-as-warning semantics, and unmanaged direct-bundle classification

## 10. Managed Installation Layout & Atomic Replacement — Implementation

- [ ] 10.1 Implement the receipt schema types as a tagged union (npm with resolved package/version and registry SRI/shasum; Git with URL and optional ref; local with resolved path) plus receipt read/write with structured invalid-receipt failures
- [ ] 10.2 Implement generation staging and atomic activation: unique generation directory on the same filesystem, verification from the final staged path, single-file atomic `installation.json` replacement, per-adapter replacement lock acquired after the runtime name is known
- [ ] 10.3 Implement post-activation cleanup: remove the previous generation and legacy direct bundle after the receipt switch; report cleanup failure as a warning, never as a failed installation; never delete the generation named by the current receipt; clean safe inactive crash leftovers during later placement/removal
- [ ] 10.4 Implement pre-activation failure preservation: any resolution, build, verification, staging, or receipt-write failure leaves the existing receipt and active generation byte-for-byte unchanged
- [ ] 10.5 Implement unit tests: atomic replacement success and every pre-activation failure class preserving the previous installation; receipt tagged-variant invariants; generation-id path-segment validation and containment; unmanaged direct-bundle handling; reinstall converting a direct layout to the managed layout
- [ ] 10.6 Verify: run `bun check` for `packages/engine`

## 11. Installed Inspection, Loading & Command Gates — Research

- [ ] 11.1 Explore `packages/engine/src/adapters/loader.ts` and every `loadInstalledAdapters` consumer across engine and CLI (build pipeline, `runInstall`, add/remove/install commands, adapter list) including the current warn-and-skip behavior
- [ ] 11.2 Explore `packages/engine/src/install/run-install.ts` (`RunInstallFailure` variants, the no-mutation path before the per-facet loop, where Git/local facet builds invoke adapter metadata methods) and `packages/engine/src/build/pipeline.ts` failure data
- [ ] 11.3 Explore the zero-adapter picker trigger in `facet add`/`remove`/`install` to ensure the incompatible-adapter state does not launch it
- [ ] 11.4 Propose: the shared per-directory inspection outcome (compatible with verified adapter and API / incompatible with structured failure and repair source / broken with structured receipt-import-shape failure), managed-receipt pre-import rejection of unsupported recorded APIs and runtime-vs-receipt comparison, unique generation paths defeating dynamic-import caching, unmanaged inspection without invented provenance, `loadInstalledAdapters` as a result value collecting all failures, the repair discriminator (managed → recorded specifier; unmanaged first-party → canonical alias; other unmanaged → directory/runtime name with explicit no-provenance note), and each command gate (build/publish-build before `runBuildPipeline`; add/remove/install before `runInstall`; `ADAPTER_INCOMPATIBLE` on `RunInstallFailure` through the no-mutation path; defense-in-depth preflights; materialization in-loop assertion as invariant only; `adapter remove` untouched)

## 12. Installed Inspection, Loading & Command Gates — Implementation

- [ ] 12.1 Implement shared installed-adapter inspection returning the tagged compatible/incompatible/broken outcome, handling managed receipts (validate, reject unsupported recorded API before import, import active generation by unique path, compare runtime declaration with receipt) and unmanaged direct bundles (import and verify without provenance)
- [ ] 12.2 Implement `loadInstalledAdapters` returning a result value that fails with all collected failures when any entry is incompatible or broken, and attach the repair discriminator to each compatibility failure
- [ ] 12.3 Implement the build gates: `facet build` and publish-build stop before `runBuildPipeline` on inspection failure; build failure data distinguishes adapter incompatibility from content validation; `runBuildPipeline` retains a defense-in-depth API preflight
- [ ] 12.4 Implement the facet-operation gates: add/remove/install stop before `runInstall` on inspection failure without launching the zero-adapter picker; add `ADAPTER_INCOMPATIBLE` to `RunInstallFailure` routed through the existing no-mutation path before the per-facet loop; keep the in-loop materialization assertion as an invariant check
- [ ] 12.5 Implement unit tests: incompatible adapter blocks build/add/remove/install before any adapter contract method or mutation; multiple failures collected and reported together; facet removal still requires compatible adapters while remaining cache- and network-independent; compatible adapters proceed; no-adapters build still proceeds with unknown-adapter warnings
- [ ] 12.6 Verify: run `bun check` for `packages/engine`

## 13. CLI Diagnostics & Adapter List — Research

- [ ] 13.1 Explore `packages/cli/src/commands/adapter/` (install, list, remove flows) and the TUI/list rendering used by `facet adapter list`
- [ ] 13.2 Explore `packages/cli/src/util/errors.ts` and existing CLI failure rendering to determine where compatibility-failure prose is produced (engine returns values; CLI renders strings)
- [ ] 13.3 Propose: prose rendering for each compatibility-failure variant (adapter/package identity, found declaration, supported APIs, repair command), no-compatible-release and unsupported-selector error rendering for `facet adapter install`, and the `facet adapter list` columns (declared API as exact identifier / `missing` / `malformed`; status as `supported` / `unsupported` / `broken`) that remain rendered when entries are incompatible

## 14. CLI Diagnostics & Adapter List — Implementation

- [ ] 14.1 Implement CLI renderers mapping every compatibility-failure variant to actionable prose including the best available compatible-install command; engine code constructs no user-facing strings
- [ ] 14.2 Implement `facet adapter list` API and compatibility-status output covering supported, unsupported, and broken entries while keeping the command available for recovery
- [ ] 14.3 Implement `facet adapter install` output for compatible selection (resolved package version and API) and for structured selector-parse and no-compatible-release failures
- [ ] 14.4 Implement end-to-end tests: install with selector forms; list output across compatible/incompatible/broken states; build and facet operations failing with repair guidance against an undeclared bundle
- [ ] 14.5 Verify: run `bun check` for `packages/cli`

## 15. Documentation — Research

- [ ] 15.1 Explore the affected docs for statements contradicted by this change: `docs/cli/adapters/install.mdx`, `docs/cli/adapters/list.mdx`, `docs/guides/custom-adapters.mdx`, `docs/guides/troubleshooting.mdx`, `docs/specification/install.mdx`, `docs/specification/commit.mdx`, `docs/specification/build.mdx`, `docs/cli/env.mdx`, and root `README.md` (expected: picker statement stays accurate, no change)
- [ ] 15.2 Propose the documentation diff set matching the observable contract (selectors, highest-compatible resolution, incompatibility failures, atomic replacement, managed layout, list statuses, publishing requirements, troubleshooting recovery, compatibility gates)

## 16. Documentation — Implementation

- [ ] 16.1 Implement updates to `docs/cli/adapters/install.mdx` (package selectors, highest-compatible resolution, incompatibility failures, atomic replacement, managed layout) and `docs/cli/adapters/list.mdx` (API and compatibility-status output)
- [ ] 16.2 Implement updates to `docs/guides/custom-adapters.mdx` (SDK stamping, `facetAdapterApiVersion`, publishing, rebuilding/reinstalling) and `docs/guides/troubleshooting.mdx` (missing, malformed, unsupported, metadata/runtime-mismatch recovery)
- [ ] 16.3 Implement updates to `docs/specification/install.mdx` and `docs/specification/commit.mdx` (compatibility gate before the per-facet loop and materialization), `docs/specification/build.mdx` (failure on incompatible installed adapter before metadata validation), and `docs/cli/env.mdx` (receipt/generation layout under `$FACET_DIR/adapters/`)
- [ ] 16.4 Verify: docs build/lint passes and each updated page matches the implemented behavior

## 17. Migration Readiness & Final Verification

- [ ] 17.1 Implement a release-ordering note in the release tooling or checklist: first-party `0.0`-declaring adapter releases (Claude Code, OpenCode, Codex) are published before the compatibility-aware CLI ships, with unchanged method contracts so existing CLIs keep working
- [ ] 17.2 Verify: run `bun check` across the full workspace (lint, types, unit, e2e) and confirm the undeclared-legacy-bundle path fails closed with the reinstall diagnostic
