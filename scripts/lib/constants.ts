/**
 * CI pipeline configuration constants.
 *
 * Single source of truth for branch names, PR templates,
 * bot identity, and notification channels used across
 * the changeset and release scripts.
 */

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

/** Branch that changeset version PRs are pushed to. */
export const CHANGESET_RELEASE_BRANCH = 'changeset-release/main'

/** Title for the auto-generated version PR and its commit message. */
export const CHANGESET_PR_TITLE = 'ci(release): version packages'

/** Commit message used when versioning packages. */
export const CHANGESET_COMMIT_MESSAGE = 'ci(release): version packages'
