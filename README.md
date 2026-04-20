# Agent Facets

`facet` is a CLI package manager and toolkit for facets — modular skills, agents, commands, and tools that extend AI coding assistants.

## Documentation

Full documentation is available at [agentfacets.io](https://agentfacets.io).

## Quickstart

```shell
# Install the CLI (macOS/Linux)
curl -fsSL https://install.agentfacets.io | bash

# Or via npm (all platforms, including Windows)
npm install -g agent-facets

# For closed-alpha partners: see docs/alpha/onboarding.md
# Short version:
git clone <facet-repo>
cd <facet-repo>
facet install
```

Registry-based `facet add <name>` is roadmap (open-beta) — see [agentfacets.io/roadmap](https://agentfacets.io/roadmap).

Please see https://agentfacets.io for detailed guidance and documentation for the `facet` CLI tool.

## Packages

| Package                           | NPM                   | Description                        |
|-----------------------------------|-----------------------|------------------------------------|
| [CLI](packages/cli/README.md)     | `agent-facets`        | CLI tool for managing facets       |
| [Core](packages/core/README.md)   | `@agent-facets/core`  | Schemas, loaders, and validators   |
| [Brand](packages/brand/README.md) | `@agent-facets/brand` | Agent Facets branding and styles   |

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

## License

[MIT](LICENSE)
