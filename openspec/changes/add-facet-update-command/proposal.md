## Why

Projects currently have no single command that discovers and applies newer releases of their declared facets. Users must manually inspect registry versions, edit `facets.json`, and reinstall, so the CLI needs one update workflow that preserves declared version intent by default while still allowing deliberate upgrades to the registry's latest releases. The workflow is already promised by the unimplemented `docs/cli/upgrade.mdx` placeholder and the beta roadmap, making this both a user-facing gap and an outstanding documented commitment.

## What Changes

- Add `facet update` as the canonical command for discovering and applying updates to registry-backed facets declared in `facets.json`.
- With no flags, the command SHALL update each facet to the highest published version permitted by its manifest specifier. Exact pins SHALL remain unchanged, major and minor wildcards SHALL remain within their declared ranges, and `*` or `latest` SHALL resolve to the registry's latest version. If no declared range permits a newer version, the command SHALL succeed as a no-op and distinguish “nothing allowed by the current ranges” from a failed check.
- Add `--latest` with alias `-L`. This mode SHALL ignore current version constraints and update registry facets to their latest published versions. Rewritten manifest specifiers SHALL preserve their existing style: exact pins remain exact at the selected version, major wildcards advance to the selected major, minor wildcards advance to the selected major and minor, and `*` or `latest` remain unchanged.
- Add `--interactive` with alias `-i`. Interactive mode SHALL complete discovery before performing any update and SHALL show each outdated registry facet's manifest specifier, Current version, range-respecting Target, and registry Latest version.
- The interactive interface SHALL follow Bun's established update-selection model: users can navigate the list, select facets, confirm the selected updates, and toggle an individual facet between Target and Latest with `l`. Combining `--interactive` with `--latest` SHALL make Latest the initial target while retaining the per-facet toggle.
- Interactive cancellation SHALL leave all project files, materialized assets, native configuration, and machine-local state unchanged. No update SHALL begin until the user confirms the selection.
- Add `--dry-run` as a non-interactive preview path. It SHALL print the complete proposed update plan—including each facet's manifest specifier, Current version, range-respecting Target, and registry Latest version—and SHALL leave all project and machine-local state unchanged. It SHALL respect `--latest`; when combined with `--interactive`, the confirmed selection SHALL be previewed but not applied.
- Applying updates SHALL preserve existing materialization overrides and use the normal verified installation transaction to update facet contents, `facets.json` when its version intent changes, `facets.lock`, the install receipt, materialized assets, and native configuration. All selected updates SHALL commit together or roll back together.
- Registry facets missing usable local resolution state and git or local sources that cannot be checked against the registry SHALL be identified explicitly rather than reported as current.
- Discovery SHALL produce a complete project-wide answer. If any required registry lookup fails, the command SHALL fail before presenting an actionable update plan or writing state; users and automation must not act on an incomplete inventory.
- The command SHALL document successful application, no-op, updates-available dry-run, interactive cancellation, discovery failure, and application failure outcomes with meaningful exit behavior.
- `facet upgrade` SHALL become an alias of `facet update`, replacing its unimplemented placeholder while keeping existing command usage and documentation links valid. Help and documentation SHALL distinguish facet-package `update`/`upgrade` from CLI-binary `facet self-update`.

## Non-goals

- Adding any check-only mode beyond `--dry-run`. Default and interactive modes apply updates; dry-run is the single preview-without-write path.
- Supporting positional facet filters, wildcard name filters, or dependency-group filters in the initial command. These selectors are deferred; the initial non-interactive command considers the complete manifest, while interactive mode provides per-facet selection.
- Detecting or applying updates for git and local facet sources.
- Adding a server-side batch registry endpoint. Update discovery SHALL use the existing `resolveRegistryMetadataBatch` boundary in groups of at most 100 specifiers; the real registry batch endpoint is planned separately.
- Changing project-manifest, lockfile, or version-spec grammar.
- Implementing `facet upgrade` as an independent workflow; it is an alias of `facet update`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli`: Define `facet update`, the `facet upgrade` alias, `--latest`/`-L`, `--interactive`/`-i`, and `--dry-run`; the Current/Target/Latest presentation and selection controls; application, preview, no-op, cancellation, and failure outcomes; help; and the distinction from `facet self-update`.
- `installation`: Define range-respecting and latest target selection, manifest-specifier rewriting, preservation of materialization intent, and transactional application of selected facet updates.

## Impact

- **CLI:** Command registration, aliasing, dispatch, argument parsing, help, Ink-based interactive selection, dry-run presentation, summaries, structured errors, exit behavior, and command tests will gain the update workflow. The existing unimplemented `upgrade` stub will become an alias of `update`.
- **Engine:** Update discovery will combine manifest and lockfile state with the existing registry metadata resolver by requesting each authored specifier and `latest`. The returned exact metadata will carry directly into the verified installation transaction rather than introducing a version-list client or a second metadata lookup.
- **Protocol and persisted state:** No schema or grammar changes are required. Existing comment-preserving manifest mutation and transactional lockfile/receipt writes will carry any selected version changes.
- **Registry:** No deployment or OpenAPI change is required. Existing metadata resolution is assumed to support the manifest `VersionSpec` forms. A true server-side batch endpoint is planned separately.
- **Documentation:** This proposal was informed by `docs/cli/upgrade.mdx`, `docs/cli/self-update.mdx`, `docs/guides/install-facets.mdx`, and `docs/roadmap/beta.mdx`, plus Bun's `update` and interactive-update documentation. Add `docs/cli/update.mdx` and its navigation entry, convert `docs/cli/upgrade.mdx` into an alias pointer, update `docs/cli/self-update.mdx` to clarify the command-name distinction, and revise the guide and roadmap for default ranges, `--latest`, `--interactive`, and `--dry-run`.
