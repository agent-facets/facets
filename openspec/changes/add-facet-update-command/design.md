## Context

`facet install` intentionally reproduces a satisfying `facets.lock` entry, while an explicit non-exact `facet add` request re-resolves that one facet. There is no project-wide operation that resolves every registry-backed manifest entry against both its authored version intent and the registry’s latest release, lets the user choose targets, and then applies those targets through the verified install transaction.

The required behavior crosses the CLI router and Ink UI, the engine registry client, manifest and lockfile loading, and the install transaction. The existing protocol version-spec grammar, manifest schema, lockfile schema, cache, materialization planner, MCP reconciliation, and file transaction remain authoritative. No persisted format or registry deployment changes are required.

Relevant constraints are:

- `facets.json` values preserve user-authored version intent and comment metadata; updates MUST use the existing normalized mutation and transactional write path rather than rebuilding JSON.
- A satisfying lockfile entry anchors reproduction, so an update MUST carry an explicit target into resolution rather than relying on ordinary install behavior.
- Discovery, dry-run, and interactive selection MUST NOT download facet content, populate the cache, install adapters, or mutate project or machine-local configuration.
- Registry discovery MUST be complete or fail closed. The existing metadata resolver accepts caller-relative version specifiers but has no server-side batch transport yet.
- Selected updates MUST retain the existing integrity, collision, MCP-consent, ownership, receipt, rollback, and concurrent-write guarantees.
- Engine failures MUST remain structured values; the CLI owns rendering and exit codes.

Stakeholders are project users updating facets, automation previewing updates, registry users with caller-relative private-version visibility, and maintainers of the install transaction and CLI documentation.

## Goals / Non-Goals

**Goals:**

- Provide one engine-owned discovery model containing each checkable registry facet's manifest specifier, Current version, range-respecting Target, and registry Latest version.
- Support range-respecting application, explicit latest application, Bun-style interactive selection, and write-free dry-run from the same discovered plan.
- Preserve manifest specifier style and materialization overrides while forcing each selected exact target through registry confirmation and the existing install transaction.
- Detect a plan that became stale between discovery and application before any mutation.
- Make `facet upgrade` a true alias of `facet update` and keep facet-package updates distinct from CLI-binary self-update.
- Align user, agent, roadmap, and specification documentation with the shipped behavior.

**Non-Goals:**

- Updating git or local facet sources.
- Adding positional, wildcard-name, or dependency-group selectors.
- Adding another check-only mode, JSON output, changelog retrieval, package diffs, or asset-level previews.
- Adding a registry batch endpoint or changing the registry OpenAPI contract.
- Changing version-spec grammar, project-manifest schema, lockfile schema, receipt schema, cache layout, or archive formats.
- Making `facet upgrade` an independent implementation.
- Changing `facet list` into a network-backed outdated check.

## Decisions

### D1. Separate read-only preparation from guarded application

The engine SHALL expose a two-phase update workflow:

1. `prepareFacetUpdate` SHALL load and validate `facets.json` and `facets.lock`, capture their exact `FileState` values, perform registry version discovery, re-read both files, and return either a structured preparation failure or a `PreparedFacetUpdate` containing the display plan and its snapshot.
2. `runPreparedFacetUpdate` SHALL accept that prepared value, selected target choices, adapters, and the normal install callbacks. It SHALL validate the selection, select the exact metadata already carried by the prepared plan for every chosen target, and invoke the install transaction with an update operation bound to the captured snapshot.

Preparation SHALL remain lock-free and read-only. This avoids holding the project install lock while a user reviews an interactive screen and ensures dry-run or cancellation leaves no persistent lock-directory, cache, adapter, receipt, manifest, lockfile, materialization, or native-configuration change. The post-network re-read SHALL reject a plan if either file changed during discovery.

Application SHALL acquire the existing install lock before reading project state. Under that lock it SHALL compare the newly loaded manifest and lockfile states with the preparation snapshot using exact file-state equality. A mismatch SHALL return a structured `UPDATE_PLAN_STALE` failure before resolution, content download, cache writes, or transaction creation and SHALL direct the user to rerun the command. Exact selected targets are immutable registry identities, so a version published after discovery SHALL not silently change an already-confirmed plan.

The CLI SHALL perform interactive selection before calling adapter selection. Therefore cancelling the update picker SHALL not install an adapter as a side effect. Default application MAY obtain adapters immediately after preparation because the user requested application without a selection gate.

**Alternatives considered:** Holding the install lock through network discovery and the interactive picker would eliminate the snapshot handoff but could block every other facet operation indefinitely and would make a preview acquire persistent machine-local lock infrastructure. Discovering before application without a snapshot precondition would allow a confirmed plan to overwrite or merge against state the user never saw. Both alternatives are rejected.

### D2. Build one validated, tagged discovery plan through existing metadata resolution

Discovery SHALL construct exactly two `RegistrySpec` inputs for each registry-backed manifest entry: one using the authored `VersionSpec` to resolve Target and one using `latest` to resolve Latest. It SHALL flatten those pairs in manifest order, divide them into groups of at most 100 specifiers, and invoke `resolveRegistryMetadataBatch` for every group concurrently. A full group therefore covers 50 facets. `resolveRegistryMetadataBatch` SHALL accept at most 100 specifiers per invocation and SHALL run its current per-specifier requests concurrently.

After every group settles, discovery SHALL inspect group results in original input order and return the first input-ordered failure rather than a partial plan. Successful metadata SHALL be paired back to facets in manifest order. The client SHALL validate that each response matches the requested facet name, contains usable integrity fields, and resolves to an exact supported `MAJOR.MINOR.PATCH`; Target SHALL additionally satisfy the authored specifier. The registry is authoritative for resolving the authored specifier and `latest`.

**TODO:** Replace the internal per-specifier requests in `resolveRegistryMetadataBatch` with the registry’s planned batch endpoint when it becomes available.

Discovery SHALL parse and classify every manifest entry before presenting a plan:

- A registry entry is checkable only when it has a matching, usable registry lockfile entry whose exact Current version satisfies the manifest specifier.
- Update SHALL not re-resolve Current or use registry availability of the locked version as a discovery precondition. Repairing an unavailable installed version remains the responsibility of `facet install`.
- A registry entry with missing, mismatched, invalid, or drifted local resolution state SHALL make preparation fail with all affected facet names and a remedy to run `facet install`. It SHALL never be reported as current and update SHALL not become a second drift-repair command.
- Git and local entries SHALL appear as tagged `unsupported-source` rows for dry-run output but SHALL not block updates to checkable registry facets.
- A checkable registry row SHALL carry the exact Target and Latest metadata returned by discovery and SHALL be tagged as `candidate` when either resolved version is newer than Current, otherwise as `current`. Exact pins therefore remain unchanged by default but still appear as candidates when a newer Latest can be selected interactively or with `--latest`.

Target SHALL be the exact version returned for the authored specifier. Latest SHALL be the exact version returned for `latest`. Only a choice newer than Current SHALL be selectable, so update SHALL never downgrade an installed facet. A registry lookup failure SHALL fail the whole preparation before any actionable plan is rendered.

The plan types SHALL use tagged unions rather than optional fields to distinguish `candidate`, `current`, and `unsupported-source` rows. CLI rendering and application SHALL consume this one engine result; the CLI SHALL NOT reimplement version matching, ordering, or specifier rewriting.

**Alternatives considered:** Creating a dedicated version-list discovery client would duplicate an existing registry boundary and fetch information update does not use. Resolving selected targets again during application would repeat discovery without adding trust because exact published versions are immutable. Treating absent lock state as current would produce false clean reports. Proceeding with checkable facets while merely listing registry facets with unusable local state would make one invocation look complete while silently omitting facets that require install or repair. Returning partial registry lookup successes would likewise let users apply a plan known to omit failures. These alternatives are rejected.

### D3. Represent update as a distinct install operation and resolve selected versions exactly

Adding optional update fields to the existing `InstallDelta` would permit illegal combinations such as additions, removals, and snapshot-bound updates in one value. The install input SHALL instead become a tagged operation with mutually exclusive `reproduce`, `add`, `remove`, and `update` arms. Frozen-lockfile mode SHALL be representable only with `reproduce`; `update` SHALL always be non-frozen. Existing add and remove front doors SHALL construct their corresponding arms, preserving current behavior while removing the existing add/remove conflict state.

An update operation SHALL carry:

- the exact prepared manifest and lockfile states;
- a non-empty set of selected facets;
- for each facet, its exact selected metadata and its final manifest source string.

`runPreparedFacetUpdate` SHALL validate each selected choice against the prepared rows and attach the corresponding Target or Latest `RegistryMetadata` already returned by discovery. It SHALL NOT perform a second registry metadata request. Exact published versions are immutable, so the selected metadata remains the authoritative registry confirmation supplied to content resolution.

For each selected facet, the install merge SHALL preserve existing overrides, write only the chosen manifest source in memory, and provide the selected exact version as a resolution override. Resolution SHALL ignore the old lock anchor for that facet and SHALL use the prefetched metadata as registry confirmation. Non-selected facets SHALL follow normal reproduction semantics. The prior lock entry SHALL remain available to ownership diffing and outcome classification, so existing `updated` summaries retain the old and new versions.

The final manifest source SHALL be derived by one pure engine helper shared by all modes:

- Range Target keeps the authored source unchanged.
- Latest chosen from an exact pin writes the selected exact version.
- Latest chosen from a major wildcard writes the selected major plus `.*`.
- Latest chosen from a minor wildcard writes the selected major and minor plus `.*`.
- Latest chosen from `*` or `latest` leaves that token unchanged.

The existing comment-preserving `applyDesiredFacets` path SHALL apply this in-memory intent only during the manifest/lockfile/receipt tri-write. Selected content SHALL continue through cache audit or download, registry integrity confirmation, verified plan construction, complete-set collision detection, MCP consent and takeover handling, materialization, native configuration, and one `FileTransaction`. All selected updates SHALL therefore commit or roll back together.

**Alternatives considered:** Encoding a selected target as an ordinary exact addition would collapse two independent values: the exact version to install and the source string to persist in `facets.json`. For example, installing exact Target `1.5.0` for an authored `1.*` entry must resolve and verify `1.5.0` while preserving `1.*` in the manifest. An exact addition would overwrite the range; a range addition would resolve again during application, could select a version published after discovery, and would discard the metadata already reviewed. Adding optional update-only fields to `Addition` would permit mismatched source, metadata, and snapshot combinations, while adding another tagged variant inside additions would bury operation-wide snapshot and non-empty-selection requirements inside a nested union. The top-level `update` arm keeps those requirements together while still reusing the existing install transaction. Patching the manifest after resolution would create two sources of truth for desired intent. Building a separate updater transaction would duplicate integrity, ownership, rollback, and concurrent-write guarantees. These alternatives are rejected.

### D4. Keep target choice and preview semantics explicit

The engine SHALL accept selected choices as facet name plus `range` or `latest`; it SHALL reject duplicates, unknown names, unsupported rows, and choices that do not advance Current as structured selection failures. Selection validation and manifest rewriting SHALL occur in engine so dry-run display and application cannot disagree.

The CLI SHALL derive mode defaults from the prepared candidates:

- Plain `facet update` SHALL select every candidate whose range Target is newer than Current.
- `facet update --latest` SHALL select every candidate whose Latest is newer than Current.
- `--interactive` SHALL show every candidate for which either choice is newer. Range SHALL be the initial choice unless `--latest` is present. Left and right SHALL address the Target and Latest columns directly, clamping at each end rather than wrapping so a held key settles on a column instead of oscillating; `l` SHALL flip the focused row between them.
- Interactive eligibility SHALL be derived from the presence of those candidate rows, not from whether the initial mode produced a non-empty default selection. In particular, plain `--interactive` SHALL open for a Latest-only candidate even though its initial Range Target is stationary. The range-specific “newer releases exist” no-op remains a non-interactive result; interactive selection is skipped only when neither choice advances for any facet.
- A row whose displayed choice equals Current SHALL not be selectable until the user toggles to an advancing choice. Interactive row state SHALL be a tagged selected/unselected union so a selected no-op choice is not representable.
- Confirm SHALL require at least one selected advancing target. Escape or Ctrl-C SHALL cancel before application.
- `--dry-run` without `--interactive` SHALL render the complete prepared plan using the mode's default choices. With `--interactive`, it SHALL render the user's confirmed selection and then stop before adapter selection or application.

The picker SHALL present candidate facets only and SHALL show aligned Current, Target, and Latest columns simultaneously. Each row SHALL state its chosen column as a visible word. Bold and underline MAY reinforce it but SHALL NOT carry it alone: those attributes are emitted only when the terminal advertises styling support, so under `NO_COLOR`, a pipe, or a screen reader they disappear entirely — and "which of these two similar numbers is selected" is not something a user can be left to infer. Advancing versions SHALL additionally expose the semantic size of the change by coloring only the changed suffix with existing theme roles: patch uses `THEME.success` (green), minor uses `THEME.caution` (amber), and major uses `THEME.warning` (coral). Current and stationary values remain dim. Colour is therefore never the sole carrier of any fact on this screen: the digits themselves say which component moved, and the chosen column is named in words. Reusing the existing three-rung semantic scale avoids introducing a second palette.

Dry-run is a successful preview, not a drift-check contract. It SHALL exit `0` both when updates are available and when no update is selected, matching `self-update --dry-run`; real preparation failures SHALL exit non-zero. A future check mode MAY define a distinct updates-available exit contract, but is outside this change.

Interactive cancellation SHALL exit `1`, not `0`, because the user abandoned the requested workflow rather than completing either an application or a no-op. This matches the existing interactive workspace convention and lets automation distinguish cancellation from a completed command.

No-op output SHALL distinguish: all registry facets current; newer releases exist but authored ranges permit none; and the project has no registry facets. Unsupported git/local rows SHALL be named rather than counted as current.

**Alternatives considered:** Returning non-zero merely because dry-run found updates would conflict with the CLI's `1 = user-facing failure` convention and with existing self-update preview behavior. Hiding exact pins from interactive mode would make the Target/Latest toggle unable to perform its primary override use case. Both alternatives are rejected.

### D5. Extend CLI metadata once, then derive parsing and help from it

`FlagDef` SHALL gain a canonical short-alias field consumed by both `run.ts` and `help.ts`. The per-command parser SHALL pass aliases to `@bomb.sh/args`, normalize parsed values onto long names, and exclude short names from undeclared-flag passthrough. Help SHALL render long and short forms from the same flag definition. No second alias map or command-local manual normalization SHALL be introduced.

The update command SHALL define `--latest`/`-L`, `--interactive`/`-i`, `--dry-run`, and the shared install-pipeline `--verbose` and `--accept-mcp` flags. It SHALL reject positional arguments. It SHALL not expose `--frozen-lockfile`. `facet upgrade` SHALL be declared only in `updateCommand.aliases`, never as another registry key, so canonical and alias invocations share behavior and canonical help.

The command SHALL reject `--interactive` in a non-interactive terminal using `canPromptInteractively()` before starting discovery. The standalone update picker SHALL reuse the established `InstallPicker` keyboard conventions and the collision workspace's non-color focus markers and always-active interrupt handling. Installation progress and final per-facet outcomes SHALL reuse `InstallView` with an `update` mode rather than introducing a second progress renderer.

After invocation and TTY validation, the CLI SHALL mount a lightweight discovery view before awaiting `prepareFacetUpdate`. While registry discovery is pending it SHALL state that it is checking the registry for facet updates and reuse the existing indeterminate `ProgressBar`; once preparation settles, that view SHALL be cleared and unmounted in a `finally` so the picker, static plan, no-op, or structured error renders onto a clean screen however discovery ended. The indicator SHALL remain indeterminate: discovery currently resolves concurrent groups without exposing per-request progress events, so a percentage or completed-count display would be invented rather than measured.

The indicator SHALL be drawn only when stdout is a terminal. An animated frame is a terminal affordance; piped to a file or a CI log it becomes many frames per second in front of the output the caller wanted, and existing `--dry-run` output assertions depend on that stream staying clean. A non-terminal run performs identical discovery and emits nothing extra. This is a CLI presentation wrapper only and SHALL NOT add an engine progress API or alter metadata batching.

Exit behavior SHALL remain:

- `0` for applied updates, no-op, or successful dry-run;
- `1` for invalid invocation, non-TTY interactive use, interactive cancellation, stale plan, discovery failure, or application failure;
- `2` only for an unexpected error escaping the command boundary.

Errors SHALL use the existing three-line stderr format and registry/install failure translators. Help, tables, picker frames, progress, and summaries SHALL use stdout. Cancellation SHALL report that nothing was applied and SHALL not report success.

**Alternatives considered:** Treating `-L` and `-i` as undeclared passthrough keys would leave aliases undocumented and force each handler to interpret two names. Registering `upgrade` as a second command object would duplicate help, tests, and behavior. A new update-specific progress pipeline would duplicate the install view. Reporting discovery percentages without progress events would present synthetic precision; printing nothing until all registry calls settle leaves the user unable to distinguish work from a stalled command. Both are rejected in favor of the existing indeterminate progress component. These alternatives are rejected.

### D6. Reconcile documentation around one canonical update workflow

Implementation SHALL update every affected user- and agent-facing source rather than leaving the old roadmap promise as a second contract:

- Create `docs/cli/update.mdx` with usage, range behavior, Current/Target/Latest terminology, flags, TTY requirements, dry-run scope, outcomes, exit codes—including interactive cancellation as `1`—source limitations, and self-update disambiguation.
- Convert `docs/cli/upgrade.mdx` from an unimplemented placeholder into a concise alias page that points to `facet update`. Keep the page so existing links remain valid, but remove it from the primary Facet Management navigation in `docs/docs.json` and add `cli/update` there.
- Update `docs/cli/self-update.mdx` to distinguish facet-package update/upgrade from CLI-binary self-update/self-upgrade and the facet registry from `FACET_CLI_REGISTRY`'s npm registry.
- Update both human and agent sections of `docs/guides/install-facets.mdx`; update `docs/cli/index.mdx`, `docs/roadmap/alpha.mdx`, `docs/roadmap/beta.mdx`, `docs/roadmap/stable.mdx`, and root `README.md`. The beta promise “surface what changed” SHALL be narrowed to version transitions and the normal installation summary; changelog and content diffs are not part of this change.
- Update `docs/specification/commit.mdx` so resolution has an explicit update mode and the manifest-write policy covers style-preserving latest selection. Add cross-links from `docs/cli/add.mdx` and `docs/cli/list.mdx` rather than duplicating install outcomes or adding network behavior to list. Verify the existing materialization documentation remains accurate.
- Add update guidance to `packages/cli/src/prompts/overview.txt` and `packages/cli/src/prompts/usage.txt`, with companion instruction-prompt tests.
- Add one new top-of-file entry to `docs/changelog/index.mdx` following its one-entry-per-day and RSS rules. The entry SHALL call out that `facet upgrade` changes from a non-mutating unimplemented stub into a live alias that applies facet updates. The historical sentence saying install shipped “without a separate `facet update` command” SHALL remain unchanged because it describes that release at that time; the new entry supersedes it without rewriting historical headings.

The OpenSpec delta SHALL modify `cli` and `installation`. It SHALL reuse the existing `protocol__version-spec` grammar rather than restating it.

**Alternatives considered:** Redirecting away `cli/upgrade` would preserve URLs but remove a useful explanation that the typed command remains a supported alias. Keeping both pages in primary navigation would make two names appear to be independent workflows. Duplicating installation outcome definitions on the update page would create competing sources of truth. These alternatives are rejected.

## Risks / Trade-offs

- **[A plan can become stale while a user is deciding]** → Preparation revalidates after network discovery, and application compares exact manifest and lockfile states again under the install lock before any side effect.
- **[Lock-free preparation can observe concurrent project activity]** → Exact post-discovery re-reads reject detected changes; the authoritative apply gate under the lock prevents stale writes even if preparation raced in an undetectable instant.
- **[Private or authorization-relative resolution can produce different targets for different callers]** → Discovery carries the same optional credentials as other registry reads and treats the registry’s Target and Latest resolutions as caller-relative. It does not use Current availability as an update precondition, and only advancing choices can be selected.
- **[`--latest` can intentionally widen a bounded range]** → The flag is explicit, dry-run and interactive display both range Target and Latest, specifier style is preserved, and all selected changes remain transactional.
- **[Discovery metadata could bypass the lockfile trust model]** → Target and Latest metadata come through the existing registry resolution boundary and selected content still passes through the existing three-check integrity chain; old lock integrity is never reused as the anchor for new content.
- **[Updates may introduce collisions or MCP configuration]** → Application reuses complete-set composition, consent, takeover, transaction, and rollback. Dry-run documents that it previews versions, not downstream asset or configuration effects.
- **[Short-flag support affects every command]** → Alias parsing and help derive from one `FlagDef` field and receive router-level unit and end-to-end coverage, including undeclared dynamic flags.
- **[Holding prepared file bytes increases in-memory plan size]** → Only two small project files are retained, and exact bytes provide the strongest existing concurrent-edit precondition without a duplicate hash format.
- **[Four similar update/upgrade names can confuse users]** → Canonical help groups aliases, docs lead with `facet update`, and self-update documentation explicitly names the binary/package boundary and registry distinction.
- **[The `upgrade` alias changes an existing invocation from inert to mutating]** → Global help, the retained alias page, and the release changelog SHALL identify `update` as canonical and state that `facet upgrade` now applies the same project changes instead of printing the former stub notice.

## Migration Plan

1. Give `resolveRegistryMetadataBatch` its 100-specifier contract, remove its stale exact-or-latest-only assumption, and add two-specifier-per-facet discovery with concurrent groups, target pairing, and tagged plan types. Engine unit tests SHALL cover all five `VersionSpec` kinds, exact response validation, range satisfaction, the 100-specifier boundary, concurrent multi-group resolution, all-or-nothing and input-order behavior, every unusable-local-state reason, and reuse of discovered metadata without a second lookup.
2. Refactor install input to the tagged operation union, add snapshot validation and exact update resolution overrides, and cover manifest preservation, metadata confirmation, transaction, rollback, stale-plan, and mixed selected/unselected behavior.
3. Add short-flag metadata support, register `update` with the `upgrade` alias, implement static and interactive presentation, extend install progress/failure wording, and add CLI unit, Ink, and end-to-end tests.
4. Add the `cli` and `installation` delta specifications, then update all documentation and agent prompts named in D6.
5. Run `bun check` as the canonical verification, including unit, type, lint, and end-to-end suites.

No persisted-data migration is required. Updated projects continue to use existing valid manifest specifiers, lockfile entries, and receipt schemas. If the feature must be rolled back, the command and alias can be removed without rewriting projects; projects already updated remain consumable by the existing install path.

## Open Questions

None. The proposal and this design settle preview exit behavior, missing local state, concurrency, aliasing, registry transport, and documentation treatment before specification authoring.
