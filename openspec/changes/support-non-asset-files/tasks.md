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

- [x] 1.1 Explore: Inspect the current facet, build-manifest, lockfile, and asset-name schemas and identify every current-versus-legacy validation call site
- [x] 1.2 Explore: Trace archive membership, path validation, collision detection, and per-entry hashing across protocol and engine build code
- [x] 1.3 Explore: Inspect protocol public exports, version constants, fixtures, and schema tests that constrain compatibility
- [x] 1.4 Propose: Define the protocol model for exact supplementary declarations, tagged archive-plan entries, version dispatch, and structured validation failures

## 2. Protocol Models and Archive Plan — Implementation

- [x] 2.1 Implement: Add top-level and per-skill exact `files` declarations, current single-segment asset-name validation, and the shared skill/command namespace while isolating legacy `0.1` naming behavior
- [x] 2.2 Implement: Add one pure archive-plan operation that classifies manifest, primary-asset, skill-companion, and archive-only entries and enforces the complete path-safety and collision grammar, including Windows-portable component rules (reserved device names, forbidden characters, control bytes, trailing dot/space)
- [x] 2.3 Implement: Add separate archive-format and lockfile-format constants plus exact versioned build-manifest schemas for legacy `0.1` `assets` and current `0.2` `files`, pinning numeric `facetVersion: 0.2` and the exact `archive: "archive.tar.gz"` literal, and rejecting duplicate JSON object members in facet manifests, build manifests, and lockfiles before schema validation
- [x] 2.4 Implement: Add the lockfile `0.2` schema with deterministic per-asset file-integrity records and exact legacy-alpha-`1` versus current-`0.2` dispatch
- [x] 2.5 Implement: Curate protocol exports and add focused schema, name, archive-plan, collision, version-dispatch, and lockfile tests for all legal and illegal states
- [x] 2.6 Verify: Run the focused protocol typecheck and test suites for schemas and archive planning

## 3. Archive Verification and Consumer Bridge — Research

- [x] 3.1 Explore: Trace outer/inner tar parsing and identify where duplicate, aliased, unsafe, and non-regular headers can be rejected before path-keyed maps are built
- [x] 3.2 Explore: Trace archive verification, cache extraction/auditing, registry download, and engine loading from verified bytes through resolved facet data
- [x] 3.3 Explore: Inspect integrity result types and CLI failure rendering for path-specific mismatches, decompression refusal, and unsupported versions
- [x] 3.4 Propose: Define the consumer-first bridge approach for strict `0.1`/`0.2` dispatch, tagged verified content, immutable fixtures, and actionable failures without enabling `0.2` production

## 4. Archive Verification and Consumer Bridge — Implementation

- [x] 4.1 Implement: Validate raw tar headers for both the outer container and the inner archive before lossy mapping and return structured failures for duplicate paths, portable aliases, unsafe or non-portable paths, and every non-regular entry type
- [x] 4.2 Implement: Make archive verification derive exact expected membership from the embedded manifest's shared archive plan and require equality with observed entries and the version-selected hash map
- [x] 4.3 Implement: Keep supplementary content as opaque bytes and return a tagged verified result that groups companions with their owning skill while decoding and validating only primary assets as text
- [x] 4.4 Implement: Add structured unsupported-version and per-entry integrity failures, preserve caller-supplied decompression, and prevent malformed current archives from falling back to legacy rules
- [x] 4.5 Implement: Update registry download, cache audit/extraction, and engine loaders to consume tagged verified results without exposing archive-only files to materialization
- [x] 4.6 Implement: Add immutable valid `0.1` and `0.2` fixtures plus tampering, missing/extra entry, raw-header (both layers), duplicate-JSON-member, portable-alias, non-portable path, binary, empty-supplementary, and legacy-compatibility tests
- [x] 4.7 Verify: Run focused protocol and engine consumer tests and confirm the bridge accepts both formats while no released producer emits `0.2`

## 5. Protocol-Only Release Handoff

- [x] 5.1 Explore: Audit the release automation, protocol package boundary, public exports, Node-native smoke coverage, pending lower-stack review findings, and downstream registry API needs, using the stack through PR `#437` as the release boundary
- [x] 5.2 Propose: Present the exact protocol-only release packet and merge order for PRs `#428`, `#435`, and `#437`, including the pre-1.0 minor changeset, release notes, verification evidence, and an explicit exclusion of adapter and `agent-facets` CLI bumps
- [x] 5.3 Implement: Resolve every valid correctness, compatibility, package-surface, fixture, and documentation finding required to make the proposal, protocol-model, and archive-verifier stack through PR `#437` release-ready without pulling adapter-contract work into the release boundary
- [x] 5.4 Implement: Add a protocol-only pre-1.0 minor changeset to PR `#437` describing strict `0.1`/`0.2` consumer support, the breaking tagged verification API, structured failures, and the registry migration surface, with no adapter-package or `agent-facets` CLI release entry
- [x] 5.5 Verify: Run focused protocol tests, types, package build/API checks, Node-native smoke coverage, immutable dual-version fixture verification, and the full `bun check`, and prove the currently released CLI producer behavior remains `0.1`
- [x] 5.6 Implement: Restack and submit the release boundary through PR `#437`, keeping PR `#438` and all later CLI work above the protocol-only release boundary
- [x] 5.7 Review: Present the clean protocol release handoff, exact merge/version-package sequence, verification evidence, and downstream registry resume prompt to the user; protocol publication remains an externally controlled action and does not block continued work above PR `#437`

## 6. Adapter Skill Bundles — Research

- [x] 6.1 Explore: Trace adapter install/read/delete calls and identify every positional-contract implementation and consumer
- [x] 6.2 Explore: Inspect filesystem helper containment, metadata transformation, pruning, and failure behavior for each first-party adapter
- [x] 6.3 Explore: Inspect engine materialization's type-only adapter dependency and determine how atomic helpers can remain owned by the adapter SDK
- [x] 6.4 Propose: Define tagged request/result unions and an all-or-nothing owned skill-bundle lifecycle that cannot represent companions on agents or commands
- [x] 6.5 Explore: Audit the merged adapter-API-version machinery — `ADAPTER_API_VERSION`, `SUPPORTED_ADAPTER_APIS`, verifier/loader/inspection classification, npm package/runtime declaration selection, and first-party prepack `facetAdapterApiVersion` injection — and confirm every consumer derives from the single SDK constant

## 7. Adapter Skill Bundles — Implementation and Release Preparation

- [x] 7.1 Implement: Replace positional adapter asset methods with tagged skill, agent, and command requests/results carrying explicit scope, type, and name, with skill variants carrying engine-supplied owned-companion path sets for install, read, and delete
- [x] 7.2 Implement: Add SDK filesystem helpers that validate every supplied companion path (new or owned) as contained below the skill root before any filesystem access, plus staged bundle replacement, rollback, ownership-set-based deletion, and empty-directory pruning with primary-only metadata transformation
- [x] 7.3 Implement: Migrate claude-code, opencode, and codex adapters to the tagged contract and canonical reads, including consistent skill-root pruning and preservation of unowned files
- [x] 7.4 Implement: Add SDK and first-party adapter tests for companion-less and multi-file skills, escaping paths in bundles and ownership sets, malformed ownership rejection before any filesystem access, idempotence, canonical reads limited to requested owned paths, unowned content preservation, and injected failures at every write/delete/commit boundary
- [x] 7.5 Implement: Update adapter public exports and add a pre-1.0 minor changeset covering only the adapter SDK and three first-party adapters, explicitly withholding any `agent-facets` CLI bump until the final release gate
- [x] 7.6 Implement: Bump the single-source-of-truth `ADAPTER_API_VERSION` from `0.0` to `0.1` for the tagged contract, keep `SUPPORTED_ADAPTER_APIS` derived from it (support set `{0.1}`), and update first-party adapter package/runtime declarations and prepack `facetAdapterApiVersion` injection so every consumer derives `0.1` without hardcoding the token
- [x] 7.7 Implement: Add fail-closed coverage proving `defineAdapter()` stamps `0.1` while author definitions cannot supply it, a positional `0.0` declaration is well-formed but unsupported by a `{0.1}` CLI, an installed/runtime `0.0` adapter is rejected before any contract method or project mutation, package/runtime metadata agree at `0.1`, and tagged `0.1` first-party adapters proceed through normal materialization
- [x] 7.8 Verify: Run focused adapter SDK, compatibility/verifier, and all first-party adapter typechecks and tests

## 8. Lockfile, Receipt, and Materialization — Research

- [x] 8.1 Explore: Trace lockfile loading/writing and every place resolved entries are inherited, minted, compared, or carried forward
- [x] 8.2 Explore: Trace receipt loading, bootstrapping, project isolation, drift removal, tri-write commit, and rollback ordering
- [x] 8.3 Explore: Trace materialization, skip-if-identical behavior, journaling, deletion, drift reporting, and archive-to-adapter data flow
- [x] 8.4 Propose: Define the migration and transaction approach for per-file integrity, untrusted receipt ownership, atomic skill bundles, normal legacy migration, and frozen legacy behavior

## 9. Lockfile, Receipt, and Materialization — Implementation

- [x] 9.1 Implement: Replace numeric-order lockfile handling with exact legacy-alpha-`1` and current-`0.2` loading, normal-mode migration, and frozen-mode no-rewrite behavior
- [x] 9.2 Implement: Derive sorted lockfile asset file records from the verified materialization subset and recomputed entry hashes rather than copying self-declared hash values
- [x] 9.3 Implement: Enforce pre-materialization agreement among facet integrity, asset identities, complete owned path sets, recomputed entry hashes, and verified build-manifest hashes with path-specific result variants, running the adapter-compatibility preflight (positional `0.0` rejected by a `{0.1}` CLI) ahead of archive-version dispatch and per-file reconciliation
- [x] 9.4 Implement: Introduce receipt `0.2` asset/file ownership, safe legacy refinement, project-isolated bootstrap, and containment validation that treats receipt data as untrusted
- [x] 9.5 Implement: Commit lockfile, receipt, and adapter state transactionally and ensure frozen consistency gates complete before receipt-driven cleanup begins
- [x] 9.6 Implement: Materialize only primary assets and owned skill companions through tagged adapter requests carrying validated ownership sets from the lockfile and receipt, with per-file skip/repair behavior and rollback journal preimages
- [x] 9.7 Implement: Make drift and removal path-specific, preserve unowned files, and support offline multi-file cleanup from receipts without cache or network access
- [x] 9.8 Implement: Render lockfile, archive-version, per-file mismatch, adapter-bundle, and receipt failures exhaustively in CLI install output using one compatibility table for known format transitions
- [x] 9.9 Implement: Add engine and CLI tests for migration, frozen failures, receipt corruption/isolation, pulled-lockfile cleanup, per-file drift, integrity mismatch, rollback, archive-only withholding, and exact diagnostics
- [x] 9.10 Implement: Add a full-cycle end-to-end test that builds and verifies a facet with skill companions and archive-only files, installs it, detects and repairs single-file drift, exercises interrupted-install convergence on re-run without deleting unowned files, and removes it offline from the receipt, then exercises the same install path with an immutable legacy `0.1` archive
- [x] 9.11 Verify: Run focused install, materialization, receipt, lockfile, cache, registry, and CLI install tests

## 10. Current Producer and Build Pipeline — Research

- [x] 10.1 Explore: Trace source-file loading, build validation stages, archive assembly, output cleanup, and build-result rendering
- [x] 10.2 Explore: Inspect source filesystem APIs needed to reject missing files, links, resolved aliases, and non-regular declarations before output mutation
- [x] 10.3 Explore: Inspect Changesets and CLI packaging to confirm the complete `0.2` producer may be implemented and merged without publishing `agent-facets`, while protocol, registry, adapter, and final CLI activation remain independently controlled release gates
- [x] 10.4 Propose: Define the producer implementation that reuses the archive plan, preserves deterministic bytes, validates before cleanup, emits only current-format output in the unreleased candidate, and requires no long-lived runtime dual-format flag

## 11. Current Producer and Build Pipeline — Implementation

- [x] 11.1 Implement: Load declared supplementary files as exact bytes, validate their resolved regular-file identities, and preserve previous `dist/` output on every input failure
- [x] 11.2 Implement: Drive archive collection and all-entry hashing from the shared archive plan, preserving deterministic ordering and opaque binary or empty supplementary content
- [x] 11.3 Implement: Switch every build in the unreleased source candidate, including asset-only facets, to flat build-manifest `0.2` output with a complete `files` map while retaining legacy consumer support
- [x] 11.4 Implement: Update build results and CLI output to show the emitted format, complete entry listing, integrity, and archive-assembly stage
- [x] 11.5 Implement: Add the build failure-class matrix for traversal, absolute/drive/URL prefixes, backslashes, NUL, empty/`.`/`..` segments, Unicode-normalization and portable-case aliases, Windows-reserved device names, forbidden portable characters, trailing dot/space segments, file/directory prefix collisions, symlinks, hard links, duplicate paths, reserved root `facet.json`, conventional-primary-path collisions, missing declarations, undeclared entries, and tampered bytes, plus success tests for top-level files, nested companions, binary/empty bytes, exact manifest-byte hashing, canonical-tar determinism, scoped output paths, and validation-before-cleanup
- [x] 11.6 Implement: Add a reproducible candidate archive/interop path that can produce a representative `0.2` artifact for registry stage acceptance without publishing or releasing the CLI
- [x] 11.7 Verify: Run focused build pipeline and CLI build tests and inspect representative `0.2` archives for exact deterministic membership while confirming no `agent-facets` release changeset is present

## 12. Create and Edit Authoring — Research

- [x] 12.1 Explore: Trace scaffold options, manifest generation, templates, previews, and create wizard state/editor round-trips
- [x] 12.2 Explore: Trace edit scanner, reconciliation, context, operation, manifest-rewrite, confirmation, and transactional apply types
- [x] 12.3 Explore: Inspect create/edit focus management and exhaustive UI switches that must represent two independent README paths and path-bearing reconciliation items
- [x] 12.4 Propose: Define tagged README and supplementary-file states, stable reconciliation identities, headless-create behavior, and an exact-path operation preview for the full authoring block

## 13. Create and Edit Authoring — Implementation

- [x] 13.1 Implement: Add an editable default `README.md` scaffold option and template that writes the file and top-level declaration atomically without regenerating authored content after identity edits
- [x] 13.2 Implement: Add the dedicated create README card/editor flow, optional disable behavior, state snapshotting, and explicit confirmation preview, and align headless create with the documented policy
- [x] 13.3 Implement: Extend edit scanning and reconciliation for undeclared skill companions, common root files, and missing declared supplementary files while routing only exact `README.md` and `README` paths to a dedicated panel
- [x] 13.4 Implement: Add independent tagged states and actions for both conventional README paths, preserving bytes on adoption and retaining exact paths for scaffold, edit, removal, and declaration changes
- [x] 13.5 Implement: Replace string-parsed reconciliation keys with stable structured identities and represent file/declaration operations as tagged variants with no invalid combinations
- [x] 13.6 Implement: Apply README, companion, and generic supplementary changes transactionally with manifest edits and show every queued exact-path operation before Apply
- [x] 13.7 Implement: Add engine, CLI, TUI, integration, and create-build end-to-end tests covering README defaults/disable/edit preservation in interactive and headless creates, both README paths, adoption, missing-file choices, companion discovery, skill deletion preserving undeclared files, confirmation, cancellation, and buildability
- [x] 13.8 Verify: Run focused scaffold, edit, create, TUI, integration, and end-to-end tests

## 14. Documentation — Research

- [x] 14.1 Explore: Audit `docs/` and root `README.md` for archive versions, hash-map shape, manifest naming/declarations, lockfile/receipt semantics, install behavior, adapter contracts, and asset-only wording
- [x] 14.2 Explore: Inspect documentation generation and shared snippets so field descriptions and compatibility values are referenced from authoritative schemas or constants rather than duplicated
- [x] 14.3 Explore: Inspect the protocol-only, adapter-only, and held CLI release notes and package metadata so documentation describes the actual staged rollout without making package versions a second source of truth
- [x] 14.4 Propose: Define the documentation and generated-reference update set, including compatibility warnings, the custom-adapter contract, and the consumer-first protocol → registry → adapter → CLI release sequence

## 15. Documentation — Implementation

- [x] 15.1 Implement: Update archive, build, manifest, integrity, lockfile, commit, install, publish, and terminology documentation for supplementary membership, strict versions, path safety, per-file hashes, atomic skill bundles, and the protocol-first release boundary
- [x] 15.2 Implement: Update create, edit, install, troubleshooting, first-facet, install-facets, skills, and custom-adapter guides plus root `README.md` for the README workflow, materialization boundary, upgrade guidance, non-asset files, and adapter API `0.0`→`0.1` migration
- [x] 15.3 Implement: Generate or share schema-derived field references where practical, keep one authoritative minimum-version mapping, and link other documentation to it instead of copying values
- [x] 15.4 Implement: Add durable release notes identifying the previously accepted archive, lockfile, naming, and adapter behaviors that become incompatible, and retain the approved protocol delta as the authoritative permanent pre-1.0 breaking-minor/post-1.0 breaking-major policy update to be synced during change finalization
- [x] 15.5 Verify: Run documentation checks and verify every compatibility and release-order claim against authoritative schemas, constants, package metadata, and the staged Changesets

## 16. Held CLI Release Gate and Final Readiness

- [x] 16.1 Explore: Audit the completed implementation, package versions, pending Changesets, generated release notes, and release automation to define a minimal held `agent-facets` activation PR with no unintended protocol or adapter publication
- [x] 16.2 Propose: Present the exact CLI-only pre-1.0 minor changeset, activation evidence, PR base/stack placement, and merge conditions; the user retains sole authority to merge the held release gate
- [x] 16.3 Implement: Create and submit the tiny held CLI release-gate PR containing the `agent-facets` changeset and final release notes, without merging, publishing, or deploying it
- [x] 16.4 Verify: Run strict OpenSpec validation, package API/build checks, and the full `bun check` suite, fixing formatter-only findings with `bun format`, then verify implementation coverage scenario-by-scenario across all seven delta specs
- [x] 16.5 Verify: Confirm the protocol-only release from Section 5 is published and exposes strict `0.1`/`0.2` verification, tagged results, structured failures, and cross-version helpers from a clean consumer install
- [x] 16.6 Verify: Confirm the adapter SDK and all three first-party adapters are published with `facetAdapterApiVersion: 0.1`, while existing `0.0` CLIs retain compatible `0.0` adapter resolution — DONE: published `@agent-facets/adapter@0.28.0`, `adapter-claude-code@0.9.0`, `adapter-opencode@0.10.0`, `adapter-codex@0.7.0`; all three first-party adapters declare `facetAdapterApiVersion: 0.1`, and each retains a highest-`0.0` release (claude-code 0.8.0, opencode 0.9.0, codex 0.6.0) so existing `0.0` CLIs still resolve a compatible adapter
- [x] 16.7 Verify: Confirm the deployed registry pins the released protocol, accepts valid `0.1` and `0.2`, rejects malformed/unsupported archives before persistence, and preserves supplementary hashes — DONE against the deployed registry (production + `julian` stage on `@agent-facets/protocol@0.29.0`): valid `0.1` and `0.2` archives accepted; malformed uploads rejected pre-persistence with `E_ARCHIVE_MALFORMED` and unsupported-version uploads with `E_UNSUPPORTED_FACET_VERSION` (neither stored); per-file supplementary hashes preserved. NOTE: the deployed `/contents` endpoint returns every verified inner file except the manifest (primary assets, skill companions, and archive-only supplementary files, typed text/binary) — not "only primary resources"; the original task wording predates that endpoint's expansion (registry PR #449) and is superseded by the shipped behavior
- [x] 16.8 Verify: Build the unreleased candidate CLI, publish a representative `0.2` archive to the stage registry, and verify metadata, archive download, stored-content behavior, and legacy `0.1` retention end to end — DONE on the `julian` stage: published a representative `0.2` facet (skill with text + binary companions and an archive-only README) via the `0.2` producer; version metadata `content_integrity` matched the built archive; archive download re-verified through the protocol verifier as `0.2` with exact 5-entry membership; typed `/contents` returned all files with correct text/binary classification and preserved hashes; a valid legacy `0.1` archive published and read back successfully
- [ ] 16.9 Review: Present the final activation packet and evidence to the user; the held CLI release-gate PR remains unmerged until the user explicitly authorizes the Changesets version-and-publish sequence. NOTE: after the changeset linked-group decoupling, the projected activation release is `agent-facets@0.29.0` (single pre-1.0 minor over the published `0.28.0` baseline), not `0.31.0`
