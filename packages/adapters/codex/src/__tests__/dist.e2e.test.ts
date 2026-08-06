/**
 * Packed-runtime coverage: the built `dist/index.mjs` (the exact artifact
 * published to npm and loaded by the CLI at install time) must carry the
 * SDK-stamped canonical adapter API version. Requires `bun run build`
 * first — wired via the `test:e2e` script.
 */
import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
import sourceAdapter from '../index.ts'

test('built dist bundle declares the canonical adapter API version', async () => {
  const module = (await import(join(import.meta.dir, '../../dist/index.mjs'))) as {
    default?: { name?: string; apiVersion?: string; mcpServers?: unknown }
  }
  expect(module.default?.name).toBe(sourceAdapter.name)
  expect(module.default?.apiVersion).toBe(ADAPTER_API_VERSION)
})

test('built dist bundle states its MCP server support', async () => {
  // The field is required by the API this bundle declares, so its presence
  // is part of what makes the artifact loadable — not an optional extra.
  const module = (await import(join(import.meta.dir, '../../dist/index.mjs'))) as {
    default?: { mcpServers?: unknown }
  }
  expect(module.default?.mcpServers).toBe(sourceAdapter.mcpServers)
})
