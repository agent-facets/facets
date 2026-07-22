# Library Release Pipeline

Publishes `@agent-facets/protocol`, `@agent-facets/brand`, `@agent-facets/adapter`, `@agent-facets/adapter-*`, and any future public library/adapter packages to npm. (`@agent-facets/engine` is private to the monorepo and never published.)

## Flow

```
Version PR merged to main
  │
  ▼
┌────────────────────────────────────────────────────────────────────┐
│  release/tag.ts (main-pipeline)                                    │
│                                                                    │
│  1. Detect version PR merge                                        │
│  2. Create git tags for each unpublished package version           │
│  3. git push --tags origin                                         │
│  4. For each tag: POST to CircleCI API v2 /pipeline/run            │
│     with {definition_id, config: {tag}, checkout: {tag}}           │
│                                                                    │
│  Why explicit API trigger? GitHub-to-CircleCI tag-push webhooks    │
│  are unreliable when the bot GitHub App pushes tags — the CircleCI │
│  App installation drops events from other bot actors. See          │
│  docs/contributing/release-pipeline.mdx.                           │
└────────────────────────────────────────────────────────────────────┘
  │
  ▼ (one release pipeline per tag)
┌──────────────────────────────────────────────────┐
│  release/publish.ts                              │
│                                                  │
│  1. Parse package name + version from tag        │
│  2. Find package in workspace                    │
│  3. Skip if private (guard)                      │
│  4. Skip if version already on npm (guard)       │
│  5. Mint OIDC token (npm trusted publishing)     │
│  6. Build via `turbo build --filter=<pkg>...`    │
│  7. npm publish --access public                  │
│  8. Create GitHub Release                        │
│  9. Send Slack notification                      │
└──────────────────────────────────────────────────┘
```

The `--filter=<pkg>...` scope is critical: an unfiltered `turbo build` fans out to all 11 workspace packages and OOM-killed the executor (exit 137) because four `tsdown` + `rolldown-plugin-dts` builds run in parallel. The release job runs on `resource_class: medium` with `TURBO_CONCURRENCY=1` for the same reason — see `.circleci/development/commands/run-check.yml` for the full memory analysis.

## Scripts

| Script              | CircleCI Job    | Trigger                        | Purpose                                                                   |
|---------------------|-----------------|--------------------------------|---------------------------------------------------------------------------|
| `version.ts`        | `main-pipeline` | Push to `main`                 | Run `changeset version`, create/update Version Packages PR                |
| `tag.ts`            | `main-pipeline` | Push to `main`                 | Detect merged version PR, create git tags, trigger release pipelines      |
| `publish.ts`        | `release`       | API trigger (`@agent-facets/*@*`) | Build and publish one library package to npm                           |
| `seed-adapters.ts`  | (manual)        | One-time bootstrap             | Seed adapter/library package names on npm with v0.0.1                     |

## Required secrets

`tag.ts` requires `CIRCLECI_API_TOKEN` in the `bot-context` CircleCI context. It's a personal API token with write access to the project, used to POST to `/api/v2/project/<slug>/pipeline/run`. See [CI Architecture docs](../../docs/docs/contributing/ci-architecture.md) for context rotation steps.

## Private Package Guard

`publish.ts` checks `pkg.private` before publishing. If a private package's tag triggers the release workflow (e.g., an internal adapter package), the script logs a skip message and exits cleanly. This prevents accidental npm publish attempts for internal packages.

## Adapter API compatibility rollout

The compatibility-aware CLI selects npm adapter releases by their `facetAdapterApiVersion` metadata and refuses to load installed adapters without a supported declaration. That makes release **ordering** load-bearing the first time the supported API set changes (including its introduction): the SDK and first-party adapter releases MUST be live on npm before the CLI release that requires them, or a plain `facet adapter install <alias>` has no compatible candidate.

Checklist (SDK → first-party adapters → CLI):

1. Land the implementation with changesets for `@agent-facets/adapter` and the first-party adapter packages (`@agent-facets/adapter-claude-code`, `@agent-facets/adapter-opencode`, `@agent-facets/adapter-codex`) **only** — no `agent-facets` changeset yet.
2. Merge that Version Packages PR. Tags are created and the library pipeline publishes the SDK and adapter releases. npm `latest` advances normally — never move, pin, or withhold dist-tags for compatibility purposes; compatibility selection is entirely the CLI's job.
3. Verify each adapter's packument declares the API before proceeding:

   ```sh
   npm view @agent-facets/adapter-claude-code facetAdapterApiVersion
   npm view @agent-facets/adapter-opencode facetAdapterApiVersion
   npm view @agent-facets/adapter-codex facetAdapterApiVersion
   ```

4. Only after all three respond with the expected API version, add the `agent-facets` changeset and merge the second Version Packages PR. Its tag triggers the `release-cli` pipeline, which ships the compatibility-aware CLI.
5. No action is needed for already-published CLIs (the adapter method contract is unchanged). Users of the new CLI with previously installed, undeclared bundles get fail-closed diagnostics and a `facet adapter install <specifier>` reinstall command.

Why two Version-PR cycles: `.changeset/config.json` links `agent-facets`, `@agent-facets/adapter`, and `@agent-facets/protocol`, and a single Version PR creates **all** tags at once — the library and CLI pipelines then run in parallel, racing the CLI release against the adapter publishes. Splitting the changesets into two cycles is what enforces the ordering.

## Seeding New Library/Adapter Packages

Before a brand-new `@agent-facets/*` package can be published by the tag pipeline, its name must exist on npm so that OIDC trusted publishing can be configured on the package's access page. Run `bun seed:adapters` locally (requires `npm login`) to publish `v0.0.1` placeholders for any non-private workspace packages missing from the registry, then follow the printed instructions to configure each package's trusted publisher. After OIDC is configured, the normal tag-triggered pipeline takes over.

The CLI platform packages (`@agent-facets/cli-*`) are seeded by `scripts/release-cli/seed.ts` (`bun seed:cli`), not this script.
