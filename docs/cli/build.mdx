---
title: facet build
sidebarTitle: ' '
description: Build a facet from the current directory
tag: facet build
---

## Usage

```sh
facet build [directory]
```

Validates and builds the facet in the specified directory (defaults to the current directory).

## What it does

The build command runs a validation pipeline, assembles an archive, and computes content hashes:

1. **Load manifest** — reads `facet.json`, parses JSON, validates against the schema, checks business-rule constraints (at least one text asset, etc.)
2. **Resolve prompts** — reads prompt files at conventional paths (`<type>/<name>.md`) for skills, agents, and commands. If an expected file doesn't exist, the build fails with an error identifying the asset and the missing file path.
3. **Validate compact facets** — checks that compact entries in the `facets` section match the `name@version` format.
4. **Detect naming collisions** — fails if the same name is used more than once within the same asset type (e.g., two skills both named "review"). Assets of different types may share a name.
5. **Validate platform config** — validates platform configuration for known platforms (e.g., `opencode`, `claude-code`). Unknown platforms produce a warning but do not fail the build.
6. **Assemble archive** — collects the manifest and all resolved text assets into a deterministic tar archive, computes the integrity hash from the uncompressed tar bytes, then compresses it with gzip for the `.facet` file. Also computes SHA-256 content hashes for each individual asset.

On success, the build writes output to `dist/`:

- `dist/<name>-<version>.facet` — a gzip-compressed tar archive containing the manifest and all resolved text assets
- `dist/build-manifest.json` — records the facet format version, archive filename, integrity hash (`sha256:<hex>`), and per-asset content hashes

The build manifest format:

```json
{
  "facetVersion": 1,
  "archive": "<name>-<version>.facet",
  "integrity": "sha256:<hex>",
  "assets": {
    "facet.json": "sha256:<hex>",
    "skills/<name>.md": "sha256:<hex>"
  }
}
```

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Build succeeded |
| `1`  | Build failed (validation errors) |
