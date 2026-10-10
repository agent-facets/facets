#!/usr/bin/env node
/**
 * Run a script on plain Node with Bun provably unreachable.
 *
 *   node scripts/smoke/node-only.mjs [--deny-network] <script> [args...]
 *
 * Filtering `bun` out of `$PATH` is not enough: tool managers such as mise or
 * asdf put a shim directory on `$PATH` that serves `node` AND `bun`, and the
 * directory holding the real Node binary may hold a Bun binary beside it. So
 * the child gets a `$PATH` containing exactly one fresh directory, holding a
 * link to the Node executable this launcher is running on — which is the real
 * binary even when `node` was reached through a shim — and nothing else.
 *
 * Before running the script it proves the isolation instead of assuming it:
 * Node must be 22 or newer and `bun` must fail to resolve on the child's
 * `$PATH`. Either failure exits 2 without running anything.
 *
 * `--deny-network` preloads `deny-network.mjs`, which makes every ordinary
 * Node network entry point throw. That is a regression guard against code
 * that reaches for the network, not an operating-system sandbox.
 *
 * Shared by the manual smoke check and protocol's automated packed-package
 * test, so the recipe a person runs is the one CI proves.
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MINIMUM_NODE_MAJOR = 22

const argv = process.argv.slice(2)
const denyNetwork = argv[0] === '--deny-network'
const [script, ...rest] = denyNetwork ? argv.slice(1) : argv

if (script === undefined) {
  console.error('usage: node scripts/smoke/node-only.mjs [--deny-network] <script> [args...]')
  process.exit(2)
}

const major = Number(process.versions.node.split('.')[0])
if (!(major >= MINIMUM_NODE_MAJOR)) {
  console.error(`node-only: Node ${MINIMUM_NODE_MAJOR}+ is required, this is ${process.version}`)
  process.exit(2)
}

const binDir = mkdtempSync(join(tmpdir(), 'facet-node-only-'))
let status = 2
try {
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  try {
    symlinkSync(process.execPath, join(binDir, nodeName))
  } catch {
    // Symlinks can need privileges on Windows; a copy isolates just as well.
    copyFileSync(process.execPath, join(binDir, nodeName))
  }

  const env = { ...process.env, PATH: binDir }
  // Options a parent set for itself must not reach the child unannounced.
  delete env.NODE_OPTIONS

  const probe = spawnSync('bun', ['--version'], { env, encoding: 'utf8' })
  if (probe.error?.code !== 'ENOENT') {
    console.error(`node-only: bun is still reachable on the isolated PATH (${binDir}); refusing to run`)
    process.exit(2)
  }

  const preload = denyNetwork
    ? ['--import', pathToFileURL(join(fileURLToPath(new URL('.', import.meta.url)), 'deny-network.mjs')).href]
    : []
  const result = spawnSync(process.execPath, [...preload, script, ...rest], { env, stdio: 'inherit' })
  status = result.status ?? 1
} finally {
  rmSync(binDir, { recursive: true, force: true })
}
process.exit(status)
