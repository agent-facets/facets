---
title: Servers
description: MCP server references that give AI assistants new tool capabilities
---

Servers are references to [MCP (Model Context Protocol)](https://modelcontextprotocol.io) servers declared in a facet's manifest. Unlike skills, agents, and commands, servers are linked rather than embedded -- the facet manifest references them, but server code is never included in the facet archive.

## Two execution modes

Facets support two ways to reference MCP servers:

| Mode        | Manifest value                          | Resolution                                   |
| ----------- | --------------------------------------- | -------------------------------------------- |
| Source-mode | String (floor version): `"1.0.0"`      | Published to the facets registry as a separate server artifact. The version is a floor constraint -- the CLI may install a newer compatible version. |
| Ref-mode    | Object: `{ "image": "ghcr.io/..." }`   | OCI container image in an external registry (GHCR, Docker Hub, ECR). Pinned by tag and resolved digest. |

### Source-mode example

```json
{
  "servers": {
    "sqlite": "1.0.0"
  }
}
```

The CLI downloads the server artifact from the facets registry, verifying its content hash and API surface hash.

### Ref-mode example

```json
{
  "servers": {
    "sqlite": { "image": "ghcr.io/acme/sqlite-mcp:v1.2" }
  }
}
```

The CLI pulls the OCI image, resolves the tag to an immutable digest, and pins the digest in the lockfile.

## Server manifest

Source-mode servers have their own manifest (`server.json`) with these fields:

| Field         | Type   | Required | Description                           |
| ------------- | ------ | -------- | ------------------------------------- |
| `name`        | string | Yes      | Server name                           |
| `version`     | string | Yes      | Semver version                        |
| `runtime`     | string | Yes      | Runtime to execute the server (day-one: `bun` only) |
| `entry`       | string | Yes      | Entry point file                      |
| `description` | string | No       | Human-readable description            |
| `author`      | string | No       | Author name or identifier             |

## Execution contract

- The CLI manages the server process lifecycle: start, stop, restart.
- Communication uses stdio (source-mode) or stdio/HTTP (ref-mode).
- Servers are terminal -- they must not declare dependencies on other servers. Resolution is always one level deep.

## Current status

<Warning>
Server support is in development. A facet that declares `servers:` emits a warning during install -- the server names are listed but not materialized. Server materialization is planned for open beta. The day-one runtime is Bun only.
</Warning>

## Further reading

- [MCP specification](https://modelcontextprotocol.io/specification/latest)
- [Server Assets specification](/specification/servers) -- normative rules for server publishing and execution
- [Manifest Schema](/specification/manifest) -- the `servers` field in `facet.json`
