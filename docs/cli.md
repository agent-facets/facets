---
title: Facet CLI
sidebarTitle: CLI
description: "`facet` is an open-source CLI for managing and installing **facets**"
tag: facet
---

Good development ecosystems allow you to install the exact version of what you need.

`facet` is a **facet** manager for any AI coding tool (adapter) that follows the
[Agent Skills specification](https://agentskills.io/specification) and
[Model Context Protocol](https://modelcontextprotocol.io/specification/latest). It can discover, install,
verify, and publish **facets**. It is extremely configurable and solves a variety of use cases. Most importantly, it
allows you to install the exact versions you want of **facets** and their dependencies.

## Common Commands

The following are the most common `facet` commands. See the [roadmap](/roadmap) for planned commands.

<Columns cols={2}>
  <Card title={<Badge>facet create</Badge>}>
    Scaffolds a new **facet** project with an interactive wizard — name, description, version, and initial assets
  </Card>
  <Card title={<Badge>facet edit</Badge>}>
    Full authoring workbench — edit identity, manage assets, reconcile disk vs manifest, strip front matter
  </Card>
  <Card title={<Badge>facet build</Badge>}>
    Validates and packages your **facet** into a distributable archive with integrity hashes
  </Card>
  <Card title={<Badge>facet add</Badge>} href="/cli/add">
    Add a **facet** to the project — resolve from a source, download, and install in one step
  </Card>
  <Card title={<Badge>facet publish</Badge>} href="/roadmap">
    Publish a built **facet** to the registry
  </Card>
  <Card title={<Badge>facet self-update</Badge>} href="/cli/self-update">
    Update the `facet` CLI to the latest version (alias: `facet self-upgrade`)
  </Card>
</Columns>
