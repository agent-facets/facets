---
title: Release Pipeline
description: End-to-end flow from PR merge to npm publish, GitHub Release, and notifications.
---

## Overview

Releases are fully automated. Merging a PR with changesets triggers a pipeline that bumps versions, publishes packages to npm, creates GitHub Releases, and sends notifications. No manual steps are required.

## Flow

<Steps>
  <Step title="Changesets consumed">
    When a PR with pending changesets merges to `main`, the `main-pipeline` CI job runs `changeset version`. This consumes all pending changesets, bumps package versions in `package.json`, and updates `CHANGELOG.md` files.
  </Step>
  <Step title="Version PR opened">
    CI opens (or updates) a version PR titled **"ci(release): version packages"** targeting `main`. The PR body lists each package being bumped with its changelog entry. If a version PR already exists, it is updated in place.
  </Step>
  <Step title="Version PR merged">
    A maintainer reviews and merges the version PR. CI detects the merge, compares each package version against what is published on npm, and creates a git tag for each package that has an unpublished version (e.g. `@agent-facets/core@0.3.0` or `agent-facets@1.0.0`).
  </Step>
  <Step title="Release pipeline triggered per tag">
    After pushing tags, the `tag.ts` script also calls CircleCI's API v2 `pipeline/run` endpoint once per tag to explicitly trigger the release pipeline. We do not rely on GitHub-to-CircleCI tag-push webhooks because they are unreliable when the bot GitHub App pushes tags — CircleCI appears to filter events from other bot actors. The pipeline's workflow filters (tag regex in `.circleci/release.yml`) still apply, so scoped tags (`@agent-facets/*@*`) run the `release` workflow and unscoped tags (`agent-facets@*`) run `release-cli`.
  </Step>
  <Step title="Publish to npm">
    The publish path depends on the package type:

    - **Library packages** (`@agent-facets/core`, `@agent-facets/brand`): build via turbo, then publish directly to `latest`.
    - **CLI** (`agent-facets`): uses a three-stage matrix workflow — see below.
  </Step>
  <Step title="Announce">
    After publishing, CI creates a GitHub Release with the changelog entry and sends a notification.
  </Step>
</Steps>

## CLI Publishing

The CLI publishes 13 packages (12 platform binaries + 1 CLI package) directly to `latest` using ordering as the safety mechanism:

<Steps>
  <Step title="Build">
    Cross-compile binaries for all 12 platform targets using `bun build --compile --target`. Build output is persisted to workspace.
  </Step>
  <Step title="Publish platform binaries">
    Each of the 12 platform packages publishes to `latest` in its own CI executor via a matrix job. This avoids OOM from concurrent publishes. Each job mints its own OIDC token.
  </Step>
  <Step title="Verify platform binaries">
    Poll the npm registry until all 12 platform packages are visible at the new version. Retries with exponential backoff.
  </Step>
  <Step title="Publish CLI package">
    Synthesize the `agent-facets` package (with `optionalDependencies` pointing to all 12 platform packages) and publish to `latest`. This is the package users install — it only appears on `latest` after all its dependencies are confirmed available.
  </Step>
  <Step title="Verify all 13 packages">
    Confirm all 13 packages (12 platform + CLI) are visible at the new version.
  </Step>
</Steps>

The CLI package is always last. Users cannot install the new version until this step succeeds, because `npm install agent-facets` resolves the CLI package first, which then pulls platform binaries via `optionalDependencies`. If any platform binary failed to publish, the CLI package never publishes, so users on the previous version are unaffected.

## Adding changesets on behalf of contributors

The [changeset bot](https://github.com/apps/changeset-bot) comments on every PR indicating whether a changeset is present. If a contributor doesn't add one, the bot's comment includes a link to create one in the browser — pre-filled with the correct filename. Write the summary, select the bump type, and commit directly to the PR branch.

## Troubleshooting

### Tags pushed but no release pipeline runs

**Symptom**: A version PR merges, tags appear on GitHub, but no `release` or `release-cli` pipeline shows up in CircleCI.

**Background**: The release pipeline is triggered via CircleCI's API v2 `pipeline/run` endpoint, not via GitHub webhooks. `scripts/release/tag.ts` calls the API explicitly after pushing tags. If the API call fails, `tag.ts` throws and the `main-pipeline` job fails with a Slack notification — so a silent "no pipeline ran" failure usually means the trigger call never executed (tag push failed, or the job was cancelled before reaching the trigger step).

**Fix**:

1. Check the `main-pipeline` job log for the most recent version PR merge. Look for `Triggering CircleCI release pipeline for <tag>` lines and their `→ pipeline #N` responses.
2. If those log lines are missing, the job died before tagging completed. Fix the underlying failure and re-run the job from main.
3. If those log lines show errors (401/404 from the CircleCI API), see the CIRCLECI_API_TOKEN section below.

To manually trigger a release pipeline for a tag that's already pushed, POST to the API directly:

```bash
for tag in \
  '@agent-facets/core@0.4.0' \
  'agent-facets@0.5.0' \
  ; do
  curl -X POST \
    "https://circleci.com/api/v2/project/gh/agent-facets/facets/pipeline/run" \
    -H "Circle-Token: $CIRCLECI_API_TOKEN" \
    -H "content-type: application/json" \
    --data "{\"definition_id\":\"9d2f5823-f2c9-4cba-918a-e7d0dc2f658a\",\"config\":{\"tag\":\"$tag\"},\"checkout\":{\"tag\":\"$tag\"}}"
done
```

The idempotency checks in `scripts/release/publish.ts`, `publish-platform.ts`, and `publish-cli-package.ts` mean re-triggering for an already-published version will skip the npm publish and only re-run the GitHub Release + notification steps.

### CircleCI trigger API returns 401 or 404

**Symptom**: `tag.ts` fails with `CircleCI pipeline trigger failed for tag <tag>: 401` or `404`.

**Cause**:

- **401** — `CIRCLECI_API_TOKEN` is missing, revoked, or belongs to a user without write access to the project.
- **404** — `CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID` is stale. If the release pipeline definition was recreated in the CircleCI UI, the UUID in `scripts/lib/constants.ts` needs updating.

**Fix**:

- For 401: rotate the `CIRCLECI_API_TOKEN` in the `bot-context` CircleCI context. Mint a new token at CircleCI → User Settings → Personal API Tokens.
- For 404: grab the current definition ID from CircleCI → Project Settings → Pipelines → copy Definition ID for the release pipeline, then update `CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID` in `scripts/lib/constants.ts`.

### `finalize-cli` fails with `Not Found - /app/installations/*/access_tokens`

**Symptom**: Platform packages publish successfully, but `finalize-cli` (or any job that calls `mintGithubTokens`) fails with an Octokit `HttpError: Not Found` pointing at `https://api.github.com/app/installations/*/access_tokens`.

**Cause**: `APP_INSTALLATION_ID` in the `bot-context` CircleCI context is stale. GitHub assigns a **new installation ID every time the bot GitHub App is reinstalled on an org**. The old ID in the context now returns 404.

**Fix**:

1. Find the current installation ID:

   ```bash
   gh api /orgs/agent-facets/installation --jq '.id'
   ```

   Or via UI: github.com/organizations/agent-facets/settings/installations → Configure on the bot app → the URL contains `.../installations/{ID}/...`.

2. Update `APP_INSTALLATION_ID` in CircleCI → Organization Settings → Contexts → `bot-context`.

3. Manually trigger any stuck release pipelines using the curl snippet in the "Tags pushed but no release pipeline runs" section above.

The `mintGitHubAppToken` helper (`scripts/lib/github-app.ts`) detects 404s and surfaces this exact runbook in its error message, so this diagnosis should appear in future job logs without needing to consult these docs.

### `finalize-cli` fails with `Unauthorized - /app/installations/*/access_tokens`

**Symptom**: As above but with HTTP 401 instead of 404.

**Cause**: `APP_ID` or `APP_PRIVATE_KEY_BASE64` in `bot-context` does not match the installed GitHub App. This usually happens when the bot app was rotated or replaced.

**Fix**: Update both values from the GitHub App's settings page (App ID on the page itself, Private Key downloaded and base64-encoded into the env var).

### Release pipeline ran but only some packages published

**Symptom**: Mixed state — some packages at the new version on npm, others still at the old version. Usually happens when `finalize-cli` fails partway through.

**Fix**: Re-push the tag. The idempotency checks in `publish-platform.ts`, `publish-cli-package.ts`, and `publish.ts` all guard against double-publishing — each will skip packages already at the target version and only publish what's missing.
