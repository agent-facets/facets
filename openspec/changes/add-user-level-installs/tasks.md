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
- **Pause** → PAUSE, NO TOOL. A model-switch pause. Emit this exact line of plain text and nothing else:
  "Switch models if desired, then send any message to continue."
  Then end the turn. Do NOT call the `question` tool, and do NOT tell the user to run a command.
  An affirmative continuation resumes execution; a stop, revise-plan, or
  question message is handled without advancing.

Each numbered Step heading and its single checkbox represent the same task, not two tasks. The heading supplies the VIPER TODO label; the checkbox supplies the OpenSpec progress ID and detailed work. This plan is pause-enabled, with one model-switch pause at each exploration/implementation boundary.

The reconciled [design](design.md) and [delta specs](specs/) govern this checklist. Groups 1–6 deliver the SDK/protocol/adapter foundation with working project operations; groups 7–16 complete the user lifecycle. The first public `--user` release SHALL include text assets, companions, and MCP together. Package publication remains a separately authorized release action, not permission granted by this checklist. Delivery 1 SHALL expose no `--user` command surface. The final release sequence SHALL verify publication prerequisites, activate only this change's parked CLI changeset, and verify release isolation. Activating local changeset metadata SHALL NOT authorize publishing packages, merging release PRs, or creating tags.

Checks SHALL use isolated home, `FACET_DIR`, and native configuration roots and SHALL NOT touch real user configuration or execute declared MCP servers. Preserve existing project behavior except for the explicitly specified SDK cutover, lazy receipt migration, and physical-alias refusals. Keep the existing shared cache and adapter installations; do not introduce a second user pipeline or expand the design's non-goals.

Verification failures stop execution. Repairs belong in an authorized Implement step followed by verification; Biome formatting repairs SHALL use `bun format`, not manual whitespace edits.

**Project-only bridge (landed after group 2, outside the step sequence).** Groups 1–2 left downstream packages uncompiled, so `bun check` was restored with a project-only migration ahead of the steps that own it. Later steps SHALL treat this as existing state to verify and extend, not as completion of their own work; none of their checkboxes is satisfied by it.

- All three first-party adapters and engine/CLI test adapters use the planning context and disclose `storageRoot`, declaring `supportedScopes: ['project']` and empty `locationEnvironment`. Their former ambient-`$HOME` user branches were removed, so user requests are refused. User layouts, overrides, MCP user documents, and their evidence remain group 4 work (4.2–4.7).
- Engine captures one project planning context per `runInstall`, after the adapter-compatibility preflight, and threads it through asset planning and MCP preparation/replan. Receipt-derived MCP identities carry project scope. Capture-once/filtering integration coverage beyond the capture helper's unit tests remains 6.4.
- Bundle verification accepts a `defineAdapter()` result or a bare adapter and returns structured `definition-invalid`/`invalid-export` failures. It fully verifies the payload, including capability declarations. CLI adapter-install errors render both. Listing/loading regressions, capability-based eligibility, and `ADAPTER_SCOPE_UNSUPPORTED` remain 6.3–6.4.
- `packages/cli/src/__tests__/adapter-integration.test.ts` bundles its fixture once per file to avoid an intermittent, pre-existing Bun bundler `EISDIR` failure on a second in-process build.

## 1. SDK and portable contracts — Research

Contracts: [Adapter SDK](specs/adapter__sdk/spec.md), [portable schemas and planning](specs/protocol__schemas/spec.md), and [scope-neutral authoring](specs/authoring__facets/spec.md). Approach: design D2–D3.

### Step 1 - Explore: Map SDK planning contracts

- [x] 1.1 Explore: Trace SDK request/result types, factory validation, asset and MCP planning helpers, exports, and distribution tests in `packages/adapter/src/`; identify every always-required project root and every no-op/absent result needing location disclosure against `specs/adapter__sdk/spec.md` and `specs/adapter__assets/spec.md`.

### Step 2 - Explore: Map portable planning and format invariants

- [x] 1.2 Explore: Trace declaration-based and fingerprint-only server planning, identity keys, locked inventory derivation, schema dispatch, and Node-only tests in `packages/protocol/src/`; identify the minimal scope-aware extension without changing manifest `0.2`, lockfile `0.4`, archive bytes, or `facets:mcp-server:v1`.

### Step 3 - Propose: Define the SDK and protocol implementation

- [x] 1.3 Propose: Present the complete SDK/protocol implementation approach: exported target/context types, required capability declarations, structured failures, helper boundaries, stable location disclosure, backward-compatible project planner defaults, and tests. Identify downstream project call sites that group 6 must migrate before the foundation is releasable. State explicitly that declaration fingerprint encoding, the `deriveLockedMcpInventory` signature, and portable schema shapes and versions remain unchanged. Choose scope types for the existing public planning signatures without mandating a new `COLLECTION_SCOPES` export or introducing a protocol runtime dependency solely to share scope vocabulary. Include the `Validated<Adapter>` factory return, field-addressed definition failures, both approved bundle export forms, and explicit non-throwing consumer handling.

## 2. SDK and portable contracts — Implementation

### Step 4 - Pause: Switch model for implementation

- [x] 2.1 Pause: Switch model for implementation

### Step 5 - Implement: Introduce explicit planning contexts

- [x] 2.2 Implement: Introduce the discriminated project/user planning target, absolute supplied home, and immutable per-capability location environment inputs across asset install/removal and MCP requests; validate malformed targets and unsupported direct scopes before inspection without inventing a user project root.

### Step 6 - Implement: Declare capabilities and SDK API 0.4

- [x] 2.3 Implement: Add non-empty supported-scope and `locationEnvironment` declarations to enabled capabilities, retaining valid `false` declarations; update SDK factory validation and the canonical Adapter SDK API identifier to `0.4`, keeping caller-supplied API values non-authoritative. Change `defineAdapter` to return `Validated<Adapter>` with field-addressed errors for every expected definition-validation failure, including malformed untyped input. Reserve throws for completely unknown, unhandleable internal programming errors; do not introduce a throwing unwrap helper.

### Step 7 - Implement: Disclose stable planning locations

- [x] 2.4 Implement: Extend asset planning results and reusable helpers with stable storage-root disclosure on changed, equivalent, and absent outcomes; adapt MCP helper boundaries to explicit targets while preserving complete candidate-document disclosure, exact preimages, containment, and read-only behavior.

### Step 8 - Implement: Scope portable MCP planning

- [x] 2.5 Implement: Extend both public MCP planners and their identity keys with explicit project/user scope and compatible omitted-scope project behavior; keep `deriveLockedMcpInventory` collection-relative with its existing signature and keep fingerprints, server record shapes, schema versions, and extension preservation unchanged. Target `packages/protocol/src/materialization/servers.ts`, including `planServerMaterialization`, `planLockedServerInventory`, and their identity/key helpers; expose only the reviewed public types needed by concrete consumers.

### Step 9 - Implement: Cover SDK and protocol invariants

- [x] 2.6 Implement: Add SDK/protocol regression coverage for capability validation, malformed targets, read-only supplied-context contracts, unchanged/absent disclosure, cross-scope planner equivalence apart from identity scope, and unchanged authored hashes and portable schemas. Preserve the SDK's self-contained declarations and dependency-free MCP declaration boundary. Replace factory throw assertions with success/failure-result assertions; cover malformed untyped definitions, missing fields, incomplete capabilities, invalid scope/environment declarations, and successful API stamping. Exercise the result-returning factory in published-declaration coverage without unchecked payload access.

### Step 10 - Verify: Check SDK and protocol contracts

- [x] 2.7 Verify: Run protocol and SDK `test`, `types`, and `test:e2e` scripts, including protocol execution under Node 22+ without Bun on PATH and SDK published-declaration/bundle checks; confirm schema readers retain the existing scope vocabulary without authorizing system installation.

## 3. Native adapter behavior and conformance — Research

Contracts: [assets](specs/adapter__assets/spec.md) and [MCP configuration](specs/adapter__mcp-servers/spec.md). Approach: design D6 and its native compatibility verification gates.

### Step 11 - Pause: Switch model for exploration

- [ ] 3.1 Pause: Switch model for exploration

### Step 12 - Explore: Inspect Claude and Codex compatibility evidence

- [ ] 3.2 Explore: Inspect Claude Code and Codex native-layout evidence and current adapter fixtures independently: Claude's overridden state-file location and minimal missing-state document acceptance; Codex's supported custom-prompt versions, `CODEX_HOME`, and separate `.agents` skill tree. Preserve the decision not to redesign Codex project commands.

### Step 13 - Explore: Inspect OpenCode V2 compatibility evidence

- [ ] 3.3 Explore: Load the `opencode` skill and inspect authoritative V2 configuration/MCP/migration references and existing JSONC fixtures; establish or identify isolated checks for same-directory JSON/JSONC ordering, native-over-legacy maps, and custom/inline precedence without changing the canonical user write boundary.

### Step 14 - Explore: Map shared adapter conformance

- [ ] 3.4 Explore: Inspect `packages/adapter-test-kit`, `packages/adapter-jsonc`, and all three adapters' asset/MCP tests for scope assumptions, candidate disclosure, shared document ownership, native equality, interpolation, preservation, and Windows path coverage. Establish the Windows test strategy: distinguish portable path assertions runnable on Linux from filesystem or native-tool checks requiring a Windows runner. Do not treat `path.win32` string assertions alone as proof of Windows filesystem behavior. Trace first-party source and distribution imports that currently treat the default `defineAdapter` export as a bare adapter, including shared conformance helpers.

### Step 15 - Review: Review native compatibility evidence

- [ ] 3.5 Review: Present established and unestablished native-layout evidence for Claude minimal user-state creation, Codex prompt consumption under CODEX_HOME, and OpenCode same-directory ordering and custom-layer precedence. Distinguish documentary evidence from pending native-fixture checks and show the resulting fail-closed branches. Review approval SHALL NOT substitute for verification or waive the release gates.

### Step 16 - Propose: Define native adapter implementation and evidence gates

- [ ] 3.6 Propose: Present the full three-adapter implementation and conformance approach, including supported native versions, evidence-producing isolated fixtures, fail-closed branches for unestablished layouts, and the complete project/user asset-plus-MCP matrix. Do not turn verification work into new installation-policy questions.

## 4. Native adapter behavior and conformance — Implementation

### Step 17 - Pause: Switch model for implementation

- [ ] 4.1 Pause: Switch model for implementation

### Step 18 - Implement: Establish isolated native compatibility fixtures

- [ ] 4.2 Implement: Build isolated, version-pinned native compatibility fixtures or offline probes for Claude minimal user state, Codex prompt consumption under default/overridden homes, and OpenCode V2 candidate ordering and mixed representations. Record evidence and supported behavior; do not encode unverified assumptions as expected results.

### Step 19 - Implement: Migrate Claude Code planning

- [ ] 4.3 Implement: Migrate Claude Code's asset and MCP planners to supplied inputs and both declared scopes: native user text roots, top-level user `mcpServers`, the exact `CLAUDE_CONFIG_DIR` state-file rule, strict JSON preservation, missing-versus-malformed handling, and concurrency recovery context; retain project destinations and no-execution behavior.

### Step 20 - Implement: Migrate Codex planning

- [ ] 4.4 Implement: Migrate Codex's asset and MCP planners to supplied inputs and both declared scopes: fixed home `.agents/skills`, Codex-home agents/prompts, and syntax-preserving `mcp_servers` TOML edits that preserve trust/profiles; retain legacy project command placement without translating user commands into skills.

### Step 21 - Implement: Migrate OpenCode planning

- [ ] 4.5 Implement: Migrate OpenCode's asset and MCP planners to supplied inputs and both scopes; share V2-aware `mcp.servers`/legacy handling across project and user plans, preserve controls and syntax, use verified candidate precedence, remove obsolete owned entries from every managed representation, and exclude other scopes/custom/inline layers from ownership and cleanup.

### Step 22 - Implement: Cover native scope and ownership boundaries

- [ ] 4.6 Implement: Extend mandatory conformance seeds and adapter unit tests for complete binary skill bundles, aliases/omissions, owned-only cleanup, no pruning of shared roots, unchanged/absent disclosure, stable candidate sets, relative-override rejection before inspection, Windows paths, unrelated native state, and equivalent other-scope entries not satisfying the selected scope. Add known project/user physical-alias checks in adapter location helpers without arbitrary project discovery. Parameterize conformance coverage by scope with supplied isolated homes and declared overrides. Assert stable asset-root and complete candidate-set disclosure, unchanged modification times for no-op plans, and identical plans for identical requests/filesystem state despite different ambient cwd or environment. Preserve first-party `export default defineAdapter(...)` entry points and migrate adapter/test-kit consumers to check the result before accessing the adapter; use `expect.unreachable()` for failed test-fixture narrowing. Add distribution assertions for the successful result export and its payload's API/capability declarations.

### Step 23 - Verify: Check native conformance and compatibility evidence

- [ ] 4.7 Verify: Run all three adapters' unit, type, and distribution/e2e suites plus affected JSONC/test-kit checks. Require evidence for every supported native layout, both MCP transports, all text types, no writes during planning, no server execution, and unchanged project fixtures before accepting this block. Audit production adapter source for remaining ambient `homedir()`, `process.env`, or `process.cwd()` location reads; distinguish legitimate test setup from runtime resolution, which SHALL use supplied context. Verify that source and distributed first-party exports follow the factory-result contract and that shared conformance consumers inspect success before using the payload.

## 5. Project integration and compatibility rollout — Research

Contracts: [adapter management](specs/adapter__management/spec.md) and [capability eligibility](specs/adapter__sdk/spec.md). Approach: design D2 and Delivery 1.

### Step 24 - Pause: Switch model for exploration

- [ ] 5.1 Pause: Switch model for exploration

### Step 25 - Explore: Map adapter compatibility and eligibility

- [ ] 5.2 Explore: Trace `packages/engine/src/adapters/` verification, loading, npm selection, installation metadata, and capability eligibility; locate asset-only filters that would incorrectly exclude an MCP-only adapter and distinguish missing capability, unsupported scope, and unsupported SDK API. Map factory-result envelope handling, bare-adapter verification, untrusted property reads, and the structured definition/export failures needed by installation and listing.

### Step 26 - Explore: Map project request integration

- [ ] 5.3 Explore: Trace project asset/MCP request construction and replanning in `packages/engine/src/install/materialize.ts:151`, `packages/engine/src/install/mcp/prepare.ts:122`, and `packages/engine/src/install/mcp/apply.ts:48`, plus all affected engine/CLI test adapters; identify the project-only bridge needed to compile and run against SDK API `0.4` before exposing user commands. Include direct factory callers, build-pipeline fixtures, and CLI adapter-install/list diagnostics so a factory result cannot be mistaken for a usable adapter or an API incompatibility.

### Step 27 - Explore: Map foundation documentation and release order

- [ ] 5.4 Explore: Inspect `scripts/release/README.md:61`, prepack metadata stamping, deferred CLI changesets, and current SDK/adapter-management documentation. Map the separate publication cycles and identify all current-contract `0.3` claims, without rewriting historical release entries.

### Step 28 - Propose: Define foundation integration and rollout

- [ ] 5.5 Propose: Present the complete project-integration and rollout approach: one captured planning environment, capability-based eligibility, exact `{0.4}` compatibility, old/new CLI selection tests, foundation documentation, and mechanically deferred CLI release metadata. Explicitly confirm that this foundation exposes no `--user` CLI surface. Specify validated factory-result and bare-adapter normalization at bundle verification, full payload checks, field-addressed failure propagation through loading/listing/CLI diagnostics, and consumer migration without unchecked payload access or throwing unwrap helpers.

## 6. Project integration and compatibility rollout — Implementation

### Step 29 - Pause: Switch model for implementation

- [ ] 6.1 Pause: Switch model for implementation

### Step 30 - Implement: Migrate existing project planner callers

- [ ] 6.2 Implement: Supply explicit project targets and one captured, filtered home/environment context through all existing project install/removal/MCP preparation and replan calls; migrate test adapters and fixtures together so the new SDK has no surviving old-shaped caller and project receipt authority remains unchanged at this stage. Migrate direct factory callers and build/install fixtures to discriminate or propagate `Validated<Adapter>` explicitly, passing only successful adapter payloads into consumers and using `expect.unreachable()` rather than silent returns in tests.

### Step 31 - Implement: Enforce exact SDK API compatibility

- [ ] 6.3 Implement: Require exact SDK API `{0.4}` in engine verification/loading/selection, validate capability declarations, retain package/runtime agreement and non-substitution for exact requests, and preserve actionable provenance-based reinstall diagnostics and listing of incompatible adapters. Validate default-exported factory-result envelopes and fully verify successful payloads; also accept manually constructed API `0.4` adapters under the same checks. Return structured definition/export failures for failed or malformed results, distinguish them from adapter API incompatibility in loading/listing and CLI adapter diagnostics, and pass only verified adapters into build/install pipelines. Add regression coverage proving that success envelopes do not bypass shape/API/package checks, failures do not invoke contract methods or replace working installations, and loading returns all failures without partial success.

### Step 32 - Implement: Select adapters by required capabilities

- [ ] 6.4 Implement: Make adapter eligibility depend on capabilities required by active content or owned cleanup; permit `assets: false` for eligible MCP-only operations, skip unused capabilities, and aggregate unsupported scopes as `ADAPTER_SCOPE_UNSUPPORTED` without conflating them with unsupported capability or SDK API failures. Add compatibility and project pipeline regression tests. Add engine integration tests proving declared location values are captured once per operation, filtered per receiving capability, immutable after capture, and reused across preparation and replanning even when ambient environment values change. Undeclared variables SHALL NOT reach a capability.

### Step 33 - Implement: Document the SDK foundation

- [ ] 6.5 Implement: Update foundation docs in `docs/reference/adapter-sdk.mdx`, `docs/guides/custom-adapters.mdx`, `docs/reference/lockfile-inventory.mdx`, and `docs/cli/adapters/{add,list}.mdx`, plus affected package guidance: explicit contexts, plan disclosures, symmetric capability eligibility, contract migration, and scoped pure planners. Stage claims with the release that ships them; do not advertise a usable `--user` CLI yet. In `docs/reference/adapter-sdk.mdx`, replace “Write project-scoped configuration only. Never create or modify a user-wide or system-wide file.” with “Plan changes only in the requested project or user scope. System-wide configuration remains unsupported.” Document the `Validated<Adapter>` factory result, both approved export forms, structured definition failures, and explicit non-throwing consumer handling; do not show unchecked payload access or throwing unwrap helpers.

### Step 34 - Implement: Prepare staged foundation release metadata

- [ ] 6.6 Implement: Prepare the release handoff following the documented protocol-only cycle when required, then explicit SDK and all-three-adapter changesets. Park the requiring CLI changeset in `scripts/release/deferred/`, document the adapter-publish freeze between cycles, retain first-party `0.3` releases, and require published `facetAdapterApiVersion: 0.4` metadata before that CLI changeset can become active. Do not align package versions, manipulate dist-tags, or publish from this task. Include a protocol changeset for the changed public planners even if no new named export is added; use a separate protocol-first publication cycle when required by the SDK dependency. Identify the exact deferred CLI changeset path in the release handoff.

### Step 35 - Verify: Check project compatibility and foundation packaging

- [ ] 6.7 Verify: Run affected engine adapter/project lifecycle tests, SDK/native distribution tests, package typechecks, release-script tests, and foundation docs validation. Verify old `{0.3}` consumers select compatible releases, new `{0.4}` consumers never fall back, and incompatible exact installs leave working adapters intact; inspect packed metadata against runtime declarations. Run `bun check`. Confirm this change's CLI changeset remains in `scripts/release/deferred/` and no active changeset selects `agent-facets` for the foundation release cycle. Report conflicting changesets without moving or deleting unrelated files. Run affected CLI adapter-install/list tests and typechecks; verify successful/failed factory exports, malformed envelopes, invalid successful payloads, bare API `0.4` adapters, field-addressed diagnostics, and the absence of unchecked factory-result consumers or production throwing unwrap helpers.

## 7. Collection routing and local sources — Research

Contracts: [collection lifecycle and source policy](specs/installation/spec.md). Approach: design D1 and D5.

### Step 36 - Pause: Switch model for exploration

- [ ] 7.1 Pause: Switch model for exploration

### Step 37 - Explore: Map collection routing and identity

- [ ] 7.2 Explore: Trace `facet-dir.ts`, declaration/lockfile I/O, project receipt/lock identities, and add/install/remove/update preparation arguments; design one immutable collection context with explicit state paths, scope, planning inputs, and source policy while keeping shared cache/adapters unchanged. Capture the pre-change `receiptPath` and `computeLockPath` pathname rules and reference expectations before modifying them; do not generate regression expectations from the new implementation.

### Step 38 - Explore: Map local-source policy

- [ ] 7.3 Explore: Trace local source parsing, add-name resolution, canonicalization, project containment, and locked provenance. Identify where user add arguments can be normalized once without changing project tilde handling or weakening authored-file/companion containment.

### Step 39 - Propose: Define collection context and source normalization

- [ ] 7.4 Propose: Present the complete collection-context and source-policy approach, including absent-root canonical identity, relative `FACET_DIR` rejection, reserved user-state protection, initialization only at commit, and tests for cwd-independent declarations and source identity drift. Name the operation-context module and user path helpers, considering `packages/engine/src/install/collection.ts` and `packages/engine/src/facet-dir.ts`. Identify only the exports the CLI actually needs and retain project wrappers only where existing callers require them.

## 8. Collection routing and local sources — Implementation

### Step 40 - Pause: Switch model for implementation

- [ ] 8.1 Pause: Switch model for implementation

### Step 41 - Implement: Resolve independent collection targets

- [ ] 8.2 Implement: Add explicit project/user collection resolution and user declaration/lockfile paths under `$FACET_DIR/user/`; preserve existing project identities and shared facilities. Resolve absent roots through canonical existing ancestors without creating state, reject relative user metadata roots, and reject project operations reinterpreting reserved user state. Implement the reviewed resolver and path helpers in those engine surfaces, exporting only CLI-consumed entry points through `packages/engine/src/index.ts`.

### Step 42 - Implement: Thread collection state through preparation

- [ ] 8.3 Implement: Thread the immutable context through preparation/application arguments and manifest/lockfile I/O rather than changing cwd or fabricating project roots; preserve comment-aware manifest editing, exact version dispatch, extension retention, and project-default behavior.

### Step 43 - Implement: Persist canonical user local sources

- [ ] 8.4 Implement: Normalize new user local-source arguments after source-prefix parsing against invocation cwd and supplied home, validate/canonicalize them, and persist absolute declaration/provenance paths without losing overrides; reject stored relative/tilde references and symlink-retarget drift while preserving project containment.

### Step 44 - Implement: Cover collection and source boundaries

- [ ] 8.5 Implement: Add target/path/source tests for unrelated invocation directories, missing user roots, canonical aliases, relative metadata roots, first-add commit boundaries, hand-edited comments, empty and malformed state, and preserved project source behavior. Add fixed legacy pathname expectations for project receipt and lock paths, including canonical roots and symlink aliases, and assert byte-identical results under an unchanged `FACET_DIR`.

### Step 45 - Verify: Check collection routing and local sources

- [ ] 8.6 Verify: Run focused facet-dir, manifest/lockfile I/O, add preparation, and local-source suites plus engine typechecks; verify failures and read-only resolution create no collection state and no second cache or adapter root exists. Run those pathname compatibility regressions against `receiptPath` and `computeLockPath`.

## 9. Receipt authority, bindings, and coordination — Research

Contracts: [ownership, locking, and approval](specs/installation/spec.md) and [plan disclosure](specs/adapter__mcp-servers/spec.md). Approach: design D4 and D7.

### Step 46 - Pause: Switch model for exploration

- [ ] 9.1 Pause: Switch model for exploration

### Step 47 - Explore: Map receipt and transaction authority

- [ ] 9.2 Explore: Trace exact receipt readers/refinements, ownership reconciliation, consent claims, collection locking, and normal/frozen commits in `packages/engine/src/install/receipt.ts`, `packages/engine/src/install/lockfile-guard.ts`, and `packages/engine/src/install/commit/{ownership,server-ownership,tri-write}.ts`; preserve every existing authority and non-clobbering restoration boundary.

### Step 48 - Explore: Map binding and physical-location validation

- [ ] 9.3 Explore: Trace adapter plan disclosures and pre-approval/replan checkpoints, including no-op plans, newly selected adapters, and required cleanup capabilities. Determine canonical missing-path handling and how to validate known physical aliases without external ownership registries or discovering arbitrary projects.

### Step 49 - Propose: Define receipts and coordination

- [ ] 9.4 Propose: Present the complete receipt `0.5`, binding, and coordination approach: lazy project migration, one semantic inventory, all-bound-adapter participation, no authority inheritance for new user adapters, no empty-ownership probe, and normal-versus-frozen persistence behavior with failure-injection coverage.

## 10. Receipt authority, bindings, and coordination — Implementation

### Step 50 - Pause: Switch model for implementation

- [ ] 10.1 Pause: Switch model for implementation

### Step 51 - Implement: Introduce collection-aware receipt 0.5

- [ ] 10.2 Implement: Add one receipt `0.5` writer with tagged collection identity and user adapter/location bindings; retain exact legacy readers as project receipts, old project receipt paths, existing asset/MCP authority, and lazy writes only after success. Keep declaration bodies, environment snapshots, raw deletion instructions, and adapter hashes out of receipts. Implement the domain-separated `user-<identity-hash>.json` receipt location. Report legacy or project-identified receipts encountered for the user collection as unusable, granting no user ownership, binding, or approval.

### Step 52 - Implement: Coordinate collection mutations under their locks

- [ ] 10.3 Implement: Add the cwd-independent user collection lock and require it before authoritative mutable reads; preserve independent project locks, contention precedence, under-lock removal decisions, and snapshot-bound stale-update rejection, allowing target-identification failures before a lock can be selected.

### Step 53 - Implement: Enforce user adapter and location bindings

- [ ] 10.4 Implement: Enforce all previously bound user materializers with claims, allow new adapters through full reconciliation without historical deletion authority, and compare canonical plan locations with bindings before approval/application and on every existing replan. Handle equivalent/absent plans, unavailable/deselected adapters, empty collections, and restore/remove/reinstall recovery without a preliminary probe.

### Step 54 - Implement: Preserve bounded commits and frozen persistence semantics

- [ ] 10.5 Implement: Validate known physical target and collection-state aliases, retain bounded directory creation/cleanup, and parameterize normal state commits and rollback for user paths. Preserve frozen manifest/lockfile bytes and reported non-fatal receipt-persistence failure; never claim unpersisted ownership, bindings, or approval.

### Step 55 - Implement: Cover receipt and coordination failures

- [ ] 10.6 Implement: Add receipt migration, authority isolation, cross-collection consent, adapter addition/absence, location drift/no-op validation, failed-binding commit, concurrent lock, stale-snapshot, shared-native-document conflict, and rollback tests. Include conservative directory cleanup and frozen receipt-warning regressions. Explicitly cover unsupported `0.5` dispatch in a narrowed reader fixture, binding drift despite equivalent destination content, no inherited deletion authority for a new adapter, missing bound adapters blocking remove-all, failed operations recording no new binding, and physical alias rejection for HOME-rooted projects, linked tool directories, and collection-state paths.

### Step 56 - Verify: Check ownership and coordination guarantees

- [ ] 10.7 Verify: Run receipt, lock, ownership, filesystem transaction, and install receipt suites plus engine types; demonstrate no eager migration, no cross-collection authority, no abandoned old bindings, and exact restoration without overwriting external edits.

## 11. Complete engine lifecycle and read surfaces — Research

Contracts: [installation](specs/installation/spec.md) and [collection-relative inventory](specs/protocol__schemas/spec.md). Approach: design D3, D7, and the engine read surface in D8.

### Step 57 - Pause: Switch model for exploration

- [ ] 11.1 Pause: Switch model for exploration

### Step 58 - Explore: Map install and removal reconciliation

- [ ] 11.2 Explore: Trace verified content projection, complete-set composition, frozen pre-fetch checks, add/install/remove entry points, and removal refinement in `run-install.ts`, `verified-asset-plan.ts`, `commit/compose.ts`, and `install/{add,remove}/`; locate all hard-coded project scopes and locked/receipt authority uses.

### Step 59 - Explore: Map update and read-only collection surfaces

- [ ] 11.3 Explore: Trace update discovery/preparation/application and CLI-local list reads; define the minimal CLI-consumed collection read API, absent/malformed state outcomes, and snapshot comparison needed without adapter installation, receipt migration, content fetching, or persistent lock creation during discovery.

### Step 60 - Propose: Define the complete engine lifecycle

- [ ] 11.4 Propose: Present the whole lifecycle/read-surface implementation approach, including contextual scope errors, full desired-set reconciliation, server-only operations, removal fast-path witness/binding conditions, read-only missing-state behavior, and preservation of all lockfile `0.4` inventory guarantees.

## 12. Complete engine lifecycle and read surfaces — Implementation

### Step 61 - Pause: Switch model for implementation

- [ ] 12.1 Pause: Switch model for implementation

### Step 62 - Implement: Reconcile complete collections through one pipeline

- [ ] 12.2 Implement: Route add/install/remove through the existing collection-aware pipeline and project verified assets into the selected installation scope before composition and lockfile construction. Keep effective-name/namespace/alias/omit rules collection-local; preserve authored content, fingerprints, complete server inventories, and independent user/project versions and approvals.

### Step 63 - Implement: Validate contextual lockfile scope

- [ ] 12.3 Implement: Add `LOCKFILE_SCOPE_MISMATCH` validation before placement, cleanup, or refinement, including frozen pre-fetch failure and verified non-frozen regeneration under existing version-selection rules; reject mismatched update discovery state without treating lockfile metadata as ownership or approval. Update discovery SHALL report a scope-mismatched entry as unusable local resolution state and direct the user to a normal install for the same collection.

### Step 64 - Implement: Preserve safe user removal refinement

- [ ] 12.4 Implement: Extend removal-only refinement with user binding agreement while retaining complete `0.4` inventory and local-witness checks, legacy verified fallback, cancellation behavior, and no fetch of removed content when removing everything. Binding drift or missing bound adapters SHALL stop rather than fall back to resolution.

### Step 65 - Implement: Expose collection-aware update and list APIs

- [ ] 12.5 Implement: Make update discovery/prepare/apply and the new list read surface collection-aware; export only CLI-consumed APIs. Implement the missing-user-state matrix, preserve registry-only update discovery and current flags/version choices, and prohibit initialization, migration, adapter selection, content downloads, and native writes in read-only paths.

### Step 66 - Implement: Cover complete lifecycle transitions

- [ ] 12.6 Implement: Extend engine transition, add/remove/update, frozen, inventory, and discovery tests for all source kinds, companions, both MCP transports, server-only collections, independent same-name scopes, equivalent and conflicting within-scope claims, shared cache reuse, missing/corrupt receipts, and complete rollback. Explicitly test first add from a non-project directory with user declarations/lockfile created only at commit; the same collection from unrelated cwds; independent pins sharing cache; same-name cross-collection coexistence; within-user Keep/Alias/Omit resolution; independent approval including non-interactive refusal; server-only installation; empty versus malformed read state; rollback of operation-created empty directories; missing outer ancestors without widening the boundary; and honest frozen receipt-persistence warnings.

### Step 67 - Verify: Check the complete engine lifecycle

- [ ] 12.7 Verify: Run the extended transition, add/remove/update, frozen, inventory, and discovery suites and engine typechecks; require passing engine unit suites and types before CLI wiring, with explicit checks for unchanged surrounding projects and side-effect-free discovery.

## 13. CLI targeting, presentation, and documentation — Research

Contracts: [CLI](specs/cli/spec.md). Approach: design D8 and Documentation alignment.

### Step 68 - Pause: Switch model for exploration

- [ ] 13.1 Pause: Switch model for exploration

### Step 69 - Explore: Map CLI targeting and presentation

- [ ] 13.2 Explore: Trace shared command flags, all six lifecycle handlers and aliases, install/update views, consent/takeover rendering, recovery formatting, and JSON/verbose branches; identify one targeting rule and every user-visible scope-bearing surface.

### Step 70 - Explore: Audit user-facing documentation and instructions

- [ ] 13.3 Explore: Audit root `README.md`, the six command references, `docs/cli/env.mdx`, install/troubleshooting guides, learning pages, portable specification pages, SDK references, and `packages/cli/src/prompts/usage.txt` against the implemented behavior. Preserve routes/anchors and distinguish current reference updates from immutable historical changelog entries.

### Step 71 - Propose: Define CLI behavior and documentation updates

- [ ] 13.4 Propose: Present the complete CLI and documentation approach: mutation/read command routing, flag combinations, scope-labelled output and recovery, user consent reach, JSON stream purity, native verbose locations, migration/downgrade guidance, and docs ownership by surface. Specify structured failure fields and their existing command-specific rendering/JSON routes. Keep `ADAPTER_SCOPE_UNSUPPORTED` and `LOCKFILE_SCOPE_MISMATCH` as specified; choose other failure-arm names during this proposal rather than treating suggested names as new public contracts.

## 14. CLI targeting, presentation, and documentation — Implementation

### Step 72 - Pause: Switch model for implementation

- [ ] 14.1 Pause: Switch model for implementation

### Step 73 - Implement: Route user mutation commands

- [ ] 14.2 Implement: Add shared command-specific `--user` targeting to add/install/remove and their applicable aliases, passing the engine's explicit target and using invocation cwd only to interpret new local add arguments; preserve source/version flags, adapter selection, no implicit fallback, and separate asset/MCP approval.

### Step 74 - Implement: Route user list and update commands

- [ ] 14.3 Implement: Wire list/update/outdated to collection-aware engine APIs, including `upgrade`, forced dry-run for outdated, exact missing-state outcomes, no implicit user discovery from plain list, and all existing selection, no-op, invalid-flag, and exit-code behavior. Apply the missing-user-state matrix explicitly: list/outdated report empty and exit 0; install/update/remove fail with `facet add --user <facet>` guidance; none initializes state. Removing an undeclared facet is a successful no-op only when the user declarations already exist.

### Step 75 - Implement: Identify scope throughout human output

- [ ] 14.4 Implement: Scope-label progress, summaries, collision/asset takeover/MCP consent screens, failures, rollback, and recovery commands. Add user-wide consent reach, complete unsupported-scope offenders, scope-mismatch recovery, binding/adapter restoration, HOME-rooted-project migration guidance, and secret-safe verbose native locations. Cover the shared install-failure formatter and update error path for unsupported scope, lockfile scope mismatch, binding drift, missing bound adapters, physical/state-path aliases, relative `FACET_DIR`, persisted relative/tilde user sources, and missing collection state. Preserve the distinction between blocking failures and successful non-frozen scope recovery.

### Step 76 - Implement: Preserve scoped JSON and help contracts

- [ ] 14.5 Implement: Add `scope` to every update/outdated JSON success/refusal/failure envelope and keep `applied` relative to the selected collection; preserve one stdout document and empty stderr under `--json --verbose`. Update command help and agent-facing usage instructions without exposing `--user` on unrelated commands.

### Step 77 - Implement: Cover CLI scope and interaction behavior

- [ ] 14.6 Implement: Add focused CLI command, shared-formatting, help/alias, TTY, consent, and JSON tests covering both scopes and every new failure, including user operations from unrelated/project directories, absolute local-source declarations, no surrounding project mutation, and preserved non-interactive behavior. Include help/alias coverage for all six commands; `--user --json --interactive` refusal; no project-to-user fallback; no nearby project mutation; the missing-state matrix; an undeclared-name no-op in an existing collection; user consent reach and bidirectional approval isolation; frozen scope mismatch recovery; HOME-rooted-project cleanup guidance; and single-document stdout with empty stderr under `--user --json --verbose`.

### Step 78 - Implement: Document user workflows and recovery

- [ ] 14.7 Implement: Update `README.md`, `docs/cli/{add,install,update,remove,list,outdated,env}.mdx`, install/troubleshooting guides, and affected learning/overview pages. Document canonical user files, shared cache/adapters, native overrides and Codex prompt invocation, bound-adapter/location recovery, lazy receipt migration and downgrade limits, HOME-as-project cleanup, and the warning to version-control only user declarations/lockfile rather than credentials or all of `FACET_DIR`. In `docs/cli/install.mdx`, replace “Only project-scoped files are touched.” with “Without `--user`, only project-scoped files are touched. With `--user`, the operation targets the independent user collection.” In `docs/cli/env.mdx`, direct dotfiles users to track only `user/facets.json` and optionally `user/facets.lock`, never the entire `FACET_DIR`, and explain receipt migration and downgrade limitations.

### Step 79 - Implement: Align portable documentation and package guidance

- [ ] 14.8 Implement: Update `docs/specification/{project-manifest,lockfile,materialization,install,manifest,terminology}.mdx` and affected package `AGENTS.md` guidance to reflect scoped placement, independent authority, unchanged portable formats, no author opt-in, and explicit opt-in user-wide writes instead of blanket prohibitions. Keep canonical documentation homes and existing anchors; stage release-note material through the release process, not edits to historical changelog entries. In `docs/specification/install.mdx`, replace “An installer MUST NOT modify user-wide or system-wide tool configuration.” with “User-wide tool configuration MUST be modified only by an explicitly selected user-collection operation, with separate MCP approval. System-wide tool configuration MUST NOT be modified.” Historical changelog occurrences remain unchanged.

### Step 80 - Verify: Check CLI contracts and documentation

- [ ] 14.9 Verify: Run CLI unit/types/e2e scripts, `bun run docs:validate`, and `bun run docs:broken-links`; confirm examples, help, API tokens, permissions boundaries, and migration guidance agree with the implemented SDK and lifecycle.

## 15. Cross-package acceptance and release gates — Research

Contracts: all eight [delta specs](specs/). Acceptance and release ordering follow the design's Verification and Migration Plan sections.

### Step 81 - Pause: Switch model for exploration

- [ ] 15.1 Pause: Switch model for exploration

### Step 82 - Explore: Audit complete spec coverage

- [ ] 15.2 Explore: Map every reconciled requirement/scenario to an existing or new unit, conformance, distribution, e2e, native-compatibility, or release check; identify missing coverage without weakening the spec. Include scope-neutral authoring/build behavior and the regression scenarios added during reconciliation.

### Step 83 - Explore: Audit end-to-end and release evidence

- [ ] 15.3 Explore: Inspect isolated compiled-CLI fixtures and failure-injection facilities for multi-adapter user/project coexistence, concurrency, frozen receipts, and publication compatibility; identify which native-version and npm-metadata evidence is still missing before a release can be claimed ready.

### Step 84 - Propose: Define final acceptance and release gates

- [ ] 15.4 Propose: Present the final cross-package acceptance matrix and staged release checklist, separating implementation completion from publication authorization and retaining the complete text-plus-MCP first-release gate. Include the exact deferred CLI changeset path and its conditional activation after publication checks. Approval of local changeset activation SHALL remain separate from authorization to publish or merge a release PR.

## 16. Cross-package acceptance and release gates — Implementation

### Step 85 - Pause: Switch model for implementation

- [ ] 16.1 Pause: Switch model for implementation

### Step 86 - Implement: Cover the complete user lifecycle end to end

- [ ] 16.2 Implement: Add isolated compiled-CLI scenarios that install, list, reproduce, update, discover outdated versions, and remove mixed and server-only user facets through all three first-party adapters from unrelated directories; prove independent project/user pins, same-name coexistence, bidirectional consent isolation, and shared verified cache reuse.

### Step 87 - Implement: Cover cross-package failures and concurrency

- [ ] 16.3 Implement: Add cross-package failure and concurrency coverage for first-add rollback, missing/corrupt/legacy receipts, bound-adapter addition/absence, environment and symlink location drift including no-op plans, known physical aliases, malformed native documents, concurrent native edits, normal commit failures, frozen unpersisted receipts, and removal refinement/fallback.

### Step 88 - Implement: Close authoring and consumer conformance gaps

- [ ] 16.4 Implement: Add authoring/build and package-consumer regressions proving one unchanged artifact serves both scopes, opaque top-level/descriptor scope extensions do not control placement, server scope fields remain rejected, scaffolding asks no installation scope, and archive-only files remain unmaterialized. Close every remaining coverage gap from group 15.

### Step 89 - Implement: Finalize the staged release handoff

- [ ] 16.5 Implement: Finalize the staged release handoff and deferred CLI changesets with explicit opt-in safety-boundary, SDK reinstall, native compatibility, and receipt downgrade notes. Keep the CLI changeset inactive until required protocol/SDK releases and all three published adapter metadata declarations are confirmed; leave historical changelog entries unchanged and do not publish automatically.

### Step 90 - Verify: Check complete acceptance and publication prerequisites

- [ ] 16.6 Verify: Run all affected package unit/type/distribution/e2e suites, protocol Node-only checks, docs validation/link checks, and `bun check`. Confirm the native evidence and old/new CLI compatibility matrices. After the prerequisite library release cycle has published, run:

```sh
npm view @agent-facets/adapter-claude-code facetAdapterApiVersion --json
npm view @agent-facets/adapter-opencode facetAdapterApiVersion --json
npm view @agent-facets/adapter-codex facetAdapterApiVersion --json
```

Each result SHALL be the string `"0.4"`. Confirm publication of the approved SDK release and any required protocol release, recording their package versions separately from the API identifier. If publication, compatibility, or native evidence is missing, STOP, report the gate as blocked, and leave the CLI changeset parked. No text-only `--user` release is permitted.

### Step 91 - Implement: Activate the verified CLI changeset

- [ ] 16.7 Implement: Only after 16.6 passes, move this change's finalized agent-facets changeset from scripts/release/deferred/ into .changeset/, preserving its contents and unrelated files. Do not publish packages, merge release PRs, or create tags.

### Step 92 - Verify: Check activated CLI release metadata

- [ ] 16.8 Verify: Run bun check; confirm this change's finalized CLI changeset exists in .changeset/ and its parked counterpart is absent. Confirm no first-party adapter changeset is pending in the same CLI release cycle. Report conflicting or unrelated changesets without deleting or moving them.

### Step 93 - Review: Review completion evidence and release handoff

- [ ] 16.9 Review: Present the completed requirement-to-check mapping, native compatibility evidence, project regression results, and staged release prerequisites for approval. Distinguish verified implementation from any separately authorized publication action; do not publish or archive automatically.
