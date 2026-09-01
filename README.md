# Agent Facets

**A package manager for AI coding assistant extensions.**

AI coding tools all want roughly the same things: skills, agents, commands, and MCP server declarations. But each expects them in its own format, in its own directory. So those files get copied between projects and between tools by hand, with no version, no upgrade path, no integrity check, and no clean way to take them back out.

A **facet** packages those extensions into a single versioned unit. The `facet` CLI installs facets into your project through adapters for Claude Code, OpenCode, and Codex, and resolves them from the free public registry at [agentfacets.io](https://agentfacets.io).

## Why facets?

- **Reproducible.** `facets.json` records what your project depends on; `facets.lock` pins exact versions and integrity hashes, so teammates and CI get identical results.
- **Tool-independent.** Install a facet once and it materializes into every connected tool, instead of maintaining a copy per tool.
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
```

## Learn more

- [Browse the registry](https://agentfacets.io) to find facets to install, or publish your own.
- [Quickstart](https://docs.agentfacets.io/quickstart) walks through the above in under five minutes.
- [Install facets](https://docs.agentfacets.io/guides/install-facets) covers adapters, version pinning, name collisions, MCP approval, and CI.
- [Create your first facet](https://docs.agentfacets.io/guides/create-your-first-facet) covers scaffolding, authoring, building, and publishing.
- [CLI reference](https://docs.agentfacets.io/cli) documents every command and flag.
- [Specification](https://docs.agentfacets.io/specification) defines the open facet format, integrity model, and install pipeline.

## Contributing

This repository is the CLI, the protocol reference implementation, and the first-party adapters. See [CONTRIBUTING.md](CONTRIBUTING.md) to get set up.

We use [Greptile](https://www.greptile.com/) to review code changes here. They generously provide free reviews to OSS projects.

## License

[MIT](LICENSE)
