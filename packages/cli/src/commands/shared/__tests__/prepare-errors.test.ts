import { describe, expect, test } from 'bun:test'
import { addPrepareCliError } from '../../add/index.ts'
import { removePrepareCliError } from '../../remove/index.ts'

/**
 * The stderr half of unsupported-manifest reporting.
 *
 * `add` and `remove` previously described this as a malformed manifest and
 * told the user to fix or delete the file — the opposite of the remedy, since
 * the file is fine and the CLI is behind it. Both commands now route through
 * the same shared translation.
 */

const detail = { path: '/tmp/p/facets.json', observed: 0.9, supported: [0.1] as const }

describe('unsupported manifestVersion on stderr', () => {
  test.each([
    ['add', addPrepareCliError],
    ['remove', removePrepareCliError],
  ])('%s tells the user to upgrade rather than edit the manifest', (_command, translate) => {
    const error = translate({ reason: 'manifest-unsupported-version', ...detail })

    expect(error.fix).toContain('upgrade')
    expect(error.fix).not.toContain('delete')
    expect(error.detail).toContain('0.9')
    expect(error.detail).toContain('0.1')
    expect(error.detail).toContain(detail.path)
  })

  test('a non-numeric version is described rather than invented', () => {
    const error = addPrepareCliError({
      reason: 'manifest-unsupported-version',
      path: detail.path,
      observed: undefined,
      supported: detail.supported,
    })
    expect(error.detail).toContain('non-numeric')
  })

  // The distinction the shared translation exists to preserve.
  test('a genuinely unreadable manifest still says to fix the file', () => {
    const error = addPrepareCliError({ reason: 'manifest-read', error: 'facets.json is malformed JSON' })
    expect(error.fix).toContain('fix or delete')
  })
})
