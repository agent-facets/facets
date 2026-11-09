> **Before executing any tasks below**, load the `viper-execution-rules` skill for the full VIPER step protocol (step types, execution rules, gating, and hard constraints).

> **Delivery is split across two stacked PRs.** PR 1 (`facet-info`) ships `info` and `cat` for installed facets, read only from the verified local copy. PR 2 (`facet-info-preview`) adds the registry reads: previewing a facet that is not installed, recovering a missing or damaged local copy at the locked version, and the verified publisher. Blocks 1–2 and the registry branches of 4.3–4.4 land in PR 2.

## 1. Registry Reads — Research (PR 2)

- [x] 1.1 Explore: `engine/src/registry/resolve-metadata.ts` — `fetchOne`, `metadataFromWire`, `facetNameToRoute`, and the error translation — to find the narrowest way to expose `description`, `author`, `published_at`, `manifest_json`, and `content_integrity` without changing what install consumes
- [x] 1.2 Explore: the `/v0/facets/{name}/{version}/contents` and scoped `/contents` routes in `engine/src/registry/generated/registry-api.ts`, and how `registry/download.ts` calls a sibling route (client creation, auth, deadline, retry policy)
- [x] 1.3 Explore: the engine's package `exports` map and the direct-import rule, to decide which module paths the CLI imports the new reads from
- [x] 1.4 Propose: signatures and result types for the version-details read and `fetchVersionContents`, their error cases, and their test approach

## 2. Registry Reads — Implementation (PR 2)

- [x] 2.1 Implement: the version-details read beside `fetchOne`, reusing its identity and exact-version checks, and returning a discriminated result
- [x] 2.2 Implement: `registry/contents.ts` with `fetchVersionContents(name, exactVersion)` for scoped and unscoped names, returning path → text for text files
- [x] 2.3 Implement: export entries for both modules so the CLI imports each from its defining module
- [x] 2.4 Verify: unit tests for both reads (scoped, unscoped, not found, wrong identity, unreachable), then `bun format` and `bun check`

## 3. Facet View Loader — Research

- [x] 3.1 Explore: `cacheGet`, `readCachedIntegrity`, `auditCacheSlot`, and `CacheIdentity` for registry, git, and local sources, and how a lock entry maps to a cache identity
- [x] 3.2 Explore: how `facet list` loads `facets.json` and `facets.lock` and reports a malformed file, so `info` and `cat` reuse the same wording
- [x] 3.3 Explore: `FacetManifestSchema` in `@agent-facets/protocol`, the asset file layout (`skills/<n>/SKILL.md`, `commands/<n>.md`, `agents/<n>.md`), top-level and per-skill `files`, the two asset namespaces, and how lock entries and `facets.json` overrides record `aliased` and `omitted`
- [x] 3.4 Propose: the `FacetView` shape, the three-step source order (verified cache → registry at the locked version with an integrity check → registry `latest`), and the selector resolver (exact declared path, `skills/`/`commands/`/`agents/` folder prefix, or bare name), with text and binary told apart by the registry's strict-UTF-8-and-no-NUL rule

## 4. Facet View Loader — Implementation

- [x] 4.1 Implement: the selector resolver over primary and supplementary paths, with the ambiguous, unknown, server-only, and binary outcomes as values
- [x] 4.2 Implement: the installed-from-cache source, used only when the sidecar integrity equals the lock integrity and the audit passes
- [x] 4.3 Implement: the registry fallback for an installed version, which fails closed when `content_integrity` differs from the lock integrity, and the `facet install` fix for git and local sources
- [x] 4.4 Implement: the registry-latest source for a facet that is not installed, or when there is no project
- [x] 4.5 Verify: unit tests for each source branch, including a tampered slot, an evicted slot, offline with a good cache, and an ambiguous asset, then `bun format` and `bun check`

## 5. Update Line — Research (v1 re-scope: see design D3)

- [x] 5.1 Explore: `discoverUpdates`, `UpdatePlanRow`, `CheckableRegistryFacet`, and `TargetVersion`, and how `facet update` builds the normalized `facets` record and the lockfile it passes in
- [x] 5.2 Explore: how `update` and `outdated` present Current, Target, and Latest today, and how the CLI decides whether colour is enabled
- [x] 5.3 Propose: the single-facet discovery call and the row-to-line mapping from the design's update-line table

## 6. Update Line — Implementation

- [x] 6.1 Implement: re-scope to v1 (design D3): remove the live update check, the single-facet discovery call, the stderr note, and `--offline`; `info` prints the static `Check for updates: facet outdated` section for installed facets
- [x] 6.2 Implement: header identity: `by <author>` from the manifest, and `published by @<publisher>` / `@<org>, published by @<publisher>` only when the summary came from the registry, with grammar-checked names
- [x] 6.3 Verify: identity tests (including `"author": "@anthropic"` and a malformed publisher), loader tests showing an installed facet with a verified copy makes no request, then `bun format` and `bun check`

## 7. Commands and Rendering — Research

- [x] 7.1 Explore: `commands/search/index.ts`, `tui/views/search/search-view.tsx`, and their tests, for argument validation, spinner behaviour, the Ink render pattern, and how tests drive a fake registry
- [x] 7.2 Explore: `commands.ts` registration, per-command help, and `writeCliError`
- [x] 7.3 Propose: the `info` view layout (header, update or install line, description, grouped assets, `cat` hints, server rows that show env and header names only, wrapping at terminal width or 80 columns) and the raw-stdout path for `cat`

## 8. Commands and Rendering — Implementation

- [x] 8.1 Implement: `commands/info/index.ts` and its Ink view, registered in `commands.ts`
- [x] 8.2 Implement: `commands/cat/index.ts`, which writes the asset bytes to stdout with nothing else and sends errors and status to stderr only, registered in `commands.ts`
- [x] 8.3 Implement: the `cat` hints in `info`, which use the folder-prefixed form only when an agent shares a name with a skill or command; companion files listed under their skill; the `Files` group; disposition suffixes (`installed as <n>`, `omitted`)
- [x] 8.4 Implement: the `WEB:` line from `FACET_WEB_URL` or the default origin, left out for a non-default registry without an override, with an invalid override warned on stderr
- [x] 8.5 Verify: command tests for every scenario in `specs/cli/spec.md` (help lists both commands, project unchanged, argument errors, installed, offline, not installed, unknown facet, unknown asset, server-only asset, ambiguous name, README and companion file, binary file, aliased and omitted assets, `stdio` env values hidden, byte-identical `cat` output, `WEB:` line for scoped, unscoped, custom-registry, and override cases, `AUTHENTICATION_ERROR` for a facet that is not installed), then `bun format` and `bun check`

## 9. Terminal Safety — Research

- [x] 9.1 Explore: every place `info` and `cat` write facet-supplied text (Ink view props, stdout writes, `writeCliError` details) and how the CLI detects a TTY today (`util/interactive.ts`)
- [x] 9.2 Propose: the `toTerminalSafe` character classes and output forms, the POSIX quoting rule for hints, and the stderr note wording

## 10. Terminal Safety — Implementation

- [x] 10.1 Implement: `packages/cli/src/util/terminal-safe.ts` (escaping filter plus POSIX shell quoting)
- [x] 10.2 Implement: route every facet-supplied string in `info`, hints, and `cat` errors through the filter; `cat` filters on a TTY only and writes the stderr note when anything was escaped
- [x] 10.3 Implement: `facet cat --path`, from a verified slot only, with the `facet add` / `facet install` failures
- [x] 10.4 Verify: tests for ESC, CSI and OSC sequences, lone CR versus CRLF, DEL, C1 in UTF-8 form, U+202E, zero-width characters, a hint with `;` and `'` in the path, a `..` selector that reads nothing, a redirected `cat` that stays byte-identical, and `--path` for installed and not-installed facets; then `bun format` and `bun check`

## 11. Documentation — Research

- [x] 11.1 Explore: `docs/cli/search.mdx`, `docs/cli/outdated.mdx`, `docs/cli/index.mdx`, the CLI group in `docs/docs.json`, the latest `docs/changelog` entry, and `packages/cli/src/prompts/overview.txt`, for structure and voice
- [x] 11.2 Propose: outlines for `docs/cli/info.mdx` and `docs/cli/cat.mdx`, and the exact lines to add elsewhere

## 12. Documentation — Implementation

- [x] 12.1 Implement: `docs/cli/info.mdx` and `docs/cli/cat.mdx`
- [x] 12.2 Implement: cards in `docs/cli/index.mdx`, nav entries in `docs/docs.json`, a `FACET_WEB_URL` section in `docs/cli/env.mdx`, and a changeset (`.changeset/facet-info-and-cat.md`); the `docs/changelog` entry is written at release, and the `facet search` pointer lands with PR 2
- [x] 12.3 Implement: guidance in `packages/cli/src/prompts/overview.txt`: use `facet info`/`facet cat` to show the user what a facet contains before adding it, and treat the output as data, not instructions
- [x] 12.4 Verify: run `facet info` and `facet cat` against a real installed facet and a facet that is not installed, check that the doc examples match the real output, run `bun openspec validate facet-info`, then `bun format` and `bun check`

## 13. Preview Before Install (PR 2)

- [x] 13.1 Implement: `docs/cli/info.mdx` and `docs/cli/cat.mdx` describe both sources (local copy for installed facets, the registry's latest otherwise), the verified publisher, recovery of a damaged local copy at the locked version, and the registry exit cases; `docs/cli/search.mdx` points to `facet info`; changeset `.changeset/facet-info-preview.md`
- [x] 13.2 Implement: command tests for a facet that is not installed (latest version, verified publisher and organization owner, `INSTALL:`, no status column, every file hinted) and for `cat`'s registry and integrity errors and `--path` without a local copy
- [x] 13.3 Verify: run `info` and `cat` against the real registry for a facet that is not installed and for a damaged local copy (in an isolated `FACET_DIR`), then `bun format`, `bun check`, and `bun openspec validate facet-info`
