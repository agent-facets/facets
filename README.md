# Agent Facets

`facet` is a CLI package manager and toolkit for facets — modular skills, agents, commands, and tools that extend AI coding assistants. Facets can also ship non-asset files — a `README.md`, a `LICENSE`, or skill companion files — that travel inside the archive; only skill companions materialize on disk. See the [docs](https://docs.agentfacets.io) for details.

The official registry for Agent Facets is [agentfacets.io](https://agentfacets.io) where you can publish and share facets.

## Documentation

Full documentation is available at [docs.agentfacets.io](https://docs.agentfacets.io).

## Quickstart

```shell
# Install the CLI (macOS/Linux)
curl -fsSL https://agentfacets.io/install | bash

# Or via npm (all platforms, including Windows)
npm install -g agent-facets

# Add a facet to any project — this resolves, fetches, verifies, and
# installs in one step. If the project has no AI adapters connected
# yet, the picker launches automatically.
facet add github:agent-facets/viper-plans

# Reapply an existing project's facets after a fresh clone or after
# pulling teammate changes:
facet install

# Update the CLI later
facet self-update
```

The public registry index (used by `facet add <name>` without a source) is open-beta — see [docs.agentfacets.io/roadmap](https://docs.agentfacets.io/roadmap). Today, bare-name resolution errors out against the stub; use `github:owner/repo`, an `https://...git` URL, an SCP-style git URL, or a local path.

Please see https://docs.agentfacets.io for detailed guidance and documentation for the `facet` CLI tool.

## Packages

| Package                                   | NPM                       | Description                                                          |
|-------------------------------------------|---------------------------|----------------------------------------------------------------------|
| [CLI](packages/cli/README.md)             | `agent-facets`            | CLI tool for managing facets                                         |
| [Protocol](packages/protocol/AGENTS.md)   | `@agent-facets/protocol`  | TypeScript reference implementation of the facet artifact spec — Node-native, public, consumed by registries and other third-party tools |
| [Brand](packages/brand/README.md)         | `@agent-facets/brand`     | Agent Facets branding and styles                                     |

> The legacy `@agent-facets/core` package was split into `@agent-facets/protocol` (the published spec implementation) and `@agent-facets/engine` (Bun-native CLI machinery, private to this monorepo). The `@agent-facets/core` package is no longer published; it is frozen at v0.9.1 on npm. New consumers MUST use `@agent-facets/protocol`. See `docs/docs/contributing/architecture.md` for the full layer description.

## Development

### Prerequisites

- [mise](https://mise.jdx.dev) — manages tooling (Bun, lefthook) via `mise.toml`

### Setup

```sh
# Install Bun + lefthook
mise install

# Install dependencies + set up git hooks
bun install

# Run the CLI locally (runs source directly, no compilation needed)
bun dev --version
bun dev build ./my-facet

# Run lint, typecheck, build, and tests
bun check
```

### Publishing

This project uses [changesets](https://github.com/changesets/changesets) for versioning and publishing. See the [changeset README](.changeset/README.md) for more details.

```bash
bun change          # create a changeset describing your changes
```

When changesets are merged to `main`, CI will automatically open a version PR. Merging that PR creates version tags, which trigger per-package publishing to npm.

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

### Code Review

We use [Greptile](https://www.greptile.com/) to review code changes in this repo. They generously provide OSS projects with free reviews.

[![Greptile: The War on Bugs](https://www.greptile.com/badge.svg)](https://www.greptile.com/?utm_source=oss_badge&utm_medium=readme&utm_campaign=greptile_for_open_source)

## License

[MIT](LICENSE)
