# Facets

A package manager and toolkit for facets — modular skills, agents, commands, and tools that extend AI coding assistants.

## Documentation

Full documentation is available at [agentfacets.io](https://agentfacets.io).

## Quickstart

```shell
# Install the CLI
npm install -g agent-facets
```

## Packages

| Package                                   | NPM                        | Description                              |
|-------------------------------------------|----------------------------|------------------------------------------|
| [Facet CLI](packages/cli/README.md)       | `agent-facets`        | CLI tool for managing facets             |
| [Facet Core](packages/core/README.md)     | `@agent-facets/core`       | Schemas, loaders, and shared types       |

## Development

### Prerequisites

- [mise](https://mise.jdx.dev) — manages tooling (Bun, lefthook) via `mise.toml`

### Setup

```sh
# Install Bun + lefthook
mise install

# Install dependencies + set up git hooks
bun install

# Run lint, typecheck, build, and tests
bun check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## License

[MIT](LICENSE)
