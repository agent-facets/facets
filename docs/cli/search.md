---
title: facet search
description: Search the registry for published facets
---

## Usage

```sh
facet search [term]
```

Queries the registry for facets matching the given substring (case-insensitive). Without a term, lists all published facets.

## What it does

1. **Send query.** Calls the registry search endpoint with the provided term (or no filter if omitted).
2. **Display results.** Each result shows the facet name, latest version, asset counts, and the install command.

## Output format

```
viper-plans   v1.2.0
  2 skills, 1 agent, 1 command
  -> facet add viper-plans

rezi   v0.5.0
  3 skills
  -> facet add rezi
```

Asset counts are omitted when all are zero.

## Examples

```sh
# Search for facets matching "plan".
facet search plan

# List all published facets.
facet search
```

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Search completed (even if no results). |
| `1`  | Failed (network error, registry unavailable, etc.). |
