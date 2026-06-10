---
title: "Agent Facets"
sidebarTitle: "Introduction"
---

A facet packages the text that shapes how an AI assistant behaves: domain-specific instructions (skills), specialized agent configurations (agents), and custom slash commands (commands). Facets can also reference MCP servers -- code that gives the assistant new tool capabilities -- without bundling the server code itself.

`facet` is a package manager for **facets** -- modular, versioned bundles of skills, agents, commands, and MCP server references that extend AI coding assistants.

## Install the CLI

<CodeGroup>

```shell curl
curl -fsSL https://agentfacets.io/install | bash
```

```shell npm
npm install -g agent-facets
```

```shell bun
bun add -g agent-facets
```

```shell pnpm
pnpm install -g agent-facets
```

</CodeGroup>

Verify the install:

```sh
facet --version
```

Once installed, update in place with [`facet self-update`](/cli/self-update).

## Guides

<CardGroup cols={3}>

<Card title="Install Facets" icon="download" href="/guides/install-facets">
  Set up an adapter, search the registry, add facets, and manage your project.
</Card>

<Card title="Create Your First Facet" icon="hammer" href="/guides/create-your-first-facet">
  Scaffold a project, write skills, agents, and commands, then build a `.facet` archive.
</Card>

<Card title="Publish a Facet" icon="upload" href="/guides/publish-a-facet">
  Sign in to the registry, build, publish, and handle drift detection.
</Card>

</CardGroup>
