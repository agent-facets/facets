---
title: facet remove
description: Remove one or more facets from the project
---

## Usage

```sh
facet remove <facet> [more facets...]
```

Removes one or more facets from `facets.json`, deletes their assets from every connected adapter, and rewrites `facets.lock` without them  -- in a single command. The inverse of [`facet add`](/cli/add). Aliased as `facet rm`.

## What it does

1. **Load `facets.json`.** A missing or invalid manifest fails before any change.
2. **Filter to declared names.** Names not in `facets.json` are silently ignored. If every name is absent, the command exits successfully with no changes.
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

# Remove several at once.
facet remove viper-plans rezi
```

## Flags

| Flag        | Description                          |
| ----------- | ------------------------------------ |
| `--verbose` | Show detailed step output on stderr. |

## Exit codes

| Code | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| `0`  | Removal succeeded, or all requested names were already absent from `facets.json` (no-op). |
| `1`  | Failed (no names given, install failure, etc.). `facets.json` is restored byte-for-byte on every failure path. |

## See also

- [`facet add`](/cli/add)  -- the inverse: add a facet to `facets.json` and install it in one step.
- [`facet install`](/cli/install)  -- reapply `facets.json` and the lockfile.