---
title: "MCP Server Assets"
description: "Source-mode and ref-mode MCP server publication and execution."
---

Facets contain text assets (skills, agents, commands). MCP servers contain code. This page defines how MCP servers are published, referenced, and executed — covering both source-mode (published to the facets registry) and ref-mode (OCI container images in external registries).

A facet references servers by name in its `servers` section (see [Manifest Schema](/specification/manifest)). Server code is never included in the facet archive — servers are linked, not embedded.

## Two Execution Modes

| Property           | Source-mode                                    | Ref-mode                                                |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------- |
| Where it lives     | Facets registry                                | External OCI registry                                   |
| Versioning         | Semver in the facets registry                  | OCI tags and digests (no semver, no floor constraint)    |
| Facet manifest ref | `server-name: "1.0.0"`                         | `server-name: { image: "registry/image:tag" }`          |
| Resolution         | Registry resolves latest at or above floor     | CLI resolves tag to digest at install time               |
| Integrity          | Content hash + API surface hash                | OCI digest + API surface hash                           |
| Published artifact | Source code archive in facets registry         | OCI image in external registry                          |
| Upgrade mechanism  | `facet upgrade` resolves newer above floor     | `facet upgrade` re-resolves tag, checks for new digest  |

## Source-Mode Servers

Source-mode servers are artifacts published to the facets registry. They have semver versions, content hashes, and API surface hashes.

### Server Manifest

Each source-mode server has a manifest:

```yaml
name: jira
version: "1.5.0"
description: "Jira integration — create, search, update, and transition issues"
author: acme-org
runtime: bun
entry: index.ts
```

| Field         | Required | Type   | Description                                                       |
| ------------- | -------- | ------ | ----------------------------------------------------------------- |
| `name`        | Yes      | string | Server name. MUST be unique in the registry's server namespace.   |
| `version`     | Yes      | string | Semver version string.                                            |
| `description` | No       | string | Human-readable description.                                       |
| `author`      | No       | string | Author name or identifier.                                        |
| `runtime`     | Yes      | string | Managed runtime identifier. Day-one supported: `"bun"`.          |
| `entry`       | Yes      | string | Entry point file path, relative to the artifact root.             |

There is no `type` field — if it is published to the facets registry as a server artifact, it is source-mode by definition.

### Publish Flow

1. The server author runs a publish command from the server source directory.
2. The CLI reads and validates the server manifest.
3. The CLI packages the source code into an archive (tar) containing the manifest and all source files.
4. The CLI uploads the archive to the registry.
5. The registry MUST compute the content hash (see [Integrity Model](/specification/integrity)).
6. The registry MUST compute the API surface hash — by starting the server temporarily using the declared runtime and entry point, querying its MCP tool declarations, and hashing them.
7. The registry stores the artifact, content hash, and API surface hash.

**Immutability:** Once a server version is published, the registry MUST NOT allow re-publishing the same name and version with different content.

## Ref-Mode Servers

Ref-mode servers are NOT in the facets registry. They are OCI container images hosted in external OCI registries (GHCR, Docker Hub, ECR, etc.).

### No Registry Artifact

Ref-mode servers have no manifest in the facets registry. They are declared directly in a facet's `servers` section:

```yaml
servers:
  slack:
    image: "ghcr.io/acme/slack-bot:v2"
```

The image reference follows standard OCI conventions: `:` for tags, `@` for digests. The CLI resolves tags to digests at install time and pins the digest in the lockfile (see [Integrity Model](/specification/integrity)).

There is no facets-registry artifact for ref-mode servers. There is no semver version in the facets registry. There is no floor constraint. The facet author specifies the image reference, and the CLI pins it.

## Execution Contract

The CLI guarantees the following when running an MCP server:

### Source-Mode Execution

1. The CLI downloads the server artifact from the facets registry.
2. The CLI starts the server using the declared managed runtime (`bun` on day one) with the declared entry point.
3. The server communicates via MCP over stdio.
4. The CLI manages the server process lifecycle — start, stop, restart.

### Ref-Mode Execution

1. The CLI pulls the container image by the pinned digest (from the lockfile).
2. The CLI starts the container using a container runtime (Docker/Podman).
3. The server communicates via MCP over stdio (container stdin/stdout) or HTTP (mapped port).
4. The CLI manages the container lifecycle.

### CLI Guarantees

The CLI MUST guarantee:

- The server is started with the correct runtime or image.
- The server process or container is stopped when the AI assistant session ends.
- No arbitrary command or argument execution — the CLI controls exactly what executes.
- The server's MCP tools are exposed to the AI assistant through the adapter's MCP integration.

The CLI MUST NOT guarantee:

- Network access for the server (server-specific concern).
- File system access beyond what the runtime or container provides.
- Inter-server communication (servers are terminal — they MUST NOT depend on other servers).

## Runtime Enumeration

Each supported source-mode runtime is an explicit security surface commitment. Adding a new runtime requires:

- Audit of the runtime's security model
- Implementation of the runtime adapter in the CLI
- Ongoing maintenance of the runtime integration

Runtimes are enumerated, not discovered. Supported runtimes on day one: `bun` (TypeScript/JavaScript). Additional runtimes require future specification additions.
