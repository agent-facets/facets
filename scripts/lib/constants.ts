/**
 * CI pipeline configuration constants.
 *
 * Single source of truth for branch names, PR templates,
 * bot identity, notification channels, and CLI paths used
 * across the changeset and release scripts.
 */

import path from 'node:path'

/** Slack channel directory — keyed by channel name. */
export const SLACK_CHANNELS = {
  auto_cli_deploys: 'C0AQVA6UB38',
  on_call: 'C0AQFU5S4PR',
} as const

/** Git identity used by CI commits (the-faceter GitHub App). */
export const GIT_BOT = {
  name: 'the-faceter[bot]',
  email: '272408671+the-faceter[bot]@users.noreply.github.com',
} as const

/** GitHub repository slug (owner/repo). */
export const GITHUB_REPO = 'agent-facets/facets'

/** Branch that changeset version PRs are pushed to. */
export const CHANGESET_RELEASE_BRANCH = 'changeset-release/main'

/** Title for the auto-generated version PR and its commit message. */
export const CHANGESET_PR_TITLE = 'ci(release): version packages'

/** Commit message used when versioning packages. */
export const CHANGESET_COMMIT_MESSAGE = 'ci(release): version packages'

/** The npm package name for the CLI package that users install directly. */
export const CLI_PACKAGE_NAME = 'agent-facets'

/** Root directory of the CLI package. */
export const CLI_DIR = path.resolve(import.meta.dir, '..', '..', 'packages', 'cli')

/** Build output directory for CLI binaries. */
export const DIST_DIR = path.join(CLI_DIR, 'dist')

/** Dist-tag used when publishing CLI packages to npm. */
export const PUBLISH_TAG = 'latest'

/** CircleCI project slug for triggering pipelines via API v2. */
export const CIRCLECI_PROJECT_SLUG = 'gh/agent-facets/facets'

/** CircleCI pipeline definition ID for the release pipeline (.circleci/release.yml). */
export const CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID = '229d2f5823-f2c9-4cba-918a-e7d0dc2f658a'
