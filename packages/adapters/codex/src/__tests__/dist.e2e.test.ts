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
import { assertDistBundleContract, loadDistMcpCapability, STDIO_SERVER } from '@agent-facets/adapter-test-kit'
import sourceAdapter from '../index.ts'

const bundlePath = join(import.meta.dir, '../../dist/index.mjs')

assertDistBundleContract({ bundlePath, sourceAdapter })

test('bundled TOML editor preserves comments after bundling', async () => {
  const capability = await loadDistMcpCapability(bundlePath)
  const root = mkdtempSync(join(tmpdir(), 'codex-dist-'))
  const configPath = join(root, '.codex', 'config.toml')
  try {
    await Bun.write(configPath, '# keep me\nmodel = "gpt-5.6"\n')
    const prepared = await capability.prepare({
      projectRoot: root,
      desired: [STDIO_SERVER],
      previouslyOwnedNames: [],
    })
    if (!prepared.ok) expect.unreachable()
    const applied = await capability.apply({ plan: prepared.preparation.plan })
    if (!applied.ok) expect.unreachable()

    // A value-model TOML round trip would have dropped this comment; only the
    // inlined syntax-aware editor keeps it.
    const after = readFileSync(configPath, 'utf8')
    expect(after).toContain('# keep me')
    expect(after).toContain('[mcp_servers.fs]')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
