---
title: facet install
sidebarTitle: ' '
description: Installs facets defined in `facets.json` and updates `facets.lock`
tag: facet install
---

## Usage

```sh
facet install
```

Reads `facets.json`, fetches and materializes every facet declared there, and writes a `facets.lock` recording the exact resolved versions and integrity hashes. Used after a fresh `git clone`, after pulling teammate changes that updated the manifest, or to reapply assets after manual edits to adapter directories.

`facet install` does not accept positional arguments — to add a new facet, use [`facet add`](/cli/add).

## What it does

1. **Validate the project.** `facets.json` must exist; at least one adapter must be installed (the picker auto-launches on a TTY if none are).
2. **Acquire an install lock** at `.facets/.install.lock` so two installs can't race.
3. **Load the existing lockfile**, or use an empty skeleton if `facets.lock` is absent — `facet install` bootstraps the lockfile on first run, the same way `bun install` creates `bun.lock`.
4. **For each facet in `facets.json`:**
   - If the lockfile pins a version, that version is honored verbatim; ranges in the manifest are not re-resolved.
   - If the lockfile has no entry yet (newly-added or freshly-bootstrapped), the manifest specifier is resolved fresh.
   - Fetch (from cache, or via git clone / registry / local path), verify integrity, build, and materialize the assets into every adapter.
5. **Drift removal.** Any facet in the prior lockfile but no longer in `facets.json` has its assets cleaned up.
6. **Skip-if-identical.** Each asset's on-disk content + metadata is compared to what we would write; identical assets are skipped without a journal entry.
7. **Write the new lockfile.**

## Lockfile semantics

`facet install` is **lockfile-driven**: any pinned entry in `facets.lock` is the source of truth for what gets installed, regardless of what range or wildcard the manifest declares. This is what makes installs reproducible across machines.

To change the locked version of a facet, run `facet add <facet>@<new-version>` — that updates both the manifest and the lockfile. (A dedicated `facet update` command is on the roadmap; until then, re-`add` is the path.)

## Outcomes

The summary line classifies each facet by what happened on disk:

| Outcome      | Meaning                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| `installed`  | Facet was not in the previous lockfile.                                                       |
| `updated`    | Facet was in the lockfile at a different version. Summary shows `(was X → Y)`.                |
| `repaired`   | Same lockfile entry, but at least one adapter file was missing or had drifted from the lockfile content. Restored. |
| `unchanged`  | Same lockfile entry, every asset already in its desired state. Nothing was written.           |
| `removed`    | Facet was in the lockfile but is no longer declared in `facets.json`. Assets cleaned up.      |

If you delete a materialized asset by hand and re-run `facet install`, the affected facet shows up as `repaired`.

## Integrity protocol

Every fetched facet is verified before any asset is written:

| Source kind | Checks                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| Registry    | **Three checks.** (A) cache vs. registry metadata, (B) archive manifest vs. registry metadata, (C) computed content vs. archive manifest. Defends against split-brain registries, retroactive metadata mutation, and tampered archives. |
| Git         | **One check.** Computed content vs. lockfile integrity. Defends against tag-move attacks.                               |
| Local       | **No check.** Local sources are trust-by-path.                                                                          |

Any mismatch is a hard security error: the install aborts before any asset is written, and the project state is unchanged.

## Cache

Resolved facet content is stored at `~/.facets/cache/<name>@<version>/` so subsequent installs of the same identity don't hit the network. The cache is treated as trusted material — once written, it's never re-hashed on read.

The cache root can be overridden by setting the `FACETS_CACHE_DIR` environment variable.

## Servers

A facet that declares `servers:` (MCP server dependencies) emits a warning during install — the server names are listed but not materialized. Server materialization is open-beta scope.

## Composition

A facet that declares `facets: [...]` (cherry-picking from other facets) is hard-rejected during install. Composition is open-beta scope.

## Flags

| Flag        | Description                                |
| ----------- | ------------------------------------------ |
| `--verbose` | Show detailed step output on stderr.       |

## Exit codes

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | Install succeeded (including no-op when nothing has changed).        |
| `1`  | Install failed. The view renders the structured failure inline; stderr carries an `install failed code=...` line for log-grepping. |

## See also

- [`facet add`](/cli/add) — adds a new facet to `facets.json` and installs it in one step.
- [`facet adapter install`](/cli/adapters/install) — install adapters that `facet install` materializes facets into.
