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

## 1. Protocol declarations and authored artifacts — Research

- [x] 1.1 Explore: Map the current facet-manifest, legacy-manifest, project-manifest, archive, build-validation, lockfile, and standalone-server schema paths and their test fixtures.
- [x] 1.2 Explore: Inspect the materialization planner and identity helpers to identify the smallest generic effective-name core that can serve assets and MCP servers without widening `AssetType`.
- [x] 1.3 Propose: Define the protocol implementation approach for the closed declaration union, environment-name validation, canonical fingerprint, exact version dispatch, and exported declaration type consumed by the Adapter SDK without a runtime dependency.

## 2. Protocol declarations and authored artifacts — Implementation

- [x] 2.1 Implement: Add the portable stdio/Streamable HTTP declaration schema and exported type, including closed-arm validation, portable server/environment names, literal values, non-empty commands, and absolute HTTP(S) URLs.
- [x] 2.2 Implement: Replace current server references with concrete declarations, explicitly reject current version-string and `{ image }` forms, admit server-only facets, retain top-level extension tolerance, reject every legacy `servers` member without fallback, and preserve actionable field-path errors.
- [x] 2.3 Implement: Add the canonical declaration fingerprint with deterministic `sha256:` output, stable tagged encoding, ordered arguments, code-unit-sorted environment keys, omitted/empty normalization, and name independence.
- [x] 2.4 Implement: Advance the project manifest to `0.2` with a frozen `0.1` schema, closed `servers` alias/omit overrides, exact three-form dispatch, canonical compact entries, and duplicate-member protection.
- [x] 2.5 Implement: Extract a generic deterministic effective-name planning primitive and add separate MCP identity, plan, collision, invalid-alias, and stale-override wrappers while keeping asset domain types and `AssetType` unchanged.
- [x] 2.6 Implement: Remove standalone `server.json` schemas, loaders, exports, tests, and source-map references from protocol and engine surfaces.
- [x] 2.7 Implement: Extend build/archive/loader tests for declaration validation, prior-output preservation, non-execution, server-only archives, legacy rejection, unchanged lockfile `0.3`, empty asset lists, and declaration-integrity drift.
- [x] 2.8 Verify: Run focused common/protocol/engine-loader tests and type checks, then confirm the published protocol surface contains concrete declarations and no standalone server artifact API.

## 3. Adapter SDK and compatibility window — Research

- [x] 3.1 Explore: Inspect Adapter SDK factory/types/build output and determine the zero-runtime type-import and declaration-bundling path from the protocol source of truth.
- [x] 3.2 Explore: Map engine adapter verification, loading, placement, npm selection, package/runtime agreement, diagnostics, and test helpers that currently assume one supported API token.
- [x] 3.3 Propose: Define the API `0.2` capability/result unions and the atomic rollout that keeps API `0.1` asset-only adapters usable while making `{0.1, 0.2}` the engine's sole concrete support-set declaration.

## 4. Adapter SDK and compatibility window — Implementation

- [x] 4.1 Implement: Add the required `mcpServers: false | McpServerCapability` SDK field and complete batch prepare/apply request, outcome, opaque-plan, path-disclosure, and structured-failure types using the protocol declaration type directly.
- [x] 4.2 Implement: Update `defineAdapter` validation and exports so partial MCP capabilities are unrepresentable, author-supplied API identifiers remain ignored, and first-party definitions explicitly declare initial MCP support state.
- [x] 4.3 Implement: Atomically advance the SDK canonical API to `0.2` and widen the engine's authoritative exact support set to `{0.1, 0.2}` without range or ordering semantics.
- [x] 4.4 Implement: Make runtime shape verification API-aware: preserve the tagged asset contract for `0.1`, require the complete `mcpServers` field for `0.2`, and invoke no contract method before verification.
- [x] 4.5 Implement: Cover loading, listing, package/runtime mismatch, npm highest-compatible selection across both tokens, positional `0.0` rejection, and complete actionable diagnostics without duplicating the support-set literal.
- [x] 4.6 Verify: Run focused Adapter SDK, engine adapter-management, prepack, package-build, and dist e2e checks for both supported contracts.

## 5. First-party native MCP adapters — Research

- [x] 5.1 Explore: Inspect Claude Code and OpenCode native JSON/JSONC schemas, project-file precedence, comment-preservation behavior, equality semantics, and package bundling constraints.
- [x] 5.2 Explore: Evaluate Codex TOML editing options against syntax-aware preservation, bundle size, trusted-project scope, and atomic-write requirements, and identify the comment-bearing round-trip proof the implementation must satisfy.
- [x] 5.3 Explore: Define a shared fixture matrix for absent, malformed, equivalent, divergent, tracked, untracked, unrelated-setting, native-extension, and no-op documents across all three adapters.
- [x] 5.4 Propose: Specify the common prepare/apply behavior and each adapter's native translation, project-only path, semantic-equality rules, safe extension preservation, and dependency/bundling approach.

## 6. First-party native MCP adapters — Implementation

- [x] 6.1 Implement: Implement Claude Code batch prepare/apply for project `.mcp.json` and `mcpServers`, with read-only planning, native semantic equality, unrelated-state preservation, and atomic writes.
- [x] 6.2 Implement: Implement OpenCode batch prepare/apply using existing `opencode.jsonc` when present, otherwise existing `opencode.json`, otherwise creating `opencode.jsonc`; when both exist, treat JSONC as canonical and leave JSON unchanged; reconcile the selected document's `mcp` map with JSONC-aware preservation, native semantic equality, and atomic writes.
- [x] 6.3 Implement: Implement Codex batch prepare/apply for trusted-project `.codex/config.toml` and `mcp_servers` using the approved syntax-aware TOML strategy.
- [x] 6.4 Implement: Add per-adapter fixtures and tests for stdio/HTTP translation, project-only scope, complete occupancy outcomes, unowned-entry preservation, safe native extensions, parse failures, no-op adoption, atomic failure behavior, and absence of server execution/authentication.
- [x] 6.5 Verify: Build and run unit plus dist e2e checks for all first-party adapters, including API `0.2` metadata and bundled parser availability.

## 7. Project intent, composition, and receipt ownership — Research

- [x] 7.1 Explore: Trace project-manifest mutation, stale-override pruning, collision composition, resolved-facet data, and frozen consistency paths that currently iterate only asset groups.
- [x] 7.2 Explore: Trace receipt exact dispatch, ownership indexes, tri-write receipt construction, corruption handling, and removal witnesses across receipt versions `1`, `0.2`, and `0.3`.
- [ ] 7.3 Propose: Define tagged server-intent, composition, ownership, and witnessed/unwitnessed receipt models that preserve the unified desired-state/write and receipt-only/delete rule.

## 8. Project intent, composition, and receipt ownership — Implementation

- [ ] 8.1 Implement: Implement receipt `0.4` exact dispatch with facet integrity and configuration claims, preserving earlier asset authority while explicitly withholding configuration authority and approval from pre-`0.4` receipts; ensure the next successful receipt write emits `0.4` and never an intermediate writer format.
- [ ] 8.2 Implement: Extend receipt loading/validation for absent, corrupt, path-mismatched, escaping, and duplicate historical claims without storing commands, arguments, URLs, or environment data.
- [ ] 8.3 Implement: Extend project-manifest mutations and transaction commits for `0.2` server overrides, source-change preservation, compact/expanded canonicalization, successful stale-server pruning, failed-operation retention, and frozen no-migration.
- [ ] 8.4 Implement: Carry verified concrete declarations through resolution and compose aliases, omissions, identical fingerprints, complete collision groups, claimant sets, and stale overrides separately from asset plans and lockfile entries.
- [ ] 8.5 Implement: Add configuration ownership indexes and receipt construction so successful reconciliation records project-wide adapter-agnostic claims, omitted declarations remain absent, and deletion never derives from lockfile intent.
- [ ] 8.6 Implement: Add focused tests for receipt refinement, teammate-local approval separation, server dispositions, migration rollback, server/asset namespace separation, collision exhaustiveness, and unchanged lockfile shape.
- [ ] 8.7 Verify: Run focused manifest, composition, receipt, ownership, and tri-write tests and type checks.

## 9. Transaction, consent, frozen, removal, and takeover — Research

- [ ] 9.1 Explore: Trace install ordering, journal semantics, byte-preimage helpers, rollback error reporting, and the first mutation boundary for normal and removal-only paths.
- [ ] 9.2 Explore: Trace interactive resolver plumbing and define MCP consent/failure values for new or changed declarations, native takeovers, non-interactive opt-in, and unsupported selected adapters.
- [ ] 9.3 Explore: Trace frozen post-resolution checks and removal refinement proofs needed for integrity-anchored configuration claims and receipt-only server-orphan cleanup.
- [ ] 9.4 Explore: Trace asset previous-state reads and ownership lookup to place the just-in-time takeover gate without an eager scan or coupling it to MCP consent.
- [ ] 9.5 Propose: Define the complete orchestration change from preflight through prepare, consent, journaled asset work, native apply, receipt commit, rollback, and offline removal fallback.

## 10. Transaction, consent, frozen, removal, and takeover — Implementation

- [ ] 10.1 Implement: Add the post-compose collective MCP-support preflight and batch read-only preparation for every selected adapter before prompting or mutation.
- [ ] 10.2 Implement: Derive machine-local approval from effective identity plus fingerprint, combine unapproved declarations and untracked native occupancy into one MCP-only request, and enforce `--accept-mcp` for non-interactive/frozen callers without banking failed approval.
- [ ] 10.3 Implement: Capture each prepared document's byte preimage, journal throwing restore operations, apply native MCP plans after asset writes, and restore every document exactly on later adapter, cancellation, or tri-write failure.
- [ ] 10.4 Implement: Add the separate just-in-time asset takeover resolver at the existing previous-state read, default to continue, adopt equivalent bytes without rewriting, overwrite divergent content transactionally, and roll back all prior work on cancellation.
- [ ] 10.5 Implement: Add post-resolution frozen MCP gates for collision, stale intent, support, parse, integrity, and approval while allowing receipt/native reconciliation only after every consistency check passes.
- [ ] 10.6 Implement: Extend removal-only refinement to carry integrity-witnessed configuration claims offline, fall back for pre-`0.4` or unprovable state, preserve remaining claimants, and delete only obsolete receipt-owned server identities.
- [ ] 10.7 Implement: Add ordering, no-mutation, no-reprompt, teammate-consent, takeover, byte-restore, frozen-orphan, offline-removal, and fallback tests across successful, declined, failed, and interrupted operations.
- [ ] 10.8 Verify: Run focused install, frozen, removal, materialization, journal, and rollback tests and type checks.

## 11. Engine outcomes and obsolete warning path — Research

- [ ] 11.1 Explore: Map stage events, install failures, facet classification, summaries, stale-intent reporting, and every `server-warning`/`serverWarnings` producer and consumer.
- [ ] 11.2 Propose: Define structured MCP outcomes and aggregate result shapes that distinguish intent updates, native drift repair, semantic no-op, takeover, unsupported adapters, and text-asset counts without carrying declaration secrets.

## 12. Engine outcomes and obsolete warning path — Implementation

- [ ] 12.1 Implement: Add typed MCP consent, configuration, collision, takeover, stale-intent, and unsupported-adapter events/failures/results, with exhaustive switches and pure-data failure contracts.
- [ ] 12.2 Implement: Extend facet classification and summaries so declaration/alias/omission changes are updated, native drift is repaired, semantic matches are unchanged, and server-only facets report configuration work with zero assets.
- [ ] 12.3 Implement: Remove `server-warning`, `serverWarnings`, `serversDeclared`, warn-and-skip plumbing, and associated success-path tests now that obsolete references fail validation.
- [ ] 12.4 Implement: Add focused outcome, summary, failure aggregation, stale-intent, and secret-redaction tests.
- [ ] 12.5 Verify: Run focused engine outcome tests and type checks.

## 13. Collision resolution UI — Research

- [ ] 13.1 Explore: Inspect the collision draft/workspace, claimant identity, alias validation, cancellation, non-interactive report, and prototype-safety tests that currently assume asset-only claimants.
- [ ] 13.2 Propose: Define tagged asset/MCP claimant models and a complete-draft re-planning approach that preserves separate namespaces, accessible statuses, durable server dispositions, and no-winner behavior.

## 14. Collision resolution UI — Implementation

- [ ] 14.1 Implement: Extend the interactive overview, focused workspace, draft model, and Keep/Alias/Omit controls to MCP claimants with declaration summaries and complete global revalidation.
- [ ] 14.2 Implement: Extend non-interactive collision failures with every MCP claimant, exact `materialization.servers` locations, valid alias/omission examples, no invented winner, and explicit no-mutation reporting.
- [ ] 14.3 Implement: Add UI/model/report tests for mixed asset/server groups, every-claimant omission, alias conflicts, invalid aliases, cancellation/interruption, accessible status labels, and prototype-pollution keys.
- [ ] 14.4 Verify: Run focused collision workspace, report, CLI integration, and type checks.

## 15. Consent, takeover, flags, and command output — Research

- [ ] 15.1 Explore: Inspect add/install/remove flag definitions, shared command plumbing, interactive phase/resolver lifecycle, abort settlement, and frozen prompt policy.
- [ ] 15.2 Explore: Inspect success/failure rendering, verbose logging, help output, stale-intent notices, no-op detection, and all persistent surfaces that must not leak declarations.
- [ ] 15.3 Propose: Define separate MCP-consent and asset-takeover phases plus result/failure rendering for complete non-interactive diagnostics and configuration outcomes.

## 16. Consent, takeover, flags, and command output — Implementation

- [ ] 16.1 Implement: Define `--accept-mcp` once and expose/thread it through add, install, and remove; honor it without prompting in frozen mode and keep it independent from asset collision/takeover decisions.
- [ ] 16.2 Implement: Add an MCP-only approval screen showing all exact declarations and a distinct native-takeover section, with approve-all, decline, and abort settlement before any mutation.
- [ ] 16.3 Implement: Add a separate just-in-time asset takeover screen with Continue selected by default and cancellation/restoration reporting.
- [ ] 16.4 Implement: Render complete non-interactive MCP-consent and unsupported-adapter failures with every claimant/adapter, actionable upgrade or omission guidance, and explicit no-mutation state.
- [ ] 16.5 Implement: Extend summaries and stale-intent output for added, updated, unchanged, aliased, omitted, repaired, removed, conflicted, unsupported, and takeover outcomes without treating server-only facets as no-ops.
- [ ] 16.6 Implement: Remove the obsolete CLI server-warning state, rendering, fixtures, and help/documentation language.
- [ ] 16.7 Implement: Add command/help, interactive phase, Ctrl-C, non-interactive, frozen, outcome, takeover, and declaration-secrecy tests proving commands/URLs/environment values appear only in approved disclosure surfaces.
- [ ] 16.8 Verify: Run focused CLI unit and e2e tests plus type checks for add, install, and remove.

## 17. Documentation and release preparation — Research

- [ ] 17.1 Explore: Audit every D11 target plus root README and related prompt/help surfaces for text-only framing, obsolete references, old versions, warn-and-skip behavior, and undocumented consent/takeover flows.
- [ ] 17.2 Explore: Inspect changelog, changeset, package publishing, prepack, and two-cycle adapter rollout conventions for the protocol and Adapter SDK pre-1.0 minor releases.
- [ ] 17.3 Propose: Define one documentation/release update plan covering user migration, operator security, adapter authors, roadmap status, stale-text removal, and release sequencing.

## 18. Documentation and release preparation — Implementation

- [ ] 18.1 Implement: Update all D11 specification and overview targets for concrete/server-only facets, project manifest `0.2`, aliases/omissions, consent, receipt `0.4`, keyed ownership, unchanged lockfile `0.3`, publishing, and removal of standalone server artifacts.
- [ ] 18.2 Implement: Update all D11 CLI/guidance targets for `--accept-mcp`, collisions, unsupported adapters, frozen behavior, outcomes, untracked MCP/asset takeover, default continuation, cancellation, rollback, migration, and secret-safe environment usage.
- [ ] 18.3 Implement: Update custom-adapter and adapter-install guidance for API `0.2`, the exact compatibility window, `mcpServers`, prepare/apply, occupancy/equality, project-only native files, and preservation obligations.
- [ ] 18.4 Implement: Update D11 roadmap, root README, and the newest-first changelog entry so MCP configuration is presented as shipped and the obsolete reference forms are clearly marked breaking.
- [ ] 18.5 Implement: Add changesets for the protocol pre-1.0 minor break, Adapter SDK pre-1.0 minor break, and all first-party adapters; document the adapter-first then CLI release handoff without hand-editing generated package changelogs.
- [ ] 18.6 Implement: Search documentation, prompts, release guidance, and examples beyond D11 for stale server warnings, text-only minimums, project manifest `0.1`, receipt `0.3`, or single-token adapter compatibility, and update only affected current guidance.
- [ ] 18.7 Implement: Run `bun format` to normalize all implementation, documentation, test, and changeset edits.
- [ ] 18.8 Verify: Run documentation validation, broken-link checks, changeset status checks, prepack tests, and stale-text searches.

## 19. Cross-cutting acceptance — Research

- [ ] 19.1 Explore: Build a coverage matrix from every requirement and scenario in all nine delta specs to its implementation task and automated or manual verification.
- [ ] 19.2 Propose: Define final cross-package and end-to-end scenarios for server-only install, alias/omit reproduction, consent locality, native takeover, rollback, frozen reproduction, offline removal, unsupported adapters, migration, and legacy rejection.

## 20. Cross-cutting acceptance — Implementation

- [ ] 20.1 Implement: Add any missing cross-package/e2e tests from the coverage matrix, including multi-adapter transactions and failure-order assertions before mutation or prompting.
- [ ] 20.2 Verify: Run `bun openspec validate add-mcp-json-support --strict` and verify the reconciled delta specs remain valid without editing permanent specs during implementation.
- [ ] 20.3 Verify: Run the complete `bun check` pipeline, including unit, e2e, types, lint, docs, scripts, and package checks; stop and report any failure.
- [ ] 20.4 Verify: Audit every delta requirement/scenario and every implementation-time follow-up as covered, record any genuinely external sync/archive or Notion cleanup separately, and mark the change implementation-ready.
