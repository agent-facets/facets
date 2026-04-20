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

Removes an installed adapter by deleting its directory from [`FACETS_ADAPTERS_DIR`](/cli/env).

### `FACETS_ADAPTERS_DIR`

Overrides the base directory used for installed adapters. When set, `install`, `list`, `remove`, and `build` all read from and write to this directory instead of the default `~/.facets/adapters/`.

```sh
export FACETS_ADAPTERS_DIR=/path/to/adapters
facet adapter install opencode
# adapter lands in /path/to/adapters/opencode/adapter.js
```

The directory is created automatically if it does not exist. Set the variable in your shell profile to make the override persist across sessions.

This is currently the only supported way to change the adapter install location. A per-install `--target-dir` flag is not supported because it would require persistent configuration so that later invocations (such as `facet build`) could locate adapters placed in non-default locations.
