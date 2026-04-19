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

The `install` flow downloads the source, bundles it into a self-contained `adapter.js`, verifies it exports a valid adapter, and places it in `~/.facets/adapters/<name>/`.

**Specifier formats:**

| Format           | Example                                       | Description                             |
|------------------|-----------------------------------------------|-----------------------------------------|
| Built-in name    | `opencode`                                    | Resolves to the first-party npm package |
| npm package      | `@acme/adapter-custom`                        | Downloads from the npm registry         |
| Git URL          | `git+https://github.com/user/repo.git`        | Clones the repository                   |
| Git URL with ref | `git+https://github.com/user/repo.git#v1.0.0` | Clones at a specific tag/branch         |
| Local path       | `./path/to/adapter`                           | Uses a local directory                  |

**Built-in names:**

- `opencode` — OpenCode adapter (`@agent-facets/adapter-opencode`)
- `claude-code` — Claude Code adapter (`@agent-facets/adapter-claude-code`)
- `codex` — Codex adapter (`@agent-facets/adapter-codex`)


### `facet adapter remove`

```sh
facet adapter remove <name>
```

Removes an installed adapter by deleting its directory from `~/.facets/adapters/`.

## Environment variables

### `FACETS_ADAPTERS_DIR`

Overrides the base directory used for installed adapters. When set, `install`, `list`, `remove`, and `build` all read from and write to this directory instead of the default `~/.facets/adapters/`.

```sh
export FACETS_ADAPTERS_DIR=/path/to/adapters
facet adapter install opencode
# adapter lands in /path/to/adapters/opencode/adapter.js
```

The directory is created automatically if it does not exist. Set the variable in your shell profile to make the override persist across sessions.

This is currently the only supported way to change the adapter install location. A per-install `--target-dir` flag is not supported because it would require persistent configuration so that later invocations (such as `facet build`) could locate adapters placed in non-default locations.
