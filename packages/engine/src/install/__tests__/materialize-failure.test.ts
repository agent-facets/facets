import { describe, expect, test } from 'bun:test'
import { materializeFailureToRunInstall } from '../materialize-failure.ts'
import { assetIdentity } from '../types.ts'

// An adapter failure names the asset the adapter was addressing, which is
// its EFFECTIVE identity. This was previously typed as a lockfile asset
// entry, whose name is authored -- the two are only interchangeable for an
// asset that happens not to be aliased.
const asset = assetIdentity('user', 'skill', 'planning')

describe('materializeFailureToRunInstall', () => {
  test('unsupported-adapter → ADAPTER_UNSUPPORTED', () => {
    expect(materializeFailureToRunInstall('cowsay', { kind: 'unsupported-adapter', adapter: 'opencode' })).toEqual({
      code: 'ADAPTER_UNSUPPORTED',
      facet: 'cowsay',
      adapter: 'opencode',
    })
  })

  test('a failed install plan → ADAPTER_INSTALL_FAILED with asset + cause', () => {
    expect(
      materializeFailureToRunInstall('cowsay', {
        kind: 'plan-failed',
        operation: 'install',
        adapter: 'opencode',
        asset,
        cause: 'disk full',
      }),
    ).toEqual({ code: 'ADAPTER_INSTALL_FAILED', facet: 'cowsay', adapter: 'opencode', asset, cause: 'disk full' })
  })

  test('a failed removal plan → ADAPTER_DELETE_FAILED with asset + cause', () => {
    // The operation decides the code: an install failure points a user at the
    // content being written, a removal failure at the file being removed, and
    // one shared code could only name one of them.
    expect(
      materializeFailureToRunInstall('cowsay', {
        kind: 'plan-failed',
        operation: 'removal',
        adapter: 'opencode',
        asset,
        cause: 'locked',
      }),
    ).toEqual({ code: 'ADAPTER_DELETE_FAILED', facet: 'cowsay', adapter: 'opencode', asset, cause: 'locked' })
  })

  test('a refused file change → FILESYSTEM_TRANSACTION_FAILED naming what it was for', () => {
    const failure = {
      kind: 'conflict' as const,
      path: '/tmp/x.md',
      expected: { kind: 'absent' as const },
      observed: { kind: 'absent' as const },
    }
    expect(
      materializeFailureToRunInstall('cowsay', {
        kind: 'transaction-failed',
        adapter: 'opencode',
        asset,
        failure,
      }),
    ).toEqual({
      code: 'FILESYSTEM_TRANSACTION_FAILED',
      subject: { kind: 'asset', facet: 'cowsay', adapter: 'opencode', asset },
      failure,
    })
  })

  test('takeover-cancelled → ASSET_TAKEOVER_CANCELLED', () => {
    expect(
      materializeFailureToRunInstall('cowsay', { kind: 'takeover-cancelled', adapter: 'opencode', asset }),
    ).toEqual({ code: 'ASSET_TAKEOVER_CANCELLED', facet: 'cowsay', adapter: 'opencode', asset })
  })
})
