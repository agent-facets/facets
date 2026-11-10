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

## 1. CLI Targeting Foundation — Research

- [ ] 1.1 Explore: Inspect argument-parser behavior for repeatable, missing, empty, comma-containing, digit-leading, negated, and undeclared flag values, and identify the safe normalization boundary.
- [ ] 1.2 Explore: Inspect all flag declarations and help rendering to determine the type-safe value-label migration and the strict-versus-passthrough command policy.
- [ ] 1.3 Explore: Inspect adapter discovery, picker fallback, capability declarations, and add/install/remove ordering to define the all-versus-exclusive request boundary and future project-config seam.
- [ ] 1.4 Propose: Present the complete CLI targeting foundation, including result-shaped parse failures, target deduplication, strict unknown-flag behavior, capability-aware participation, and picker suppression.

## 2. CLI Targeting Foundation — Implementation

- [ ] 2.1 Pause: Switch model for implementation.
- [ ] 2.2 Implement: Replace permissive flag metadata with a tagged definition that makes value labels valid only for value-carrying flags, add an explicit strict/passthrough command policy, and migrate existing declarations.
- [ ] 2.3 Implement: Update command routing and help rendering to reject undeclared flags on add/install/remove before handler execution, preserve dynamic modify flags, reject missing or empty values, and render repeatable value placeholders.
- [ ] 2.4 Implement: Add the shared repeatable `--adapter <name>` definition, with help text stating that explicit targets are exclusive and non-target adapters lose all Facet-managed project assets and MCP entries, and a pure `AdapterTargetRequest` parser that returns `all` or a deduplicated non-empty exclusive list without comma splitting.
- [ ] 2.5 Implement: Add a source-independent target resolver that, before the project lock, validates and partitions every installed adapter exposing assets or MCP support into target and purge sets; return a named, role-aware failure for an unknown, unavailable, broken, incompatible, or incapable target or required purge adapter; suppress the picker for explicit targets and retain existing picker behavior for the all-adapters request.
- [ ] 2.6 Implement: Add focused unit tests for strict flags, parser edge cases, help output including destructive exclusive-target wording, shared flag identity, target deduplication, capability-aware partitioning, pre-lock named target/purge validation, unknown-target guidance, and picker suppression.
- [ ] 2.7 Verify: Run the focused CLI targeting tests and package type-checking before engine integration.

## 3. Engine Scope and Asset Purge — Research

- [ ] 3.1 Pause: Switch model for exploration.
- [ ] 3.2 Explore: Trace every flat adapter-array consumer and test fixture through add, install, remove, source resolution, compatibility preflight, materialization, and public engine exports.
- [ ] 3.3 Explore: Inspect receipt-derived asset ownership, deletion planning, transaction journaling, rollback, directory cleanup, and summary aggregation to identify the smallest reusable full-project purge plan.
- [ ] 3.4 Explore: Inspect the removal-refinement fast path and cache/source resolution behavior, documenting how global removal resolution remains offline when cached and uses the network only on cache miss.
- [ ] 3.5 Propose: Present the engine scope migration and purge orchestration, including target-only build validation, participating-adapter compatibility, capability-specific passes, global refinement removal, deterministic planning, and rollback boundaries.

## 4. Engine Scope and Asset Purge — Implementation

- [ ] 4.1 Pause: Switch model for implementation.
- [ ] 4.2 Implement: Introduce and export the tagged `InstallationAdapterTargets` contract and role-specific helper accessors, then migrate runAdd, runInstall, runRemove, and existing tests through an all-target compatibility helper without changing unfiltered behavior.
- [ ] 4.3 Implement: Wire the CLI target resolver into add/install/remove while preserving source-parse and manifest-validation ordering, pass the validated target/purge partition into the engine, and ensure removal of an undeclared facet is decided under the project lock as no desired-state change while explicit target reconciliation and purge placement still proceed.
- [ ] 4.4 Implement: Run API compatibility over all participating adapters, validate local/git facet metadata against targets only, and route asset and MCP work only to adapters exposing the relevant capability.
- [ ] 4.5 Implement: Disable the adapter-agnostic removal-refinement fast path globally, remove or retire unreachable refinement orchestration, and make every removal resolve complete remaining target state from cache or source before mutation. Record and test the accepted trade-off: an unfiltered removal with a cold cache now requires source/network availability, and resolution failure leaves all project and adapter state unchanged.
- [ ] 4.6 Implement: Add a deterministic pre-mutation asset purge plan containing every receipt-owned identity regardless of desired state, while preserving absent-state no-ops, path validation, companion ownership, and untracked-file safety.
- [ ] 4.7 Implement: Apply purge asset deletions before target deletion and materialization in the existing transaction, add abort checkpoints, and preserve byte-exact rollback and conservative directory restoration across both phases.
- [ ] 4.8 Implement: Extend engine result and transaction-subject types with tagged target/purge scope and per-adapter purge counts, including zero-removal purge adapters, without changing receipt schema `0.4` or persisting placement.
- [ ] 4.9 Implement: Add and update engine tests for single and multiple targets, complete still-desired asset purge, multi-file ownership, absent and untracked state, opposite target sets, add/remove semantics, global removal resolution including cold-cache failure before mutation, rollback, unchanged receipt bytes/schema, and filtered/unfiltered operations committing identical ownership accounts for identical desired state.
- [ ] 4.10 Verify: Run focused asset-purge engine tests and package type-checking.

## 5. MCP Purge, Consent, and Frozen Mode — Research

- [ ] 5.1 Pause: Switch model for exploration.
- [ ] 5.2 Explore: Inspect MCP support classification, receipt ownership, preparation, consent derivation, application, outcome classification, and receipt-claim generation for separate target and purge roles.
- [ ] 5.3 Explore: Inspect shared native-document overlap and drift guards to design purge-then-target composition where target state wins, while retaining existing target/target overlap failure and external-drift protection.
- [ ] 5.4 Explore: Inspect frozen consistency gates, receipt-only commit behavior, receipt-unpersisted reporting, and transaction ordering to place every purge after validation and before target application.
- [ ] 5.5 Propose: Present the complete MCP and frozen implementation, including capability-partial adapters, role-aware failures, target-only consent, target-only receipt claims, target-wins shared-document composition, purged outcomes, and rollback.

## 6. MCP Purge, Consent, and Frozen Mode — Implementation

- [ ] 6.1 Pause: Switch model for implementation.
- [ ] 6.2 Implement: Make MCP support validation role-aware so targets validate active declarations, purge adapters validate only receipt-owned removals, and adapters with no relevant MCP work do not fail.
- [ ] 6.3 Implement: Prepare purge adapters with an empty desired set and all receipt-owned server identities, keep purge plans out of consent derivation and receipt-claim generation, and preserve machine-wide approval for target declarations.
- [ ] 6.4 Implement: Split native-document overlap handling by role, retain target/target failure, allow purge/target composition, and update re-planning and drift checks so this operation's purge can be followed safely by target-wins application.
- [ ] 6.5 Implement: Apply purge MCP changes before target MCP changes through the same transaction, preserve exact rollback, and add a distinct purged outcome for still-desired project declarations.
- [ ] 6.6 Implement: Keep every frozen consistency, integrity, collision, and consent gate before purge, support exclusive targets with unchanged manifest/lockfile bytes, and include scope in receipt-unpersisted results.
- [ ] 6.7 Implement: Add MCP and frozen tests for target-only consent, approval reuse, purge ownership, unsupported target and purge roles, no-work capability cases, shared-document target-wins composition, outcomes, rollback, and frozen failures preceding purge.
- [ ] 6.8 Verify: Run focused MCP, consent, rollback, frozen, and CLI integration tests.

## 7. CLI Scope Reporting and Remedies — Research

- [ ] 7.1 Pause: Switch model for exploration.
- [ ] 7.2 Explore: Inspect progress-view lifecycle, pre-mutation rendering, adapter counting, no-op classification, summary lines, removal-with-no-facet outcomes, and receipt-unpersisted presentation.
- [ ] 7.3 Explore: Inspect every short and long failure remedy, collision/MCP report, and transaction-subject renderer that must preserve explicit targets or distinguish target from purge roles.
- [ ] 7.4 Explore: Inspect the agent-facing `facet instructions` usage prompt and its tests for adapter command guidance that must distinguish tooling installation from exclusive placement targeting.
- [ ] 7.5 Propose: Present the reporting and remedy approach, selecting one source of requested pre-mutation scope and one source of actual result scope, with deterministic empty-purge reporting.

## 8. CLI Scope Reporting and Remedies — Implementation

- [ ] 8.1 Pause: Switch model for implementation.
- [ ] 8.2 Implement: Render target and purge sets from the resolved request before mutation and from the engine result after completion, including exclusive warnings, zero-removal purge adapters, and scope on receipt-unpersisted outcomes.
- [ ] 8.3 Implement: Correct no-op and adapter-count derivation so placement-only purge work is visible, and report target writes separately from per-adapter asset and MCP purge removals.
- [ ] 8.4 Implement: Render purged MCP entries distinctly from project-level removals and keep target declarations visible as still desired.
- [ ] 8.5 Implement: Add a single shell-safe rerun-command renderer and thread it through every short and long failure path so generic, collision, frozen, and MCP-consent remedies preserve all explicit targets.
- [ ] 8.6 Implement: Update target/purge role diagnostics for compatibility, MCP support, shared-document handling, and transaction failures without changing the canonical CLI error shape.
- [ ] 8.7 Implement: Update the agent-facing usage prompt to document repeatable exclusive targets, destructive non-target purge, frozen compatibility, and the distinction from `facet adapter add`.
- [ ] 8.8 Implement: Add view, outcome, help, prompt, failure-block, and remedy tests covering pre-mutation scope, final scope, empty purges, placement-only runs, undeclared removals, shell quoting, and filter-preserving reruns.
- [ ] 8.9 Verify: Run focused CLI rendering, prompt, failure, and end-to-end tests.

## 9. Integration, Documentation, and Release — Research

- [ ] 9.1 Pause: Switch model for exploration.
- [ ] 9.2 Explore: Inspect the fake-adapter and compiled-CLI harnesses and map the complete cross-command scenario matrix for target/purge placement, later unfiltered rematerialization, ordering failures, and frozen mode.
- [ ] 9.3 Explore: Re-audit all CLI reference, specification, and guide pages named by the design, confirming exact conflicting statements and confirming README, navigation, authoring docs, and adapter SDK references remain unchanged.
- [ ] 9.4 Explore: Inspect release metadata requirements for the user-facing CLI change and confirm the required changeset path without adding a manual documentation changelog entry.
- [ ] 9.5 Propose: Present the final integration, documentation, release-metadata, and verification pass, including rollback-sensitive and cache-miss scenarios.

## 10. Integration, Documentation, and Release — Implementation

- [ ] 10.1 Pause: Switch model for implementation.
- [ ] 10.2 Implement: Add compiled-CLI scenarios for single, multiple, duplicate, unknown, empty, comma-containing, and misspelled targets, complete non-target asset/MCP purge, opposite targets, empty purges, and later unfiltered rematerialization.
- [ ] 10.3 Implement: Add cross-command scenarios for add/install/remove ordering, undeclared removal with placement work, cache-backed and cache-miss removal resolution, MCP consent and shared documents, rollback, and frozen exclusive targeting.
- [ ] 10.4 Implement: Update `docs/cli/add.mdx`, `docs/cli/install.mdx`, and `docs/cli/remove.mdx` with the repeatable flag, exclusive semantics, picker suppression, validation, frozen interaction, examples, outcomes, and exit behavior.
- [ ] 10.5 Implement: Update the affected specification pages with target/purge terminology, adapter-agnostic receipt authority, transactional ordering, consent, frozen behavior, and the absence of persisted targets in manifest and lockfile.
- [ ] 10.6 Implement: Update the affected installation, troubleshooting, and custom-adapter guides with exclusive placement, purge failures, shared MCP visibility, and later unfiltered rematerialization; leave README, navigation, authoring docs, and SDK references unchanged after verification.
- [ ] 10.7 Implement: Add the required release changeset or equivalent package-release metadata without editing `docs/changelog/index.mdx`.
- [ ] 10.8 Verify: Run the complete `bun check` pipeline, fix formatting with `bun format` when required, and verify tests, types, lint, end-to-end behavior, documentation consistency, and unchanged receipt schema `0.4`.
