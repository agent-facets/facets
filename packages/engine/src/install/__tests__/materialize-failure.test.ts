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

  test('read-failed → ADAPTER_READ_FAILED with asset + cause', () => {
    expect(
      materializeFailureToRunInstall('cowsay', {
        kind: 'read-failed',
        adapter: 'opencode',
        asset,
        cause: 'EACCES',
      }),
    ).toEqual({ code: 'ADAPTER_READ_FAILED', facet: 'cowsay', adapter: 'opencode', asset, cause: 'EACCES' })
  })

  test('install-failed → ADAPTER_INSTALL_FAILED with asset + cause', () => {
    expect(
      materializeFailureToRunInstall('cowsay', {
        kind: 'install-failed',
        adapter: 'opencode',
        asset,
        cause: 'disk full',
      }),
    ).toEqual({ code: 'ADAPTER_INSTALL_FAILED', facet: 'cowsay', adapter: 'opencode', asset, cause: 'disk full' })
  })

  test('delete-failed → ADAPTER_DELETE_FAILED with asset + cause', () => {
    expect(
      materializeFailureToRunInstall('cowsay', {
        kind: 'delete-failed',
        adapter: 'opencode',
        asset,
        cause: 'locked',
      }),
    ).toEqual({ code: 'ADAPTER_DELETE_FAILED', facet: 'cowsay', adapter: 'opencode', asset, cause: 'locked' })
  })
})
