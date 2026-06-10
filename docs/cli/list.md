---
title: facet list
sidebarTitle: ' '
description: List facets installed in the current project
tag: facet list
---

## Usage

```sh
facet list
```

Shows all facets declared in `facets.json` for the current project. No network calls are made.

## What it does

1. **Read `facets.json`.** Loads the project manifest from the current directory.
2. **Read `facets.lock` (if present).** When a lockfile exists, resolved versions from the lockfile are displayed instead of the raw manifest specifier.
3. **Display entries.** Each facet is listed with its name and resolved version (or source specifier if not yet installed).

## Examples

```sh
facet list
```

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Listed successfully (even if `facets.json` has no entries). |
| `1`  | Failed (no `facets.json` found, invalid manifest, etc.). |

## See also

- [`facet add`](/cli/add) -- add a facet to the project.
- [`facet install`](/cli/install) -- install all declared facets.
