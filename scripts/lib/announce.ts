/**
 * Release announcement and notification logic.
 *
 * Contains announceRelease (GitHub Release + Slack) and slackNotify
 * (Slack API message sending). All side effects go through io.ts.
 */

import { getChangelogEntry } from '@changesets/release-utils'
import { transformChangelogContent } from './changesets'
import { SLACK_CHANNELS } from './constants'
import { io } from './io'

/**
 * Send a message to one or more Slack channels (comma-separated).
 *
 * Best-effort — logs errors but does not throw. Requires SLACK_ACCESS_TOKEN
 * or SLACK_BOT_TOKEN in the environment.
 */
export async function slackNotify(channels: string, text: string): Promise<void> {
  const token = process.env.SLACK_ACCESS_TOKEN ?? process.env.SLACK_BOT_TOKEN ?? ''
  if (!token) {
    console.error('No Slack token found (SLACK_ACCESS_TOKEN or SLACK_BOT_TOKEN). Skipping notification.')
    return
  }
  for (const channel of channels.split(',').map((c) => c.trim())) {
    const body = (await io.httpPost(
      'https://slack.com/api/chat.postMessage',
      { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      { channel, text },
    )) as { ok: boolean; error?: string }
    if (!body.ok) {
      console.error(`Slack API error for channel ${channel}: ${body.error}`)
    }
  }
}

/** Create a GitHub Release and send a notification. Non-fatal — failures are logged but don't fail the release. */
export async function announceRelease(tag: string, dir: string, version: string): Promise<void> {
  try {
    const changelog = await io.readFile(`${dir}/CHANGELOG.md`)
    const entry = getChangelogEntry(changelog, version)
    const url = (await io.ghReleaseCreate(tag, tag, transformChangelogContent(entry.content))).trim()
    io.log(`Created GitHub Release: ${url}`)

    try {
      await slackNotify(SLACK_CHANNELS.auto_cli_deploys, `🚀 Published: <${url}|${tag}>`)
    } catch (err) {
      io.error(`Failed to send Slack notification: ${(err as Error).message}`)
    }
  } catch (err) {
    io.error(`Failed to create GitHub Release for ${tag}: ${(err as Error).message}`)
  }
}
