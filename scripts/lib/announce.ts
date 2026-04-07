/**
 * Shared release announcement logic — GitHub Release + Slack notification.
 *
 * Extracted from ci-release.ts and ci-release-finalize.ts to avoid duplication.
 */

import { getChangelogEntry } from '@changesets/release-utils'
import { transformChangelogContent } from './changesets'
import { io } from './ci-io'
import { SLACK_CHANNELS } from './constants'

/** Create a GitHub Release and send a notification. Non-fatal — failures are logged but don't fail the release. */
export async function announceRelease(tag: string, dir: string, version: string): Promise<void> {
  try {
    const changelog = await io.readFile(`${dir}/CHANGELOG.md`)
    const entry = getChangelogEntry(changelog, version)
    const url = (await io.ghReleaseCreate(tag, tag, transformChangelogContent(entry.content))).trim()
    io.log(`Created GitHub Release: ${url}`)

    try {
      await io.slackNotify(SLACK_CHANNELS.auto_cli_deploys, `🚀 Published: <${url}|${tag}>`)
    } catch (err) {
      io.error(`Failed to send Slack notification: ${(err as Error).message}`)
    }
  } catch (err) {
    io.error(`Failed to create GitHub Release for ${tag}: ${(err as Error).message}`)
  }
}
