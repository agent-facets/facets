# Contributing

Thanks for your interest in contributing to Agent Facets!

## Prerequisites

- [mise](https://mise.jdx.dev) — manages tooling (Bun, lefthook) via `mise.toml`

## Setup

Fork [agent-facets/facets](https://github.com/agent-facets/facets) on GitHub, then clone your fork:

```sh
git clone git@github.com:<your-username>/facets.git
cd facets
git remote add upstream git@github.com:agent-facets/facets.git
```

Adding the `upstream` remote lets you pull in changes from the main repo later with `git fetch upstream`.

Then install tools and dependencies:

```sh
mise install   # installs Bun + lefthook as specified in mise.toml
bun install    # installs workspace dependencies + sets up git hooks
```

## Scripts

| Command                         | Description                                                                  |
| ------------------------------- |------------------------------------------------------------------------------|
| `bun dev`                       | Run `facet` from source (e.g. `bun dev build ./my-facet`)                    |
| `bun check`                     | Turborepo lint + typecheck + build + tests — run this before submitting a PR |
| `bun format`                    | Biome auto-fix and format                                                    |
| `bun run types`                 | Typecheck only                                                               |

## Pull requests

- Push your branch to your fork, then open a PR against `agent-facets/facets:main`.
- Keep PRs focused on a single change.
- Run `bun check` before submitting — CI runs the same command.
- Add a changeset for changes to published packages (see below).

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

Not every PR needs a changeset — changes to docs, CI, or other non-published files can skip this step. The [changeset bot](https://github.com/apps/changeset-bot) comments on every PR to indicate whether one is present.
