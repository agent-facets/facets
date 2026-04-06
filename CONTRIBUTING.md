# Contributing

Thanks for your interest in contributing to Facets! This guide will help you get set up.

## Prerequisites

- [mise](https://mise.jdx.dev) — manages tooling (Bun, lefthook) via `mise.toml`

## Setup

```sh
git clone <repo-url>
cd facets
mise install   # installs Bun + lefthook
bun install    # installs deps + sets up git hooks
```

## Scripts

| Command          | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `bun dev`        | Run the CLI from source (e.g. `bun dev build ./my-facet`)         |
| `bun check`      | Lint + typecheck + build + test (run this before submitting a PR) |
| `bun run lint`   | Biome lint only                                                   |
| `bun run format` | Biome auto-fix and format                                         |
| `bun run test`   | Run tests                                                         |
| `bun run types`  | Typecheck only                                                    |
| `bun run build`  | Build only                                                        |
| `bun seed`       | Seed platform package names on npm (one-time setup)               |

## Platform Packages

The CLI is distributed as per-platform npm packages under `@agent-facets/cli-*`. When adding new platform targets, run `bun seed` to claim package names on npm, then follow the [OIDC setup guide](OIDC-SETUP.md) to configure trusted publishing for CircleCI.

## Pull Requests

- Keep PRs focused on a single change
- Run `bun check` before submitting — CI runs the same command
- Add a changeset with `bun change` for any user-facing changes — see the [changeset README](.changeset/README.md) for details
