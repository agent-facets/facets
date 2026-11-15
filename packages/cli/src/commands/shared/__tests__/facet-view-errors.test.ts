import { describe, expect, test } from 'bun:test'
import type { LoadFacetViewFailure } from '@agent-facets/engine'
import { facetViewError } from '../facet-view-errors.ts'

describe('facetViewError', () => {
  test('an unreadable facets.json is not reported as malformed', () => {
    const failure = {
      code: 'project-manifest',
      result: { ok: false, reason: 'read', error: 'EACCES: permission denied, open facets.json' },
    } satisfies LoadFacetViewFailure
    expect(facetViewError('/project', 'cowsay', failure)).toEqual({
      what: 'facets.json could not be read',
      detail: 'EACCES: permission denied, open facets.json',
      fix: 'check that the file is readable, then try again',
    })
  })
})

describe('facetViewError — terminal safety', () => {
  test('a malformed facets.json detail is escaped before it reaches the terminal', () => {
    const failure = {
      code: 'project-manifest',
      result: {
        ok: false,
        reason: 'invalid',
        failure: {
          code: 'duplicate-members',
          errors: [
            {
              path: 'facets',
              message: 'duplicate member "evil\u001b]8;;x\u0007"',
              expected: 'unique',
              actual: 'duplicate',
            },
          ],
        },
      },
    } satisfies LoadFacetViewFailure
    const error = facetViewError('/project', 'cowsay', failure)
    expect(error.what).toBe('facets.json is malformed')
    expect(error.detail).not.toContain('\u001b')
    expect(error.detail).toContain('evil^[]8;;x^G')
  })

  test('an unreadable facets.lock detail is escaped', () => {
    const failure = { code: 'lockfile-unreadable', error: 'bad\u001b[2Jlock' } satisfies LoadFacetViewFailure
    expect(facetViewError('/project', 'cowsay', failure).detail).toBe('bad^[[2Jlock')
  })
})
