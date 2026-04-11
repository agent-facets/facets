#!/usr/bin/env bun

/**
 * Send a failure notification to Slack.
 *
 * Intended to run as a `when: on_fail` step in CircleCI jobs.
 * Uses CIRCLE_BUILD_URL, CIRCLE_JOB, and CIRCLE_TAG env vars
 * to construct a contextual failure message with a link to the build.
 */

import { slackNotify } from './announce'
import { SLACK_CHANNELS } from './constants'

const buildUrl = process.env.CIRCLE_BUILD_URL ?? ''
const job = process.env.CIRCLE_JOB ?? 'unknown'
const tag = process.env.CIRCLE_TAG

const channels = `${SLACK_CHANNELS.auto_cli_deploys},${SLACK_CHANNELS.on_call}`

const message = tag ? `❌ Release failed: <${buildUrl}|${tag}>` : `❌ CI failed on main: <${buildUrl}|${job}>`

try {
  await slackNotify(channels, message)
} catch (err) {
  // Best-effort — don't fail the build further if notification fails
  console.error(`Failed to send failure notification: ${(err as Error).message}`)
}
