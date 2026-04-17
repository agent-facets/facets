/**
 * Prepack entry point — run via `bun <relative-path>/scripts/prepack.ts`
 * from a package directory during `npm publish` or `changeset publish`.
 *
 * Rewrites workspace:* dependencies to concrete versions and saves a
 * backup so that postpack.ts can restore the original.
 *
 * The monorepo root is discovered by walking upward from the package
 * directory until a `package.json` with a `workspaces` field is found.
 * This allows the script to work for packages at any depth (e.g.
 * `packages/<name>/` and `packages/adapters/<name>/`).
 */

import { dirname, resolve } from 'node:path'
import { createDiskResolver, rewriteWorkspaceDeps } from './lib/prepack'

const cwd = process.cwd()
const pkgPath = resolve(cwd, 'package.json')
const bakPath = resolve(cwd, '.package.json.bak')

// Read the current package.json
const original = await Bun.file(pkgPath).text()
const pkg = JSON.parse(original)

/**
 * Walk upward from `start` looking for the nearest ancestor
 * `package.json` that defines a `workspaces` field. That's the monorepo
 * root. Throws if no such ancestor exists.
 */
async function findMonorepoRoot(start: string): Promise<string> {
  let dir = start
  // Skip the package's own package.json
  dir = dirname(dir)
  while (true) {
    const candidate = resolve(dir, 'package.json')
    const file = Bun.file(candidate)
    if (await file.exists()) {
      const json = (await file.json()) as { workspaces?: unknown }
      if (json.workspaces) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`prepack: could not find monorepo root starting from ${start}`)
    }
    dir = parent
  }
}

const rootDir = await findMonorepoRoot(cwd)
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
