/**
 * Prepack entry point — run via `bun ../../scripts/prepack.ts` from a
 * package directory during `npm publish` or `changeset publish`.
 *
 * Rewrites workspace:* dependencies to concrete versions and saves a
 * backup so that postpack.ts can restore the original.
 */

import { resolve } from 'node:path'
import { createDiskResolver, rewriteWorkspaceDeps } from './lib/prepack'

const cwd = process.cwd()
const pkgPath = resolve(cwd, 'package.json')
const bakPath = resolve(cwd, '.package.json.bak')

// Read the current package.json
const original = await Bun.file(pkgPath).text()
const pkg = JSON.parse(original)

// Find the monorepo root (two levels up from packages/<name>/)
const rootDir = resolve(cwd, '..', '..')
const resolver = createDiskResolver(rootDir)

const { pkg: rewritten, modified } = await rewriteWorkspaceDeps(pkg, resolver)

if (modified) {
  // Save backup of the original for postpack restore
  await Bun.file(bakPath).write(original)
  // Write the rewritten package.json
  await Bun.file(pkgPath).write(`${JSON.stringify(rewritten, null, 2)}\n`)
  console.log('prepack: rewrote workspace:* dependencies to concrete versions')
} else {
  console.log('prepack: no workspace:* dependencies found, nothing to rewrite')
}
