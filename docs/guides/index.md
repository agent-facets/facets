---
title: Getting Started
description: Install the CLI, then create, publish, and install facets
---

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

Once installed, update in place with:

```sh
facet self-update
```

See [`facet self-update`](/cli/self-update) for flags and behavior.

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
