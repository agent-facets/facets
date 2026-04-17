---
title: "Architecture"
description: "Actors, lifecycle, artifact types, and design principles of the Facets system."
---

The Facets system distributes AI assistant extensions through a registry-based model with two artifact types: facets (text) and MCP servers (code). This page defines the actors, artifact types, lifecycle, and design principles that inform the rest of the specification.

## Actors

| Actor              | Role                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Author**         | Creates facets and/or MCP servers. Publishes to the registry.                                                     |
| **Registry**       | Stores facet archives and source-mode server artifacts. Assembles archives with server-side composition. Computes and stores integrity hashes. |
| **CLI**            | The consumer-facing tool. Installs facets, resolves server references, manages the lockfile, runs MCP servers.    |
| **AI assistant**   | The host application that loads installed text assets and connects to running MCP servers.                         |
| **OCI registry**   | External container registry (GHCR, Docker Hub, ECR, etc.) that hosts ref-mode server images.                      |

## Artifact Types

Facets and MCP servers are fundamentally different artifacts with different lifecycles, distribution models, and security profiles.

### Facets

A facet is a named, versioned collection of text assets — skills, agents, and commands — defined by a facet manifest. Facets MAY compose text from other published facets. Facets MAY reference MCP servers, but server code is never included in the facet.

When published, the registry assembles a **facet archive**: the manifest plus all text assets (locally authored and composed). The archive is self-contained — consumers need no further text resolution at install time.

### MCP Servers

An MCP server is a code asset that provides tool capabilities to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io). Servers are published independently from facets, versioned independently, and resolved at install time.

Two execution modes:

| Property           | Source-mode                                    | Ref-mode                                              |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------- |
| Where it lives     | Facets registry                                | External OCI registry                                 |
| Versioning         | Semver in the facets registry                  | OCI tags and digests (no semver, no floor constraint)  |
| Facet manifest ref | `server-name: "1.0.0"` (floor constraint)     | `server-name: { image: "registry/image:tag" }`        |
| Resolution         | Registry resolves latest at or above floor     | CLI resolves tag to digest at install time             |
| Integrity          | Content hash + API surface hash                | OCI digest + API surface hash                         |
| Published artifact | Source code archive in facets registry         | OCI image in external registry                        |

## Dual Distribution Model

Text and code follow different distribution paths:

- **Text assets** are resolved at **publish time**. The registry composes text from referenced facets and includes everything in the facet archive. Consumers receive a self-contained archive with no install-time text resolution.

- **Server assets** are resolved at **install time**. The facet manifest declares server references (floor constraints for source-mode, OCI image references for ref-mode). The CLI resolves these to specific versions and pins them in the lockfile.

This separation exists because text and code have different update characteristics. Stale text (an older version of a skill) is safe — it may be suboptimal but it will not break anything. However, *changed* text is a trust concern — prompt injection, behavioral changes, or context manipulation can be introduced through text updates. Text asset changes are surfaced to the consumer at install and upgrade time so they can review what changed (see [Install & Resolve](/specification/install)). Stale code (an older version of a server with a security vulnerability) is dangerous. Floor constraints allow servers to be updated for security fixes without requiring the facet author to re-publish.

## Lifecycle

### Authoring

An author creates a facet: a facet manifest (`facet.json`) and the associated text asset files (skills, agent prompts, command prompts) in a local directory. The manifest declares the facet's identity, its text assets, any composed facets, and any server references.

### Publishing

The facet is published to the registry. The author uploads the manifest and locally-authored files. The registry resolves text composition from its own trusted storage, assembles the facet archive, and computes the content hash. Once published, a version is immutable — re-publishing the same name and version with different content MUST be rejected.

### Installing

A consumer installs a facet. The CLI downloads the facet archive from the registry, verifies the content hash, and extracts text assets. For each server reference, the CLI resolves the reference to a specific version (source-mode: latest at or above the floor; ref-mode: tag to digest), verifies integrity, and pins the result in the lockfile.

### Running

The installed facet is loaded by the AI assistant. Text assets are in the assistant's context. MCP servers are running processes managed by the CLI, communicating via the Model Context Protocol.

## Design Principles

1. **Manifest immutability.** The build and publish process MUST NOT modify the manifest. The author's facet manifest is included as-is in the facet archive.

2. **Server-side composition.** Text composition MUST be performed by the registry from its own trusted storage. This prevents supply chain attacks where an author replaces composed content with malicious prompts while the manifest still attributes the content to trusted sources.

3. **Adapter-agnostic format.** The facet manifest format is adapter-agnostic by default. Adapter-specific configuration (tool access, permissions, model preferences) lives in designated extension points within the manifest. Each installed adapter defines its own metadata schema — the CLI delegates validation to the adapter.

4. **Terminal server dependencies.** MCP servers MUST NOT declare dependencies on other MCP servers. Resolution is always one level deep — no transitive dependency chains, no conflict resolution.

5. **Forward compatibility.** Structural choices MUST NOT prevent future extensions. Consumers MUST tolerate unrecognized fields in manifests. New server modes, asset types, or manifest sections can be added without breaking existing consumers.
