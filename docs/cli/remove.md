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
3. **Commit.** Delegate to the install pipeline with the removals delta. The pipeline removes assets using the machine-local install receipt (no cache or network needed for removal), then writes `facets.json`, `facets.lock`, and the receipt together. Every other facet is left untouched.
4. **On any failure**, the journal rolls back all changes. The manifest, lockfile, and receipt are never written ahead of success.

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
| `1`  | Failed (no names given, install failure, etc.). No files are modified on failure. |

## See also

- [`facet add`](/cli/add)  -- the inverse: add a facet to `facets.json` and install it in one step.
- [`facet install`](/cli/install)  -- reapply `facets.json` and the lockfile.