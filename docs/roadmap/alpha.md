---
title: Pre-Release Alpha
sidebarTitle: Alpha
---

The pre-release alpha is a work in progress, but is available for enterprising users to try out.

## Available Now

These commands are implemented and ready to use:

| Command         | Description                                                                         |
|-----------------|-------------------------------------------------------------------------------------|
| `facet create`  | Scaffold a new **facet** project with an interactive wizard                         |
| `facet edit`    | Full authoring workbench — edit identity, manage assets, reconcile disk vs manifest |
| `facet build`   | Validate and package a **facet** into a distributable archive                       |
| `facet add`     | Add a **facet** to the project — resolve from registry, download, and install       |
| `facet install` | Install all **facets** from the lockfile                                            |
| `facet remove`  | Remove a **facet** from the project and update the lockfile                         |

## Planned

These commands are registered in the CLI but not yet implemented:

| Command         | Description                                          |
|-----------------|------------------------------------------------------|
| `facet upgrade` | Interactive upgrade wizard for installed **facets**  |
| `facet publish` | Publish a built **facet** to the registry            |
| `facet info`    | Show information about a **facet** from the registry |
| `facet list`    | List installed **facets**                            |
