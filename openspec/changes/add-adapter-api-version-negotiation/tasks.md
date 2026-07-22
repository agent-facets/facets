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

## 1. SDK Contract and Published Metadata — Research

- [x] 1.1 Explore: Inspect `packages/adapter/src/types.ts`, `packages/adapter/src/define-adapter.ts`, `packages/adapter/src/index.ts`, and `packages/adapter/src/__tests__/` to map the runtime adapter type, factory, public exports, and unit-test surfaces.
- [x] 1.2 Explore: Inspect `packages/adapters/{claude-code,codex,opencode}/` call sites, package builds, and tests to identify compile-time and packed-runtime coverage for the stamped API declaration.
- [x] 1.3 Explore: Inspect `scripts/prepack.ts`, `scripts/postpack.ts`, `scripts/lib/prepack.ts`, `scripts/lib/prepack.test.ts`, and `scripts/release/` to identify a literal-free metadata-injection seam and packed-manifest test strategy.
- [x] 1.4 Propose: Present the complete SDK and release-tooling approach, including the single source of truth for the API value and metadata field name.

## 2. SDK Contract and Published Metadata — Implementation

- [x] 2.1 Implement: Add and export the canonical adapter API and package-metadata field-name constants from `@agent-facets/adapter`.
- [x] 2.2 Implement: Add the readonly runtime API field, define an author-input type that excludes it, and make the SDK factory stamp the canonical value without changing the positional method contract.
- [x] 2.3 Implement: Update SDK and first-party adapter tests to prove stamping, author-input exclusion, and unchanged first-party definitions.
- [x] 2.4 Implement: Extend prepack tooling to inject `facetAdapterApiVersion` into first-party adapter manifests from the SDK constants while leaving unrelated packages untouched and restoring source manifests after packing.
- [x] 2.5 Implement: Add pure prepack tests and packed-tarball coverage proving every first-party adapter publishes the canonical package field and runtime declaration.
- [x] 2.6 Verify: Run the Adapter SDK, first-party adapter, and prepack test suites and verify representative packed manifests.

## 3. Compatibility Classification and Runtime Verification — Research

- [x] 3.1 Explore: Inspect `packages/engine/src/adapters/verify.ts`, `packages/engine/src/adapters/bundler.ts`, and `packages/engine/src/adapters/install-service.ts` to enumerate current verification, prebuilt-isolation, rebundling-fallback, and dynamic-import failure boundaries.
- [x] 3.2 Explore: Inspect result-union and rendering precedents in `packages/protocol/src/integrity/types.ts`, `packages/engine/src/install/lockfile-io.ts`, `packages/engine/src/install/types.ts`, and `packages/cli/src/util/adapter-install-errors.ts` for carrying compatibility failures without thrown expected errors.
- [x] 3.3 Propose: Present the shared compatibility classifier, support-set representation, verified-adapter type, and ordered `VerifyAdapterResult` contract used by all downstream consumers.

## 4. Compatibility Classification and Runtime Verification — Implementation

- [x] 4.1 Implement: Add canonical adapter API syntax validation, the CLI support set derived from the SDK constant, and the shared pure compatibility failure union.
- [x] 4.2 Implement: Convert adapter verification to an ordered discriminated result covering import, default export, declaration syntax, support, expected-metadata equality, name, and API `0.0` method shape.
- [x] 4.3 Implement: Preserve prebuilt-to-source fallback only for eligible loadability or bundling failures and make compatibility contradictions terminal.
- [x] 4.4 Implement: Update engine exports and callers to consume verified adapters and exhaustively handle verification results.
- [x] 4.5 Implement: Add tests for every compatibility classification, metadata/runtime disagreement, method non-invocation, fallback eligibility, and supported success path.
- [x] 4.6 Verify: Run targeted verifier, bundler, and type-check suites.

## 5. Adapter Specifiers and npm Compatible Resolution — Research

- [x] 5.1 Explore: Inspect `packages/engine/src/sources/adapter/specifier.ts`, `packages/engine/src/adapters/first-party.ts`, `packages/engine/src/sources/facet/parse-version.ts`, and `packages/protocol/src/sources/version-spec.ts` for scoped-name handling, alias duplication, selector parsing, and satisfaction rules.
- [x] 5.2 Explore: Inspect `packages/engine/src/sources/adapter/npm.ts` and its fake-registry and hardening tests to map full-packument metadata, integrity verification, extraction, and provenance flow.
- [x] 5.3 Propose: Present tagged source request/result types and structured parse, no-compatible-release, metadata, network, integrity, and extraction failures.

## 6. Adapter Specifiers and npm Compatible Resolution — Implementation

- [x] 6.1 Implement: Make the first-party adapter catalog the single source of truth for both picker entries and alias-to-package resolution.
- [x] 6.2 Implement: Add tagged npm implicit, exact, wildcard/`latest`, Git, and local specifier variants with correct scoped-package splitting and reused Facet selector grammar.
- [x] 6.3 Implement: Return structured parse failures for unsupported npm selector forms while preserving existing Git and local source behavior.
- [x] 6.4 Implement: Replace npm `/latest` lookup with full-packument parsing that filters stable versions by selector and supported API, handles exact requests without substitution, and reports the newest considered incompatible release.
- [x] 6.5 Implement: Carry the selected package version, declared API, tarball URL, and exact SRI or shasum through download, integrity verification, extraction, and installation provenance.
- [x] 6.6 Implement: Add parser and fake-registry tests for scoped names, aliases, all supported selectors—including explicit `latest` selecting the highest compatible release independently of npm's `latest` dist-tag—rejected ranges, compatible selection, exact incompatibility, missing/malformed metadata, prerelease exclusion, and integrity failures; if exact-version metadata optimization is implemented, prove its validation and failure data match the full-packument path.
- [x] 6.7 Verify: Run targeted adapter-source and npm hardening suites.

## 7. Managed Installation and Atomic Activation — Research

- [x] 7.1 Explore: Inspect `packages/engine/src/adapters/placement.ts`, `packages/engine/src/facet-dir.ts`, `packages/common/src/atomic-write.ts`, and `packages/engine/src/install/lockfile-guard.ts` for placement, directory derivation, atomic writes, advisory locking, and safe-path precedents.
- [x] 7.2 Explore: Inspect adapter placement tests and engine/CLI fixtures that fabricate flat installed bundles to define managed, unmanaged, staging, crash-leftover, failure-injection, and cleanup behavior.
- [x] 7.3 Propose: Present the versioned installation receipt schema, source-tagged provenance, generation naming and containment rules, per-adapter lock lifecycle, and atomic activation sequence.

## 8. Managed Installation and Atomic Activation — Implementation

- [x] 8.1 Implement: Add validated installation receipt types and I/O for npm, Git, and local provenance without representable cross-source field combinations.
- [x] 8.2 Implement: Add safe unique generation paths, containment checks, and a per-adapter replacement lock with stale-owner handling.
- [x] 8.3 Implement: Replace direct bundle overwrite with stage, final-path verification, atomic receipt activation, and post-activation cleanup while preserving the prior installation on every pre-activation failure.
- [x] 8.4 Implement: Support unmanaged historical `<name>/adapter.js` entries and convert them to the managed layout only after a successful reinstall.
- [x] 8.5 Implement: Update adapter removal and directory enumeration to delete complete installations, ignore staging/crash leftovers, and never remove the generation named by the active receipt.
- [x] 8.6 Implement: Add tests for each provenance variant, invalid receipts and paths, atomic success, injected failures at every stage, cleanup warnings, stale leftovers, concurrent replacements, and legacy conversion.
- [x] 8.7 Verify: Run targeted placement, receipt, lock, and removal suites.

## 9. Installed Inspection and Fail-Closed Loading — Research

- [x] 9.1 Explore: Inspect `packages/engine/src/adapters/loader.ts`, `packages/cli/src/commands/adapter/index.ts`, and tests that fabricate flat installed bundles to map warn-and-skip loading, list behavior, import caching, and fixture migration.
- [x] 9.2 Explore: Inspect `packages/engine/src/adapters/first-party.ts` and unmanaged-name consumers to define provenance-aware repair aliases without inventing unavailable source information.
- [x] 9.3 Propose: Present shared managed/unmanaged inspection outcomes, broken-installation failures, repair discriminators, aggregate load results, and fixture migration.

## 10. Installed Inspection and Fail-Closed Loading — Implementation

- [x] 10.1 Implement: Add one installed-adapter inspector that validates managed receipts, rejects recorded unsupported APIs before import, verifies active runtime declarations, and verifies unmanaged bundles directly.
- [x] 10.2 Implement: Classify every directory as compatible, incompatible, or broken with structured failure and repair data, ignoring non-active generations and staging leftovers.
- [x] 10.3 Implement: Convert installed loading to a result that returns verified adapters only when every entry succeeds and otherwise aggregates all failures without warning-and-skip behavior.
- [x] 10.4 Implement: Expose inspection-backed list data containing adapter name, declared or missing/malformed API, supported/unsupported/broken status, and repair source.
- [x] 10.5 Implement: Migrate flat-bundle test fixtures where managed provenance is required while retaining explicit unmanaged compatibility tests.
- [x] 10.6 Implement: Add tests for managed and unmanaged success, missing/malformed/unsupported declarations, receipt/runtime mismatch, invalid receipt/import/export failures, aggregate failures, and unique-generation import freshness.
- [x] 10.7 Verify: Run targeted inspector, loader, listing-data, and integration suites.

## 11. Adapter Install and Management Commands — Research

- [x] 11.1 Explore: Inspect `packages/engine/src/adapters/install-service.ts` for stage reporting, source cleanup, prebuilt fallback, and provenance flow.
- [x] 11.2 Explore: Inspect `packages/engine/src/adapters/bundler.ts` and its tests for thrown exception boundaries, temporary resources, and cleanup guarantees.
- [x] 11.3 Explore: Inspect `packages/cli/src/commands/adapter/`, `packages/cli/src/util/adapter-install-errors.ts`, and adapter command tests for install, picker, list, remove, and result-rendering behavior.
- [x] 11.4 Propose: Present the end-to-end install-service result flow and CLI presentation for parse, no-compatible-release, download, verification, activation, cleanup-warning, and recovery outcomes.

## 12. Adapter Install and Management Commands — Implementation

- [x] 12.1 Implement: Rework the adapter install service to carry tagged source provenance through resolve, download/build, verification, lock acquisition, and atomic activation using structured results.
- [x] 12.2 Implement: Convert expected bundler, verification, placement, and cleanup boundaries into typed failures or warnings without losing temporary-resource cleanup.
- [x] 12.3 Implement: Render actionable compatibility and no-compatible-release diagnostics exclusively in the CLI, including found API, supported APIs, and the best available reinstall command.
- [x] 12.4 Implement: Update `facet adapter list` to render inspection-backed API and compatibility status while remaining usable for incompatible and broken entries.
- [x] 12.5 Implement: Preserve load-free whole-directory behavior for `facet adapter remove` and update picker/install behavior to consume the new list and load results.
- [x] 12.6 Implement: Update adapter command unit and end-to-end tests for selectors, managed install/list/remove, replacement preservation, migration, diagnostics, and cleanup warnings.
- [x] 12.7 Verify: Run targeted adapter command and CLI end-to-end suites.

## 13. Build and Facet-Operation Compatibility Gates — Research

- [x] 13.1 Explore: Inspect `packages/cli/src/commands/build.ts`, `packages/cli/src/commands/publish/run-build-view.ts`, and `packages/engine/src/build/pipeline.ts` for build loading, failure rendering, and the first adapter method invocation.
- [x] 13.2 Explore: Inspect `packages/cli/src/commands/shared/ensure-adapters.ts` and the add, remove, and install command entry points for adapter discovery and zero-adapter-picker behavior.
- [x] 13.3 Explore: Inspect `packages/engine/src/install/run-install.ts` and Git/local facet resolvers for no-mutation exits, per-facet-loop ordering, and nested build invocations.
- [x] 13.4 Explore: Inspect drift removal, materialization, and CLI/TUI failure renderers for adapter method calls and exhaustive compatibility handling.
- [x] 13.5 Propose: Present command-level fail-closed inspection and defense-in-depth build/install preflights that share compatibility data and preserve exhaustive result handling.

## 14. Build and Facet-Operation Compatibility Gates — Implementation

- [x] 14.1 Implement: Gate build and publish-build commands on installed inspection before starting the pipeline, and add a distinct build incompatibility failure before metadata validation.
- [x] 14.2 Implement: Add an `ADAPTER_INCOMPATIBLE` install failure variant and route defense-in-depth preflight failures through the no-mutation path before the per-facet loop and any Git/local facet build.
- [x] 14.3 Implement: Update add, remove, and install command discovery to report incompatible/broken entries without launching the zero-adapter picker or invoking adapter methods.
- [x] 14.4 Implement: Retain materialization compatibility checks only as invariant defense and preserve receipt-driven removal without cache or network access after the compatibility gate passes.
- [x] 14.5 Implement: Add exhaustive CLI/TUI rendering for build and install compatibility failures and all collected repair commands.
- [x] 14.6 Implement: Add tests proving incompatible adapters block build, publish-build, add, remove, and install before methods or writes; multiple failures aggregate; compatible adapters preserve the normal path; a build with no installed adapters proceeds with unknown-adapter warnings for manifest metadata; and `facet adapter remove` remains available.
- [x] 14.7 Verify: Run targeted build, publish, add, remove, install, TUI, and type-check suites.

## 15. Documentation and Rollout — Research

- [x] 15.1 Explore: Audit `docs/cli/adapters/install.mdx`, `docs/cli/adapters/list.mdx`, `docs/guides/custom-adapters.mdx`, `docs/guides/troubleshooting.mdx`, `docs/specification/install.mdx`, `docs/specification/commit.mdx`, `docs/specification/build.mdx`, `docs/cli/env.mdx`, and `scripts/README.md` against the implemented behavior.
- [x] 15.2 Explore: Recheck the root `README.md`, `scripts/release/`, and affected package manifests for zero-adapter-picker accuracy and SDK → first-party adapters → CLI rollout constraints.
- [x] 15.3 Propose: Present the complete documentation update and SDK, first-party adapter, and compatibility-aware CLI rollout plan without manipulating npm dist-tags.

## 16. Documentation and Rollout — Implementation

- [x] 16.1 Implement: Update adapter install/list documentation for selector syntax, highest-compatible resolution, incompatibility errors, atomic replacement, managed layout, and recovery.
- [x] 16.2 Implement: Update custom-adapter and troubleshooting guides for SDK stamping, `facetAdapterApiVersion`, publishing, rebuilding/reinstalling, and every compatibility classification.
- [x] 16.3 Implement: Update install, commit, and build specifications documentation for compatibility gates before adapter methods and materialization.
- [x] 16.4 Implement: Update environment and scripts documentation for the receipt/generation layout and first-party prepack metadata injection.
- [x] 16.5 Implement: Add the rollout checklist requiring the SDK and new `0.0` first-party adapter releases before the compatibility-aware CLI release while preserving normal npm `latest` advancement.
- [x] 16.6 Verify: Run documentation link/content checks and verify all command and layout examples against the implementation.

## 17. Integrated Coverage Audit — Research

- [x] 17.1 Explore: Audit the completed implementation and tests against every reconciled SDK, adapter-management, and installation scenario and every design failure boundary.
- [x] 17.2 Explore: Inspect for duplicated API literals, metadata field names, alias maps, compatibility classifiers, or user-facing engine messages that violate the single-source-of-truth design.
- [ ] 17.3 Propose: Present the final gap-closing changes and a verification matrix covering unit, integration, end-to-end, packed-artifact, documentation, and OpenSpec validation.

## 18. Integrated Coverage Audit — Implementation

- [ ] 18.1 Implement: Apply the approved gap-closing tests or corrections found by the coverage and duplication audit.
- [ ] 18.2 Implement: Run `bun format` and apply any remaining non-formatting corrections required before final verification.
- [ ] 18.3 Verify: Run the complete `bun check` pipeline and stop on any lint, type, unit, or end-to-end failure.
- [ ] 18.4 Verify: Run strict OpenSpec validation and check the implementation and documentation against every reconciled requirement and migration constraint.
- [ ] 18.5 Verify: Run automated representative npm, Git, local, managed, unmanaged, compatible, incompatible, replacement-failure, list, build, and facet-operation flows end to end.
