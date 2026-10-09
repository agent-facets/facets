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

Execution authority is the reconciled `proposal.md`, `design.md` (D1–D8), and both change-local delta specs. These checkboxes describe future work; artifact creation does not complete them. Read each affected package's `AGENTS.md` before editing it. Use `mise exec --` when Bun is not on PATH.

This plan is pause-enabled. Each globally numbered step heading and its immediately following OpenSpec checkbox describe exactly one execution TODO; the group/item ID is only the OpenSpec progress identifier. Each Verify failure stops execution rather than authorizing fixes inside that step. Independent Explore steps within one Research group can be delegated in parallel; their final Propose gate precedes implementation.

Groups 1–2 establish pure planning primitives. Groups 3–4 add the `0.4` reader and public inventory derivation while the current writer remains `0.3`. Groups 5–6 establish same-integrity server reconciliation and its diagnostics before writer activation. Groups 7–8 coordinate the writer aliases, constructors, extension preservation, frozen-policy changes, removal behavior, failure consumers, and current-format fixtures. These must agree before that cutover is verified. Intermediate reader support is not a release milestone: do not publish intermediary states, weaken types, or invent `servers: []`. Groups 9–10 prove public and command boundaries; groups 11–12 finish documentation and release preparation. No publishing, tagging, merging, or permanent-spec synchronization is part of this checklist.

Protocol filenames below are relative to `packages/protocol/src`; installation filenames are relative to `packages/engine/src/install` unless otherwise qualified.

## 1. Fingerprints and shared server planning — Research

### Step 1 - Explore: Audit the canonical fingerprint contract
- [x] 1.1 Explore: Audit the canonical fingerprint contract

Inspect the existing canonical encoder, fingerprint validation, public exports, and fixed-vector tests in `packages/protocol/src/mcp/fingerprint.ts`, `src/index.ts`, and `src/__tests__/mcp-server.test.ts`; identify the independently pinned `0.4` encoding constant without changing either transport's encoding.

### Step 2 - Explore: Map shared server-planning semantics
- [x] 1.2 Explore: Map shared server-planning semantics

Inspect `materialization/servers.ts`, `effective-name.ts`, and existing planner tests; map declaration freezing, portable identities, claimant ordering, invalid-alias failures, omissions, and stale overrides to the declaration-free planner contract in D3.

### Step 3 - Propose: Agree the pure planning changes
- [x] 1.3 Propose: Agree the pure planning changes

Present the shared-core extraction, public fingerprint-only planner/result shapes, encoding exports, and equivalence-test approach for all of group 2, preserving existing declaration-based APIs and the Adapter SDK API. Obtain approval before writing.

### Step 4 - Pause: Switch model for implementation
- [x] 1.4 Pause: Switch model for implementation

## 2. Fingerprints and shared server planning — Implementation

### Step 5 - Implement: Export fixed encoding identifiers
- [x] 2.1 Implement: Export fixed encoding identifiers

Expose `MCP_SERVER_FINGERPRINT_ENCODING` and an independent literal `LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING`, including public exports; retain the exact `facets:mcp-server:v1` preimages and do not yet switch current lockfile aliases.

### Step 6 - Implement: Add the fingerprint-only server planner
- [x] 2.2 Implement: Add the fingerprint-only server planner

Extract the private shared server-claim core and add public `planLockedServerInventory` with its declaration-free types; retain existing `planServerMaterialization` signatures, clone/freeze behavior, complete claimants, and separate invalid-alias/collision results with stale diagnostics.

### Step 7 - Implement: Pin fingerprints and planner equivalence
- [x] 2.3 Implement: Pin fingerprints and planner equivalence

Extend `packages/protocol/src/__tests__/mcp-server.test.ts` with fixed preimage and digest vectors for `["facets:mcp-server:v1","stdio","npx",[],[]]` and `["facets:mcp-server:v1","http","https://example.com/mcp"]`. Pin compact JSON, sorted environment pairs, absent-collection normalization, name/source independence, and the independent encoding constants. Compare both planners over generated input permutations, including “missing override means authored,” alias swaps, stale `gone` on an empty facet, invalid aliases distinct from collisions, and collisions retaining unrelated stale diagnostics.

### Step 8 - Verify: Check the pure planning boundary
- [x] 2.4 Verify: Check the pure planning boundary

Run `bun run --cwd packages/protocol test`, `bun run --cwd packages/protocol types`, `bun run --cwd packages/engine types`, and `bun run --cwd packages/cli types`. Confirm the existing declaration-based callers and current `0.3` writer still work at this boundary. Stop and report any failure.

## 3. Lockfile reader and inventory API — Research

### Step 9 - Pause: Switch model for exploration
- [ ] 3.1 Pause: Switch model for exploration

### Step 10 - Explore: Audit exact-reader contracts
- [ ] 3.2 Explore: Audit exact-reader contracts

Inspect protocol `schemas/lockfile.ts`, `loaders/lockfile.ts`, `index.ts`, `lockfile-versions.test.ts`, and `duplicate-json-members.test.ts`. Identify exhaustive read-side consumers affected by adding `0.4`, without changing current-writer aliases.

### Step 11 - Explore: Map public inventory result coverage
- [ ] 3.3 Explore: Map public inventory result coverage

Map D3's authored/selected results, provenance copies, legacy unavailability, collisions, and recorded-disposition translation to existing protocol planner fixtures.

### Step 12 - Propose: Agree the reader-only boundary
- [ ] 3.4 Propose: Agree the reader-only boundary

Present the schema, exact-reader, derivation, public-type, and test changes for group 4. Keep the writer at `0.3`; defer write-side extension merging and constructor changes to group 8. Obtain approval.

### Step 13 - Pause: Switch model for implementation
- [ ] 3.5 Pause: Switch model for implementation

## 4. Lockfile reader and inventory API — Implementation

### Step 14 - Implement: Add the exact 0.4 schema and reader
- [ ] 4.1 Implement: Add the exact 0.4 schema and reader

Add explicit `0.4` schema/types, required sorted server records, exact parser dispatch, supported-reader membership, and public exports. Retain `0.2`/`0.3` readers and current `0.3` writer aliases. Update necessary exhaustive read-side consumers without temporary public compatibility shapes or unchecked casts.

### Step 15 - Implement: Derive public locked MCP inventory
- [ ] 4.2 Implement: Derive public locked MCP inventory

Implement `deriveLockedMcpInventory` using the fingerprint-only planner and recorded dispositions. Return copied readonly authored and selected provenance, every distinct origin, authored evidence on collision without partial selection, and explicit legacy unavailability. Do not accept manifest overrides or expose opaque extensions.

### Step 16 - Implement: Test exact schemas and duplicate JSON members
- [ ] 4.3 Implement: Test exact schemas and duplicate JSON members

Extend `lockfile-versions.test.ts` and `duplicate-json-members.test.ts`: required empty arrays; missing, invalid, duplicate, and unsorted records; exact dispatch without fallback; unchanged asset shapes; opaque `command` extensions; and duplicate JSON members inside server records rejected before schema validation.

### Step 17 - Implement: Test public inventory boundaries
- [ ] 4.4 Implement: Test public inventory boundaries

Cover server-only/mixed/all-omitted cases, alias provenance, every origin including two authored names from one facet, conflicts with unrelated clean servers but no partial selection, distinct identities sharing fingerprints, empty current success versus legacy unavailability, legacy lookalikes, replaced fingerprints reported without verification, manifest independence, deterministic ordering, and input/output isolation.

### Step 18 - Verify: Check the reader-only boundary
- [ ] 4.5 Verify: Check the reader-only boundary

Run protocol unit tests and types, engine and CLI typechecks, and lint. Confirm current `0.3` writing remains functional. Stop on failure; this checkpoint does not authorize releasing partial CLI support.

## 5. Verified server reconciliation — Research

### Step 19 - Pause: Switch model for exploration
- [ ] 5.1 Pause: Switch model for exploration

### Step 20 - Explore: Trace verified-content reconciliation
- [ ] 5.2 Explore: Trace verified-content reconciliation

Inspect installation `commit/resolve-all.ts`, `commit/reconcile.ts`, source resolvers, and warm/cold fixtures. Locate the previous document-version discriminator and the boundary before composition, approval, adapter planning, and cleanup.

### Step 21 - Explore: Audit reconciliation failure consumers
- [ ] 5.3 Explore: Audit reconciliation failure consumers

Inspect `types.ts` and CLI `commands/shared/install-failure.ts` and `tui/views/install/failure-block.tsx`. Identify all consumers of the two new reconciliation failures.

### Step 22 - Propose: Agree the reconciliation boundary
- [ ] 5.4 Propose: Agree the reconciliation boundary

Present group 6's same-integrity checks, typed failures, CLI rendering, and tests. Preserve legacy behavior and the current `0.3` writer; dispositions remain project intent rather than content. Obtain approval.

### Step 23 - Pause: Switch model for implementation
- [ ] 5.5 Pause: Switch model for implementation

## 6. Verified server reconciliation — Implementation

### Step 24 - Implement: Reconcile server metadata before side effects
- [ ] 6.1 Implement: Reconcile server metadata before side effects

Add `RECONCILE_SERVER_IDENTITY` and `RECONCILE_SERVER_FINGERPRINT`; discriminate on the previous document version and compare complete authored names and recomputed fingerprints for unchanged-integrity `0.4` entries. Include omitted records, skip legacy lookalikes, and do not compare dispositions.

### Step 25 - Implement: Render reconciliation failures honestly
- [ ] 6.2 Implement: Render reconciliation failures honestly

Update every CLI consumer with facet/authored-name and expected/observed fingerprint data. Explain review/restoration of inconsistent metadata rather than promising silent retry repair; disclose no declaration values.

### Step 26 - Implement: Test reconciliation across acquisition paths
- [ ] 6.3 Implement: Test reconciliation across acquisition paths

Extend reconciliation, resolution, and `run-install.test.ts` coverage for missing `gone`, unexpected `extra`, changed and omitted fingerprints, warm/cold acquisition, registry/git/local sources, legitimate integrity updates, and normal intent edits. Assert failure before prompts, adapter planning, cleanup, and writes; use explicit `0.4` input fixtures without requiring the writer switch.

### Step 27 - Verify: Check reconciliation independently
- [ ] 6.4 Verify: Check reconciliation independently

Run protocol, engine, and CLI unit-test scripts and typechecks plus lint. Confirm existing `0.3` workflows still pass and the new `0.4` checks fail before side effects. Stop on failure.

## 7. Writer and lifecycle activation — Research

### Step 28 - Pause: Switch model for exploration
- [ ] 7.1 Pause: Switch model for exploration

### Step 29 - Explore: Audit composition and write-side preservation
- [ ] 7.2 Explore: Audit composition and write-side preservation

Inspect `commit/compose.ts`, `lockfile-io.ts`, `run-install.ts`, and protocol `preserveLockfileExtensions`. Map current-entry constructors, complete planned servers, serialization, and extension matching.

### Step 30 - Explore: Audit frozen and display capabilities
- [ ] 7.3 Explore: Audit frozen and display capabilities

Inspect `frozen-gates.ts` and CLI `tui/views/install/install-view.tsx`, specifically `assetMaterializationNotes`. Find every single-version capability check and identify the legacy-policy changes that must accompany the writer switch.

### Step 31 - Explore: Audit removal witnesses and fallback context
- [ ] 7.4 Explore: Audit removal witnesses and fallback context

Inspect `remove/refine.ts`, `run-remove.ts`, receipt handling, and CLI removal diagnostics. Trace complete-inventory eligibility, two-way claim matching, shared servers, stale pruning, zero-remaining behavior, and obsolete receipt-asset removal.

### Step 32 - Explore: Classify current and legacy fixtures
- [ ] 7.5 Explore: Classify current and legacy fixtures

Inspect `compose.test.ts`, `lockfile-io.test.ts`, `manifest-transaction.test.ts`, `run-install.test.ts`, `refine-removal.test.ts`, `run-remove.test.ts`, and `update/__tests__/{discover,prepare}.test.ts`. Separate current-writer fixtures from intentional legacy cases.

### Step 33 - Propose: Agree the coordinated writer activation
- [ ] 7.6 Propose: Agree the coordinated writer activation

Present all group 8 changes and their ordering. Writer aliases, constructors, legacy frozen refusal, removal policy, CLI consumers, and fixtures move together; reconciliation is already available. No temporary public shapes, unchecked casts, or fabricated empty inventories. Obtain approval.

### Step 34 - Pause: Switch model for implementation
- [ ] 7.7 Pause: Switch model for implementation

## 8. Writer and lifecycle activation — Implementation

### Step 35 - Implement: Compose complete verified server records
- [ ] 8.1 Implement: Compose complete verified server records

Build each facet's records from final `mcpServers.planned`, never active configurations, adapter requests, or receipts. Preserve omitted and separate identical-origin records, generate explicit empty inventories from verified definitions, and retain the existing transactional commit.

### Step 36 - Implement: Preserve server extensions and deterministic serialization
- [ ] 8.2 Implement: Preserve server extensions and deterministic serialization

Extend protocol's write-side merge for previous `0.4` records matched by authored name. Replace legacy `servers` lookalikes without interpreting elements; preserve unrelated extensions and own-property-safe indexing. Keep sorted output, two-space indentation, and one trailing newline.

### Step 37 - Implement: Activate frozen server checks and diagnostics
- [ ] 8.3 Implement: Activate frozen server checks and diagnostics

Use exact asset capability `{0.3, 0.4}` and server capability `{0.4}`. Plan locked fingerprints with manifest overrides before fetch, retaining empty facets and complete collision/stale reports. Add metadata-only failures and their CLI rendering; preserve `requiredVersion: 0.3` for asset-only refusal and `0.4` for server refusal. Remove the redundant post-compose stale-server gate once legacy server overrides refuse early.

### Step 38 - Implement: Activate safe removal and migration fallback
- [ ] 8.4 Implement: Activate safe removal and migration fallback

Carry complete `0.4` inventories, require two-way active record/receipt agreement, permit omitted records without claims and shared identical claimants, and prune stale intent transactionally. Legacy remaining entries require verified resolution; zero remaining facets fetch none. Preserve receipt-only authority, remove obsolete receipt assets, and carry migration context with underlying typed failures through CLI rendering.

### Step 39 - Implement: Switch current writers and all constructors together
- [ ] 8.5 Implement: Switch current writers and all constructors together

Activate `CURRENT_LOCKFILE_VERSION`, current schemas/types, and writer aliases at `0.4`; finish every current-entry constructor, empty-lockfile path, serializer, fixture helper, and current-version assertion in this block. Fix `assetMaterializationNotes` to recognize `0.3` and `0.4`, while keeping MCP outcome reporting result/receipt-based. Preserve explicit legacy fixtures and frozen retained-document results. Change no other version axis.

### Step 40 - Implement: Test verified writing and extension migration
- [ ] 8.6 Implement: Test verified writing and extension migration

Extend `compose.test.ts`, `lockfile-extensions.test.ts`, `lockfile-io.test.ts`, and `manifest-transaction.test.ts` for complete per-facet inventories, `0.2`/`0.3` migration, legacy lookalike replacement, alias-preserved and removed-record extensions, `__proto__` facet keys, byte-deterministic output, formatting, failed migration, and transaction rollback.

### Step 41 - Implement: Test the full frozen matrix
- [ ] 8.7 Implement: Test the full frozen matrix

Cover stale `gone` on an empty inventory, removed aliases, changed omissions, conflicting records, manifest-only collision cures, zero-fetch/zero-mutation refusal, legacy server overrides, legacy default intent, and asset aliases under both `0.3` and `0.4`. Assert later content/inventory/native/approval failures still run and receipt-only server-orphan cleanup still occurs after valid gates.

### Step 42 - Implement: Test removal and receipt authority
- [ ] 8.8 Implement: Test removal and receipt authority

Extend `refine-removal.test.ts` and `run-remove.test.ts` for complete offline refinement, legacy fallback and acquisition failure context, both directions of claim mismatch, shared identical claimants, omitted records, transactional stale pruning, preserved extensions, and zero-remaining legacy or missing-receipt cases. Explicitly cover “Successful removal drops obsolete receipt assets” and “Unowned entry is not deleted from lockfile evidence.”

### Step 43 - Implement: Test discovery and recovery diagnostics
- [ ] 8.9 Implement: Test discovery and recovery diagnostics

Extend `update/__tests__/discover.test.ts` and `prepare.test.ts` to prove supported versions are read without migration or declaration acquisition merely to inspect versions. Test complete metadata diagnostics, required-version values, migration versus corruption remedies, and declaration-disclosure limits.

### Step 44 - Verify: Check the activated lifecycle
- [ ] 8.10 Verify: Check the activated lifecycle

Run protocol, engine, and CLI unit-test scripts and typechecks, CLI e2e tests, and lint. Confirm all non-frozen writers emit valid `0.4`, legacy behavior matches the final matrix, and no incomplete constructors or invented inventories remain. Stop on failure.

## 9. Public consumers and command-level behavior — Research

### Step 45 - Pause: Switch model for exploration
- [ ] 9.1 Pause: Switch model for exploration

### Step 46 - Explore: Inspect published-consumer test infrastructure
- [ ] 9.2 Explore: Inspect published-consumer test infrastructure

Inspect protocol build/publish exports, emitted declarations, `scripts/smoke/protocol-node.mjs`, and existing packed-package test patterns. Plan an isolated Node 22+ consumer harness that proves Bun is unavailable, uses installed local dependencies without registry access, and cannot leave workspace manifests rewritten by pack hooks.

### Step 47 - Explore: Map command-level regression coverage
- [ ] 9.3 Explore: Map command-level regression coverage

Inspect CLI e2e fixtures and selected-adapter/native-document tests; map remaining specification scenarios to public-consumer and command-level evidence, especially migration recovery, pre-fetch rejection, per-facet origins, rollback, and unchanged consent/takeover behavior.

### Step 48 - Propose: Agree public and command-boundary verification
- [ ] 9.4 Propose: Agree public and command-boundary verification

Present the public-entrypoint, packaged-output, Node-only, and CLI end-to-end verification approach for all of group 10, including the new protocol `test:e2e` wiring and isolation of build-dependent tests from unit tests. Obtain approval before writing.

### Step 49 - Pause: Switch model for implementation
- [ ] 9.5 Pause: Switch model for implementation

## 10. Public consumers and command-level behavior — Implementation

### Step 50 - Implement: Demonstrate consumer-owned offline verification
- [ ] 10.1 Implement: Demonstrate consumer-owned offline verification

Add a source-level consumer test importing only protocol's public index. Parse a current lockfile, derive authored/selected origins, independently fingerprint exported portable declarations, and compare complete effective-name/fingerprint sets; prove changed argument order, missing servers, and unexpected servers fail comparison without cache, archives, adapters, or network. Place the source-level workflow in `packages/protocol/src/__tests__/public-inventory.test.ts`.

### Step 51 - Implement: Automate Node-only published-package coverage
- [ ] 10.2 Implement: Automate Node-only published-package coverage

Add protocol `*.e2e.test.ts` coverage of packaged/published exports and declarations under Node 22+ with Bun absent from PATH. Exercise the inventory consumer from isolated local package fixtures, not workspace-only source exports; add `test:e2e` with an explicit build and exclude these tests from the unit script without making unit tests or typechecks depend on build. Assert the child runtime version and that its isolated PATH cannot resolve Bun, including through tool-manager shims; use local dependencies and disable network for consumer operations. Use `packages/protocol/src/__tests__/public-inventory.e2e.test.ts`. Set `test:e2e` to build explicitly before running these tests, following `bun run build && bun test src/__tests__/*.e2e.test.ts`; exclude `**/*.e2e.test.ts` from the unit script. Use the existing root Turbo task unless an actual configuration gap is demonstrated.

### Step 52 - Implement: Exercise CLI format and migration behavior
- [ ] 10.3 Implement: Exercise CLI format and migration behavior

Extend CLI e2e tests for `0.4` server-only/mixed installs, aliases and omissions, identical/conflicting declarations, legacy migration and frozen refusal/recovery, required-version reporting, and metadata-only diagnostics. Use local fixtures or controlled transports; assert no MCP launch/connection and no project/native mutation on gated failures. Ground these cases in `packages/cli/src/__tests__/collision.e2e.test.ts`, `mcp-consent.e2e.test.ts`, and `remove.e2e.test.ts`.

### Step 53 - Implement: Preserve authority and transaction regressions
- [ ] 10.4 Implement: Preserve authority and transaction regressions

Add or retain command-level regressions for approvals remaining machine-local, lock records granting no takeover/deletion authority, shared-claim removal, native drift, rollback, and retained legacy frozen documents. Keep the documented verification recipe in sync with the public-consumer test rather than adding a comparison API.

### Step 54 - Implement: Update the manual Node smoke check
- [ ] 10.5 Implement: Update the manual Node smoke check

Extend `scripts/smoke/protocol-node.mjs` with `0.4` exact-dispatch and inventory-derivation checks while retaining legacy coverage. Replace its `grep -v bun` PATH recipe with the tested shim-proof isolation approach used by the automated harness. Update `scripts/README.md` in the same step to distinguish manual smoke coverage from automated e2e coverage and provide the correct invocation.

### Step 55 - Verify: Check public consumers and command boundaries
- [ ] 10.6 Verify: Check public consumers and command boundaries

Run `bun run --cwd packages/protocol test:e2e`, `bun run --cwd packages/cli test:e2e`, `bun run --cwd packages/adapter test:e2e`, first-party adapter unit suites, and the protocol public-consumer unit tests. Confirm Node-only operation, correct published JavaScript/type exports, no declaration leakage, and unchanged Adapter SDK API `0.3` compatibility. Stop and report failed or blocked checks. Run the updated manual smoke check with the same verified Bun-free isolation. Confirm packing tests leave workspace manifests unchanged.

## 11. Documentation and release preparation — Research

### Step 56 - Pause: Switch model for exploration
- [ ] 11.1 Pause: Switch model for exploration

### Step 57 - Explore: Audit documentation claims and links
- [ ] 11.2 Explore: Audit documentation claims and links

Recheck `README.md`, the affected specification/CLI/guide pages, `docs/docs.json`, `docs/AGENTS.md`, and script smoke-test documentation against the implemented public names and format matrix. Locate inbound links to the obsolete lockfile section and confirm the existing README consent/ownership promises remain true.

### Step 58 - Explore: Confirm release preparation rules
- [ ] 11.3 Explore: Confirm release preparation rules

Recheck `.changeset/config.json`, `scripts/README.md`, and release documentation for pre-1.0 breaking bumps, ignored packages, generated release notes, and packed-export rules. Confirm this change needs protocol and CLI release metadata, not an Adapter SDK API rollout or manually edited package versions.

### Step 59 - Propose: Agree documentation and release-note scope
- [ ] 11.4 Propose: Agree documentation and release-note scope

Present the documentation, reproducible consumer example, compatibility/migration warnings, and changeset scope for all of group 12, including the local-source fingerprint disclosure risk and the distinction between capability version and current writer version. Obtain approval before writing.

### Step 60 - Pause: Switch model for implementation
- [ ] 11.5 Pause: Switch model for implementation

## 12. Documentation and release preparation — Implementation

### Step 61 - Implement: Document the lockfile 0.4 contract
- [ ] 12.1 Implement: Document the lockfile 0.4 contract

Update `docs/specification/lockfile.mdx`: examples and reader/writer versions, complete server arrays, encoding binding, opaque extensions, legacy lookalikes, migration, and fingerprint disclosure. Replace the obsolete no-server-inventory section while preserving or redirecting its anchor.

### Step 62 - Implement: Correct omitted-server documentation
- [ ] 12.2 Implement: Correct omitted-server documentation

Update `docs/specification/materialization.mdx`, explicitly replacing “An omitted server leaves no lockfile trace.” Preserve naming, composition, and approval semantics and repair its obsolete section link.

### Step 63 - Implement: Document frozen and verified-content ordering
- [ ] 12.3 Implement: Document frozen and verified-content ordering

Update `docs/specification/install.mdx`: Format capability, Plan over the locked set, Stale intent, and Intent against recorded disposition. Separate pre-fetch checks from later content/native checks and explain legacy removal fallback.

### Step 64 - Implement: Document the public inventory APIs
- [ ] 12.4 Implement: Document the public inventory APIs

Add `docs/reference/lockfile-inventory.mdx` and navigation in `docs/docs.json`. Cover parsing, authored/selected views, all origins, unavailable/conflict results, recorded derivation versus override-aware planning, and the tested consumer-owned comparison example. State trust/disclosure limits without adding an API or CLI command.

### Step 65 - Implement: Explain install migration and recovery
- [ ] 12.5 Implement: Explain install migration and recovery

Update `docs/cli/install.mdx`, replacing the claim that server overrides never cause legacy-format refusal and generalizing the `0.2` troubleshooting entry. Explain capability versus writer versions, metadata-corruption recovery, and unchanged consent.

### Step 66 - Implement: Explain removal migration costs
- [ ] 12.6 Implement: Explain removal migration costs

Update `docs/cli/remove.mdx` with legacy remaining-content fallback, possible network/approval cost, zero-remaining behavior, and recovery. Document rollback through the corresponding committed manifest/lockfile pair, not version-label edits or lockfile deletion.

### Step 67 - Implement: Refresh the installation guide example
- [ ] 12.7 Implement: Refresh the installation guide example

Update `docs/guides/install-facets.mdx` to `0.4` with complete server arrays and links to canonical migration guidance. Leave the accurate README and Adapter SDK contracts unchanged.

### Step 68 - Implement: Prepare protocol and CLI changesets
- [ ] 12.8 Implement: Prepare protocol and CLI changesets

Add changeset release notes for `@agent-facets/protocol` and `agent-facets` using appropriate pre-1.0 minor bumps. Explain upgrade/migration requirements and unchanged SDK/approval boundaries. Do not bump ignored packages, hand-edit package versions, publish, or pre-author shipped changelog entries.

### Step 69 - Verify: Run final documentation and repository checks
- [ ] 12.9 Verify: Run final documentation and repository checks

Run documentation validation, broken-link checks, `bun test scripts/lib/changesets.test.ts`, `bun check`, and strict validation of this OpenSpec change. Check edited documentation prose for forbidden em dashes/spaced double hyphens without treating literal flags or untouched historical text as violations. Audit production protocol source for new Bun, filesystem, network, or adapter dependencies. Stop on failure; formatting repairs are implementation work, not part of Verify.

### Step 70 - Review: Confirm scope and specification coverage
- [ ] 12.10 Review: Confirm scope and specification coverage

Review the final diff and requirement-to-test evidence against D1–D8 and both reconciled delta specs. Map every changed requirement to passing evidence or an explicit gap. Check legacy paths, metadata verification, receipt authority, version-axis isolation, Node-only operation, and release scope. Present findings and obtain feedback through the Review gate without advancing archival or release workflows.
