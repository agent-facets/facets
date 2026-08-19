/**
 * Packed-runtime coverage: the built `dist/index.mjs` (the exact artifact
 * published to npm and loaded by the CLI at install time) must satisfy the
 * adapter contract on its own, with no `node_modules` tree beside it.
 * Requires `bun run build` first — wired via the `test:e2e` script.
 */

import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertDistBundleContract,
  commitPlannedAction,
  loadDistMcpCapability,
  STDIO_SERVER,
} from '@agent-facets/adapter-test-kit'
import sourceAdapter from '../index.ts'

const bundlePath = join(import.meta.dir, '../../dist/index.mjs')

assertDistBundleContract({ bundlePath, sourceAdapter })

test('bundled JSONC parser survives bundling', async () => {
  const capability = await loadDistMcpCapability(bundlePath)
  const root = mkdtempSync(join(tmpdir(), 'opencode-dist-'))
  try {
    // Comments and a trailing comma are readable only if jsonc-parser was
    // actually inlined; a bare specifier would have failed at import time and
    // a JSON parser would fail here.
    await Bun.write(join(root, '.opencode/opencode.jsonc'), '{\n  // servers\n  "mcp": {},\n}\n')
    const planned = await capability.plan({
      projectRoot: root,
      desired: [STDIO_SERVER],
      previouslyOwnedNames: [],
    })
    if (!planned.ok) expect.unreachable()
    expect(planned.plan.outcomes).toEqual([{ kind: 'absent', name: 'fs', ownership: 'untracked' }])

    // The write path matters as much as the read path: jsonc-parser's UMD
    // build parses fine but resolves its edit helpers lazily, so a mis-bundled
    // dependency only renders wrong text here.
    commitPlannedAction(planned.plan.action)
    expect(readFileSync(join(root, '.opencode/opencode.jsonc'), 'utf8')).toContain('// servers')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the bundled capability creates its default document under .opencode', async () => {
  const capability = await loadDistMcpCapability(bundlePath)
  const root = mkdtempSync(join(tmpdir(), 'opencode-dist-'))
  try {
    // Creating a document inside a directory that does not exist yet is the
    // path a fresh project takes, and it only works if the plan's mutation
    // carries a boundary the caller can create directories under.
    const planned = await capability.plan({
      projectRoot: root,
      desired: [STDIO_SERVER],
      previouslyOwnedNames: [],
    })
    if (!planned.ok) expect.unreachable()
    commitPlannedAction(planned.plan.action)

    expect(readFileSync(join(root, '.opencode/opencode.jsonc'), 'utf8')).toContain('"fs"')
    expect(existsSync(join(root, 'opencode.jsonc'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
