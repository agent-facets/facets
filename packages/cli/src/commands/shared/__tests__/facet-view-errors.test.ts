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
