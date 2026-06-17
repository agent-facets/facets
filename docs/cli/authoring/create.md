---
title: facet create
description: Scaffolds a new facet project
---

## Usage

```sh
facet create [directory] [--force]
```

Creates a new facet project in the specified directory (defaults to the current directory). Walks through an interactive wizard to configure the facet.

If a `facet.json` already exists in the target directory, the command prompts for confirmation before overwriting. Use `--force` to skip the prompt.

## Wizard flow

1. **Name**  -- the facet identity. Either an unscoped name (`my-facet`) or a scoped name (`@scope/name`, e.g. `@acme/my-facet`). See the [Manifest Schema](/specification/manifest#facet-name-grammar) for the full name grammar.
2. **Description**  -- a brief description of the facet.
3. **Version**  -- defaults to `0.0.0`.
4. **Privacy**  -- choose Public (the default) or Private.
5. **Assets**  -- add skills, agents, and commands by name.
6. **Confirmation**  -- review the summary  -- and confirm.

## Generated files

On confirmation, the wizard writes:

- `facet.json`  -- the manifest with named asset descriptors
- `skills/<name>/SKILL.md`  -- starter skill template (Agent Skills directory convention)
- `agents/<name>.md`  -- starter agent template
- `commands/<name>.md`  -- starter command template

Content files are markdown. Optional YAML front matter is preserved verbatim through the build; at install time the manifest's `name`, `description`, and any per-adapter extras are merged on top of whatever the author wrote.

After creating the project, use `facet edit` to iterate on your facet, or `facet build` to validate and package it.

## Options

| Flag      | Description                    |
| --------- | ------------------------------ |
| `--force` | Overwrite existing facet.json  |
| `--help`  | Show help                      |

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Facet created successfully |
| `1`  | Cancelled, declined overwrite, or invalid input |
