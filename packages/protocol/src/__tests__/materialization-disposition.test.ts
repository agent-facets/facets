import { describe, expect, test } from 'bun:test'
import {
  cloneDisposition,
  isMaterialized,
  type MaterializationDisposition,
  MaterializationDispositionSchema,
  MaterializedDispositionSchema,
  materializedNameOf,
  ProjectAssetOverrideSchema,
} from '@agent-facets/protocol'
import { type } from 'arktype'

describe('MaterializationDispositionSchema — accepted arms', () => {
  test('an aliased disposition carrying an effective name is valid', () => {
    const result = MaterializationDispositionSchema({ kind: 'aliased', as: 'vendor-review' })
    expect(result).not.toBeInstanceOf(type.errors)
  })

  test('an omitted disposition without an effective name is valid', () => {
    expect(MaterializationDispositionSchema({ kind: 'omitted' })).not.toBeInstanceOf(type.errors)
  })

  test('an authored disposition without an effective name is valid', () => {
    expect(MaterializationDispositionSchema({ kind: 'authored' })).not.toBeInstanceOf(type.errors)
  })
})

describe('MaterializationDispositionSchema — illegal combinations', () => {
  test('an aliased disposition without an effective name is rejected', () => {
    expect(MaterializationDispositionSchema({ kind: 'aliased' })).toBeInstanceOf(type.errors)
  })

  // Arktype tolerates unrecognized keys by default, so these two cases would
  // silently validate and discard the alias without an explicit narrow.
  test('an authored disposition carrying an effective name is rejected', () => {
    expect(MaterializationDispositionSchema({ kind: 'authored', as: 'vendor-review' })).toBeInstanceOf(type.errors)
  })

  test('an omitted disposition carrying an effective name is rejected', () => {
    expect(MaterializationDispositionSchema({ kind: 'omitted', as: 'vendor-review' })).toBeInstanceOf(type.errors)
  })

  test('an unknown kind is rejected', () => {
    expect(MaterializationDispositionSchema({ kind: 'renamed', as: 'vendor-review' })).toBeInstanceOf(type.errors)
  })

  test('a non-string effective name is rejected', () => {
    expect(MaterializationDispositionSchema({ kind: 'aliased', as: 42 })).toBeInstanceOf(type.errors)
  })
})

describe('MaterializationDispositionSchema — alias grammar', () => {
  // The alias must satisfy the same single-segment asset-name grammar as an
  // authored name: a project cannot materialize under a name a publisher
  // could not have declared.
  test.each([
    ['Review', 'uppercase'],
    ['review/code', 'slash-namespaced'],
    ['-review', 'leading hyphen'],
    ['review-', 'trailing hyphen'],
    ['double--hyphen', 'consecutive hyphens'],
    ['has space', 'whitespace'],
    ['foo_bar', 'underscore'],
    ['', 'empty'],
    ['..', 'traversal'],
    ['a\\b', 'backslash'],
  ])('alias %p is rejected (%s)', (alias) => {
    expect(MaterializationDispositionSchema({ kind: 'aliased', as: alias })).toBeInstanceOf(type.errors)
  })

  test.each(['review', 'vendor-review', '2fa', 'a', 'a'.repeat(64)])('alias %p is accepted', (alias) => {
    expect(MaterializationDispositionSchema({ kind: 'aliased', as: alias })).not.toBeInstanceOf(type.errors)
  })

  test('an invalid alias is rejected rather than normalized', () => {
    const result = MaterializationDispositionSchema({ kind: 'aliased', as: 'Review' })
    expect(result).toBeInstanceOf(type.errors)
    // Nothing lowercases the name into validity on the way through.
    expect(MaterializationDispositionSchema({ kind: 'aliased', as: 'review' })).not.toBeInstanceOf(type.errors)
  })

  test('the failure names the offending alias', () => {
    const result = MaterializationDispositionSchema({ kind: 'aliased', as: 'Review' })
    if (!(result instanceof type.errors)) expect.unreachable()
    expect(result.summary).toContain('Review')
  })
})

describe('ProjectAssetOverrideSchema — project intent', () => {
  test('aliased and omitted are valid overrides', () => {
    expect(ProjectAssetOverrideSchema({ kind: 'aliased', as: 'vendor-review' })).not.toBeInstanceOf(type.errors)
    expect(ProjectAssetOverrideSchema({ kind: 'omitted' })).not.toBeInstanceOf(type.errors)
  })

  // Absence of an override already means "use the authored name", so an
  // explicit `authored` override would be a second spelling of the default.
  test('an explicit authored override is rejected', () => {
    expect(ProjectAssetOverrideSchema({ kind: 'authored' })).toBeInstanceOf(type.errors)
  })

  test('the alias grammar still applies to an override', () => {
    expect(ProjectAssetOverrideSchema({ kind: 'aliased', as: 'Review' })).toBeInstanceOf(type.errors)
  })
})

describe('MaterializedDispositionSchema — resolved on-disk state', () => {
  test('authored and aliased are valid materialized dispositions', () => {
    expect(MaterializedDispositionSchema({ kind: 'authored' })).not.toBeInstanceOf(type.errors)
    expect(MaterializedDispositionSchema({ kind: 'aliased', as: 'vendor-review' })).not.toBeInstanceOf(type.errors)
  })

  // An omitted asset writes nothing, so "omitted but materialized" must be
  // unrepresentable rather than merely discouraged.
  test('omitted is rejected', () => {
    expect(MaterializedDispositionSchema({ kind: 'omitted' })).toBeInstanceOf(type.errors)
  })
})

describe('materializedNameOf', () => {
  test('an authored disposition materializes under the authored name', () => {
    expect(materializedNameOf('review', { kind: 'authored' })).toBe('review')
  })

  test('an aliased disposition materializes under the alias', () => {
    expect(materializedNameOf('review', { kind: 'aliased', as: 'vendor-review' })).toBe('vendor-review')
  })
})

describe('isMaterialized', () => {
  test('authored and aliased are materialized; omitted is not', () => {
    expect(isMaterialized({ kind: 'authored' })).toBe(true)
    expect(isMaterialized({ kind: 'aliased', as: 'vendor-review' })).toBe(true)
    expect(isMaterialized({ kind: 'omitted' })).toBe(false)
  })

  test('it narrows so the effective name is reachable without a second check', () => {
    const disposition: MaterializationDisposition = { kind: 'aliased', as: 'vendor-review' }
    if (!isMaterialized(disposition)) expect.unreachable()
    expect(materializedNameOf('review', disposition)).toBe('vendor-review')
  })
})

describe('cloneDisposition', () => {
  test.each([
    { kind: 'authored' } as const,
    { kind: 'aliased', as: 'vendor-review' } as const,
    { kind: 'omitted' } as const,
  ])('copies %p by value, not by reference', (disposition) => {
    const copy = cloneDisposition(disposition)
    expect(copy).toEqual(disposition)
    expect(copy).not.toBe(disposition)
  })

  test('the copy is independent of the original', () => {
    const original = { kind: 'aliased' as const, as: 'foo' }
    const copy = cloneDisposition(original)
    original.as = 'bar'
    expect(copy).toEqual({ kind: 'aliased', as: 'foo' })
  })

  // A structural deep clone would happily copy whatever it was handed. This
  // one is arm-aware, so a stray key on an arm that cannot carry it does not
  // ride along into a value the schema would reject.
  test('a stray key is not carried into the copy', () => {
    const strayed = { kind: 'omitted', as: 'vendor-review' } as unknown as MaterializationDisposition
    expect(cloneDisposition(strayed)).toEqual({ kind: 'omitted' })
  })
})
