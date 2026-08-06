import { describe, expect, test } from 'bun:test'
import {
  CURRENT_LOCKFILE_VERSION,
  CurrentLockfileSchema,
  computeMcpServerFingerprint,
  type McpServerDeclaration,
  validateFacetArchive,
  verifiedFileHashes,
} from '@agent-facets/protocol'
import { type } from 'arktype'
import { buildCurrentArchive, buildLegacyArchive, okGunzip } from './archive-helpers.ts'

const HASH = `sha256:${'a'.repeat(64)}`

const declaration: McpServerDeclaration = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'filesystem-mcp'],
  env: { ROOT_DIR: '/srv' },
}

/** A current-format manifest whose only deliverable is one MCP server. */
const serverOnlyManifest = (server: McpServerDeclaration = declaration): string =>
  JSON.stringify({ name: 'server-only', version: '1.0.0', servers: { filesystem: server } }, null, 2)

describe('server-only current archives', () => {
  test('a facet whose only deliverable is a declaration verifies', async () => {
    const { outerBytes } = buildCurrentArchive({ 'facet.json': serverOnlyManifest() })
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    if (!result.ok) expect.unreachable()
    if (result.data.archiveVersion !== 0.2) expect.unreachable()
    expect(result.data.facetManifest.servers?.filesystem).toEqual(declaration)
  })

  test('a declaration contributes no archive entry of its own', async () => {
    const { outerBytes } = buildCurrentArchive({ 'facet.json': serverOnlyManifest() })
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    if (!result.ok) expect.unreachable()
    // The embedded manifest IS the declaration's integrity-protected
    // representation, so there is nothing else in the archive to hash.
    expect(Object.keys(verifiedFileHashes(result.data))).toEqual(['facet.json'])
  })

  test('an invalid declaration fails archive validation', async () => {
    const invalid = JSON.stringify({
      name: 'server-only',
      version: '1.0.0',
      servers: { filesystem: { type: 'stdio', command: 'npx', headers: { a: 'b' } } },
    })
    const { outerBytes } = buildCurrentArchive({ 'facet.json': invalid })
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    expect(result.ok).toBe(false)
  })
})

describe('legacy 0.1 archives reject servers', () => {
  test('a legacy archive embedding any servers member is invalid', async () => {
    const manifestJson = JSON.stringify({
      name: 'legacy-facet',
      version: '1.0.0',
      skills: { review: { description: 'Review' } },
      servers: { jira: '1.0.0' },
    })
    const { outerBytes } = buildLegacyArchive(
      {
        name: 'legacy-facet',
        version: '1.0.0',
        skills: { review: { description: 'Review', prompt: '# Review' } },
      },
      manifestJson,
    )
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    expect(result.ok).toBe(false)
  })

  test('a legacy text-only archive still verifies', async () => {
    const { outerBytes } = buildLegacyArchive({
      name: 'legacy-facet',
      version: '1.0.0',
      skills: { review: { description: 'Review', prompt: '# Review' } },
    })
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    expect(result.ok).toBe(true)
  })
})

describe('declaration drift is covered by facet integrity', () => {
  test('changing a declaration changes the archive integrity', () => {
    const one = buildCurrentArchive({ 'facet.json': serverOnlyManifest() })
    const two = buildCurrentArchive({
      'facet.json': serverOnlyManifest({ ...declaration, args: ['-y', 'other-mcp'] }),
    })
    expect(one.buildManifestJson).not.toBe(two.buildManifestJson)
  })

  test('a tampered declaration no longer reproduces the recorded integrity', async () => {
    const { outerBytes } = buildCurrentArchive({ 'facet.json': serverOnlyManifest() }, (manifest) => ({
      ...manifest,
      files: { ...manifest.files, 'facet.json': `sha256:${'b'.repeat(64)}` },
    }))
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    expect(result.ok).toBe(false)
  })

  test('the fingerprint distinguishes the two declarations that drifted', () => {
    expect(computeMcpServerFingerprint(declaration)).not.toBe(
      computeMcpServerFingerprint({ ...declaration, args: ['-y', 'other-mcp'] }),
    )
  })
})

describe('the lockfile is unchanged by MCP support', () => {
  test('the current lockfile version stays 0.3', () => {
    expect(CURRENT_LOCKFILE_VERSION).toBe(0.3)
  })

  const serverOnlyEntry = {
    source: { kind: 'registry' as const, registry: 'https://facet.cafe' },
    version: '1.0.0',
    integrity: HASH,
    assets: [],
  }

  test('a server-only facet is representable with an empty asset list', () => {
    const lockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
      facets: { 'server-only': serverOnlyEntry },
    }
    expect(CurrentLockfileSchema(lockfile)).not.toBeInstanceOf(type.errors)
  })

  test('the lockfile schema has no place to record a declaration', () => {
    const lockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
      facets: {
        'server-only': { ...serverOnlyEntry, servers: { filesystem: declaration } },
      },
    }
    // Tolerated as unknown extension data rather than recognized: the point
    // is that nothing in the schema gives a declaration meaning here.
    const result = CurrentLockfileSchema(lockfile)
    const parsed = result as { facets: Record<string, Record<string, unknown>> }
    expect(parsed.facets['server-only']?.assets).toEqual([])
  })
})
