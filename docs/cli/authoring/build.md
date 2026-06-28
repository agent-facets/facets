---
title: facet build
description: Build a facet from the current directory
---

## Usage

```sh
facet build [directory]
```

Validates and builds the facet in the specified directory (defaults to the current directory). The build command is purely deterministic  -- it never modifies the manifest and behaves identically in all environments.

## What it does

The build command runs a validation pipeline, assembles an archive, and computes content hashes:

1. **Parse manifest**  -- reads `facet.json`, parses JSON, validates against the schema including business-rule constraints (at least one text asset, etc.)
2. **Resolve prompts**  -- reads prompt files at conventional paths. Skills use `skills/<name>/SKILL.md` (Agent Skills directory convention). Agents use `agents/<name>.md`. Commands use `commands/<name>.md`. If an expected file doesn't exist, the build fails.
3. **Validate assets**  -- checks that all content files are non-empty. Author-supplied YAML front matter is preserved verbatim in the archive; the manifest's `name`, `description`, and any per-adapter extras are merged on top of it at install time.
4. **Check collisions**  -- validates compact facets entries match the `name@version` format. Fails if the same name is used more than once within the same asset type.
5. **Validate adapters**  -- validates adapter metadata for installed adapters (e.g., `opencode`, `claude-code`). Each adapter validates its own metadata schema. Unknown adapters produce a warning but do not fail the build.
6. **Assemble archive**  -- collects the manifest and all resolved text assets into a deterministic tar archive, computes the integrity hash, compresses it with gzip, then wraps the compressed archive and a build manifest into the self-contained `.facet` file.

On success, the build writes output to `dist/`:

- `dist/<name>-<version>.facet`  -- a self-contained archive (uncompressed tar containing `build-manifest.json` and `archive.tar.gz`)

For a scoped facet identity, the name's `/` renders as a nested path under `dist/`. For example, `@acme/cowsay` at `1.0.0` is written to `dist/@acme/cowsay-1.0.0.facet`; the build creates the required parent directories.

The `.facet` file is the single distributable artifact. The build manifest is embedded inside it. Use `--emit-manifest` to also write a loose copy of `build-manifest.json` to `dist/` for debugging or tooling integration.

If the build fails, errors are displayed inline under the failed pipeline stage, with a suggestion to run `facet edit` to fix the issues.

## Flags

| Flag | Description |
| ---- | ----------- |
| `--emit-manifest` | Write a loose `build-manifest.json` to `dist/` alongside the `.facet` file |

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Build succeeded |
| `1`  | Build failed (validation errors) |
