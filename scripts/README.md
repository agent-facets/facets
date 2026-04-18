# Release Scripts

This directory contains the release and CI automation scripts for the facets monorepo.

## Directory Structure

```
scripts/
├── release/                    # Library package release pipeline
│   ├── version.ts              # Create/update Version Packages PR
│   ├── tag.ts                  # Create git tags after version PR merge
│   ├── publish.ts              # Publish a library package from a tag
│   └── seed-adapters.ts        # Seed adapter/library package names on npm
│
├── release-cli/                # CLI binary release pipeline
│   ├── build.ts                # Cross-compile 12 platform binaries
│   ├── publish-platform.ts     # Publish one platform binary package
│   ├── publish-cli-package.ts  # Synthesize + publish CLI wrapper
│   ├── finalize.ts             # Orchestrate publish → verify → announce
│   ├── verify.ts               # Verify all 13 packages on npm
│   ├── seed.ts                 # Seed platform package names on npm
│   └── targets.ts              # Platform target matrix definitions
│
├── lib/                        # Shared utilities
│   ├── io/                     # IO adapter (split by domain, nested namespaces)
│   │   ├── index.ts            # Composes io = { npm, git, gh, circleci, shell, console }
│   │   ├── npm.ts              # npm CLI commands
│   │   ├── git.ts              # git CLI commands
│   │   ├── github.ts           # GitHub CLI commands
│   │   ├── circleci.ts         # CircleCI API v2 calls
│   │   ├── shell.ts            # Shell, filesystem, build, CI tokens, network
│   │   └── console.ts          # log and error
│   ├── ci.ts                   # Workspace package loading, token minting
│   ├── npm.ts                  # npm registry helpers (whoami, exists, etc.)
│   ├── seed-oidc.ts            # Shared OIDC trusted-publishing instructions
│   ├── changesets.ts           # Changeset parsing, PR body building
│   ├── announce.ts             # GitHub Release + Slack notification
│   ├── constants.ts            # Repo name, Slack channels, paths
│   ├── tags.ts                 # Version tag parsing (shared across pipelines)
│   ├── github-app.ts           # GitHub App token minting
│   ├── notify-failure.ts       # Slack failure notification (on_fail step)
│   └── test-helpers.ts         # Test utilities (mock helpers, fixtures)
│
├── prepack.ts                  # Rewrite workspace:* deps + hoist publishConfig overrides before npm publish
├── postpack.ts                 # Restore package.json after pack
└── check-bun-version.ts        # Verify Bun version matches mise.toml
```

## Two Pipelines

There are two independent release pipelines, triggered by different git tag patterns:

```
┌──────────────────────────────────────────────────────────────────┐
│  Developer merges changesets to main                             │
│                                                                  │
│  main-pipeline CI job:                                           │
│    1. bun run check                                              │
│    2. release/version.ts  → create/update Version Packages PR    │
│    3. release/tag.ts      → (no-op unless version PR just merged)│
└──────────────────────────────────────────────────────────────────┘
                                │
                        Version PR merged
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  main-pipeline runs again:                                       │
│    release/tag.ts detects the merge and creates git tags:        │
│                                                                  │
│    @agent-facets/core@X.Y.Z   ─── library tag                    │
│    @agent-facets/brand@X.Y.Z  ─── library tag                    │
│    agent-facets@X.Y.Z         ─── CLI tag                        │
└──────────────────────────────────────────────────────────────────┘
            │                                       │
            ▼                                       ▼
   ┌─────────────────┐                  ┌──────────────────────┐
   │ Library Release │                  │ CLI Release          │
   │ (release/ dir)  │                  │ (release-cli/ dir)   │
   │                 │                  │                      │
   │ See release/    │                  │ See release-cli/     │
   │ README.md       │                  │ README.md            │
   └─────────────────┘                  └──────────────────────┘
```

## Why is the CLI package private?

The CLI package (`agent-facets`) is marked `"private": true` in its `package.json`. This is **not** because it's unpublished — it IS published to npm. It's private because:

1. The CLI is cross-compiled into 12 standalone binaries for different platforms
2. These are published as individual `@agent-facets/cli-*` platform packages
3. A synthesized wrapper package (`agent-facets`) is published last with `optionalDependencies` pointing to all 12 platform packages
4. This custom flow cannot use `changeset publish` or standard `npm publish` from the source directory
5. Marking it `private` prevents `changeset publish` from attempting to publish the raw source package — the custom `release-cli/` pipeline handles it instead

## IO Adapter

All external side effects (shell commands, file operations, network calls) go through the `io` object exported from `lib/io/`. The adapter is split into domain files and exposed as **nested namespaces** — one per domain.

Import it as:

```ts
import { io } from '../lib/io'

await io.npm.publish(pkgDir)
await io.git.pushAllTags('origin')
await io.gh.prCreate('main', head, title, body)
await io.circleci.triggerPipelineForTag(slug, defId, tag)
await io.shell.readFile(path)
io.console.log('hello')
```

Tests mock individual methods via the domain: `spyOn(io.npm, 'publish')`, `spyOn(io.git, 'tagAt')`, etc.
