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

## 1. Registry Discovery and Update Planning — Research

- [x] 1.1 Explore: Inspect `packages/engine/src/registry/resolve-metadata.ts`, `registry/types.ts`, `registry/index.ts`, `src/__tests__/registry.test.ts`, and resolver-specific tests for the 100-specifier contract, result-valued failures, credentials, retry/timeout behavior, runtime response validation, and current callers.
- [x] 1.2 Explore: Inspect `packages/engine/src/manifest/project-files.ts`, `install/lockfile-io.ts`, `install/lockfile-guard.ts`, `install/detect-lockfile-drift.ts`, `install/parse-locked-version.ts`, and `packages/protocol/src/sources/version-spec.ts` for exact file-state capture, source classification, all five version forms, satisfaction, and ordering.
- [x] 1.3 Explore: Inspect `packages/engine/src/install/add/`, `install/remove/`, engine export conventions in `src/index.ts`, and existing install test helpers for two-phase workflows, tagged results, public-surface discipline, and side-effect assertions.
- [x] 1.4 Propose: Define the cohesive engine approach for metadata grouping, deterministic failure ordering, plan types, version comparison, manifest-source rewriting, preparation snapshots, and unit-test coverage.
- [x] 1.5 Pause: Model-switch boundary before engine discovery implementation.

## 2. Registry Discovery and Update Planning — Implementation

- [x] 2.1 Implement: Give registry metadata resolution a result-valued 100-specifier limit, remove the stale exact-or-latest-only assumption, validate response facet identity, exact version syntax, and integrity fields, and leave an explicit TODO to replace per-specifier requests with the registry's planned batch endpoint.
- [x] 2.2 Implement: Add pure exact-version ordering and manifest-source rewriting helpers covering all five supported `VersionSpec` forms without duplicating the protocol grammar.
- [x] 2.3 Implement: Add tagged update-plan row and preparation result types that make candidate, current, unsupported-source, and complete local-state failure outcomes explicit.
- [x] 2.4 Implement: Add read-only update discovery using authored-specifier and `latest` metadata pairs, concurrent groups of at most 100 specifiers, stable result pairing, range-satisfaction validation, no-downgrade classification, and deterministic all-or-nothing failures.
- [x] 2.5 Implement: Add `prepareFacetUpdate` with exact manifest and lockfile snapshots, post-discovery revalidation, no Current re-resolution, and no content, cache, adapter, lock-directory, or project-state side effects.
- [x] 2.6 Implement: Export only the update planning API and structured types consumed by the CLI, retaining internal helpers behind the engine boundary.
- [x] 2.7 Implement: Add engine tests for the resolver limit and response contract, all five specifier forms, numeric ordering, concurrent multi-group behavior, input-ordered failures, every unusable-local-state reason, unsupported git/local rows, no-downgrade behavior, exact pins tagged as candidates when Latest advances while remaining unchanged by plain update, and preparation side-effect freedom.
- [x] 2.8 Verify: Run the targeted engine registry and update-planning tests and typecheck the engine package.
- [x] 2.9 Pause: Model-switch boundary before transaction research.

## 3. Transactional Update Application — Research

- [x] 3.1 Explore: Inventory `packages/engine/src/install/types.ts`, `run-install.ts`, `commit/delta.ts`, engine add/remove front doors, `packages/cli/src/commands/install/index.ts`, and every `InstallDelta` or `frozenLockfile` call site that must migrate to the tagged operation union without behavior changes.
- [x] 3.2 Explore: Trace `install/commit/resolve-all.ts`, `resolve-facet.ts`, `effective-locked.ts`, `resolve-registry.ts`, `registry-support.ts`, `compose.ts`, `classify-outcome.ts`, `applyDesiredFacets`, and the project-file tri-write to separate selected exact metadata from prior lock ownership.
- [x] 3.3 Explore: Trace `install/lockfile-guard.ts`, file-state equality, `install/commit/tri-write.ts`, receipt ownership, disposition persistence, and filesystem transaction rollback to place stale-plan checks before every side effect.
- [x] 3.4 Propose: Define the cohesive transaction refactor for operation types, update resolution intent, prefetched metadata reuse, stale gates, manifest mutation, rollback, and migration of existing tests.
- [x] 3.5 Pause: Model-switch boundary before transaction implementation.

## 4. Transactional Update Application — Implementation

- [x] 4.1 Implement: Replace permissive install delta and frozen option combinations with mutually exclusive reproduce, add, remove, and non-empty update operation arms, then migrate existing engine and CLI callers and remove impossible conflict failures.
- [x] 4.2 Implement: Extend in-memory manifest merging so selected updates preserve overrides, persist the chosen final manifest source through the existing comment-preserving `applyDesiredFacets` path only during the manifest/lockfile/receipt tri-write, bypass the prior lock only as a version anchor, and retain prior entries for ownership and old-to-new outcomes.
- [x] 4.3 Implement: Thread per-facet update resolution intent through the resolver and seed selected registry resolution with discovery metadata so application installs the reviewed exact version without another metadata lookup.
- [x] 4.4 Implement: Add the under-lock exact snapshot gate and structured `UPDATE_PLAN_STALE` outcome before cache writes, downloads, transaction creation, or any other mutation.
- [x] 4.5 Implement: Add selection validation and `runPreparedFacetUpdate`, rejecting duplicate, unknown, unsupported, and non-advancing choices while deriving final manifest sources from the shared helper.
- [x] 4.6 Implement: Add transaction tests for stale manifest and lockfile snapshots, publication after discovery, no secondary metadata request, mixed selected/unselected facets, comment and override preservation, alias and omission lockfile dispositions, old-to-new summaries, exact pins versus range and latest choices, and compile-time/runtime proof that frozen mode is representable only by the reproduce operation.
- [x] 4.7 Implement: Add failure-path tests proving multi-facet atomicity, integrity failure rollback, collision and MCP consent behavior, takeover handling, and path-level restoration reporting remain identical to other installation operations.
- [x] 4.8 Verify: Run targeted install/update tests plus engine and CLI typechecks to verify the operation-union migration and application path.
- [x] 4.9 Pause: Model-switch boundary before short-flag research.

## 5. CLI Short-Flag Metadata — Research

- [x] 5.1 Explore: Inspect `packages/cli/src/commands.ts`, `run.ts`, `help.ts`, `commands/shared/flags.ts`, parser alias support, undeclared dynamic-flag passthrough, help alignment, and existing alias tests.
- [x] 5.2 Propose: Define the canonical short-alias field, parser normalization, exclusion of short keys from handler passthrough, shared help rendering, and router-level regression coverage.
- [x] 5.3 Pause: Model-switch boundary before short-flag implementation.

## 6. CLI Short-Flag Metadata — Implementation

- [x] 6.1 Implement: Add canonical short aliases to command flag metadata and derive parser aliases from that field while preserving undeclared dynamic flags and exposing only canonical long-name values to handlers.
- [x] 6.2 Implement: Render long and short forms together in per-command help from the same declaration without a second alias map.
- [x] 6.3 Implement: Add router and help tests proving `-i` and `-L` set only their canonical values, undeclared dynamic flags retain existing behavior, and existing commands' help remains correctly aligned.
- [x] 6.4 Verify: Run targeted router/help tests and typecheck the CLI package.
- [x] 6.5 Pause: Model-switch boundary before update-command research.

## 7. Update Command and Presentation — Research

- [x] 7.1 Explore: Inspect command registration and alias dispatch in `packages/cli/src/commands.ts`, `run.ts`, and `help.ts`, using `commands/self-update.ts` and `commands/remove/index.ts` as canonical alias examples.
- [x] 7.2 Explore: Inspect add/install/remove orchestration, `commands/shared/ensure-adapters.ts`, TTY gates, error translators, cancellation handling, and process-exit boundaries needed to preserve update ordering and exit semantics.
- [x] 7.3 Explore: Inspect static list rendering, `commands/adapter/install-picker.tsx`, `tui/views/install/collision/workspace.tsx`, `tui/views/install/install-view.tsx`, failure rendering, and Ink test utilities needed for preview, selection, progress, and rollback output.
- [x] 7.4 Propose: Define the cohesive update-command approach for registration, mode derivation, no-op and dry-run rendering, tagged picker rows, adapter ordering, shared installation presentation, error translation, and test coverage.
- [x] 7.5 Pause: Model-switch boundary before update-command implementation.

## 8. Update Command and Presentation — Implementation

- [x] 8.1 Implement: Register implemented `update` with `upgrade` only as its alias, remove the inert upgrade stub, define the supported flag surface, reject positional arguments with `--interactive` guidance, and distinguish project updates from `self-update` in help.
- [x] 8.2 Implement: Add static Current/Target/Latest plan rendering, unsupported-source rows, latest-mode manifest rewrite previews, and distinct successful no-op messages including the actionable `--latest` hint.
- [x] 8.3 Implement: Add the standalone update picker by reusing `install-picker.tsx` keyboard conventions and collision-workspace focus/interrupt behavior, with tagged selected/unselected rows, mode-specific initial choices, focused `l` toggling, non-advancing protection, and reliable cancellation.
- [x] 8.4 Implement: Add command orchestration in the required order: positional and TTY validation, preparation, optional interactive selection, dry-run stop, adapter selection, and guarded application with the complete 0/1/2 exit contract.
- [x] 8.5 Implement: Extend `InstallView`, shared summaries, failure remedies, stale-plan rendering, and path-level rollback detail for update mode without introducing a second progress pipeline.
- [x] 8.6 Implement: Add registration, help, command, static-view, picker, and install-view unit tests covering canonical/alias identity, mode defaults, cancellation, no-op output, output streams, and `--accept-mcp` boundaries.
- [x] 8.7 Implement: Add CLI end-to-end tests for global and per-command help, `upgrade` alias behavior, positional and non-TTY failures, dry-run without adapters, interactive cancellation before adapter installation, applied old-to-new summaries, stale plans, and expected exit codes.
- [x] 8.8 Verify: Run targeted CLI command, Ink, and end-to-end tests and typecheck the CLI package.
- [x] 8.9 Pause: Model-switch boundary before documentation research.

## 9. Documentation and Agent Guidance — Research

- [x] 9.1 Explore: Inspect `docs/cli/update.mdx` requirements and reference-page conventions together with existing `docs/cli/upgrade.mdx`, `docs/cli/self-update.mdx`, `docs/cli/index.mdx`, `docs/cli/add.mdx`, `docs/cli/list.mdx`, and `docs/docs.json`; verify whether retaining the upgrade alias page outside primary navigation passes Mintlify validation.
- [x] 9.2 Explore: Inspect `docs/guides/install-facets.mdx`, `docs/guides/troubleshooting.mdx`, `docs/roadmap/alpha.mdx`, `docs/roadmap/beta.mdx`, `docs/roadmap/stable.mdx`, `docs/specification/commit.mdx`, `docs/specification/materialization.mdx`, and root `README.md` for stale promises, update remedies, and package-versus-binary ambiguity.
- [x] 9.3 Explore: Inspect `packages/cli/src/prompts/overview.txt`, `packages/cli/src/prompts/usage.txt`, prompt generation, and instruction-prompt unit/e2e tests so guidance is added without duplicating topic lists, adapter API support sets, or materialization schemas.
- [x] 9.4 Explore: Inspect `docs/changelog/index.mdx`, its RSS rules, `.changeset/`, and contribution conventions for the required inert-stub-to-live-alias disclosure and package changeset.
- [x] 9.5 Propose: Define the cohesive documentation, prompt, changelog, navigation, and validation approach while preserving historical changelog text and `facet list`'s offline contract.
- [x] 9.6 Pause: Model-switch boundary before documentation implementation.

## 10. Documentation and Agent Guidance — Implementation

- [x] 10.1 Implement: Create `docs/cli/update.mdx`, convert `docs/cli/upgrade.mdx` into a concise alias page, update `docs/cli/self-update.mdx` and `docs/cli/index.mdx`, and revise `docs/docs.json` so canonical behavior, flags, TTY rules, preview scope, no-op/failure outcomes, and package-versus-binary distinctions have one source of truth.
- [x] 10.2 Implement: Update both audiences in `docs/guides/install-facets.mdx`, add remedies to `docs/guides/troubleshooting.mdx`, update `docs/roadmap/alpha.mdx`, `beta.mdx`, and `stable.mdx`, update root `README.md`, and add cross-links from `docs/cli/add.mdx` and `docs/cli/list.mdx` while retaining list's offline contract and narrowing the beta promise.
- [x] 10.3 Implement: Update `docs/specification/commit.mdx` for prepared exact resolution and style-preserving Latest selection, and verify `docs/specification/materialization.mdx` remains accurate without duplicating override rules.
- [x] 10.4 Implement: Update `packages/cli/src/prompts/overview.txt` and `usage.txt` with project update, alias, non-TTY, dry-run, `--accept-mcp`, and `facet install` recovery guidance, then add companion unit and end-to-end prompt assertions.
- [x] 10.5 Implement: Leave `docs/changelog/index.mdx` untouched, ask the user to generate the `agent-facets` minor changeset manually, then replace only its placeholder body with the stub-to-live-alias warning without editing generated package changelogs.
- [x] 10.6 Verify: Run prompt tests, Mintlify validation, and broken-link checks for all documentation and agent-guidance changes.
- [x] 10.7 Pause: Model-switch boundary before integrated acceptance research.

## 11. Interactive Update Corrections — Implementation

The approach for this block was explored and approved during the block 10 review,
so it opens on implementation rather than a second research pass.

- [x] 11.1 Implement: Add a lightweight update-discovery view that starts before awaiting preparation, states that the registry is being checked, reuses the existing indeterminate `ProgressBar`, and yields cleanly to success, no-op, or structured failure without adding synthetic percentages or an engine progress API.
- [x] 11.2 Implement: Correct interactive orchestration so the presence of any Target-or-Latest candidate opens the picker even when the initial Range selection is empty, while truly candidate-free plans retain their specific successful no-op and non-interactive range behavior remains unchanged.
- [x] 11.3 Implement: Render candidate picker rows as aligned Current, Target, and Latest columns; preserve mode defaults and `l` toggling; emphasize the chosen cell without color alone; and color only the changed semantic-version suffix with existing success, caution, and warning theme roles for patch, minor, and major advances.
- [x] 11.4 Implement: Add focused command, Ink, and pure presentation tests for pending/settled/failed discovery feedback, Latest-only plain interactive selection, truly empty no-ops, simultaneous version columns, and semantic change coloring, while preserving existing cancellation, dry-run, adapter-ordering, and side-effect coverage.
- [x] 11.5 Verify: Run the targeted update command, picker, and Ink tests plus the CLI typecheck.
- [ ] 11.6 Pause: Model-switch boundary before integrated acceptance research.

## 12. Integrated Acceptance — Research

- [ ] 12.1 Explore: Map every reconciled CLI and installation scenario — including the corrected interactive and discovery-feedback behavior — to an automated test or explicit documentation check, and identify any remaining coverage gaps across engine, CLI, transaction, prompts, and docs.
- [ ] 12.2 Explore: Review the complete implementation for single-source-of-truth violations, representable illegal states, escaping expected errors, accidental registry-current checks, secondary metadata resolution, or dry-run side effects.
- [ ] 12.3 Propose: Define the final acceptance pass and the smallest fixes needed to close all uncovered specification and regression gaps.
- [ ] 12.4 Pause: Model-switch boundary before final acceptance implementation.

## 13. Integrated Acceptance — Implementation

- [ ] 13.1 Implement: Add or adjust the remaining focused tests and documentation checks identified by the acceptance matrix without duplicating coverage already owned by lower-level suites.
- [ ] 13.2 Verify: Run `bun check`; if any test, type, lint, formatting, documentation, or end-to-end check fails, stop and report the failures.
- [ ] 13.3 Verify: Validate the completed OpenSpec change against its schema and confirm every implementation task and reconciled scenario is accounted for before verification and archive.
