---
title: Getting Started
description: Set up the Facets development environment and learn the contribution workflow.
---

## Prerequisites

- [mise](https://mise.jdx.dev)  -- manages tooling (Bun, lefthook) via `mise.toml`

## Setup

<Steps>
  <Step title="Fork and clone the repository">
    Fork [agent-facets/facets](https://github.com/agent-facets/facets) on GitHub, then clone your fork:

    ```sh
    git clone git@github.com:<your-username>/facets.git
    cd facets
    git remote add upstream git@github.com:agent-facets/facets.git
    ```

    Adding the `upstream` remote lets you pull in changes from the main repo later with `git fetch upstream`.
  </Step>
  <Step title="Install tools">
    ```sh
    mise install
    ```
    This installs Bun and lefthook (git hooks) as specified in `mise.toml`.
  </Step>
  <Step title="Install dependencies">
    ```sh
    bun install
    ```
    Installs all workspace dependencies and sets up git hooks via lefthook.
  </Step>
</Steps>

## Scripts

| Command          | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `bun dev`        | Run `facet` from source (e.g. `bun dev build ./my-facet`)         |
| `bun check`      | Lint + typecheck + build + test (run this before submitting a PR) |
| `bun run lint`   | Biome lint only                                                   |
| `bun run format` | Biome auto-fix and format                                         |
| `bun run test`   | Run tests                                                         |
| `bun run types`  | Typecheck only                                                    |
| `bun run build`  | Build only                                                        |

## Refreshing registry types

The CLI's view of the registry's HTTP API is generated from the
registry's published OpenAPI specification. The generated types live
in `packages/engine/src/registry/generated/`, and the curated
re-exports CLI code imports from live in
`packages/engine/src/registry/wire.ts`.

When to refresh:

- The registry adds, renames, or restructures an endpoint.
- The CI staleness check (`openapi-snapshot-freshness`) reports
  `STALE`.
- Before tagging a CLI release.

How to refresh:

```sh
bun run --cwd packages/engine codegen:registry
```

The script fetches the live OpenAPI from
`https://api.facet.cafe/v0/openapi.yaml` (or
`FACET_REGISTRY_OPENAPI_URL`), regenerates the typed module, and
updates the on-disk snapshot. Both files are committed; PRs review
the diff just like any other change.

To check freshness without re-fetching (offline; reads only the
on-disk `Generated-At` header):

```sh
bun run --cwd packages/engine codegen:registry --check
bun run --cwd packages/engine codegen:registry --check --strict
```

`--strict` exits non-zero on stale, which is what CircleCI runs for
the `openapi-snapshot-freshness` job  -- produces a red X on the PR if
your snapshot is older than 7 days. The check is advisory by default
and does not block merge.

Call sites use the typed client directly:

```ts
import { createRegistryClient } from '@agent-facets/engine'

const client = createRegistryClient()
const { data, error, response } = await client.GET(
  '/v0/packages/{name}/{version}',
  { params: { path: { name, version } } },
)
```

## Pull requests

- Push your branch to your fork, then open a PR against `agent-facets/facets:main`.
- Keep PRs focused on a single change.
- Run `bun check` before submitting -- CI runs the same command.
- Add a changeset for any user-facing changes (see below).

## Changesets

Before submitting a PR that changes published packages, run:

```sh
bun change
```

Follow the prompts to select a bump type (patch/minor/major) and write a summary. Commit the generated `.md` file with your PR.

A good changeset describes:

- **What** the change is
- **Why** the change was made
- **How** a consumer should update their code (if applicable)

Not every PR needs a changeset  -- changes to docs, CI, or other non-published files can skip this step. The [changeset bot](https://github.com/apps/changeset-bot) comments on every PR to indicate whether one is present.

## Platform packages

`agent-facets` is distributed as per-platform npm packages under `@agent-facets/cli-*`. When adding new platform targets, a maintainer will run `bun seed:cli` to claim package names on npm, then follow the [publishing guide](/docs/contributing/publishing.md) to configure authentication for CircleCI.
