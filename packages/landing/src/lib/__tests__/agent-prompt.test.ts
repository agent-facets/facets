/**
 * Sanity check on the agent prompt asset.
 *
 * Why this test exists: the AgentPromptButton copies the FULL prompt
 * body to the clipboard. That body is inlined at build time via a
 * `?raw` import of `packages/landing/public/agent-prompt.txt`, and the
 * same file is also served at https://agentfacets.io/agent-prompt.txt by
 * the static-site upload. If the .txt file is accidentally deleted,
 * moved, or truncated, both the button and the hosted URL break.
 *
 * We don't snapshot the content (the prompt iterates) — we assert the
 * file exists, is non-empty, starts with a recognizable header, and
 * that the inlined `?raw` copy matches the file on disk byte-for-byte so
 * the button can never drift from the hosted prompt.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_PROMPT_BODY, AGENT_PROMPT_URL } from '../agent-prompt'

const PROMPT_FILE = join(import.meta.dir, '..', '..', 'agent-prompt.txt')

describe('agent-prompt.txt asset', () => {
  test('exists at packages/landing/src/agent-prompt.txt', () => {
    expect(existsSync(PROMPT_FILE)).toBe(true)
  })

  test('is non-empty', () => {
    const size = statSync(PROMPT_FILE).size
    expect(size).toBeGreaterThan(500)
  })

  test('starts with the recognizable header', () => {
    const body = readFileSync(PROMPT_FILE, 'utf8')
    // The header phrase is intentionally distinctive — if someone
    // edits the file and removes this opening sentence, the test
    // fails and forces a deliberate decision.
    expect(body.startsWith('You are helping a user install and use facets')).toBe(true)
  })
})

describe('inlined agent prompt body', () => {
  test('AGENT_PROMPT_URL is the apex URL', () => {
    expect(AGENT_PROMPT_URL).toBe('https://agentfacets.io/agent-prompt.txt')
  })

  test('AGENT_PROMPT_BODY matches the .txt file on disk byte-for-byte', () => {
    const onDisk = readFileSync(PROMPT_FILE, 'utf8')
    expect(AGENT_PROMPT_BODY).toBe(onDisk)
  })

  test('AGENT_PROMPT_BODY is the full prompt, not a pointer', () => {
    // The body is hundreds of lines; a pointer would be one sentence.
    // Guard against a regression that reverts to copying a URL.
    expect(AGENT_PROMPT_BODY.length).toBeGreaterThan(500)
    expect(AGENT_PROMPT_BODY.startsWith('You are helping a user install and use facets')).toBe(true)
  })
})
