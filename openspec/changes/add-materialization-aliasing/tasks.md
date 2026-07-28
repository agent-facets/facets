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

- [x] 1.1 Explore: Inspect the existing asset-name validators, portable collision normalization, shared skill/command validation, and canonical authored-path derivation in `packages/protocol` and `packages/common`.
- [x] 1.2 Explore: Inspect the project-manifest, lockfile, and build-manifest schemas/loaders and their exact-dispatch, duplicate-member, fixture, and public-export test patterns.
- [x] 1.3 Explore: Inspect protocol package release metadata and all downstream consumers of project-manifest and lockfile types/constants so explicit legacy readers, removal of permissive compatibility exports, and the single-delivery `0.3` writer transition are defined safely.
- [x] 1.4 Propose: Define the protocol implementation approach for one namespace mapping, tagged dispositions, legacy/current manifest dispatch, lockfile `0.3`, canonical identity helpers, and a deterministic planner without duplicating existing sources of truth.

## 2. Protocol Identity and Schema Contracts — Implementation

- [x] 2.1 Implement: Add the shared materialization namespace, collision-key, adapter-key, and canonical authored-path helpers; refactor existing facet/build collision validation to consume the shared rules; add focused namespace and portability tests.
- [x] 2.2 Implement: Add the three-arm `MaterializationDisposition` schema/type and derive project-override and materialized-only variants; enforce the single-segment alias grammar and rejection of stray or missing alias fields; add scenario-complete tests.
- [x] 2.3 Implement: Implement legacy-unversioned and exact `manifestVersion: 0.1` schemas in `packages/protocol/src/schemas/project-manifest.ts` plus a project-manifest loader that rejects duplicate members before exact version dispatch and never falls back by shape; cover compact/expanded entries, typed override maps, invalid aliases, unsupported versions, and empty-expanded-entry rejection.
- [x] 2.4 Implement: Add lockfile `0.3` with required dispositions while preserving exact readers for `1` and `0.2`; factor shared file-record validation, keep authored names/paths for aliases and omissions, and test malformed-current no-fallback behavior.
- [x] 2.5 Implement: Implement the pure deterministic materialization planner as a discriminated result union, reporting every ordered collision group and supporting scope separation, shared skill/command names, aliases, omissions, name transfers, swaps, temporary draft conflicts, and declaration-order independence.
- [x] 2.6 Implement: Export the new protocol contracts through the curated public surface and update protocol release notes/metadata according to repository conventions without changing archive or adapter API versions.
- [x] 2.7 Verify: Run the protocol unit tests, typecheck, and public-surface/build checks; confirm the new schema and planner scenario suites pass.

## 3. Project Manifest Intent and Migration — Research

- [x] 3.1 Explore: Trace every `facets.json` reader, mutation, empty-document producer, source update, delta merge, serializer, and tri-write path across engine and CLI, including comment-preserving behavior and `facet list`.
- [x] 3.2 Explore: Trace frozen and normal migration boundaries for legacy unversioned manifests and identify where unsupported versions, expanded legacy entries, source updates, empty override collapse, and stale overrides are handled transactionally.
- [x] 3.3 Propose: Define the normalized in-memory manifest shape and write policy that preserve comments, untouched expanded entries, and overrides while keeping the protocol schema as the source of truth.

## 4. Project Manifest Intent and Migration — Implementation

- [x] 4.1 Implement: Route engine project-manifest loading through the protocol loader and normalize legacy/current compact and expanded entries without losing comment metadata or structured version failures.
- [x] 4.2 Implement: Update `packages/engine/src/manifest/mutations.ts`, `manifest/project-files.ts`, `install/commit/delta.ts`, and `install/commit/tri-write.ts` so source changes preserve overrides, empty expanded entries collapse canonically, and successful non-frozen commits write `manifestVersion: 0.1`.
- [x] 4.3 Implement: Add transactional tests proving successful legacy migration preserves every entry, failed operations leave prior manifest bytes unchanged, frozen operations retain legacy bytes, duplicate members fail before mutation, and unrelated add/update/remove operations preserve expanded entries.
- [x] 4.4 Implement: Update `facet list` and any other read-only consumers to obtain a facet source from either compact or expanded entries; add legacy/current read-tolerance tests.
- [x] 4.5 Verify: Run targeted engine manifest, add, remove, list, frozen, and tri-write tests plus engine typechecking.

## 5. Resolve and Compose Pipeline — Research

- [x] 5.1 Explore: Trace the current interleaved install loop, source-specific resolvers, verified authored plans, integrity reconciliation, journal lifecycle, lock scope, outcome classification, stage events, and structured failure unions.
- [x] 5.2 Explore: Trace adapter preflight and every pre-materialization failure path to establish which failures must precede collision resolution and which paths must guarantee no mutation.
- [x] 5.3 Propose: Define the resolve-all, compose, resolver-callback, and apply handoff types so verified authored content, loaded legacy state, current persisted state, and resolved versus colliding plans cannot represent illegal mixed states.

## 6. Resolve and Compose Pipeline — Implementation

- [x] 6.1 Implement: Extract deterministic resolve-all behavior in which every resolved facet retains its verified authored plan and companion bytes regardless of source, cache warmth, or frozen mode; remove the inherited-content arm and invoke no adapter I/O methods during Resolve or Compose.
- [x] 6.2 Implement: Remove the deprecated unpinned lockfile schema/types/constants, preserve exact `1`, `0.2`, and `0.3` readers through version-specific and derived supported-format unions, narrow every engine consumer to its actual read/write/identity contract, add receipt `0.3` with exact `1`/`0.2` refinement, and move both current writer constants directly to `0.3`.
- [x] 6.3 Implement: Implement Compose over the complete desired set as the sole constructor of current lockfile entries and effective receipt intent: apply persisted overrides, report stale overrides, derive effective identities, call the protocol planner, and produce dispositions, retained adapter keys, and effective ownership only for collision-free results.
- [x] 6.4 Implement: Add the optional typed collision-resolver callback and structured collision, invalid-resolution, and cancellation results/events; frozen mode and calls without a resolver must return every group without prompting or mutation.
- [x] 6.5 Implement: Refactor `runInstall` into preflight, resolve-all, compose, apply, and commit boundaries; keep the project lock across resolution, create the journal only after Compose succeeds, and final-validate callback choices without reopening the resolver.
- [x] 6.6 Implement: Update reuse and outcome classification so disposition-only changes at unchanged versions are `updated`, disk-only drift remains `repaired`, and source/integrity failures still retain deterministic ordering.
- [x] 6.7 Implement: Add tests for no adapter I/O calls during resolve/compose, cache-independent frozen verification, frozen companion retention/repair, exact legacy/current refinement, all-group collision failures, adapter/integrity precedence, resolver success, invalid callback output, cancellation, stale-override retention on failure, and successful transactional pruning.
- [x] 6.8 Verify: Run targeted resolve, compose, callback, run-install, add, remove, and outcome-classification tests plus engine typechecking.

## 7. Effective Ownership, Receipts, and Frozen Reproduction — Research

- [x] 7.1 Explore: Trace materialization, drift removal, receipt bootstrap/validation, companion ownership, journal replay, and adapter request construction to distinguish authored identity from effective adapter identity at every read/write/delete boundary.
- [x] 7.2 Explore: Trace receipt and lockfile version dispatch plus every frozen consistency check, including legacy formats, local/git provenance, orphan cleanup, and current no-network/no-registry-confirmation guarantees.
- [x] 7.3 Propose: Define the global two-pass apply and migration approach for ownership transfer, duplicate historical claims, alias changes, omissions, frozen materialization drift, and rollback safety.

## 8. Effective Ownership, Receipts, and Frozen Reproduction — Implementation

- [x] 8.1 Implement: Replace per-facet deletion planning with a global effective-adapter-key apply pass that aggregates historical claims, retains identities claimed by any desired asset, deletes obsolete identities once, and safely handles cross-facet ownership transfer.
- [x] 8.2 Implement: Materialize non-omitted assets under effective names while keeping content lookup, integrity, descriptions, metadata, and companion extraction authored; ensure generated front matter and adapter read/install/delete requests use the effective name.
- [x] 8.3 Implement: Make alias changes delete old ownership and write new ownership transactionally, make omission toggles remove/restore complete bundles, preserve unowned files, and cover journal rollback after partial global apply.
- [x] 8.4 Implement: Extend frozen gates for manifest version, locked dispositions, stale overrides, unresolved effective collisions, and legacy lockfiles that cannot represent intent while preserving exact-version downloads, no registry confirmation, and receipt-only cleanup.
- [x] 8.5 Implement: Add receipt, ownership-transfer, duplicate-claim, companion-cleanup, alias/omit drift, offline removal, frozen, integrity, and rollback tests covering all retained legacy safeguards.
- [x] 8.6 Verify: Run targeted materialization/apply, receipt, removal, frozen-drift, integrity, and journal tests plus engine typechecking.

## 9. CLI Collision Resolution Experience — Research

- [x] 9.1 Explore: Inspect `packages/cli/src/tui/views/install/`, existing overview/focused-item editors, focus/navigation hooks, inline input validation, cancellation handling, semantic colors/icons, and Ink test helpers.
- [x] 9.2 Explore: Inspect add/install/remove command wiring, stdin/stdout TTY and raw-mode capability checks, SIGINT behavior, install stage events, exhaustive failure rendering, stderr formatting, and final summary construction.
- [x] 9.3 Propose: Define the single-mount progress-to-workspace phase machine, global draft state, accessible status vocabulary, linked-conflict navigation, resolver bridge, and non-interactive error presentation.

## 10. CLI Collision Resolution Experience — Implementation

- [x] 10.1 Implement: Add one shared interactive-capability check for stdin/stdout/raw-mode support and an accessible unresolved/draft-conflict/resolved presentation whose labels or icons remain distinguishable without color.
- [x] 10.2 Implement: Implement the global collision draft and focused resolution workspace under `packages/cli/src/tui/views/install/`, with an all-groups overview, Keep/Alias/Omit controls, validated alias input, linked conflict navigation, and confirmation only when every item is resolved.
- [x] 10.3 Implement: Integrate the workspace into the existing `InstallView` mount as progress → resolution → progress → result, wire the typed engine callback only for interactive non-frozen commands, and make cancellation/SIGINT return a cancellation value with accurate no-change messaging.
- [x] 10.4 Implement: Render non-interactive collision failures to stderr with every group and claimant, exact expanded `facets.json` locations, parseable alias/omit snippets, no generated winner, a non-zero exit, and an explicit no-mutation statement.
- [x] 10.5 Implement: Render stale-override pruning without `--verbose`, frozen stale-override drift, the visible collision-checking stage, disposition-only updates, authored-to-effective alias summaries, and omitted assets without counting them as materialized.
- [x] 10.6 Implement: Add status/draft/component keyboard tests, InstallView phase/cancellation tests, stderr formatter tests, command tests, and collision e2e coverage for interactive, non-interactive, frozen, and adapter-precedence behavior.
- [x] 10.7 Verify: Run CLI unit tests, typechecking, build-dependent e2e tests, and adapter conformance tests using aliased names.

## 11. User and Specification Documentation — Research

- [x] 11.1 Explore: Re-audit `docs/specification/project-manifest.mdx`, `lockfile.mdx`, `install.mdx`, `planning.mdx`, `commit.mdx`, `manifest.mdx`, `integrity.mdx`, and `terminology.mdx` against the implemented schemas and phase boundaries, preserving existing inbound anchors.
- [x] 11.2 Explore: Re-audit `docs/cli/add.mdx`, `install.mdx`, `instructions.mdx`, `remove.mdx`, and `list.mdx` plus `docs/guides/install-facets.mdx`, `custom-adapters.mdx`, and `troubleshooting.mdx` against final CLI output and recovery behavior.
- [x] 11.3 Explore: Inspect `docs/changelog/index.mdx`, documentation conventions, navigation/link requirements, and root `README.md`; confirm whether the reviewed README quickstart remains accurate.
- [x] 11.4 Propose: Define one non-duplicative documentation update plan covering schema references, install behavior, CLI workflows, guides, recovery, changelog, links, and the README disposition.

## 12. User and Specification Documentation — Implementation

> Approved plan additions from 11.4, beyond the original file list: (a) a new
> `docs/specification/materialization.mdx` owning the identity/disposition model,
> registered in the `Installation` nav group, so the model is stated once rather
> than restated on nine pages; (b) correcting the `facet instructions` prompt
> source, which currently tells agents `facets.json` is a flat string map and
> should not be hand-edited — both false, and the second steers agents away from
> the only non-TTY remedy; (c) fixing four pre-existing `README.md` defects found
> during the audit. `facet list` cannot show aliased or omitted assets; that gap
> is documented, not closed, in this change.

- [x] 12.0 Implement: Add `docs/specification/materialization.mdx` defining authored vs. effective identity, the three dispositions, the override schema, collision/adapter keys and portable folding, the skill-command namespace rule, and the planner's determinism guarantees; register it in the `Installation` nav group in `docs/docs.json`.
- [x] 12.1 Implement: Update `docs/specification/project-manifest.mdx` for `manifestVersion: 0.1`, exact dispatch, legacy migration, compact/expanded entries, typed overrides, preservation/collapse rules, duplicate rejection, and frozen behavior.
- [x] 12.2 Implement: Update `docs/specification/lockfile.mdx` for lockfile `0.3`, required dispositions, authored paths, omitted records, exact legacy dispatch, migration policy, and receipt/effective-ownership implications.
- [x] 12.3 Implement: Update install pipeline documentation in `docs/specification/install.mdx`, `planning.mdx`, `commit.mdx`, `manifest.mdx`, `integrity.mdx`, and `terminology.mdx` for authored/effective identities, Resolve-all/Compose/Apply, global ownership, frozen behavior, and the four independent version axes while preserving existing anchors.
- [x] 12.4 Implement: Update `docs/cli/add.mdx`, `docs/cli/install.mdx`, and `docs/guides/install-facets.mdx` with the interactive resolution workflow, red/yellow/green status model with non-color cues, persisted examples, non-interactive/frozen behavior, cancellation, summaries, and resulting on-disk layout.
- [x] 12.5 Implement: Update `docs/cli/instructions.mdx`, `remove.mdx`, `list.mdx`, `docs/guides/custom-adapters.mdx`, and `troubleshooting.mdx` for manual CI intent, effective adapter names, expanded-entry reading, ownership-safe removal, unsupported versions, stale overrides, and recovery.
- [x] 12.5a Implement: Correct the `facet instructions` prompt source (`packages/cli/src/prompts/`) so emitted agent guidance describes compact and expanded `facets.json` entries and the hand-edit recovery path for collisions, and add tests asserting that guidance.
- [x] 12.6 Implement: Add the newest-first changelog entry for the breaking manifest/lockfile/receipt formats and collision workflow, including required RSS metadata and links, without rewriting historical entries; leave README's quickstart unchanged, and repair the four pre-existing README defects found in 11.3 (three dead relative links, stale bare-name resolution claim).
- [x] 12.7 Verify: Run documentation formatting/link checks and stale-text searches for lockfile/receipt `0.2`, three-version-axis claims, string-only manifests, and the interleaved install loop.

## 13. Migration and Cross-Layer Validation — Research

- [ ] 13.1 Explore: Audit all protocol, engine, CLI, adapter, fixture, and documentation tests affected by the manifest/lockfile/receipt version changes and identify any remaining permissive types, obsolete compatibility exports, or alias-unaware helpers that could drop dispositions.
- [ ] 13.2 Propose: Define the final cross-layer migration validation matrix and any residual corrections required before the single release is implementation-ready.

## 14. Migration and Cross-Layer Validation — Implementation

- [ ] 14.1 Implement: Remove any residual permissive or obsolete compatibility path found by the final audit while retaining only the explicit legacy `1`, `0.2`, and unversioned readers required by the specification.
- [ ] 14.2 Implement: Verify unconditional non-frozen lockfile/receipt `0.3` writes and transactional project-manifest `0.1` migration hold across every command, and that frozen operations retain loaded manifest/lockfile versions and write only safe machine-local receipt state.
- [ ] 14.3 Implement: Add cross-package migration fixtures and tests for resolution-free upgrades, alias/omit projects, downgrade fail-closed behavior, failed-write restoration, teammate/CI reproduction, and removing all overrides without format downgrade.
- [ ] 14.4 Verify: Run `bun check` for the complete repository and resolve every test, type, lint, formatting, e2e, documentation, and build failure before marking the change implementation-ready.
