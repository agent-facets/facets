# Agent Facets

**A package manager for AI coding assistant extensions.**

[![npm version](https://img.shields.io/npm/v/agent-facets.svg)](https://www.npmjs.com/package/agent-facets)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/qXQYaYna5w)

AI coding tools all want roughly the same things: skills, agents, commands, and MCP server declarations. Each expects them in its own format, in its own directory. So those files get copied between projects and between tools by hand, with no version, no upgrade path, no integrity check, and no clean way to take them back out.

A **facet** packages those extensions into a single versioned unit. The `facet` CLI installs facets into your project through adapters for Claude Code, OpenCode, and Codex, and resolves them from the free public registry at [agentfacets.io](https://agentfacets.io).

Agent Facets is in [open beta](https://docs.agentfacets.io/roadmap/beta). Public publishing remains free. [Personal private publishing](https://docs.agentfacets.io/private-facets) is free during the beta, and paid private publishing for teams is available by request.

## Why facets?

- **Reproducible.** `facets.json` records what your project depends on. `facets.lock` pins exact versions and integrity hashes, so teammates and CI get identical results.
- **Tool-independent.** Install a facet once and each connected adapter materializes the asset types it supports, instead of maintaining a copy per tool.
- **Verified and deliberate.** Every archive is integrity-checked against what was published, and a new or changed MCP server declaration is never written until you approve it.
- **Manageable.** Move between versions with `facet update`, and remove a facet cleanly: only the files and config entries your project actually owns are deleted.

## Quickstart

```sh
# Install the CLI (macOS/Linux)
curl -fsSL https://agentfacets.io/install | bash

# Or on any platform, including Windows
npm install -g agent-facets

facet --version
```

Connect the AI tool you use, then add a facet from the registry:

```sh
facet adapter add claude-code   # or: opencode, codex

facet add cowsay
```

`facet add` resolves, verifies, records, and installs in one step:

```
cowsay installed. Updated facets via 1 adapter  ✓
  1 installed · 4 assets written
  + 1 skill · 1 agent · 2 commands
```

Those assets land where your tool already looks for them, so the new command works immediately:

```
/cowsay hey there
```

## Everyday use

```sh
facet install         # restore a project's facets after a clone or a pull
facet update          # move to newer releases within the ranges facets.json allows
facet remove cowsay   # take a facet back out, along with the files it owns
facet list            # see what is declared and what resolved
```

## Documentation

Full documentation lives at [docs.agentfacets.io](https://docs.agentfacets.io).

**Start here**

- [Quickstart](https://docs.agentfacets.io/quickstart) walks through the above in under five minutes.
- [Setup](https://docs.agentfacets.io/guides/setup) covers the CLI, adapters, and registry tokens.
- [Key concepts](https://docs.agentfacets.io/docs/learn) explains facets, the two project files, assets, and adapters.

**Using facets**

- [Install facets](https://docs.agentfacets.io/guides/install-facets) covers adding, pinning, collisions, MCP approval, and CI.
- [CLI reference](https://docs.agentfacets.io/cli) documents every command, flag, and exit code.
- [Troubleshooting](https://docs.agentfacets.io/guides/troubleshooting) maps common errors to fixes.

**Authoring and publishing**

- [Create a facet](https://docs.agentfacets.io/guides/create-your-first-facet) covers scaffolding, authoring, and building.
- [Publish a facet](https://docs.agentfacets.io/guides/publish-a-facet) covers authentication, publishing, and versioning.

**Extending and integrating**

- [Build a custom adapter](https://docs.agentfacets.io/guides/custom-adapters) for a tool we do not support yet.
- [Adapter SDK reference](https://docs.agentfacets.io/reference/adapter-sdk) documents the adapter contract.
- [Specification](https://docs.agentfacets.io/specification) defines the artifact formats, integrity model, and install guarantees.

**Project status**

- Agent Facets is currently in [open beta](https://docs.agentfacets.io/roadmap/beta). Follow the [roadmap](https://docs.agentfacets.io/roadmap) and [changelog](https://docs.agentfacets.io/changelog).
- [Browse the registry](https://agentfacets.io) to find facets, or publish your own.

## Repository layout

This repository holds the CLI, the protocol reference implementation, and the first-party adapters.

| Package | Purpose |
| --- | --- |
| `packages/protocol` | Reference implementation of the facet specification: schemas, integrity, archive format |
| `packages/engine` | Install pipeline, registry client, adapter machinery, cache |
| `packages/cli` | The `facet` binary: commands, terminal UI, error formatting |
| `packages/adapter` | The published adapter SDK |
| `packages/adapters/*` | First-party adapters for Claude Code, OpenCode, and Codex |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to get set up.

We use [Greptile](https://www.greptile.com/) to review code changes here. They generously provide free reviews to OSS projects.

## License

[MIT](LICENSE)
