---
title: "Architecture"
description: "Actors, artifact types, distribution model, and design principles."
---

The Facets system distributes AI assistant extensions through a registry-based model with two artifact types: **facets** (text) and **MCP servers** (code).

## Actors

<CardGroup cols={2}>
  <Card title="Author" icon="pen">
    Creates facets and/or MCP servers. Publishes to the registry.
  </Card>
  <Card title="Registry" icon="database">
    Stores archives, assembles server-side composition, computes integrity hashes.
  </Card>
  <Card title="CLI" icon="terminal">
    Installs facets, resolves server references, manages the lockfile and receipt, runs MCP servers.
  </Card>
  <Card title="AI assistant" icon="bot">
    Loads text assets into context. Connects to running MCP servers.
  </Card>
</CardGroup>

## Artifact types

### Facets

A named, versioned collection of text assets -- skills, agents, and commands -- defined by a manifest. MAY compose text from other published facets. MAY reference MCP servers, but server code is never included.

When published, the registry assembles a **facet archive**: manifest + all text assets. Self-contained -- no further text resolution at install time.

### MCP servers

Code assets providing tool capabilities via the [Model Context Protocol](https://modelcontextprotocol.io). Published and versioned independently from facets.

| Property | Source-mode | Ref-mode |
| --- | --- | --- |
| Where it lives | Facets registry | External OCI registry |
| Versioning | Semver + floor constraints | OCI tags and digests |
| Manifest reference | `server: "1.0.0"` | `server: { image: "reg/img:tag" }` |
| Resolution | Latest at or above floor | Tag → digest at install |
| Integrity | Canonical fingerprint + API surface hash | OCI digest + API surface hash |

## Distribution model

<CardGroup cols={2}>
  <Card title="Text → publish time" icon="clock">
    Registry composes text and includes everything in the archive. Consumers receive a self-contained artifact.
  </Card>
  <Card title="Code → install time" icon="download">
    The manifest declares server references. The CLI resolves to specific versions and pins in the lockfile.
  </Card>
</CardGroup>

<Info>
Stale text is safe (suboptimal, not broken). Changed text is a trust concern (prompt injection). Stale code is dangerous (security vulnerabilities). This asymmetry drives the split: text is locked at publish; servers float with floor constraints.
</Info>

## Lifecycle

<Steps>
  <Step title="Author">
    Create a `facet.json` manifest and text asset files in a local directory.
  </Step>
  <Step title="Publish">
    Registry assembles the archive, computes the <Tooltip tip="SHA-256 of the canonical uncompressed inner tar (content_integrity) and the uploaded tarball (content_hash).">integrity hashes</Tooltip>. A published version is immutable.
  </Step>
  <Step title="Install">
    The [plan/commit pipeline](/specification/pipeline) resolves versions, verifies integrity (cache self-audit + lockfile comparison or registry confirmation), materializes assets, and writes manifest + lockfile + receipt atomically.
  </Step>
  <Step title="Run">
    Text assets in the assistant's context. MCP servers as managed processes.
  </Step>
</Steps>

## Design principles

<AccordionGroup>
  <Accordion title="Manifest immutability">
    Build and publish MUST NOT modify the manifest. The author's `facet.json` is included as-is in the archive.
  </Accordion>
  <Accordion title="Server-side composition">
    Text composition MUST be performed by the registry from its own trusted storage. Prevents supply chain attacks where an author replaces composed content with malicious prompts.
  </Accordion>
  <Accordion title="Adapter-agnostic format">
    The manifest format is adapter-agnostic. Adapter-specific configuration lives in designated extension points. Each adapter defines its own metadata schema.
  </Accordion>
  <Accordion title="Terminal server dependencies">
    MCP servers MUST NOT declare dependencies on other servers. One level deep -- no transitive chains.
  </Accordion>
  <Accordion title="Forward compatibility">
    Consumers MUST tolerate unrecognized fields. New server modes, asset types, or manifest sections can be added without breaking existing consumers.
  </Accordion>
</AccordionGroup>
