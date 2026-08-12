import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import type { McpServerCapability } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'

/**
 * The contract every first-party adapter's published bundle must satisfy.
 *
 * The CLI loads `dist/index.mjs` directly, with no `node_modules` tree beside
 * it, so a dependency that was not inlined is a runtime failure at install time
 * rather than a build warning. These assertions are the tripwire for that.
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
    // A real scan, not a regex: a bundled dependency can contain a template
    // literal that reads like an import, and — more importantly — a CommonJS
    // dependency whose lazy `require('./impl/...')` calls survived bundling
    // looks fine until the moment that code path runs.
    const specifiers = new Bun.Transpiler({ loader: 'js' }).scanImports(source)
    const unresolvable = specifiers.filter((specifier) => !specifier.path.startsWith('node:'))
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
