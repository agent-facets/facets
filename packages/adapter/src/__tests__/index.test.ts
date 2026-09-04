import { describe, expect, test } from 'bun:test'
import type { McpServerDeclaration as ProtocolMcpServerDeclaration } from '@agent-facets/protocol/mcp-declaration'
import { ADAPTER_API_VERSION, ADAPTER_API_VERSION_PACKAGE_FIELD } from '../api-version.ts'
import { defineAdapter } from '../define-adapter.ts'
import type { McpServerContribution, McpServerDeclaration } from '../mcp-servers.ts'
import type { Adapter, AdapterDefinition, AssetCapability } from '../types.ts'

/**
 * A minimal valid adapter definition for tests that need a base object.
 * Overrides any individual field by spreading this then assigning.
 */
function assetCapability(): AssetCapability {
  return {
    async planInstall() {
      return { ok: true, plan: { occupancy: 'equivalent', action: { kind: 'unchanged' }, primaryPath: '/tmp/test' } }
    },
    async planRemoval() {
      return { ok: true, plan: { kind: 'absent', primaryPath: '/tmp/test' } }
    },
  }
}

function validDefinition(): AdapterDefinition {
  return {
    name: 'test-adapter',
    assets: assetCapability(),
    mcpServers: false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
  }
}

describe('defineAdapter — required field validation', () => {
  test('throws when name is missing', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), name: undefined as any }
    expect(() => defineAdapter(def)).toThrow(/"name" is required/)
  })

  test('throws when name is an empty string', () => {
    expect(() => defineAdapter({ ...validDefinition(), name: '' })).toThrow(/"name" is required/)
  })

  test('throws when name is not a string', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), name: 42 as any }
    expect(() => defineAdapter(def)).toThrow(/"name" is required/)
  })

  test('throws when buildAssetMetadata is missing', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), buildAssetMetadata: undefined as any }
    expect(() => defineAdapter(def)).toThrow(/"buildAssetMetadata" is required/)
  })

  test('throws when buildAssetMetadata is not a function', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), buildAssetMetadata: 'not-a-function' as any }
    expect(() => defineAdapter(def)).toThrow(/"buildAssetMetadata" is required/)
  })

  test('throws when assets is missing', () => {
    const { assets: _omitted, ...def } = validDefinition()
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    expect(() => defineAdapter(def as any)).toThrow(/"assets" is required/)
  })

  test('throws when assets is true rather than a capability', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), assets: true as any }
    expect(() => defineAdapter(def)).toThrow(/"assets" is required/)
  })

  test('throws when an asset capability can plan an install but not a removal', () => {
    // An adapter that could put files on disk and never take them off would be
    // discovered at `facet remove`, long after the files exist.
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), assets: { async planInstall() {} } as any }
    expect(() => defineAdapter(def)).toThrow(/"assets" is required/)
  })

  test('throws when mcpServers is missing', () => {
    const { mcpServers: _omitted, ...def } = validDefinition()
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    expect(() => defineAdapter(def as any)).toThrow(/"mcpServers" is required/)
  })

  test('throws when mcpServers is true rather than a capability', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional type hole for runtime validation test
    const def = { ...validDefinition(), mcpServers: true as any }
    expect(() => defineAdapter(def)).toThrow(/"mcpServers" is required/)
  })

  test('accepts a complete MCP capability', () => {
    const capability = { async plan() {} }
    // biome-ignore lint/suspicious/noExplicitAny: capability stub for shape assertion
    const adapter = defineAdapter({ ...validDefinition(), mcpServers: capability as any })
    expect(adapter.mcpServers as unknown).toBe(capability)
  })

  test('a declined capability is preserved rather than stubbed', () => {
    const adapter = defineAdapter({ ...validDefinition(), assets: false, mcpServers: false })
    expect(adapter.assets).toBe(false)
    expect(adapter.mcpServers).toBe(false)
  })
})

describe('adapter SDK API identifier', () => {
  test('the SDK stamps the canonical identifier', () => {
    expect(defineAdapter(validDefinition()).apiVersion).toBe(ADAPTER_API_VERSION)
  })

  test('an author-supplied identifier is ignored, never honored', () => {
    // biome-ignore lint/suspicious/noExplicitAny: simulating untyped JavaScript input
    const def = { ...validDefinition(), apiVersion: '0.1' } as any
    expect(defineAdapter(def).apiVersion).toBe(ADAPTER_API_VERSION)
  })

  test('the canonical identifier names the planning contract', () => {
    expect(ADAPTER_API_VERSION).toBe('0.3')
  })

  test('the package-metadata field name is exported for release tooling', () => {
    expect(ADAPTER_API_VERSION_PACKAGE_FIELD).toBe('facetAdapterApiVersion')
  })
})

describe('adapter shape', () => {
  test('the returned adapter is frozen', () => {
    const adapter = defineAdapter(validDefinition())
    expect(Object.isFrozen(adapter)).toBe(true)
  })

  test('buildAssetMetadata is bound to the definition', () => {
    const definition: AdapterDefinition = {
      ...validDefinition(),
      buildAssetMetadata(this: { marker: string } & AdapterDefinition) {
        return { ok: true, data: { marker: this.marker } }
      },
    }
    Object.assign(definition, { marker: 'kept' })

    const result = defineAdapter(definition).buildAssetMetadata({})
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({ marker: 'kept' })
  })

  test('an adapter exposes exactly the contract members', () => {
    const adapter: Adapter = defineAdapter(validDefinition())
    expect(Object.keys(adapter).sort()).toEqual(['apiVersion', 'assets', 'buildAssetMetadata', 'mcpServers', 'name'])
  })
})

describe('protocol declaration identity', () => {
  test('the SDK re-exports the protocol declaration type rather than restating it', () => {
    // Assignable in both directions: one type, two names. A structural copy
    // would drift the moment the protocol adds a field.
    const protocolValue: ProtocolMcpServerDeclaration = { type: 'stdio', command: 'srv' }
    const sdkValue: McpServerDeclaration = protocolValue
    const roundTripped: ProtocolMcpServerDeclaration = sdkValue
    expect(roundTripped).toBe(protocolValue)
  })

  test('a contribution carries the declaration unchanged', () => {
    const declaration: McpServerDeclaration = { type: 'http', url: 'https://example.test/mcp' }
    const contribution: McpServerContribution = { name: 'remote', declaration }
    expect(contribution.declaration).toBe(declaration)
  })
})
