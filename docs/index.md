---
title: "Agent Facets"
sidebarTitle: "Introduction"
---

A facet packages the text that shapes how an AI assistant behaves: domain-specific instructions (skills), specialized
agent configurations (agents), and custom slash commands (commands). Facets can also reference MCP servers — code that
gives the assistant new tool capabilities — without bundling the server code itself.

`facet` is a package manager for **facets** — modular, versioned bundles of skills, agents, commands, and MCP server
references that extend AI coding assistants.

## Quick Start

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