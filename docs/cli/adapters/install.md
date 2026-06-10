---
title: facet adapter install
sidebarTitle: ' '
description: Installs an adapter
tag: facet adapter install
---

## Usage
```sh
facet adapter install <specifier>
```

Installs an adapter from the given specifier. An adapter is way for the `facet` system to talk to external tools, most often AI coding harnesses (OpenCode, Claude Code, Codex, etc.). Adapters define where assets and configuration live on disk.

The `install` flow downloads the source, bundles it into a self-contained `adapter.js`, verifies it exports a valid adapter, and places it in the adapter base directory (default `$FACET_DIR/adapters/<name>/`, where `FACET_DIR` defaults to `~/.facet`).

**Specifier formats:**

| Format           | Example                                       | Description                             |
|------------------|-----------------------------------------------|-----------------------------------------|
| Built-in name    | `opencode`                                    | Resolves to the first-party npm package |
| npm package      | `@acme/adapter-custom`                        | Downloads from the npm registry         |
| Git URL          | `git+https://github.com/user/repo.git`        | Clones the repository                   |
| Git URL with ref | `git+https://github.com/user/repo.git#v1.0.0` | Clones at a specific tag/branch         |
| Local path       | `./path/to/adapter`                           | Uses a local directory                  |

**Built-in names:**

- `opencode`  -- OpenCode adapter (`@agent-facets/adapter-opencode`)
- `claude-code`  -- Claude Code adapter (`@agent-facets/adapter-claude-code`)
- `codex`  -- Codex adapter (`@agent-facets/adapter-codex`)


### `facet adapter remove`

```sh
facet adapter remove <name>
```

Removes an installed adapter by deleting its directory from the adapter base directory (default `$FACET_DIR/adapters/`, where `FACET_DIR` defaults to `~/.facet`).

## Environment variables

### `FACET_DIR`

Overrides the facet directory root. The adapter base directory is always
`$FACET_DIR/adapters/`. `install`, `list`, `remove`, and `build` all
resolve through this single override.

```sh
export FACET_DIR=/opt/facet
facet adapter install opencode
# adapter lands in /opt/facet/adapters/opencode/adapter.js
```

The directory is created automatically if it does not exist. Default is
`~/.facet`. See the [environment variables reference](/cli/env) for the
full layout.

A per-install `--target-dir` flag is not supported because it would
require persistent configuration so that later invocations (such as
`facet build`) could locate adapters placed in non-default locations.
