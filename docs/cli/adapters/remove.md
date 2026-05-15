---
title: facet adapter remove
sidebarTitle: ' '
description: Manage adapter installations
tag: facet adapter remove
---

## Usage

```sh
facet adapter remove <name>
```

Removes an installed adapter by deleting its directory from the adapter
base directory (default `$FACET_DIR/adapters/`, where `FACET_DIR`
defaults to `~/.facet`).

### `FACET_DIR`

Overrides the facet directory root. The adapter base directory is
always `$FACET_DIR/adapters/`. See the [environment variables
reference](/cli/env) for the full layout.

```sh
export FACET_DIR=/opt/facet
facet adapter remove opencode
# removes /opt/facet/adapters/opencode
```

Default is `~/.facet`.
