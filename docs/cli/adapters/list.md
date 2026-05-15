---
title: facet adapter list
sidebarTitle: ' '
description: Lists installed adapters
tag: facet adapter list
---

## Usage

```sh
facet adapter list
```

Lists all installed adapters by scanning the adapter base directory
(default `$FACET_DIR/adapters/`, where `FACET_DIR` defaults to
`~/.facet`).

## Environment variables

### `FACET_DIR`

Overrides the facet directory root. The adapter base directory is
always `$FACET_DIR/adapters/`. See the [environment variables
reference](/cli/env) for the full layout.

```sh
export FACET_DIR=/opt/facet
facet adapter install opencode
facet adapter list
# lists adapters in /opt/facet/adapters/
```

The directory is created automatically if it does not exist. Default is
`~/.facet`.
