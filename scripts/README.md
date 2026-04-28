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
├── deploy/                     # SST main-stage CD pipeline
│   └── site.ts                 # `sst install` + `sst deploy --stage main`
│
├── lib/                        # Shared utilities
│   ├── io/                     # IO adapter (split by domain, nested namespaces)
│   │   ├── index.ts            # Composes io = { npm, git, gh, circleci, shell, console }
│   │   ├── npm.ts              # npm CLI commands (pack, publishTarball, view, etc.)
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

## Three Pipelines

There are three independent release-pipeline workflows — two triggered by git tag
patterns, one triggered by pushes to `main`:

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

Independently, every push to `main` triggers the `deploy` workflow which
runs `sst deploy --stage main` via `deploy/site.ts`. See `deploy/README.md`.
```

## Why is the CLI package private?

The CLI package (`agent-facets`) is marked `"private": true` in its `package.json`. This is **not** because it's unpublished — it IS published to npm. It's private because:

1. The CLI is cross-compiled into 12 standalone binaries for different platforms
2. These are published as individual `@agent-facets/cli-*` platform packages
3. A synthesized wrapper package (`agent-facets`) is published last with `optionalDependencies` pointing to all 12 platform packages
4. This custom flow cannot use `changeset publish` or standard `npm publish` from the source directory
5. Marking it `private` prevents `changeset publish` from attempting to publish the raw source package — the custom `release-cli/` pipeline handles it instead

## Workspace-only packages

Some workspace packages — `@agent-facets/common`, `@agent-facets/landing`, `@agent-facets/functions` — are private helpers that are never published and have no companion release pipeline. `"private": true` alone isn't enough to skip them: the CLI package is also private but MUST be tagged (its tag triggers the binary release pipeline).

The contract for marking a package as "workspace-only, never release" has three parts:

1. **Listed in `.changeset/config.json` `ignore`** — changesets never bumps the package's version or includes it in the Version Packages PR. This is the authoritative mechanism.
2. **No `version` field in `package.json`** — `release/tag.ts` and `lib/changesets.ts#hasUnpublishedVersions` defensively skip any package without a version. Without this fallback, an accidental removal from the `ignore` list would cause `tag.ts` to try creating `@pkg@undefined` tags, and `hasUnpublishedVersions` would perpetually report the package as "unpublished" (since `null !== undefined`).
3. **`DEP_FIELDS` in `scripts/lib/prepack.ts` excludes `devDependencies`** — lets published packages keep `workspace:*` devDep references to versionless workspace-only packages (e.g. `@agent-facets/common` in `core` / `adapter` / `cli` devDeps) without `prepack` trying — and failing — to resolve them to a concrete version. `npm pack` strips devDeps from the tarball anyway, so there's nothing to rewrite.

Together these keep workspace-only packages out of the release pipeline entirely — no tags, no npm publishes, no lingering "unpublished" state, and no prepack failures.

## Why pack-then-upload?

Both the library publish path and the CLI matrix path go through one helper —
`packAndPublish` in `scripts/lib/npm.ts` — which does `bun pm pack --quiet` followed by `npm publish <filename>`. This avoids an npm lifecycle race: when `npm publish` builds its own tarball, the registry **packument** (the JSON metadata served by `npm view`) is derived from a different `package.json` snapshot than the **tarball contents**. Our `prepack`/`postpack` rewrite/restore dance leaves the packument with the original (un-rewritten) manifest, so installs fail with `ENOLOCAL` errors trying to resolve `workspace:*` deps the registry shouldn't have advertised.

Pre-building the tarball with `bun pm pack` and uploading it with `npm publish <filename>` makes npm derive the packument from the `package.json` *inside* the tarball — tarball and packument match by construction. The exact filename is captured from `bun pm pack --quiet`'s stdout (which is just the filename) and passed to `npm publish` as a single arg, never a `*.tgz` glob — `npm publish` accepts exactly one `<package-spec>`, so a leftover tarball from a prior local pack would otherwise fail with EUSAGE.

## Per-package release queueing

`release/tag.ts` parses the package name out of scoped tags
(`@agent-facets/<pkg>@<version>` → `<pkg>`) and forwards it as the `package`
pipeline parameter when triggering CircleCI. The `release` workflow uses that
parameter in its `serial-group` key so releases of different packages
(`core`, `adapter`, etc.) can run in parallel while repeat releases of the
same package serialize. The CLI tag (`agent-facets@<version>`) routes to the
`release-cli` workflow, which doesn't use the parameter — we pass `undefined`
there and the pipeline default (`""`) applies. See `.circleci/AGENTS.md` for
the full serial-group layout across workflows.

## IO Adapter

All external side effects (shell commands, file operations, network calls) go through the `io` object exported from `lib/io/`. The adapter is split into domain files and exposed as **nested namespaces** — one per domain.

Import it as:

```ts
import { io } from '../lib/io'

await io.npm.publishTarball(pkgDir, filename)
await io.git.pushAllTags('origin')
await io.gh.prCreate('main', head, title, body)
await io.circleci.triggerPipelineForTag(slug, defId, tag, packageName)
await io.shell.readFile(path)
io.console.log('hello')
```

Tests mock individual methods via the domain: `spyOn(io.npm, 'publish')`, `spyOn(io.git, 'tagAt')`, etc.
