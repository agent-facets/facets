/**
 * Packed-runtime coverage: the built `dist/index.mjs` (the exact artifact
 * published to npm and loaded by the CLI at install time) must satisfy the
 * adapter contract on its own, with no `node_modules` tree beside it.
 * Requires `bun run build` first — wired via the `test:e2e` script.
 */

import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertDistBundleContract,
  commitPlannedAction,
  loadDistMcpCapability,
  STDIO_SERVER,
} from '@agent-facets/adapter-test-kit'
import definition from '../index.ts'

if (!definition.ok) throw new Error('the adapter definition must be valid')
const sourceAdapter = definition.data

const bundlePath = join(import.meta.dir, '../../dist/index.mjs')

assertDistBundleContract({ bundlePath, sourceAdapter })

test('bundled capability reads a native document', async () => {
  const capability = await loadDistMcpCapability(bundlePath)
  const root = mkdtempSync(join(tmpdir(), 'claude-code-dist-'))
  try {
    await Bun.write(join(root, '.mcp.json'), '{ "mcpServers": {} }\n')
    const planned = await capability.plan({
      context: { target: { scope: 'project', projectRoot: root }, homeDirectory: '/home/unused', environment: {} },
      desired: [STDIO_SERVER],
      previouslyOwnedNames: [],
    })
    if (!planned.ok) expect.unreachable()
    expect(planned.plan.outcomes).toEqual([{ kind: 'absent', name: 'fs', ownership: 'untracked' }])

    commitPlannedAction(planned.plan.action)
    expect(JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')).mcpServers.fs.command).toBe('srv')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
