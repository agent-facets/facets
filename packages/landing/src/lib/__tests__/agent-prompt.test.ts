/**
 * Sanity check on the agent prompt asset.
 *
 * Why this test exists: the AgentPromptButton copies a short pointer
 * to the clipboard that tells the agent to fetch
 * https://agentfacets.io/agent-prompt.txt. That URL is served by the
 * static-site upload of `packages/landing/public/agent-prompt.txt`.
 * If the .txt file is accidentally deleted or moved, the button's
 * pointer points at a 404 and the whole UX is broken.
 *
 * We don't snapshot the content (the prompt iterates) — we just
 * assert the file exists, is non-empty, and starts with a recognizable
 * header so a casual rename or truncation is caught.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_PROMPT_POINTER, AGENT_PROMPT_URL } from '../agent-prompt'

const PROMPT_FILE = join(import.meta.dir, '..', '..', '..', 'public', 'agent-prompt.txt')

describe('agent-prompt.txt asset', () => {
  test('exists at packages/landing/public/agent-prompt.txt', () => {
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

describe('agent-prompt pointer constants', () => {
  test('AGENT_PROMPT_URL is the apex URL', () => {
    expect(AGENT_PROMPT_URL).toBe('https://agentfacets.io/agent-prompt.txt')
  })

  test('AGENT_PROMPT_POINTER references the URL exactly once', () => {
    expect(AGENT_PROMPT_POINTER).toContain(AGENT_PROMPT_URL)
    // Guard against accidental duplication of the URL in the pointer.
    const occurrences = AGENT_PROMPT_POINTER.split(AGENT_PROMPT_URL).length - 1
    expect(occurrences).toBe(1)
  })
})
