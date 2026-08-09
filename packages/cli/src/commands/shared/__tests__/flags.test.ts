import { describe, expect, test } from 'bun:test'
import type { McpConsentRequest } from '@agent-facets/engine'
import { addCommand } from '../../add/index.ts'
import { installCommand } from '../../install/index.ts'
import { removeCommand } from '../../remove/index.ts'
import { ACCEPT_MCP_FLAG, INSTALL_PIPELINE_FLAGS, mcpConsentPolicy } from '../flags.ts'

const PIPELINE_COMMANDS = [
  ['add', addCommand],
  ['install', installCommand],
  ['remove', removeCommand],
] as const

describe('--accept-mcp is exposed by every install-pipeline command', () => {
  test.each(PIPELINE_COMMANDS)('%s declares it', (_name, command) => {
    expect(command.flags?.[ACCEPT_MCP_FLAG]).toBeDefined()
  })

  // Identity, not equality: three flag records that merely happen to contain
  // the same words are three things to keep in sync. Help output is rendered
  // straight from these, so a drifted description is a user-visible
  // inconsistency about what the flag authorizes.
  test.each(PIPELINE_COMMANDS)('%s uses the shared definition', (_name, command) => {
    expect(command.flags?.[ACCEPT_MCP_FLAG]).toBe(INSTALL_PIPELINE_FLAGS[ACCEPT_MCP_FLAG])
  })

  // The one command where this is easy to forget: a removal that has to
  // resolve the facets it keeps re-enters the same consent path as an
  // install, so without the flag it has no non-interactive completion.
  test('remove exposes it through its alias too', () => {
    expect(removeCommand.aliases).toContain('rm')
    expect(removeCommand.flags?.[ACCEPT_MCP_FLAG]).toBeDefined()
  })

  test('install keeps its own frozen flag alongside the shared ones', () => {
    expect(installCommand.flags?.['frozen-lockfile']).toBeDefined()
    expect(installCommand.flags?.verbose).toBe(INSTALL_PIPELINE_FLAGS.verbose)
  })
})

describe('mcpConsentPolicy', () => {
  const resolve = async (_request: McpConsentRequest) => ({ kind: 'approved' }) as const

  test('no flag and no terminal cannot answer', () => {
    expect(mcpConsentPolicy({ acceptMcp: false, mayPrompt: false, resolve })).toEqual({ kind: 'unavailable' })
  })

  test('a terminal prompts', () => {
    expect(mcpConsentPolicy({ acceptMcp: false, mayPrompt: true, resolve })).toEqual({
      kind: 'interactive',
      resolve,
    })
  })

  test('the flag pre-approves without a terminal', () => {
    expect(mcpConsentPolicy({ acceptMcp: true, mayPrompt: false, resolve })).toEqual({ kind: 'preapproved' })
  })

  // The flag outranks the prompt. Otherwise passing it on a TTY would still
  // open the screen, which makes the flag mean nothing exactly where a user
  // is most likely to try it first.
  test('the flag outranks an available prompt', () => {
    expect(mcpConsentPolicy({ acceptMcp: true, mayPrompt: true, resolve })).toEqual({ kind: 'preapproved' })
  })

  // Frozen mode reaches here with `mayPrompt: false`, so the only arm it can
  // produce is `preapproved` — it may USE an approval supplied up front and
  // can never COLLECT one.
  test('frozen with the flag is pre-approved, and without it cannot answer', () => {
    expect(mcpConsentPolicy({ acceptMcp: true, mayPrompt: false, resolve })).toEqual({ kind: 'preapproved' })
    expect(mcpConsentPolicy({ acceptMcp: false, mayPrompt: false, resolve })).toEqual({ kind: 'unavailable' })
  })
})
