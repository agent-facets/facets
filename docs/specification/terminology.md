---
title: "Terminology"
description: "Canonical terms used throughout the Facets specification."
---

Canonical terms used throughout the specification. Implementations SHOULD use the same terms in user-facing interfaces and documentation.

## Core concepts

<CardGroup cols={2}>
  <Card title="Facet" icon="box">
    A named, versioned collection of text assets defined by a manifest. What the author creates, what gets published, and what gets installed.
  </Card>
  <Card title="Facet archive" icon="package">
    The published, self-contained artifact stored in the registry. Contains the manifest and all text assets. The transport form between publish and install.
  </Card>
  <Card title="Adapter" icon="plug">
    An AI coding tool abstraction (OpenCode, Claude Code, Codex). The layer between facet assets and the tool's storage and configuration conventions.
  </Card>
  <Card title="MCP server" icon="server">
    A code asset providing tool capabilities via the [Model Context Protocol](https://modelcontextprotocol.io). Published independently, versioned independently, resolved at install time.
  </Card>
</CardGroup>

### Asset types

<CardGroup cols={4}>
  <Card title="Skill" icon="sparkles" href="https://agentskills.io/specification">
    Text asset following the Agent Skills spec.
  </Card>
  <Card title="Agent" icon="bot" href="https://agentskills.io/specification">
    Text asset following the Agent Skills spec.
  </Card>
  <Card title="Command" icon="terminal" href="https://agentskills.io/specification">
    Text asset following the Agent Skills spec.
  </Card>
  <Card title="Server" icon="server" href="https://modelcontextprotocol.io/specification/latest">
    MCP server reference. Code, not text.
  </Card>
</CardGroup>

### Asset management

| Term | Definition |
| --- | --- |
| **Managed asset** | Installed by a facet, tracked in the lockfile and <Tooltip tip="Per-project record under $FACET_DIR/receipts/ -- tracks what this machine has materialized.">install receipt</Tooltip>. |
| **Unmanaged asset** | Exists in an adapter directory but not connected to any facet. User-created or kept from an uninstalled facet. |

## Integrity

<AccordionGroup>
  <Accordion title="Hashes" icon="fingerprint" defaultOpen>
    | Term | Definition |
    | --- | --- |
    | **Canonical fingerprint** | SHA-256 of the uncompressed inner tar (`content_integrity`). Recorded in the lockfile, cache sidecar, and build manifest. Trust anchor for verification. |
    | **Transport hash** | SHA-256 of the uploaded `.facet` tarball (`content_hash`). Download-time transit check only. Never persisted to the lockfile. |
    | **API surface hash** | SHA-256 of an MCP server's tool declarations. Detects structural breaking changes. |
    | **OCI digest** | Immutable content hash for a container image. Pins ref-mode servers in the lockfile. |
  </Accordion>
  <Accordion title="Verification" icon="shield-check">
    | Term | Definition |
    | --- | --- |
    | **Cache sidecar** | `cache-integrity.json` stored alongside cached content. Canonical fingerprint + per-asset hashes. |
    | **Cache self-audit** | Re-verification of cached content against its sidecar on every materialization. Evicts on mismatch. |
    | **Integrity confirmation** | Registry metadata request verifying content matches the published canonical fingerprint. Required when creating a lockfile entry. Fails offline. |
  </Accordion>
</AccordionGroup>

## Install pipeline

| Term | Definition |
| --- | --- |
| **Install delta** | Additions (user's specifier verbatim) + removals (bare names). `facet install` produces an empty delta. |
| **Structural discriminator** | Additions never trust the lockfile for version resolution; reproductions do. |
| **Install receipt** | Machine-local record under `$FACET_DIR/receipts/` tracking materialized state per project. Drives offline drift removal. |
| **Tri-write** | Atomic commit: `facets.json` + `facets.lock` + receipt written together. Failure leaves all three unchanged. |

## Execution modes

| Term | Definition |
| --- | --- |
| **Source-mode** | Server source code published to the facets registry, run via managed runtime. |
| **Ref-mode** | Server references an OCI container image in an external registry. |

<Info>
Always hyphenate: `source-mode`, `ref-mode`. Do not use `OCI-mode` or unhyphenated forms.
</Info>

## Version constraints

| Term | Definition |
| --- | --- |
| **Floor constraint** | Minimum acceptable version for source-mode servers. CLI resolves to the latest at or above the floor. |
| **Floor version** | The specific minimum version value (e.g., `"1.0.0"`). |

## Lifecycle

| Stage | What happens |
| --- | --- |
| **Authoring** | Author creates a manifest and text assets locally. |
| **Publishing** | Registry assembles the archive, computes hashes. Version is immutable once published. |
| **Installing** | [Plan/commit pipeline](/specification/pipeline): resolve, verify, materialize, tri-write. |
| **Upgrading** | Diffs surfaced to consumer. API surface changes flagged. _(Future)_ |
| **Uninstalling** | Assets removed via delta pipeline. Receipt updated. |
| **Running** | Text in context. Servers running via MCP. |
