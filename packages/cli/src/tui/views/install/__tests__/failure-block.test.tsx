import { describe, expect, test } from 'bun:test'
import type { McpServerCapabilityFailure } from '@agent-facets/adapter'
import type { RunInstallResult } from '@agent-facets/engine'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { visibleTerminalText } from '../../../../__tests__/helpers/terminal-output.ts'
import { FailureBlock } from '../failure-block.tsx'

/**
 * The rendered half of an MCP failure.
 *
 * The stderr `fix:` line and this block are two views of one condition, so the
 * assertions here mirror `install-failure.test.ts`: each conflict reason says
 * its own thing, and a declaration value cannot draw anything of its own.
 */

function frameFor(failure: McpServerCapabilityFailure, code: 'MCP_PREPARE_FAILED' | 'MCP_APPLY_FAILED'): string {
  const result = {
    ok: false,
    failure: { code, adapter: 'opencode', failure },
    rollback: { kind: 'not-needed', reason: 'post-lock-no-mutation' },
  } as Extract<RunInstallResult, { ok: false }>

  const instance = render(createElement(FailureBlock, { result }))
  const text = visibleTerminalText(instance.lastFrame() ?? '')
  instance.unmount()
  return text
}

const INTERPOLATION: McpServerCapabilityFailure = {
  code: 'conflict',
  reason: 'interpolation',
  serverName: 'fs',
  value: '{env:TOKEN}',
}

describe('FailureBlock — MCP conflict reasons', () => {
  test('an interpolated literal shows the server, the value, and no document', () => {
    const text = frameFor(INTERPOLATION, 'MCP_PREPARE_FAILED')

    expect(text).toContain('opencode could not plan its MCP configuration')
    expect(text).toContain('"fs"')
    expect(text).toContain('"{env:TOKEN}"')
    expect(text).toContain('substitute')
    expect(text).not.toContain('opencode.jsonc')
  })

  test('a native-state conflict reports the adapter’s own detail once', () => {
    const text = frameFor(
      { code: 'conflict', reason: 'native-state', path: '/p/config.toml', detail: 'cannot patch an inline table' },
      'MCP_APPLY_FAILED',
    )

    expect(text).toContain('/p/config.toml')
    expect(text).toContain('cannot patch an inline table')
  })

  test('a hostile value cannot add a line or reach the terminal', () => {
    const clean = frameFor(INTERPOLATION, 'MCP_PREPARE_FAILED')
    const hostile = frameFor(
      { code: 'conflict', reason: 'interpolation', serverName: 'fs', value: '\u001b[2K\nforged heading' },
      'MCP_PREPARE_FAILED',
    )

    expect(hostile).not.toContain('\u001b[2K')
    expect(hostile.split('\n')).toHaveLength(clean.split('\n').length)
    expect(hostile).toContain('\\u001b[2K\\nforged heading')
  })
})
