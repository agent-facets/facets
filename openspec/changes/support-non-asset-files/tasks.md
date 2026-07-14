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

## 1. Protocol Models and Archive Plan — Research

- [ ] 1.1 Explore: Inspect the current facet, build-manifest, lockfile, and asset-name schemas and identify every current-versus-legacy validation call site
- [ ] 1.2 Explore: Trace archive membership, path validation, collision detection, and per-entry hashing across protocol and engine build code
- [ ] 1.3 Explore: Inspect protocol public exports, version constants, fixtures, and schema tests that constrain compatibility
- [ ] 1.4 Propose: Define the protocol model for exact supplementary declarations, tagged archive-plan entries, version dispatch, and structured validation failures

## 2. Protocol Models and Archive Plan — Implementation

- [ ] 2.1 Implement: Add top-level and per-skill exact `files` declarations, current single-segment asset-name validation, and the shared skill/command namespace while isolating legacy `0.1` naming behavior
- [ ] 2.2 Implement: Add one pure archive-plan operation that classifies manifest, primary-asset, skill-companion, and archive-only entries and enforces the complete path-safety and collision grammar, including Windows-portable component rules (reserved device names, forbidden characters, control bytes, trailing dot/space)
- [ ] 2.3 Implement: Add separate archive-format and lockfile-format constants plus exact versioned build-manifest schemas for legacy `0.1` `assets` and current `0.2` `files`, pinning numeric `facetVersion: 0.2` and the exact `archive: "archive.tar.gz"` literal, and rejecting duplicate JSON object members in facet manifests, build manifests, and lockfiles before schema validation
- [ ] 2.4 Implement: Add the lockfile `0.2` schema with deterministic per-asset file-integrity records and exact legacy-alpha-`1` versus current-`0.2` dispatch
- [ ] 2.5 Implement: Curate protocol exports and add focused schema, name, archive-plan, collision, version-dispatch, and lockfile tests for all legal and illegal states
- [ ] 2.6 Verify: Run the focused protocol typecheck and test suites for schemas and archive planning

## 3. Archive Verification and Consumer Bridge — Research

- [ ] 3.1 Explore: Trace outer/inner tar parsing and identify where duplicate, aliased, unsafe, and non-regular headers can be rejected before path-keyed maps are built
- [ ] 3.2 Explore: Trace archive verification, cache extraction/auditing, registry download, and engine loading from verified bytes through resolved facet data
- [ ] 3.3 Explore: Inspect integrity result types and CLI failure rendering for path-specific mismatches, decompression refusal, and unsupported versions
- [ ] 3.4 Propose: Define the consumer-first bridge approach for strict `0.1`/`0.2` dispatch, tagged verified content, immutable fixtures, and actionable failures without enabling `0.2` production

## 4. Archive Verification and Consumer Bridge — Implementation

- [ ] 4.1 Implement: Validate raw tar headers for both the outer container and the inner archive before lossy mapping and return structured failures for duplicate paths, portable aliases, unsafe or non-portable paths, and every non-regular entry type
- [ ] 4.2 Implement: Make archive verification derive exact expected membership from the embedded manifest's shared archive plan and require equality with observed entries and the version-selected hash map
- [ ] 4.3 Implement: Keep supplementary content as opaque bytes and return a tagged verified result that groups companions with their owning skill while decoding and validating only primary assets as text
- [ ] 4.4 Implement: Add structured unsupported-version and per-entry integrity failures, preserve caller-supplied decompression, and prevent malformed current archives from falling back to legacy rules
- [ ] 4.5 Implement: Update registry download, cache audit/extraction, and engine loaders to consume tagged verified results without exposing archive-only files to materialization
- [ ] 4.6 Implement: Add immutable valid `0.1` and `0.2` fixtures plus tampering, missing/extra entry, raw-header (both layers), duplicate-JSON-member, portable-alias, non-portable path, binary, empty-supplementary, and legacy-compatibility tests
- [ ] 4.7 Verify: Run focused protocol and engine consumer tests and confirm the bridge accepts both formats while no producer yet emits `0.2`

## 5. Adapter Skill Bundles — Research

- [ ] 5.1 Explore: Trace adapter install/read/delete calls and identify every positional-contract implementation and consumer
- [ ] 5.2 Explore: Inspect filesystem helper containment, metadata transformation, pruning, and failure behavior for each first-party adapter
- [ ] 5.3 Explore: Inspect engine materialization's type-only adapter dependency and determine how atomic helpers can remain owned by the adapter SDK
- [ ] 5.4 Propose: Define tagged request/result unions and an all-or-nothing owned skill-bundle lifecycle that cannot represent companions on agents or commands
- [ ] 5.5 Explore: Audit the merged adapter-API-version machinery — `ADAPTER_API_VERSION`, `SUPPORTED_ADAPTER_APIS`, verifier/loader/inspection classification, npm package/runtime declaration selection, and first-party prepack `facetAdapterApiVersion` injection — and confirm every consumer derives from the single SDK constant

## 6. Adapter Skill Bundles — Implementation

- [ ] 6.1 Implement: Replace positional adapter asset methods with tagged skill, agent, and command requests/results carrying explicit scope, type, and name, with skill variants carrying engine-supplied owned-companion path sets for install, read, and delete
- [ ] 6.2 Implement: Add SDK filesystem helpers that validate every supplied companion path (new or owned) as contained below the skill root before any filesystem access, plus staged bundle replacement, rollback, ownership-set-based deletion, and empty-directory pruning with primary-only metadata transformation
- [ ] 6.3 Implement: Migrate claude-code, opencode, and codex adapters to the tagged contract and canonical reads, including consistent skill-root pruning and preservation of unowned files
- [ ] 6.4 Implement: Add SDK and first-party adapter tests for companion-less and multi-file skills, escaping paths in bundles and ownership sets, malformed ownership rejection before any filesystem access, idempotence, canonical reads limited to requested owned paths, unowned content preservation, and injected failures at every write/delete/commit boundary
- [ ] 6.5 Implement: Update adapter public exports and add the required pre-1.0 minor-release metadata describing the breaking contract
- [ ] 6.6 Implement: Bump the single-source-of-truth `ADAPTER_API_VERSION` from `0.0` to `0.1` for the tagged contract, keep `SUPPORTED_ADAPTER_APIS` derived from it (support set `{0.1}`), and update first-party adapter package/runtime declarations and prepack `facetAdapterApiVersion` injection so every consumer derives `0.1` without hardcoding the token
- [ ] 6.7 Implement: Add fail-closed coverage proving `defineAdapter()` stamps `0.1` while author definitions cannot supply it, a positional `0.0` declaration is well-formed but unsupported by a `{0.1}` CLI, an installed/runtime `0.0` adapter is rejected before any contract method or project mutation, package/runtime metadata agree at `0.1`, and tagged `0.1` first-party adapters proceed through normal materialization
- [ ] 6.8 Verify: Run focused adapter SDK, compatibility/verifier, and all first-party adapter typechecks and tests

## 7. Lockfile, Receipt, and Materialization — Research

- [ ] 7.1 Explore: Trace lockfile loading/writing and every place resolved entries are inherited, minted, compared, or carried forward
- [ ] 7.2 Explore: Trace receipt loading, bootstrapping, project isolation, drift removal, tri-write commit, and rollback ordering
- [ ] 7.3 Explore: Trace materialization, skip-if-identical behavior, journaling, deletion, drift reporting, and archive-to-adapter data flow
- [ ] 7.4 Propose: Define the migration and transaction approach for per-file integrity, untrusted receipt ownership, atomic skill bundles, normal legacy migration, and frozen legacy behavior

## 8. Lockfile, Receipt, and Materialization — Implementation

- [ ] 8.1 Implement: Replace numeric-order lockfile handling with exact legacy-alpha-`1` and current-`0.2` loading, normal-mode migration, and frozen-mode no-rewrite behavior
- [ ] 8.2 Implement: Derive sorted lockfile asset file records from the verified materialization subset and recomputed entry hashes rather than copying self-declared hash values
- [ ] 8.3 Implement: Enforce pre-materialization agreement among facet integrity, asset identities, complete owned path sets, recomputed entry hashes, and verified build-manifest hashes with path-specific result variants, running the adapter-compatibility preflight (positional `0.0` rejected by a `{0.1}` CLI) ahead of archive-version dispatch and per-file reconciliation
- [ ] 8.4 Implement: Introduce receipt `0.2` asset/file ownership, safe legacy refinement, project-isolated bootstrap, and containment validation that treats receipt data as untrusted
- [ ] 8.5 Implement: Commit lockfile, receipt, and adapter state transactionally and ensure frozen consistency gates complete before receipt-driven cleanup begins
- [ ] 8.6 Implement: Materialize only primary assets and owned skill companions through tagged adapter requests carrying validated ownership sets from the lockfile and receipt, with per-file skip/repair behavior and rollback journal preimages
- [ ] 8.7 Implement: Make drift and removal path-specific, preserve unowned files, and support offline multi-file cleanup from receipts without cache or network access
- [ ] 8.8 Implement: Render lockfile, archive-version, per-file mismatch, adapter-bundle, and receipt failures exhaustively in CLI install output using one compatibility table for known format transitions
- [ ] 8.9 Implement: Add engine and CLI tests for migration, frozen failures, receipt corruption/isolation, pulled-lockfile cleanup, per-file drift, integrity mismatch, rollback, archive-only withholding, and exact diagnostics
- [ ] 8.10 Implement: Add a full-cycle end-to-end test that builds and verifies a facet with skill companions and archive-only files, installs it, detects and repairs single-file drift, exercises interrupted-install convergence on re-run without deleting unowned files, and removes it offline from the receipt, then exercises the same install path with an immutable legacy `0.1` archive
- [ ] 8.11 Verify: Run focused install, materialization, receipt, lockfile, cache, registry, and CLI install tests

## 9. Current Producer and Build Pipeline — Research

- [ ] 9.1 Explore: Trace source-file loading, build validation stages, archive assembly, output cleanup, and build-result rendering
- [ ] 9.2 Explore: Inspect source filesystem APIs needed to reject missing files, links, resolved aliases, and non-regular declarations before output mutation
- [ ] 9.3 Explore: Confirm consumer support and the external registry verification gate required before any producer can emit archive format `0.2`
- [ ] 9.4 Propose: Define the producer switch that reuses the archive plan, preserves deterministic bytes, validates before cleanup, and emits only current-format output

## 10. Current Producer and Build Pipeline — Implementation

- [ ] 10.1 Implement: Record a passing consumer-and-registry readiness gate and do not enable `0.2` producer output if either consumer class is not ready
- [ ] 10.2 Implement: Load declared supplementary files as exact bytes, validate their resolved regular-file identities, and preserve previous `dist/` output on every input failure
- [ ] 10.3 Implement: Drive archive collection and all-entry hashing from the shared archive plan, preserving deterministic ordering and opaque binary or empty supplementary content
- [ ] 10.4 Implement: Switch every new build, including asset-only facets, to flat build-manifest `0.2` output with a complete `files` map while retaining legacy consumer support
- [ ] 10.5 Implement: Update build results and CLI output to show the emitted format, complete entry listing, integrity, and archive-assembly stage
- [ ] 10.6 Implement: Add the build failure-class matrix for traversal, absolute/drive/URL prefixes, backslashes, NUL, empty/`.`/`..` segments, Unicode-normalization and portable-case aliases, Windows-reserved device names, forbidden portable characters, trailing dot/space segments, file/directory prefix collisions, symlinks, hard links, duplicate paths, reserved root `facet.json`, conventional-primary-path collisions, missing declarations, undeclared entries, and tampered bytes, plus success tests for top-level files, nested companions, binary/empty bytes, exact manifest-byte hashing, canonical-tar determinism, scoped output paths, and validation-before-cleanup
- [ ] 10.7 Verify: Run focused build pipeline and CLI build tests and inspect representative `0.2` archives for exact deterministic membership

## 11. Create and Edit Authoring — Research

- [ ] 11.1 Explore: Trace scaffold options, manifest generation, templates, previews, and create wizard state/editor round-trips
- [ ] 11.2 Explore: Trace edit scanner, reconciliation, context, operation, manifest-rewrite, confirmation, and transactional apply types
- [ ] 11.3 Explore: Inspect create/edit focus management and exhaustive UI switches that must represent two independent README paths and path-bearing reconciliation items
- [ ] 11.4 Propose: Define tagged README and supplementary-file states, stable reconciliation identities, headless-create behavior, and an exact-path operation preview for the full authoring block

## 12. Create and Edit Authoring — Implementation

- [ ] 12.1 Implement: Add an editable default `README.md` scaffold option and template that writes the file and top-level declaration atomically without regenerating authored content after identity edits
- [ ] 12.2 Implement: Add the dedicated create README card/editor flow, optional disable behavior, state snapshotting, and explicit confirmation preview, and align headless create with the documented policy
- [ ] 12.3 Implement: Extend edit scanning and reconciliation for undeclared skill companions, common root files, and missing declared supplementary files while routing only exact `README.md` and `README` paths to a dedicated panel
- [ ] 12.4 Implement: Add independent tagged states and actions for both conventional README paths, preserving bytes on adoption and retaining exact paths for scaffold, edit, removal, and declaration changes
- [ ] 12.5 Implement: Replace string-parsed reconciliation keys with stable structured identities and represent file/declaration operations as tagged variants with no invalid combinations
- [ ] 12.6 Implement: Apply README, companion, and generic supplementary changes transactionally with manifest edits and show every queued exact-path operation before Apply
- [ ] 12.7 Implement: Add engine, CLI, TUI, integration, and create-build end-to-end tests covering README defaults/disable/edit preservation in interactive and headless creates, both README paths, adoption, missing-file choices, companion discovery, skill deletion preserving undeclared files, confirmation, cancellation, and buildability
- [ ] 12.8 Verify: Run focused scaffold, edit, create, TUI, integration, and end-to-end tests

## 13. Documentation and Release Readiness — Research

- [ ] 13.1 Explore: Audit `docs/` and root `README.md` for archive versions, hash-map shape, manifest naming/declarations, lockfile/receipt semantics, install behavior, adapter contracts, and asset-only wording
- [ ] 13.2 Explore: Inspect documentation generation and shared snippets so field descriptions and compatibility values are referenced from authoritative schemas or constants rather than duplicated
- [ ] 13.3 Explore: Inspect linked-package changeset policy, current package versions, and release-note requirements for pre-1.0 breaking minor releases
- [ ] 13.4 Propose: Define the documentation, generated-reference, compatibility-warning, and release-note update set, including the custom-adapter contract page omitted from the original migration list

## 14. Documentation and Release Readiness — Implementation

- [ ] 14.1 Implement: Update archive, build, manifest, integrity, lockfile, commit, install, publish, and terminology documentation for supplementary membership, strict versions, path safety, per-file hashes, and atomic skill bundles
- [ ] 14.2 Implement: Update create, edit, install, troubleshooting, first-facet, install-facets, skills, and custom-adapter guides plus root `README.md` for the README workflow, materialization boundary, upgrade guidance, and non-asset files, and update the adapter API version-negotiation docs and adapter install/list surfaces from `0.0` to `0.1` (tagged contract, CLI-supported-API values, and reinstall guidance for old positional `0.0` adapters)
- [ ] 14.3 Implement: Generate or share schema-derived field references where practical, keep one authoritative minimum-version mapping, and link other documentation to it instead of copying values
- [ ] 14.4 Implement: Add linked minor-release changeset metadata and release notes identifying the previously accepted archive, lockfile, naming, and adapter behaviors that become incompatible — including the adapter API `0.0`→`0.1` cutover for the SDK and three first-party adapters — while intentionally omitting an `agent-facets` CLI changeset from this stack so the CLI release requiring `0.1` follows in a second cycle gated on all three first-party adapters publishing `facetAdapterApiVersion: 0.1`, and retain the approved protocol delta as the authoritative permanent pre-1.0 breaking-minor/post-1.0 breaking-major policy update to be synced during change finalization
- [ ] 14.5 Verify: Run documentation checks, strict OpenSpec validation, package API/build checks, and the full `bun check` suite, fixing formatter-only findings with `bun format`, then verify implementation coverage scenario-by-scenario across all seven delta specs and confirm the consumer-first bridge and external registry gate precede `0.2` producer enablement
