---
title: facet edit
sidebarTitle: ' '
description: Edit a facet project interactively
tag: facet edit
---

## Usage

```sh
facet edit [directory]
```

Opens an interactive editor for the facet in the specified directory (defaults to the current directory). The edit command is the full authoring workbench — everything `facet create` can do, plus automatic reconciliation of disk state versus the manifest.

## What it does

The edit command has two phases:

### Reconciliation

If the edit command detects drift between the manifest and the files on disk, it enters a reconciliation phase first. Drift includes:

- **New files on disk** not tracked in the manifest — choose "Add to manifest" or "Ignore for now"
- **Missing files** declared in the manifest but absent from disk — choose "Scaffold template" or "Remove from manifest"
- **Front matter detected** in content files — choose "Strip front matter" or "Remove from manifest"

All reconciliation items must be resolved before proceeding to editing.

### Editing

After reconciliation (or immediately if no drift), the edit phase allows:

- **Identity editing** — modify the facet name, description, and version
- **Asset management** — add, remove, or rename skills, agents, and commands
- **Description editing** — press Enter on an asset to edit its name, or press ↓ during name editing to open the description in your terminal editor (`$VISUAL` / `$EDITOR` / `vi`)

All changes are transactional — nothing is written to disk until you review and confirm on the confirmation page. Exit at any point with Esc Esc to discard all changes.

## Confirmation

Before applying, a summary shows the final state of your facet — identity fields and all assets with their descriptions. Choose "Apply" to write changes or "Go back" to continue editing.

On apply, the edit command:
- Writes the updated `facet.json`
- Scaffolds template files for new assets
- Strips front matter from flagged files
- Deletes files for removed assets

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Changes applied successfully |
| `1`  | Cancelled or manifest invalid |
