---
title: "Integrity Model"
description: "Content hashing, OCI digest pinning, and API surface hashing."
---

Facets and MCP servers are distributed artifacts. Consumers need confidence that what they install is what was published — no tampering, no corruption, no substitution. This page defines how artifacts are hashed, when hashes are verified, and how structural changes to MCP server APIs are detected.

Three distinct integrity concerns are addressed:

1. **Content integrity** — does the downloaded artifact match what was published?
2. **OCI digest integrity** — for ref-mode MCP servers, does the container image match a known-good digest?
3. **API surface integrity** — has an MCP server's API changed structurally between versions?

## Content Hashing

### What It Covers

Facet archives and source-mode MCP server artifacts — anything published to the facets registry.

### How It Works

At publish time, the registry MUST compute a SHA-256 hash of the complete artifact (the archive). The hash is stored as the artifact's integrity value. At install time, the CLI MUST download the artifact, compute the hash, and compare it to the registry's recorded value.

A mismatch MUST be a hard failure — the artifact MUST be rejected.

### Format

`sha256:<hex-encoded hash>` (e.g., `sha256:a1b2c3d4e5f6...`)

### When It Is Applied

| When             | What happens                                                           |
| ---------------- | ---------------------------------------------------------------------- |
| **Publish time** | Registry computes the hash after assembling the artifact.              |
| **Install time** | CLI verifies the downloaded artifact against the registry's hash.      |
| **Lockfile**     | The content hash is recorded in the lockfile for reproducible verification. |

### What It Guarantees

The bytes the consumer receives are identical to the bytes the registry stored. No tampering in transit, no corruption, no substitution.

## OCI Digest Pinning

### What It Covers

Ref-mode MCP servers — container images hosted in OCI registries (GHCR, Docker Hub, ECR, etc.).

### How It Works

A ref-mode server is declared in the facet manifest with an OCI image reference:

```yaml
servers:
  slack:
    image: "ghcr.io/acme/slack-bot:v2"
```

OCI images have two reference types:

- **Tags** (`:v2`, `:latest`) — mutable labels. A tag can be moved to point to a different image at any time.
- **Digests** (`@sha256:abc123...`) — immutable content hashes. A digest always points to the same image.

At install time, the CLI MUST resolve the tag to a digest by querying the OCI registry. The resolved digest MUST be pinned in the lockfile:

```yaml
servers:
  slack:
    image: "ghcr.io/acme/slack-bot:v2"
    digest: "sha256:abc123..."
```

If the author specifies a digest directly (`image: "ghcr.io/acme/slack-bot@sha256:abc123"`), no resolution is needed — the digest MUST be used as-is.

### When It Is Applied

| When                 | What happens                                                                       |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Install time**     | CLI resolves the tag to a digest and pins it in the lockfile.                      |
| **Upgrade time**     | CLI re-resolves the tag. If the digest changed, the consumer is notified.          |
| **Lockfile install** | CLI pulls the image by the pinned digest, not by the tag.                          |

### What It Guarantees

Once installed, the consumer always gets the same container image regardless of whether the tag was moved. The digest in the lockfile is the truth.

### Notes

OCI images do not have semver versions — they have tags and digests. Tags that look like versions (`:v1.5.0`) are labels, not semantic versions. Floor constraints do NOT apply to ref-mode servers. Ref-mode servers are pinned by tag + resolved digest.

## API Surface Hashing

### What It Covers

MCP server API surfaces — the structural contract between a server and its consumers. Applies to both source-mode and ref-mode servers.

### How It Works

The API surface hash is computed from the server's MCP tool declarations:

- Tool names
- Tool descriptions (exact text)
- Parameter names, types, and schemas (JSON Schema)
- Parameter descriptions
- Required vs. optional parameter status

These elements MUST be serialized into a deterministic canonical form and hashed with SHA-256. The hash captures the structural shape of the API including the text that guides how an LLM uses it.

Two identical API surfaces MUST always produce the same hash, regardless of implementation.

### Why Descriptions Are Included

Descriptions are consumed by the LLM to decide when and how to use a tool. A description change could alter AI behavior even if parameters are unchanged. Including descriptions in the hash ensures consumers are notified of any change that could affect how their AI assistant interacts with the server.

### What the Hash Does NOT Cover

- Tool implementation (behavior, side effects)
- Server version number or metadata (author, license)
- Server configuration or environment variables
- Response formats (not part of the MCP tool declaration)

### When It Is Applied

| When             | What happens                                                                          |
| ---------------- | ------------------------------------------------------------------------------------- |
| **Install time** | CLI retrieves tool declarations, computes the hash, and records it in the lockfile.   |
| **Upgrade time** | CLI computes the new hash and compares to the lockfile. Changes trigger a warning.    |
| **Publish time** | Registry MAY compute and store the hash as metadata for version comparison queries.   |

### What It Guarantees

The consumer is warned when an MCP server's API surface changes structurally. This catches:

- Tools that were removed or renamed
- Parameters that were added, removed, or changed type
- Schema changes that alter what the server accepts
- Description changes that alter how the LLM interprets a tool

It does NOT catch behavioral changes where the API surface is unchanged but the server acts differently. Behavioral integrity is not solvable through hashing.

## Hash Storage Summary

| Artifact type               | Content hash | OCI digest | API surface hash |
| --------------------------- | ------------ | ---------- | ---------------- |
| Facet archive               | Yes          | —          | —                |
| Source-mode server artifact  | Yes          | —          | Yes              |
| Ref-mode server (OCI image) | —            | Yes        | Yes              |

## Where Hashes Live

| Location        | What is stored                                                                              |
| --------------- | ------------------------------------------------------------------------------------------- |
| **Registry**    | Content hash for facet archives and source-mode servers. API surface hash for source-mode servers. |
| **Lockfile**    | Content hash or OCI digest + API surface hash for every installed server.                   |
| **Manifest**    | OCI image reference (tag or digest) for ref-mode servers.                                   |

## Verification Summary

| When             | What is verified                                                          |
| ---------------- | ------------------------------------------------------------------------- |
| Install          | Content hash of facet archive and source-mode server artifacts.           |
| Install          | OCI tag resolved to digest; digest pinned in lockfile for ref-mode.       |
| Install          | API surface hash computed and recorded for all servers.                   |
| Upgrade          | Content hash or OCI digest verified for new versions.                     |
| Upgrade          | API surface hash compared to lockfile — changes flagged to consumer.      |
| Lockfile install | Pinned content hash or OCI digest used for exact reproduction.            |
