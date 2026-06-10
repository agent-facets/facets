---
title: "Terminology"
description: "Canonical terms used throughout the Facets specification."
---

This page defines the canonical terms used throughout the Facets specification. All specification sections use these terms consistently. Implementations SHOULD use the same terms in user-facing interfaces and documentation.

## Core Concepts

<Tabs>
  <Tab title='Facet'>
    A named, versioned collection of text assets defined by a manifest (the facet manifest). What the author creates locally, what gets published to the registry, and what gets extracted after install.
  </Tab>
  <Tab title='Assets'>
    A discrete unit of content within a facet. Consisting of any combination of skills, agents, commands, and MCP
    servers.

    <Columns col={2}>
      <Card title='Skill'>
        Text assets that follow the [Agent Skills](https://agentskills.io/specification) specification.
      </Card>
      <Card title='Agent'>
        Text assets that follow the [Agent Skills](https://agentskills.io/specification) specification.
      </Card>
      <Card title='Command'>
        Text assets that follow the [Agent Skills](https://agentskills.io/specification) specification.
      </Card>
      <Card title='Server'>
        A reference to an MCP server that is compliant with the [Model Context Protocol](https://modelcontextprotocol.io/specification/latest)
      </Card>

    </Columns>
  </Tab>

</Tabs>

| Term               | Definition                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Facet**          | A named, versioned collection of text assets defined by a manifest (the facet manifest). What the author creates locally, what gets published to the registry, and what gets extracted after install. |
| **Facet archive**  | The published, self-contained artifact stored in the registry. Contains the manifest and all text assets (locally authored and composed). The transport form between publish and install.        |
| **Asset**          | A discrete unit of content within a facet. Assets are either text assets (skills, agents, commands) or server assets (MCP server references).                                                  |
| **Text asset**     | An asset containing text  -- a skill, an agent prompt, or a command prompt. Text assets are included in the facet archive.                                                                       |
| **Server asset**   | An MCP server reference in a facet's manifest. Server assets are linked, not included  -- server code is published and archived separately from the facet.                                       |
| **MCP server**     | An asset type containing code (not text). Published independently from facets, versioned independently, resolved at install time. Two execution modes: source-mode and ref-mode.               |
| **Adapter**        | An AI coding tool that wraps around an LLM (e.g., OpenCode, Claude Code, Codex). The adapter is the abstraction layer over its tool's storage, configuration, and asset conventions. Installed via `facet adapter install`. |

## Asset Management

| Term                | Definition                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Managed asset**   | A text asset installed by a facet and tracked in the lockfile. The lockfile records the facet, version, content hash, and any override.                              |
| **Unmanaged asset** | A text asset that exists in a provider's install directory but is not connected to any facet. Either user-created or kept from an uninstalled facet.                 |
| **Override**        | A user modification to a managed text asset, stored as a unified diff in the lockfile. Detected by content hash mismatch. Preserved across upgrades via 3-way merge. |
| **Asset collision** | When a managed or to-be-managed asset has the same name as an existing asset on disk within the same asset type. Requires user resolution at install time.           |

## Execution Modes

| Term              | Definition                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Source-mode**   | MCP server execution mode where source code is published to the facets registry and run using a managed runtime. Always hyphenated. |
| **Ref-mode**      | MCP server execution mode where the facet manifest references an OCI container image hosted in an external registry. Always hyphenated. |

Do not use: `OCI-mode`, `source mode` (unhyphenated), `ref mode` (unhyphenated).

## Version Constraints

| Term                 | Definition                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Floor constraint** | The version constraint mechanism for source-mode MCP servers. Declares a minimum acceptable version; the CLI resolves to the latest at or above the floor at install time. |
| **Floor version**    | The specific minimum version value declared in a floor constraint (e.g., `"1.0.0"`).                                                              |

Use "floor-only" as an adjective when describing the constraint type (e.g., "floor-only constraints, no upper bounds"). Do not use: `minimum version`, `floor-constrained`.

## Integrity

| Term                | Definition                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Content hash**    | A SHA-256 hash of a published artifact (facet archive or source-mode server artifact). Verifies that downloaded bytes match what was published.      |
| **API surface hash**| A SHA-256 hash of an MCP server's tool declarations (names, descriptions, parameters, schemas). Detects structural breaking changes between versions.|
| **OCI digest**      | An immutable content hash for a container image. Used to pin ref-mode MCP servers in the lockfile.                                                  |

Use "integrity" when referring to the verification process ("integrity verification"), not as a synonym for the hash itself. Do not use: `integrity hash`, `content integrity hash`.

## Lifecycle

| Stage          | What exists                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Authoring**  | A facet  -- manifest and text assets in a local directory.                                                                                               |
| **Publishing** | The facet is built into an archive  -- text assets assembled, content hash computed, stored in the registry.                                              |
| **Installing**    | The archive is downloaded and verified. Text assets are presented to the consumer for review, then placed in provider-specified directories. Server references are resolved and pinned in the lockfile. |
| **Upgrading**     | Text asset changes are surfaced to the consumer with diffs. The consumer accepts, rejects, or modifies each change. Server API surface changes are flagged. The lockfile is updated. |
| **Uninstalling**  | Assets being removed are summarized. The consumer can keep individual text assets as unmanaged. The lockfile entry is removed. |
| **Running**       | The installed facet is loaded by the AI assistant. Text assets are in context. MCP servers are running processes managed by the CLI. |
