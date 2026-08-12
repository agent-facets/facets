# Agent Facets

`facet` is a CLI package manager and toolkit for facets — modular skills, agents, commands, and MCP server declarations that extend AI coding assistants. A facet can declare MCP servers that are installed and configured in each connected tool's own config file (`.mcp.json`, `opencode.jsonc`, `.codex/config.toml`), after you approve them; a facet may even ship servers and nothing else. Facets can also ship non-asset files — a `README.md`, a `LICENSE`, or skill companion files — that travel inside the archive; only skill companions materialize on disk. See the [docs](https://docs.agentfacets.io) for details.

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
facet add viper-plans
```

The public registry is free – see [agentfacets.io](https://agentfacets.io). A bare name (`facet add cowsay`) resolves against it; you can also install from `github:owner/repo`, an `https://...git` URL, an SCP-style git URL, or a local path.

Please see https://docs.agentfacets.io/cli for a detailed reference for the `facet` CLI tool.

### Other Commands

```shell


# Reapply an existing project's facets after a fresh clone or after
# pulling teammate changes:
facet install

# In CI, or any run without a terminal, approve MCP server configuration
# up front — otherwise a facet that declares servers fails before writing.
facet install --accept-mcp

# Update the CLI later
facet self-update
```

## Packages

| Package                                              | NPM                                 | Description                                                                                                                              |
|------------------------------------------------------|-------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| [CLI](packages/cli/AGENTS.md)                        | `agent-facets`                      | CLI tool for managing facets                                                                                                             |
| [Protocol](packages/protocol/AGENTS.md)              | `@agent-facets/protocol`            | TypeScript reference implementation of the facet artifact spec — Node-native, public, consumed by registries and other third-party tools |
| [Adapter SDK](packages/adapter)                      | `@agent-facets/adapter`             | Contract for building adapters that target an AI coding tool — asset storage plus MCP server configuration                               |
| [Claude Code adapter](packages/adapters/claude-code) | `@agent-facets/adapter-claude-code` | First-party adapter for Claude Code                                                                                                      |
| [Codex adapter](packages/adapters/codex)             | `@agent-facets/adapter-codex`       | First-party adapter for Codex                                                                                                            |
| [OpenCode adapter](packages/adapters/opencode)       | `@agent-facets/adapter-opencode`    | First-party adapter for OpenCode                                                                                                         |
| [Brand](packages/brand)                              | `@agent-facets/brand`               | Agent Facets branding and styles                                                                                                         |

The monorepo also contains private internals that are never published: `@agent-facets/engine` (Bun-native CLI machinery), `@agent-facets/common` (shared primitives), and `@agent-facets/adapter-test-kit`. See [`AGENTS.md`](AGENTS.md) for the full layer description.

## Development

```sh
mise trust && mise install  # tooling (Bun, lefthook) via mise.toml
bun install                 # dependencies + git hooks
bun dev --version           # run the CLI from source and verify it works
bun check                   # lint, typecheck, build, and tests
```

Versioning and publishing use [changesets](https://github.com/changesets/changesets) — run `bun change` for user-facing changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

### Code Review

We use [Greptile](https://www.greptile.com/) to review code changes in this repo. They generously provide OSS projects with free reviews.

[![Greptile: The War on Bugs](https://www.greptile.com/badge.svg)](https://www.greptile.com/?utm_source=oss_badge&utm_medium=readme&utm_campaign=greptile_for_open_source)

## License

[MIT](LICENSE)
