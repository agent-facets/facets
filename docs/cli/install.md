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
2. **Acquire an install lock** at `$FACET_DIR/locks/<basename>-<hash>.lock` so two installs can't race. The lock lives under the facet directory tree (not in your project root), keyed by `sha256(realpath(projectRoot))` so each project gets its own slot.
3. **Load the existing lockfile**, or use an empty skeleton if `facets.lock` is absent — `facet install` bootstraps the lockfile on first run, the same way `bun install` creates `bun.lock`.
4. **For each facet in `facets.json`:**
   - If the lockfile pins a version that **satisfies** the manifest specifier, that version is honored; ranges in the manifest are not re-resolved.
   - If the locked version **no longer satisfies** the manifest specifier — because you edited `facets.json` or pulled a teammate's change — the entry is stale: the manifest specifier is re-resolved and the lockfile entry is replaced. If the new specifier resolves to nothing (e.g. a version that doesn't exist), install fails and the project is left unchanged.
   - If the lockfile has no entry yet (newly-added or freshly-bootstrapped), the manifest specifier is resolved fresh.
   - Fetch (from cache, or via git clone / registry / local path), verify integrity, build, and materialize the assets into every adapter.
5. **Drift removal.** Any facet in the prior lockfile but no longer in `facets.json` has its assets cleaned up.
6. **Skip-if-identical.** Each asset's on-disk content + metadata is compared to what we would write; identical assets are skipped without a journal entry.
7. **Write the new lockfile.**

## Lockfile semantics

`facets.json` is the source of truth; `facets.lock` records the resolved state so that an **unchanged** manifest installs reproducibly across machines. A pinned entry in `facets.lock` is honored as long as it **satisfies** its manifest specifier — a wildcard like `1.*` keeps using the locked `1.2.3` and won't drift to a newer `1.2.4`.

When the manifest and lockfile disagree — you bumped an exact version, widened a wildcard the lock no longer falls within, or pulled a manifest change — the lockfile entry is **stale**. `facet install` re-resolves the manifest specifier and updates the lockfile to match. If the requested version doesn't exist in the registry, install fails rather than silently keeping the old one.

To change the locked version of a facet, you can also run `facet add <facet>@<new-version>` — that updates both the manifest and the lockfile in one step. (A dedicated `facet update` command is on the roadmap.)

To enforce that the lockfile is already in sync — never re-resolving — use [`--frozen-lockfile`](#frozen-lockfile).

## Outcomes

The summary line classifies each facet by what happened on disk:

| Outcome      | Meaning                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| `installed`  | Facet was not in the previous lockfile.                                                       |
| `updated`    | Facet was in the lockfile at a different version — including when a stale entry was re-resolved to match the manifest. Summary shows `(was X → Y)`. |
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

Resolved facet content is stored at `$FACET_DIR/cache/<name>@<version>/` (default `~/.facet/cache/`) so subsequent installs of the same identity don't hit the network. The cache is treated as trusted material — once written, it's never re-hashed on read.

The cache root is part of the facet directory tree; set `FACET_DIR` to change it. See the [environment variables reference](/cli/env).

## Servers

A facet that declares `servers:` (MCP server dependencies) emits a warning during install — the server names are listed but not materialized. Server materialization is open-beta scope.

## Composition

A facet that declares `facets: [...]` (cherry-picking from other facets) is hard-rejected during install. Composition is open-beta scope.

## Flags

| Flag                | Description                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `--verbose`         | Show detailed step output on stderr.                                                                 |
| `--frozen-lockfile` | Treat the lockfile as the source of truth; fail on any manifest/lockfile drift. See [below](#frozen-lockfile). |

## Frozen lockfile

`facet install --frozen-lockfile` inverts the source of truth: the **lockfile** becomes authoritative. In this mode install never re-resolves a specifier and never writes `facets.lock`. Before installing, it verifies the lockfile fully covers the manifest, and fails — changing nothing on disk — if any of these hold:

- no `facets.lock` exists;
- a facet in `facets.json` has no lockfile entry;
- a lockfile entry's version no longer satisfies its manifest specifier;
- the lockfile pins a facet `facets.json` no longer declares (an orphaned entry a normal install would prune).

This is the mode to use in CI: it guarantees that `facets.json` and `facets.lock` are already in agreement, so a forgotten `facet add` or a hand-edited manifest fails the build loudly instead of silently mutating the lockfile. It mirrors the `--frozen-lockfile` contract from `npm` and `bun`.

## Exit codes

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | Install succeeded (including no-op when nothing has changed).        |
| `1`  | Install failed. The view renders the structured failure inline; stderr carries an `install failed code=...` line for log-grepping. |

## See also

- [`facet add`](/cli/add) — adds a new facet to `facets.json` and installs it in one step.
- [`facet adapter install`](/cli/adapters/install) — install adapters that `facet install` materializes facets into.
