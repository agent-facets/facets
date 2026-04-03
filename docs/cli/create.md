---
title: facet create
sidebarTitle: ' '
description: Create a new facet project interactively
tag: facet create
---

## Usage

```sh
facet create [directory]
```

Creates a new facet project in the specified directory (defaults to the current directory). Walks through an interactive wizard to configure the facet.

## Wizard flow

1. **Name** — the facet name, in kebab-case (e.g., `my-facet`).
2. **Description** — a brief description of the facet.
3. **Version** — defaults to `0.0.0`.
4. **Assets** — add skills, agents, and commands by name. At least one asset is required. Each asset shows its description below the name — press Enter to edit the name, or press ↓ during name editing to edit the description in your terminal editor.
5. **Confirmation** — review the summary and confirm.

## Generated files

On confirmation, the wizard writes:

- `facet.json` — the manifest with named asset descriptors
- `skills/<name>/SKILL.md` — starter skill template (Agent Skills directory convention)
- `agents/<name>.md` — starter agent template
- `commands/<name>.md` — starter command template

Content files contain pure markdown with no YAML front matter. The manifest is the single source of truth for metadata.

After creating the project, use `facet edit` to iterate on your facet, or `facet build` to validate and package it.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Facet created successfully |
| `1`  | Cancelled or invalid input |
