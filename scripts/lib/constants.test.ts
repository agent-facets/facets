import { describe, expect, test } from 'bun:test'
import { CIRCLECI_PROJECT_SLUG, CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID } from './constants'

/**
 * Guardrail for CircleCI API trigger constants.
 *
 * This test imports the REAL exported constants (not a mock) and validates
 * their shape. Any future typo — including a stray character in a hand-copied
 * UUID — fails `bun check` locally before it can reach CI.
 *
 * Context: an earlier 10-character-first-segment typo in
 * CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID caused the release pipeline trigger
 * to 400 in production. No existing test exercised the raw constant, only
 * the mocked io helper, so the bad value passed check. Don't regress.
 */
describe('CircleCI constants', () => {
  test('CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID is a valid UUID (8-4-4-4-12)', () => {
    expect(CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  test('CIRCLECI_PROJECT_SLUG matches the gh/<org>/<repo> format', () => {
    expect(CIRCLECI_PROJECT_SLUG).toMatch(/^gh\/[\w-]+\/[\w-]+$/)
  })
})
