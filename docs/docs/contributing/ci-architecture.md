---
title: CI Architecture
description: CircleCI workflow structure, job definitions, and configuration management.
---

## Workflows

CI runs on [CircleCI](https://circleci.com) with three workflows across two separate config files.

| Config                      | Trigger | Workflows                 |
|-----------------------------|---------|---------------------------|
| `.circleci/development.yml` | Pushes  | `ci`                      |
| `.circleci/release.yml`     | Tags    | `release` + `release-cli` |

| Workflow      | Trigger Filter              | Purpose                                                             |
|---------------|-----------------------------|---------------------------------------------------------------------|
| `ci`          | Any branch including `main` | Lint, typecheck, test (PRs); plus changesets and tag-release (main) |
| `release`     | Tags: `@agent-facets/*@*`   | Library package publish to npm                                      |
| `release-cli` | Tags: `agent-facets@*`      | CLI matrix publish to npm                                           |

## CI workflow

The `ci` workflow has two jobs that run on different branches, `check` and `main-pipeline`.

### `check` (PR branches)

Runs on every push to branches **except** `main`. We use [Turborepo](https://turborepo.dev/) for caching and incremental builds.

<Steps>
  <Step>Load artifacts from remote cache</Step>
  <Step>Validate via `bun check` with remote caching</Step>
  <Step>Save artifacts to remote turbo cache</Step>
</Steps>

### `main-pipeline` (main only)

Runs on pushes to `main` only. Executes three steps sequentially in a single job:

<Steps>
  <Step title="Check">
    Run `bun check` with caching (same as PR branches)
  </Step>
  <Step title="Changesets">
    `bun scripts/release/version.ts` (consume changesets, open/update version PR)
  </Step>
  <Step title="Tag Release">
    `bun scripts/release/tag.ts` (create version tags for unpublished packages)
  </Step>
  <Step>Sends maintainer notification on failure</Step>
</Steps>

## Release workflows

Triggered explicitly via CircleCI API v2 by `scripts/release/tag.ts` after pushing tags (see [Release Pipeline](./release-pipeline#flow) for why we don't rely on tag-push webhooks). The tag pattern determines which workflow within the release pipeline runs.

### `release` (library packages)

Triggered by scoped tags matching `@agent-facets/*@<version>`. Each tag publishes one library package.

<Steps>
  <Step>Parses the package name and version from the tag</Step>
  <Step>Skips private packages</Step>
  <Step>Builds via turbo</Step>
  <Step>Publishes the package to npm</Step>
  <Step>Creates a GitHub Release</Step>
  <Step>Sends maintainer notification</Step>
</Steps>


### `release-cli` (CLI)

Triggered by unscoped tags matching `agent-facets@<version>`. Uses a three-stage matrix pipeline.

<Steps>
  <Step title="Build CLI">
    Cross-compiles all 12 platform binaries, persists build output to workspace
  </Step>
  <Step title={<span>Publish Platform Packages <Badge color="purple" size="sm" icon="badge-info">12 total</Badge></span>}>
    Each matrix instance publishes one platform binary directly to `latest` in its own executor
  </Step>
  <Step title="Finalize CLI">
    <Steps>
      <Step>Publishes the CLI package to `latest`</Step>
      <Step>Verifies all 13 packages are visible on npm</Step>
      <Step>Creates a GitHub Release</Step>
      <Step>Sends maintainer notification</Step>
    </Steps>
  </Step>
</Steps>

Both workflows send failure notifications via the `notify-failure` reusable command.

## Notifications

1. **Failure notifications** – any **release** workflow failure notifies maintainers
2. **Success notifications** – when any package successfully publishes to npm

## Contexts

CircleCI contexts provide environment variables to jobs.

| Context         | Variables                                                             | Used by                                    |
|-----------------|-----------------------------------------------------------------------|--------------------------------------------|
| `turbo-cache`   | `TURBO_API`, `TURBO_TOKEN` (`TURBO_TEAM` lives in `mise.toml`)        | `check`, `main-pipeline`, all release jobs |
| `bot-context`   | npm OIDC config, GitHub app credentials, CircleCI API token           | `main-pipeline`, all release jobs          |
| `slack-secrets` | Notification webhook credentials                                      | `main-pipeline`, all release jobs          |

`turbo-cache` provides the consumer-side credentials for the self-hosted Turborepo remote cache. The cache server itself is deployed from the sibling `facet-cafe` repo at `infra/turbo-cache.ts`  -- an SST AWS Lambda backed by an S3 bucket, fronted by a CloudFront router. The current production URL is `https://turbo-cache.facet.cafe` (the `main` SST stage); the bearer token is held in 1Password and mirrored into both the `turbo-cache` CircleCI context (as `TURBO_TOKEN`) and the AWS-side `TurboToken` SST secret. To verify the cache is healthy, `curl https://turbo-cache.facet.cafe/v8/artifacts/status` should return `{"status":"enabled",...}`.

`bot-context` includes `CIRCLECI_API_TOKEN` (a personal API token with write access to the project), which `scripts/release/tag.ts` uses to explicitly trigger release pipelines via the [CircleCI v2 API](https://circleci.com/docs/api/v2/index.html#operation/triggerPipelineRun). See [Release Pipeline troubleshooting](./release-pipeline#circleci-trigger-api-returns-401-or-404) for rotation steps.

## Config source structure

CircleCI configs are authored as modular YAML files under source directories. Running `bun ci:pack` will compile them into single files for CircleCI to consume.

<Tree>
  <Tree.Folder name=".circleci" defaultOpen>
    <Tree.Folder name={<>development <Badge color='purple' size='xs'>CI</Badge></>} defaultOpen>
      <Tree.Folder name="commands" />
      <Tree.Folder name="jobs" />
      <Tree.Folder name="workflows" />
      <Tree.File name='@config.yml' />
    </Tree.Folder>
    <Tree.Folder name={<>release <Badge color='purple' size='xs'>CD</Badge></>} defaultOpen>
      <Tree.Folder name={<>commands <Badge color='purple' size='xs'>contents are symlinks to ../development/commands/*</Badge></>} />
      <Tree.Folder name="jobs" />
      <Tree.Folder name="workflows" />
      <Tree.File name='@config.yml' />
    </Tree.Folder>
    <Tree.File name={<>development.yml <Badge color='purple' size='xs'>packed CI config (generated)</Badge></>} />
    <Tree.File name={<>release.yml <Badge color='purple' size='xs'>packed CD config (generated)</Badge></>} />
  </Tree.Folder>
</Tree>

<Note>
  **Commands in `release/commands/` are symlinks to `development/commands/`**

  This is because the CircleCI config pack tool does not support imports or other forms of code sharing.
</Note>

## Modifying CI

<Steps>
  <Step title="Edit source files">
    Edit files under `.circleci/development/` or `.circleci/release/`.
  </Step>
  <Step title="Regenerate packed configs">
    ```sh
    bun run ci:pack
    ```
    This runs `circleci config pack` on both source directories.
  </Step>
  <Step title="Commit & Verify">
    Commit the changes and verify that the CircleCI config works in your PR
  </Step>
</Steps>
