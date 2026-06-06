---
title: facet remove
sidebarTitle: ' '
description: Removes a facet from `facets.json` and uninstalls it
tag: facet remove
---

## Usage

```sh
facet remove <facet> [more facets...]
```

Removes one or more facets from `facets.json`, deletes their assets from every connected adapter, and rewrites `facets.lock` without them — in a single command. The inverse of [`facet add`](/cli/add). Aliased as `facet rm`.

## What it does

1. **Load `facets.json`.** A missing or invalid manifest fails before any change.
2. **Validate every name is declared.** If any named facet is not in `facets.json`, the command fails and changes nothing — removing multiple facets is all-or-nothing.
3. **Snapshot `facets.json`** byte-for-byte for rollback.
4. **Remove the named entries** from `facets.json`.
5. **Run the install pipeline.** The removed facets are now absent from the manifest, so drift removal deletes their assets from every adapter and rewrites the lockfile without them. Every other facet is left untouched.
6. **On any failure**, restore the `facets.json` snapshot. The project is left exactly as it was before the command ran.

## Examples

```sh
# Remove a single facet.
facet remove viper-plans

# rm is an alias.
facet rm viper-plans

# Remove several at once (all-or-nothing).
facet remove viper-plans rezi
```

## Flags

| Flag        | Description                          |
| ----------- | ------------------------------------ |
| `--verbose` | Show detailed step output on stderr. |

## Exit codes

| Code | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| `0`  | Removal succeeded.                                                                   |
| `1`  | Failed (no names given, a named facet not in `facets.json`, install failure, etc.). `facets.json` is restored byte-for-byte on every failure path. |

## See also

- [`facet add`](/cli/add) — the inverse: add a facet to `facets.json` and install it in one step.
- [`facet install`](/cli/install) — reapply `facets.json` and the lockfile.