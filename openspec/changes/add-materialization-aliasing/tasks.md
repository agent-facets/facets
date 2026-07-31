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

## 1. Protocol Identity and Schema Contracts — Research

- [ ] 1.1 Explore: Inspect the existing asset-name validators, portable collision normalization, shared skill/command validation, and canonical authored-path derivation in `packages/protocol` and `packages/common`.
- [ ] 1.2 Explore: Inspect the project-manifest, lockfile, and build-manifest schemas/loaders and their exact-dispatch, duplicate-member, fixture, and public-export test patterns.
- [ ] 1.3 Explore: Inspect protocol package release metadata and all downstream consumers of project-manifest and lockfile types/constants so compatibility shims and the `0.3` writer flip are sequenced safely.
- [ ] 1.4 Propose: Define the protocol implementation approach for one namespace mapping, tagged dispositions, legacy/current manifest dispatch, lockfile `0.3`, canonical identity helpers, and a deterministic planner without duplicating existing sources of truth.

## 2. Protocol Identity and Schema Contracts — Implementation

- [ ] 2.1 Implement: Add the shared materialization namespace, collision-key, adapter-key, and canonical authored-path helpers; refactor existing facet/build collision validation to consume the shared rules; add focused namespace and portability tests.
- [ ] 2.2 Implement: Add the three-arm `MaterializationDisposition` schema/type and derive project-override and materialized-only variants; enforce the single-segment alias grammar and rejection of stray or missing alias fields; add scenario-complete tests.
- [ ] 2.3 Implement: Implement legacy-unversioned and exact `manifestVersion: 0.1` schemas in `packages/protocol/src/schemas/project-manifest.ts` plus a project-manifest loader that rejects duplicate members before exact version dispatch and never falls back by shape; cover compact/expanded entries, typed override maps, invalid aliases, unsupported versions, and empty-expanded-entry rejection.
- [ ] 2.4 Implement: Add lockfile `0.3` with required dispositions while preserving exact readers for `1` and `0.2`; factor shared file-record validation, keep authored names/paths for aliases and omissions, and test malformed-current no-fallback behavior.
- [ ] 2.5 Implement: Implement the pure deterministic materialization planner as a discriminated result union, reporting every ordered collision group and supporting scope separation, shared skill/command names, aliases, omissions, name transfers, swaps, temporary draft conflicts, and declaration-order independence.
- [ ] 2.6 Implement: Export the new protocol contracts through the curated public surface and update protocol release notes/metadata according to repository conventions without changing archive or adapter API versions.
- [ ] 2.7 Verify: Run the protocol unit tests, typecheck, and public-surface/build checks; confirm the new schema and planner scenario suites pass.

## 3. Project Manifest Intent and Migration — Research

- [ ] 3.1 Explore: Trace every `facets.json` reader, mutation, empty-document producer, source update, delta merge, serializer, and tri-write path across engine and CLI, including comment-preserving behavior and `facet list`.
- [ ] 3.2 Explore: Trace frozen and normal migration boundaries for legacy unversioned manifests and identify where unsupported versions, expanded legacy entries, source updates, empty override collapse, and stale overrides are handled transactionally.
- [ ] 3.3 Propose: Define the normalized in-memory manifest shape and write policy that preserve comments, untouched expanded entries, and overrides while keeping the protocol schema as the source of truth.

## 4. Project Manifest Intent and Migration — Implementation

- [ ] 4.1 Implement: Route engine project-manifest loading through the protocol loader and normalize legacy/current compact and expanded entries without losing comment metadata or structured version failures.
- [ ] 4.2 Implement: Update `packages/engine/src/manifest/mutations.ts`, `manifest/project-files.ts`, `install/commit/delta.ts`, and `install/commit/tri-write.ts` so source changes preserve overrides, empty expanded entries collapse canonically, and successful non-frozen commits write `manifestVersion: 0.1`.
- [ ] 4.3 Implement: Add transactional tests proving successful legacy migration preserves every entry, failed operations leave prior manifest bytes unchanged, frozen operations retain legacy bytes, duplicate members fail before mutation, and unrelated add/update/remove operations preserve expanded entries.
- [ ] 4.4 Implement: Update `facet list` and any other read-only consumers to obtain a facet source from either compact or expanded entries; add legacy/current read-tolerance tests.
- [ ] 4.5 Verify: Run targeted engine manifest, add, remove, list, frozen, and tri-write tests plus engine typechecking.

## 5. Resolve and Compose Pipeline — Research

- [ ] 5.1 Explore: Trace the current interleaved install loop, source-specific resolvers, verified authored plans, integrity reconciliation, journal lifecycle, lock scope, outcome classification, stage events, and structured failure unions.
- [ ] 5.2 Explore: Trace adapter preflight and every pre-materialization failure path to establish which failures must precede collision resolution and which paths must guarantee no mutation.
- [ ] 5.3 Propose: Define the resolve-all, compose, resolver-callback, and apply handoff types so fresh versus inherited content and resolved versus colliding plans cannot represent illegal mixed states.

## 6. Resolve and Compose Pipeline — Implementation

- [ ] 6.1 Implement: Replace parallel optional resolved-facet fields with a tagged fresh/inherited union and extract deterministic resolve-all behavior that retains authored plans/bytes without invoking adapters.
- [ ] 6.2 Implement: Implement Compose over the complete desired set: apply persisted overrides, report stale overrides, derive effective identities, call the protocol planner, and produce lockfile dispositions, retained adapter keys, and effective ownership only for collision-free results.
- [ ] 6.3 Implement: Add the optional typed collision-resolver callback and structured collision, invalid-resolution, and cancellation results/events; frozen mode and calls without a resolver must return every group without prompting or mutation.
- [ ] 6.4 Implement: Refactor `runInstall` into preflight, resolve-all, compose, apply, and commit boundaries; keep the project lock across resolution, create the journal only after Compose succeeds, and final-validate callback choices without reopening the resolver.
- [ ] 6.5 Implement: Update reuse and outcome classification so disposition-only changes at unchanged versions are `updated`, disk-only drift remains `repaired`, and source/integrity failures still retain deterministic ordering.
- [ ] 6.6 Implement: Add tests for no adapter calls during resolve/compose, all-group collision failures, adapter/integrity precedence, resolver success, invalid callback output, cancellation, stale-override retention on failure, and successful transactional pruning.
- [ ] 6.7 Verify: Run targeted resolve, compose, callback, run-install, add, remove, and outcome-classification tests plus engine typechecking.

## 7. Effective Ownership, Receipts, and Frozen Reproduction — Research

- [ ] 7.1 Explore: Trace materialization, drift removal, receipt bootstrap/validation, companion ownership, journal replay, and adapter request construction to distinguish authored identity from effective adapter identity at every read/write/delete boundary.
- [ ] 7.2 Explore: Trace receipt and lockfile version dispatch plus every frozen consistency check, including legacy formats, local/git provenance, orphan cleanup, and current no-network/no-registry-confirmation guarantees.
- [ ] 7.3 Propose: Define the global two-pass apply and migration approach for ownership transfer, duplicate historical claims, alias changes, omissions, frozen materialization drift, and rollback safety.

## 8. Effective Ownership, Receipts, and Frozen Reproduction — Implementation

- [ ] 8.1 Implement: Add receipt `0.3` with authored identity, authored owned paths, and authored/aliased disposition; refine receipt `1` and `0.2` to authored, filter omitted lockfile assets during bootstrap, and retain all untrusted-path/project-isolation safeguards.
- [ ] 8.2 Implement: Replace per-facet deletion planning with a global effective-adapter-key apply pass that aggregates historical claims, retains identities claimed by any desired asset, deletes obsolete identities once, and safely handles cross-facet ownership transfer.
- [ ] 8.3 Implement: Materialize non-omitted assets under effective names while keeping content lookup, integrity, descriptions, metadata, and companion extraction authored; ensure generated front matter and adapter read/install/delete requests use the effective name.
- [ ] 8.4 Implement: Make alias changes delete old ownership and write new ownership transactionally, make omission toggles remove/restore complete bundles, preserve unowned files, and cover journal rollback after partial global apply.
- [ ] 8.5 Implement: Extend frozen gates for manifest version, locked dispositions, stale overrides, unresolved effective collisions, and legacy lockfiles that cannot represent intent while preserving exact-version downloads, no registry confirmation, and receipt-only cleanup.
- [ ] 8.6 Implement: Add receipt, ownership-transfer, duplicate-claim, companion-cleanup, alias/omit drift, offline removal, frozen, integrity, and rollback tests covering all retained legacy safeguards.
- [ ] 8.7 Verify: Run targeted materialization/apply, receipt, removal, frozen-drift, integrity, and journal tests plus engine typechecking.

## 9. CLI Collision Resolution Experience — Research

- [ ] 9.1 Explore: Inspect `packages/cli/src/tui/views/install/`, existing overview/focused-item editors, focus/navigation hooks, inline input validation, cancellation handling, semantic colors/icons, and Ink test helpers.
- [ ] 9.2 Explore: Inspect add/install/remove command wiring, stdin/stdout TTY and raw-mode capability checks, SIGINT behavior, install stage events, exhaustive failure rendering, stderr formatting, and final summary construction.
- [ ] 9.3 Propose: Define the single-mount progress-to-workspace phase machine, global draft state, accessible status vocabulary, linked-conflict navigation, resolver bridge, and non-interactive error presentation.

## 10. CLI Collision Resolution Experience — Implementation

- [ ] 10.1 Implement: Add one shared interactive-capability check for stdin/stdout/raw-mode support and an accessible unresolved/draft-conflict/resolved presentation whose labels or icons remain distinguishable without color.
- [ ] 10.2 Implement: Implement the global collision draft and focused resolution workspace under `packages/cli/src/tui/views/install/`, with an all-groups overview, Keep/Alias/Omit controls, validated alias input, linked conflict navigation, and confirmation only when every item is resolved.
- [ ] 10.3 Implement: Integrate the workspace into the existing `InstallView` mount as progress → resolution → progress → result, wire the typed engine callback only for interactive non-frozen commands, and make cancellation/SIGINT return a cancellation value with accurate no-change messaging.
- [ ] 10.4 Implement: Render non-interactive collision failures to stderr with every group and claimant, exact expanded `facets.json` locations, parseable alias/omit snippets, no generated winner, a non-zero exit, and an explicit no-mutation statement.
- [ ] 10.5 Implement: Render stale-override pruning without `--verbose`, frozen stale-override drift, the visible collision-checking stage, disposition-only updates, authored-to-effective alias summaries, and omitted assets without counting them as materialized.
- [ ] 10.6 Implement: Add status/draft/component keyboard tests, InstallView phase/cancellation tests, stderr formatter tests, command tests, and collision e2e coverage for interactive, non-interactive, frozen, and adapter-precedence behavior.
- [ ] 10.7 Verify: Run CLI unit tests, typechecking, build-dependent e2e tests, and adapter conformance tests using aliased names.

## 11. User and Specification Documentation — Research

- [ ] 11.1 Explore: Re-audit `docs/specification/project-manifest.mdx`, `lockfile.mdx`, `install.mdx`, `planning.mdx`, `commit.mdx`, `manifest.mdx`, `integrity.mdx`, and `terminology.mdx` against the implemented schemas and phase boundaries, preserving existing inbound anchors.
- [ ] 11.2 Explore: Re-audit `docs/cli/add.mdx`, `install.mdx`, `instructions.mdx`, `remove.mdx`, and `list.mdx` plus `docs/guides/install-facets.mdx`, `custom-adapters.mdx`, and `troubleshooting.mdx` against final CLI output and recovery behavior.
- [ ] 11.3 Explore: Inspect `docs/changelog/index.mdx`, documentation conventions, navigation/link requirements, and root `README.md`; confirm whether the reviewed README quickstart remains accurate.
- [ ] 11.4 Propose: Define one non-duplicative documentation update plan covering schema references, install behavior, CLI workflows, guides, recovery, changelog, links, and the README disposition.

## 12. User and Specification Documentation — Implementation

- [ ] 12.1 Implement: Update `docs/specification/project-manifest.mdx` for `manifestVersion: 0.1`, exact dispatch, legacy migration, compact/expanded entries, typed overrides, preservation/collapse rules, duplicate rejection, and frozen behavior.
- [ ] 12.2 Implement: Update `docs/specification/lockfile.mdx` for lockfile `0.3`, required dispositions, authored paths, omitted records, exact legacy dispatch, migration policy, and receipt/effective-ownership implications.
- [ ] 12.3 Implement: Update install pipeline documentation in `docs/specification/install.mdx`, `planning.mdx`, `commit.mdx`, `manifest.mdx`, `integrity.mdx`, and `terminology.mdx` for authored/effective identities, Resolve-all/Compose/Apply, global ownership, frozen behavior, and the four independent version axes while preserving existing anchors.
- [ ] 12.4 Implement: Update `docs/cli/add.mdx`, `docs/cli/install.mdx`, and `docs/guides/install-facets.mdx` with the interactive resolution workflow, red/yellow/green status model with non-color cues, persisted examples, non-interactive/frozen behavior, cancellation, summaries, and resulting on-disk layout.
- [ ] 12.5 Implement: Update `docs/cli/instructions.mdx`, `remove.mdx`, `list.mdx`, `docs/guides/custom-adapters.mdx`, and `troubleshooting.mdx` for manual CI intent, effective adapter names, expanded-entry reading, ownership-safe removal, unsupported versions, stale overrides, and recovery.
- [ ] 12.6 Implement: Add the newest-first changelog entry for the breaking manifest/lockfile/receipt formats and collision workflow, including required RSS metadata and links, without rewriting historical entries; leave README unchanged unless final behavior invalidates the reviewed quickstart.
- [ ] 12.7 Verify: Run documentation formatting/link checks and stale-text searches for lockfile/receipt `0.2`, three-version-axis claims, string-only manifests, and the interleaved install loop.

## 13. Migration Rollout and Cross-Layer Validation — Research

- [ ] 13.1 Explore: Audit all protocol, engine, CLI, adapter, fixture, and documentation tests affected by the manifest/lockfile/receipt version changes and identify any remaining permissive legacy types or alias-unaware helpers that could drop dispositions.
- [ ] 13.2 Propose: Define the final rollout gate that enables current `0.3` writers only after protocol, engine, CLI, migration, rollback, adapter, and documentation behavior is green together.

## 14. Migration Rollout and Cross-Layer Validation — Implementation

- [ ] 14.1 Implement: Remove or narrow permissive manifest/lockfile compatibility paths that could silently drop expanded entries or dispositions while retaining explicit legacy `1`, `0.2`, and unversioned readers.
- [ ] 14.2 Implement: Enable unconditional non-frozen lockfile/receipt `0.3` writes and transactional project-manifest `0.1` migration only after all effective-ownership and CLI paths are wired; verify frozen operations retain loaded manifest/lockfile versions and write only safe machine-local receipt state.
- [ ] 14.3 Implement: Add cross-package migration fixtures and tests for resolution-free upgrades, alias/omit projects, downgrade fail-closed behavior, failed-write restoration, teammate/CI reproduction, and removing all overrides without format downgrade.
- [ ] 14.4 Verify: Run `bun check` for the complete repository and resolve every test, type, lint, formatting, e2e, documentation, and build failure before marking the change implementation-ready.
