/**
 * What `InstallOperation` makes unsayable.
 *
 * These assertions are checked by `tsgo --noEmit`, not at runtime: every
 * `@ts-expect-error` below fails the build the moment the combination it
 * describes becomes constructible again. That is the whole point of the
 * type — the runtime guards that used to catch these (`FROZEN_WITH_DELTA`,
 * `DELTA_CONFLICT`) are gone because the values cannot be built.
 *
 * The `expect(true)` bodies are deliberate. Bun needs a test to run, but
 * the real assertion happened at compile time.
 */

import { describe, expect, test } from 'bun:test'
import type { Addition, InstallOperation, Removal } from '../types.ts'

const ADDITION: Addition = {
  facetName: 'cowsay',
  specifier: 'cowsay@0.1.0',
  source: { kind: 'registry', name: 'cowsay', version: { kind: 'exact', major: 0, minor: 1, patch: 0 } },
}
const REMOVAL: Removal = { facetName: 'cowsay' }

describe('InstallOperation — frozen belongs to reproduction alone', () => {
  test('an add cannot be frozen', () => {
    // @ts-expect-error `frozen` is not a property of the add arm.
    const operation: InstallOperation = { kind: 'add', additions: [ADDITION], frozen: true }
    expect(operation.kind).toBe('add')
  })

  test('a remove cannot be frozen', () => {
    // @ts-expect-error `frozen` is not a property of the remove arm.
    const operation: InstallOperation = { kind: 'remove', removals: [REMOVAL], frozen: true }
    expect(operation.kind).toBe('remove')
  })

  test('an update cannot be frozen', () => {
    const operation: InstallOperation = {
      kind: 'update',
      snapshot: { manifestState: { kind: 'absent' }, lockfileState: { kind: 'absent' } },
      selections: [
        {
          facetName: 'cowsay',
          metadata: { name: 'cowsay', version: '1.0.0', transportHash: 'x', contentFingerprint: 'y' },
          manifestSource: '1.0.0',
        },
      ],
      // @ts-expect-error `frozen` is not a property of the update arm.
      frozen: true,
    }
    expect(operation.kind).toBe('update')
  })

  test('reproduction must say which mode it is in', () => {
    // @ts-expect-error `frozen` is required, so the two modes cannot be conflated.
    const operation: InstallOperation = { kind: 'reproduce' }
    expect(operation.kind).toBe('reproduce')
  })
})

describe('InstallOperation — frozen collects no decisions', () => {
  test('a frozen run cannot carry a collision resolver', () => {
    const operation: InstallOperation = {
      kind: 'reproduce',
      frozen: true,
      // @ts-expect-error reproducing recorded intent must never prompt.
      resolveCollisions: async () => ({ kind: 'cancelled' }),
    }
    expect(operation.kind).toBe('reproduce')
  })

  test('a frozen run cannot carry an asset-takeover resolver', () => {
    const operation: InstallOperation = {
      kind: 'reproduce',
      frozen: true,
      // @ts-expect-error reproducing recorded intent must never prompt.
      resolveAssetTakeover: async () => ({ kind: 'continue' }),
    }
    expect(operation.kind).toBe('reproduce')
  })

  test('a frozen run cannot use the interactive consent policy', () => {
    const operation: InstallOperation = {
      kind: 'reproduce',
      frozen: true,
      // @ts-expect-error frozen may pre-approve MCP work, but never ask for it.
      mcpConsent: { kind: 'interactive', resolve: async () => ({ kind: 'approved' }) },
    }
    expect(operation.kind).toBe('reproduce')
  })

  test('a frozen run may still pre-approve MCP work', () => {
    const operation: InstallOperation = { kind: 'reproduce', frozen: true, mcpConsent: { kind: 'preapproved' } }
    expect(operation.kind).toBe('reproduce')
  })
})

describe('InstallOperation — one operation at a time', () => {
  test('additions and removals cannot travel together', () => {
    // @ts-expect-error the same run cannot both add and remove.
    const operation: InstallOperation = { kind: 'add', additions: [ADDITION], removals: [REMOVAL] }
    expect(operation.kind).toBe('add')
  })

  test('an add carrying nothing is not an add', () => {
    // @ts-expect-error the add arm exists to say at least one facet was requested.
    const operation: InstallOperation = { kind: 'add', additions: [] }
    expect(operation.kind).toBe('add')
  })

  test('a remove carrying nothing is not a remove', () => {
    // @ts-expect-error the remove arm exists to say at least one name was requested.
    const operation: InstallOperation = { kind: 'remove', removals: [] }
    expect(operation.kind).toBe('remove')
  })

  test('an update selecting nothing is not an update', () => {
    const operation: InstallOperation = {
      kind: 'update',
      snapshot: { manifestState: { kind: 'absent' }, lockfileState: { kind: 'absent' } },
      // @ts-expect-error an update applies at least one reviewed change.
      selections: [],
    }
    expect(operation.kind).toBe('update')
  })

  test('an update cannot be built without the bytes it was reviewed against', () => {
    // @ts-expect-error the snapshot is what makes a stale plan detectable.
    const operation: InstallOperation = {
      kind: 'update',
      selections: [
        {
          facetName: 'cowsay',
          metadata: { name: 'cowsay', version: '1.0.0', transportHash: 'x', contentFingerprint: 'y' },
          manifestSource: '1.0.0',
        },
      ],
    }
    expect(operation.kind).toBe('update')
  })
})
