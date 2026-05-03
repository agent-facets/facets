import { describe, expect, test } from 'bun:test'
import { type ServerManifest, ServerManifestSchema } from '@agent-facets/protocol'
import { type } from 'arktype'

// --- Valid manifests ---

describe('ServerManifestSchema — valid manifests', () => {
  test('minimal valid server manifest', () => {
    const input = {
      name: 'jira',
      version: '1.5.0',
      runtime: 'bun',
      entry: 'index.ts',
    }
    const result = ServerManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as ServerManifest
    expect(data.name).toBe('jira')
    expect(data.version).toBe('1.5.0')
    expect(data.runtime).toBe('bun')
    expect(data.entry).toBe('index.ts')
  })

  test('server manifest with optional fields', () => {
    const input = {
      name: 'jira',
      version: '1.5.0',
      description: 'Jira integration',
      author: 'acme-org',
      runtime: 'bun',
      entry: 'index.ts',
    }
    const result = ServerManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as ServerManifest
    expect(data.description).toBe('Jira integration')
    expect(data.author).toBe('acme-org')
  })
})

// --- Invalid manifests ---

describe('ServerManifestSchema — invalid manifests', () => {
  test('missing runtime', () => {
    const input = {
      name: 'jira',
      version: '1.5.0',
      entry: 'index.ts',
    }
    const result = ServerManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('missing entry', () => {
    const input = {
      name: 'jira',
      version: '1.5.0',
      runtime: 'bun',
    }
    const result = ServerManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('wrong field type', () => {
    const input = {
      name: 'jira',
      version: '1.5.0',
      runtime: 42,
      entry: 'index.ts',
    }
    const result = ServerManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })
})

// --- Unknown field pass-through ---

describe('ServerManifestSchema — unknown field tolerance', () => {
  test('unknown field is preserved', () => {
    const input = {
      name: 'jira',
      version: '1.5.0',
      runtime: 'bun',
      entry: 'index.ts',
      license: 'MIT',
    }
    const result = ServerManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as ServerManifest & { license: string }
    expect(data.license).toBe('MIT')
  })
})
