/**
 * Mints a short-lived GitHub installation token from a GitHub App.
 *
 * Requires these environment variables:
 * - APP_ID: The GitHub App's ID
 * - APP_PRIVATE_KEY_BASE64: The App's private key, base64-encoded
 * - APP_INSTALLATION_ID: The installation ID for the target org
 */

import { createAppAuth } from '@octokit/auth-app'

/**
 * Error thrown when token minting fails in a way that is almost certainly a
 * CI configuration issue rather than a transient GitHub outage. The message is
 * written for a sleepy on-call engineer — it names the likely-broken env var
 * and points at the fix, so we don't re-derive the diagnosis every time.
 */
export class GitHubAppTokenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GitHubAppTokenError'
  }
}

export async function mintGitHubAppToken(): Promise<string> {
  const { APP_ID, APP_PRIVATE_KEY_BASE64, APP_INSTALLATION_ID } = process.env

  if (!APP_ID || !APP_PRIVATE_KEY_BASE64 || !APP_INSTALLATION_ID) {
    throw new GitHubAppTokenError(
      'Missing required env vars: APP_ID, APP_PRIVATE_KEY_BASE64, APP_INSTALLATION_ID. ' +
        'These are provided by the `bot-context` CircleCI context.',
    )
  }

  const privateKey = Buffer.from(APP_PRIVATE_KEY_BASE64, 'base64').toString('utf-8')

  const auth = createAppAuth({
    appId: APP_ID,
    privateKey,
    installationId: Number(APP_INSTALLATION_ID),
  })

  try {
    const { token } = await auth({ type: 'installation' })
    return token
  } catch (err) {
    throw diagnoseAuthError(err, APP_INSTALLATION_ID)
  }
}

/**
 * Translates an Octokit auth error into a human-readable diagnosis.
 *
 * The most common failure mode is a 404 on the installation access-tokens
 * endpoint, which means APP_INSTALLATION_ID is stale — typically because the
 * GitHub App was reinstalled on the org (GitHub assigns a new installation ID
 * on every install). The stacktrace from Octokit buries this in an opaque
 * HttpError; we surface it with a recovery runbook.
 */
function diagnoseAuthError(err: unknown, installationId: string): GitHubAppTokenError {
  const status =
    typeof err === 'object' && err !== null && 'status' in err ? (err as { status: unknown }).status : undefined

  if (status === 404) {
    return new GitHubAppTokenError(
      [
        `GitHub rejected installation ID ${installationId} with 404 Not Found.`,
        'This usually means APP_INSTALLATION_ID is stale — GitHub assigns a new',
        'installation ID each time the app is reinstalled on an org.',
        'To fix: run "gh api /orgs/<org>/installation --jq .id" to get the',
        'current ID, then update APP_INSTALLATION_ID in the bot-context',
        'CircleCI context. See docs/contributing/release-pipeline.mdx for details.',
      ].join(' '),
      { cause: err },
    )
  }

  if (status === 401) {
    return new GitHubAppTokenError(
      [
        'GitHub rejected the App credentials with 401 Unauthorized.',
        'APP_ID and/or APP_PRIVATE_KEY_BASE64 are likely stale or mismatched.',
        'Verify both values in the bot-context CircleCI context match the',
        'currently-installed GitHub App. See docs/contributing/release-pipeline.mdx for details.',
      ].join(' '),
      { cause: err },
    )
  }

  const underlying = err instanceof Error ? err.message : String(err)
  return new GitHubAppTokenError(`Failed to mint GitHub App installation token: ${underlying}`, { cause: err })
}
