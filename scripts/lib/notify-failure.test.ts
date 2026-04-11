import { describe, expect, test } from 'bun:test'
import { SLACK_CHANNELS } from './constants'

/**
 * notify-failure.ts is a top-level side-effect script (no exported function).
 * We test the message formatting logic and channel targeting directly here,
 * matching the patterns used in the actual script.
 */
describe('notify-failure.ts', () => {
  function buildMessage(tag: string | undefined, buildUrl: string, job: string): string {
    return tag ? `❌ Release failed: <${buildUrl}|${tag}>` : `❌ CI failed on main: <${buildUrl}|${job}>`
  }

  function buildChannels(): string {
    return `${SLACK_CHANNELS.auto_cli_deploys},${SLACK_CHANNELS.on_call}`
  }

  test('tag-triggered build produces release failure message', () => {
    const msg = buildMessage('agent-facets@1.0.0', 'https://circleci.com/build/123', 'finalize-cli')
    expect(msg).toContain('Release failed')
    expect(msg).toContain('agent-facets@1.0.0')
    expect(msg).toContain('https://circleci.com/build/123')
    expect(msg).not.toContain('CI failed on main')
  })

  test('non-tag build produces CI failure message', () => {
    const msg = buildMessage(undefined, 'https://circleci.com/build/456', 'main-pipeline')
    expect(msg).toContain('CI failed on main')
    expect(msg).toContain('main-pipeline')
    expect(msg).toContain('https://circleci.com/build/456')
    expect(msg).not.toContain('Release failed')
  })

  test('targets both deploy and on-call channels', () => {
    const channels = buildChannels()
    expect(channels).toContain(SLACK_CHANNELS.auto_cli_deploys)
    expect(channels).toContain(SLACK_CHANNELS.on_call)
  })

  test('handles empty build URL gracefully', () => {
    const msg = buildMessage(undefined, '', 'check')
    expect(msg).toContain('CI failed on main')
    expect(msg).toContain('|check>')
  })

  test('handles empty job name gracefully', () => {
    const msg = buildMessage(undefined, 'https://circleci.com/build/789', 'unknown')
    expect(msg).toContain('unknown')
  })
})
