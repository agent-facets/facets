import { describe, expect, test } from 'bun:test'
import { describeNoOp } from '../selection.ts'

// Classification lives in the engine and is tested there. What is the
// CLI's is the sentence each verdict becomes — in particular which of
// them points at a flag, since a flag is a thing only a terminal has.
describe('describeNoOp', () => {
  test('a project with no registry facets says why nothing was checked', () => {
    expect(describeNoOp({ reason: 'no-registry-facets' })).toContain('No registry facets')
  })

  test('everything current says so plainly', () => {
    expect(describeNoOp({ reason: 'all-current' })).toContain('current')
  })

  test('a blocked range names --latest as the way past it', () => {
    expect(describeNoOp({ reason: 'ranges-permit-none' })).toContain('facet update --latest')
  })

  test('latest mode with nothing newer suggests nothing', () => {
    expect(describeNoOp({ reason: 'latest-permits-none' })).not.toContain('--latest')
  })
})
