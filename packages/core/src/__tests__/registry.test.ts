import { describe, expect, test } from 'bun:test'
import { describeVersionSpec, downloadAndExtractFacet, resolveRegistryMetadataBatch } from '../registry/index.ts'

describe('describeVersionSpec', () => {
  test('exact', () => {
    expect(describeVersionSpec({ kind: 'exact', major: 1, minor: 2, patch: 3 })).toBe('1.2.3')
  })

  test('majorWildcard', () => {
    expect(describeVersionSpec({ kind: 'majorWildcard', major: 1 })).toBe('1.*')
  })

  test('minorWildcard', () => {
    expect(describeVersionSpec({ kind: 'minorWildcard', major: 1, minor: 2 })).toBe('1.2.*')
  })

  test('wildcard', () => {
    expect(describeVersionSpec({ kind: 'wildcard' })).toBe('*')
  })

  test('latest', () => {
    expect(describeVersionSpec({ kind: 'latest' })).toBe('latest')
  })
})

describe('resolveRegistryMetadataBatch', () => {
  test('empty batch returns empty success', async () => {
    const result = await resolveRegistryMetadataBatch([])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual([])
  })

  test('single-spec batch returns REGISTRY_NOT_AVAILABLE', async () => {
    const result = await resolveRegistryMetadataBatch([{ name: 'viper-plans', version: { kind: 'latest' } }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('REGISTRY_NOT_AVAILABLE')
  })

  test('multi-spec batch returns REGISTRY_NOT_AVAILABLE', async () => {
    const result = await resolveRegistryMetadataBatch([
      { name: 'viper-plans', version: { kind: 'exact', major: 1, minor: 2, patch: 3 } },
      { name: 'rezi', version: { kind: 'majorWildcard', major: 2 } },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('REGISTRY_NOT_AVAILABLE')
  })

  test('error message names facets.cafe', async () => {
    const result = await resolveRegistryMetadataBatch([{ name: 'viper-plans', version: { kind: 'latest' } }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    if (result.error.code !== 'REGISTRY_NOT_AVAILABLE') return
    expect(result.error.what).toContain('facets.cafe')
  })

  test('error fix suggests github/https/ssh/local workaround', async () => {
    const result = await resolveRegistryMetadataBatch([{ name: 'viper-plans', version: { kind: 'latest' } }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    if (result.error.code !== 'REGISTRY_NOT_AVAILABLE') return
    expect(result.error.fix).toContain('github:')
    expect(result.error.fix).toContain('https')
    expect(result.error.fix).toContain('local path')
  })

  test('error message renders the version spec verbatim', async () => {
    const result = await resolveRegistryMetadataBatch([
      { name: 'viper-plans', version: { kind: 'majorWildcard', major: 1 } },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    if (result.error.code !== 'REGISTRY_NOT_AVAILABLE') return
    expect(result.error.what).toContain('viper-plans@1.*')
  })

  test('multi-spec error mentions count and a sample', async () => {
    const result = await resolveRegistryMetadataBatch([
      { name: 'a', version: { kind: 'latest' } },
      { name: 'b', version: { kind: 'latest' } },
      { name: 'c', version: { kind: 'latest' } },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    if (result.error.code !== 'REGISTRY_NOT_AVAILABLE') return
    expect(result.error.what).toContain('3 facets')
    expect(result.error.what).toContain('a@latest')
  })
})

describe('downloadAndExtractFacet', () => {
  test('returns REGISTRY_NOT_AVAILABLE', async () => {
    const result = await downloadAndExtractFacet(
      {
        name: 'viper-plans',
        version: '1.2.3',
        expectedIntegrity: 'sha256:abc',
        tarballUrl: 'https://facets.cafe/viper-plans-1.2.3.facet',
      },
      '/tmp/dest',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('REGISTRY_NOT_AVAILABLE')
  })

  test('error message includes tarballUrl and name@version', async () => {
    const result = await downloadAndExtractFacet(
      {
        name: 'viper-plans',
        version: '1.2.3',
        expectedIntegrity: 'sha256:abc',
        tarballUrl: 'https://facets.cafe/viper-plans-1.2.3.facet',
      },
      '/tmp/dest',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    if (result.error.code !== 'REGISTRY_NOT_AVAILABLE') return
    expect(result.error.what).toContain('https://facets.cafe/viper-plans-1.2.3.facet')
    expect(result.error.what).toContain('viper-plans@1.2.3')
  })
})
