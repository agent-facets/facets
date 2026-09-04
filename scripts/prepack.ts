/**
 * Prepack entry point — run via `bun <relative-path>/scripts/prepack.ts`
 * from a package directory during `npm publish` or `changeset publish`.
 *
 * Does four things before the tarball is packed:
 *   1. Rewrites workspace:* dependencies to concrete versions.
 *   2. Hoists whitelisted fields from `publishConfig` (exports, main,
 *      types, module, bin) to the top-level manifest — mirrors pnpm's
 *      publishConfig behavior, which npm does not implement natively.
 *   3. Removes `devDependencies` so `bun pm pack` doesn't try to resolve
 *      `workspace:*` references that npm would have stripped from the
 *      tarball anyway. See `lib/prepack.ts#stripDevDependencies` for
 *      the full rationale.
 *   4. For first-party adapter packages (anything under
 *      `packages/adapters/`), injects the top-level adapter SDK API metadata
 *      field so compatibility-aware CLIs can select releases before
 *      download. Field name and value come from the adapter SDK's
 *      canonical constants — no literals here.
 *
 * A backup of the original `package.json` is saved so postpack.ts can
 * restore it after packing.
 *
 * The monorepo root is discovered by walking upward from the package
 * directory until a `package.json` with a `workspaces` field is found.
 * This allows the script to work for packages at any depth (e.g.
 * `packages/<name>/` and `packages/adapters/<name>/`).
 */

import { dirname, resolve, sep } from 'node:path'
// Relative source import (not the package name) so prepack works even when
// node_modules is absent; api-version.ts is dependency-free by design.
import { ADAPTER_API_VERSION, ADAPTER_API_VERSION_PACKAGE_FIELD } from '../packages/adapter/src/api-version'
import {
  applyPublishConfig,
  createDiskResolver,
  injectAdapterApiVersion,
  rewriteWorkspaceDeps,
  stripDevDependencies,
} from './lib/prepack'

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

/**
 * First-party adapter packages are exactly the workspace members under
 * `packages/adapters/` (mirrors the root workspace glob). Only they
 * publish the adapter SDK API metadata field.
 */
const adaptersDir = resolve(rootDir, 'packages', 'adapters')
const isFirstPartyAdapter = cwd.startsWith(adaptersDir + sep)

const { pkg: afterDepRewrite, modified: depsModified } = await rewriteWorkspaceDeps(pkg, resolver)
const { pkg: afterPublishConfig, modified: publishConfigModified } = applyPublishConfig(afterDepRewrite)
const { pkg: afterDevDepsStrip, modified: devDepsStripped } = stripDevDependencies(afterPublishConfig)
const { pkg: rewritten, modified: apiVersionInjected } = isFirstPartyAdapter
  ? injectAdapterApiVersion(afterDevDepsStrip, {
      fieldName: ADAPTER_API_VERSION_PACKAGE_FIELD,
      version: ADAPTER_API_VERSION,
    })
  : { pkg: afterDevDepsStrip, modified: false }

const modified = depsModified || publishConfigModified || devDepsStripped || apiVersionInjected

if (modified) {
  // Save backup of the original for postpack restore
  await Bun.file(bakPath).write(original)
  // Write the rewritten package.json
  await Bun.file(pkgPath).write(`${JSON.stringify(rewritten, null, 2)}\n`)

  const changes: string[] = []
  if (depsModified) changes.push('rewrote workspace:* dependencies to concrete versions')
  if (publishConfigModified) changes.push('hoisted publishConfig fields to top-level')
  if (devDepsStripped) changes.push('stripped devDependencies')
  if (apiVersionInjected) changes.push(`injected ${ADAPTER_API_VERSION_PACKAGE_FIELD} ${ADAPTER_API_VERSION}`)
  // Diagnostic output goes to stderr so `bun pm pack --quiet` stdout stays
  // parseable by `packAndPublish` (see scripts/lib/npm.ts#extractPackFilename).
  console.error(`prepack: ${changes.join('; ')}`)
} else {
  console.error('prepack: no workspace:* deps, no publishConfig overrides, and no devDependencies — nothing to rewrite')
}
