---
title: Key Concepts
description: Asset types, the manifest, text composition, MCP servers, and the facet lifecycle
---

This page introduces the core concepts behind Facets. For normative requirements, see the [Specification](/specification).

## Facets

A **facet** is a versioned collection of [assets](#assets) defined by a facet manifest (`facet.json`). What the author creates locally, what gets published to the registry, and what gets extracted after install.

## Assets

A discrete unit of content within a facet. Consisting of any combination of skills, agents, commands, and MCPservers.

<Columns col={2}>
  <Card title='Skills' href='/learn/skills'>
    Text assets that follow the [Agent Skills](https://agentskills.io/specification) specification.
  </Card>
  <Card title='Commands' href='/learn/commands'>
    Text assets that follow the [Agent Skills](https://agentskills.io/specification) specification.
  </Card>
  <Card title='Agents' href='/learn/agents'>
    Text assets that follow the [Agent Skills](https://agentskills.io/specification) specification.
  </Card>
  <Card title='Servers' href='/learn/servers'>
    A reference to an MCP server that is compliant with the [Model Context Protocol](https://modelcontextprotocol.io/specification/latest)
  </Card>

</Columns>
