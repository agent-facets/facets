import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import type { McpServerCapability } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
import { runtimeModuleSpecifiers } from './module-specifiers.ts'

/**
 * The contract every first-party adapter's published bundle must satisfy.
 *
 * The CLI loads `dist/index.mjs` directly, with no `node_modules` tree beside
 * it, so a dependency that was not inlined is a runtime failure at install time
 * rather than a build warning. These assertions are the tripwire for that.
 *
 * The scan proves no *statically resolvable* specifier escaped bundling. A
 * computed one — `require(name)`, a template literal, a `createRequire` handle
 * — is invisible to it and is caught only by running the code, which is why
 * each adapter's own end-to-end test also drives its write path through the
 * built bundle.
 */
export interface AssertDistBundleOptions {
  /** Absolute path to the built `dist/index.mjs`. */
  readonly bundlePath: string
  /** The adapter as imported from source, for the facts that survive re-import. */
  readonly sourceAdapter: { readonly name: string }
}

export function assertDistBundleContract(options: AssertDistBundleOptions): void {
  test('built bundle declares the canonical adapter API version', async () => {
    const loaded = await loadAdapter(options.bundlePath)
    expect(loaded.name).toBe(options.sourceAdapter.name)
    expect(loaded.apiVersion).toBe(ADAPTER_API_VERSION)
  })

  test('built bundle carries a complete MCP server capability', async () => {
    // Two module instances never share object identity, so the assertion is on
    // shape — which is also exactly what the SDK's completeness check looks at.
    const capability = await loadDistMcpCapability(options.bundlePath)
    expect(typeof capability.prepare).toBe('function')
    expect(typeof capability.apply).toBe('function')
  })

  test('built bundle resolves nothing outside Node builtins', async () => {
    const source = await readFile(options.bundlePath, 'utf8')
    const unresolvable = runtimeModuleSpecifiers(source).filter((specifier) => !specifier.startsWith('node:'))
    expect(unresolvable).toEqual([])
  })
}

/**
 * The MCP capability as the *bundle* exposes it, so a caller can exercise it
 * against a document only an inlined parser could read.
 */
export async function loadDistMcpCapability(bundlePath: string): Promise<McpServerCapability<unknown>> {
  const adapter = await loadAdapter(bundlePath)
  const capability = adapter.mcpServers
  if (typeof capability !== 'object' || capability === null) expect.unreachable()
  return capability as McpServerCapability<unknown>
}

async function loadAdapter(bundlePath: string): Promise<{ name?: string; apiVersion?: string; mcpServers?: unknown }> {
  const module = (await import(bundlePath)) as {
    default?: { name?: string; apiVersion?: string; mcpServers?: unknown }
  }
  const adapter = module.default
  if (adapter === undefined) expect.unreachable()
  return adapter
}
