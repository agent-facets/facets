import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseTar } from 'nanotar'
// The same pure transforms the release pipeline applies at pack time, imported
// rather than restated so this test cannot drift from what is published. Only
// the pure helpers: the lifecycle scripts rewrite the workspace manifest in
// place, which is exactly what this harness exists to avoid.
import { applyPublishConfig, stripDevDependencies } from '../../../../../scripts/lib/prepack.ts'

/**
 * Build a real `@agent-facets/protocol` tarball and an isolated consumer of it.
 *
 * The workspace manifest points `exports` at TypeScript source; only the
 * published manifest points at `dist`. So the package under test is packed
 * from a STAGING directory outside the workspace — a copy of `dist` plus a
 * manifest transformed the way publishing transforms it — with lifecycle
 * scripts disabled. The workspace `package.json` is never written.
 */

export const PACKAGE_ROOT = resolve(import.meta.dir, '../../..')
export const REPO_ROOT = resolve(PACKAGE_ROOT, '../..')

export interface PackedPackage {
  /** The published manifest, as packed. */
  manifest: Record<string, unknown>
  /** Every path inside the tarball, relative to its `package/` root. */
  files: string[]
}

/** Stage, pack, and extract the built package into `consumerRoot/node_modules`. */
export function installPackedProtocol(workdir: string, consumerRoot: string): PackedPackage {
  const stage = join(workdir, 'stage')
  const out = join(workdir, 'tarball')
  mkdirSync(stage, { recursive: true })
  mkdirSync(out, { recursive: true })

  const dist = join(PACKAGE_ROOT, 'dist')
  if (!existsSync(join(dist, 'index.mjs'))) {
    throw new Error(`[e2e] ${dist} is not built; run 'bun run --cwd packages/protocol build' (test:e2e does)`)
  }
  cpSync(dist, join(stage, 'dist'), { recursive: true })

  const source = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>
  const published = stripDevDependencies(applyPublishConfig(source).pkg).pkg
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(published, null, 2)}\n`)

  const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--ignore-scripts', '--quiet', '--destination', out], {
    cwd: stage,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (packed.exitCode !== 0) {
    throw new Error(`[e2e] bun pm pack failed: ${packed.stderr.toString()}`)
  }
  const [tarball] = readdirSync(out).filter((name) => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error(`[e2e] bun pm pack produced no tarball in ${out}`)

  const target = join(consumerRoot, 'node_modules', '@agent-facets', 'protocol')
  const files: string[] = []
  for (const entry of parseTar(Bun.gunzipSync(readFileSync(join(out, tarball))))) {
    if (entry.data === undefined || entry.name.endsWith('/')) continue
    const relative = entry.name.replace(/^package\//, '')
    files.push(relative)
    mkdirSync(dirname(join(target, relative)), { recursive: true })
    writeFileSync(join(target, relative), entry.data)
  }

  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as Record<string, unknown>
  return { manifest, files: files.sort() }
}

/**
 * Copy an installed package and its dependency closure into `consumerRoot`.
 *
 * Resolution follows Node's own algorithm from each package's real location,
 * so the version a package was installed against is the version it gets.
 * Packages are COPIED, not linked: a symlink back into the workspace would let
 * a consumer resolve something the published tarball does not provide.
 *
 * Placement is hoisted where that is unambiguous and nested where two
 * versions of one name are needed. Optional and peer dependencies are
 * followed only when installed; a required dependency that is not installed
 * is an error rather than something to fetch.
 */
export function installClosure(consumerRoot: string, names: readonly string[], resolveFrom: string): void {
  const placedAtRoot = new Map<string, string>()
  const visited = new Set<string>()

  const place = (name: string, from: string, parentTarget: string, required: boolean): void => {
    const source = findPackage(name, from)
    if (source === null) {
      if (required) throw new Error(`[e2e] ${name} is not installed (looked from ${from}); run 'bun install'`)
      return
    }
    const rootTarget = join(consumerRoot, 'node_modules', name)
    let target: string
    const hoisted = placedAtRoot.get(name)
    if (hoisted === undefined) {
      target = rootTarget
      placedAtRoot.set(name, source)
    } else if (hoisted === source) {
      target = rootTarget
    } else {
      target = join(parentTarget, 'node_modules', name)
    }

    const key = `${source}->${target}`
    if (visited.has(key)) return
    visited.add(key)
    if (!existsSync(target)) {
      cpSync(source, target, {
        recursive: true,
        dereference: true,
        // A package's own node_modules belongs to the store layout, not to
        // the package; its dependencies are placed by this walk instead.
        filter: (path) => !path.slice(source.length).split(/[\\/]/).includes('node_modules'),
      })
    }

    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) place(dependency, source, target, true)
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      place(dependency, source, target, false)
    }
    for (const dependency of Object.keys(manifest.peerDependencies ?? {})) place(dependency, source, target, false)
  }

  for (const name of names) place(name, resolveFrom, consumerRoot, true)
}

/** Node's lookup: each ancestor's `node_modules`, skipping `node_modules` itself. */
function findPackage(name: string, from: string): string | null {
  let dir = from
  while (true) {
    if (basename(dir) !== 'node_modules') {
      const candidate = join(dir, 'node_modules', name)
      if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Resolve an installed package's real directory, the way Node would from `from`. */
export function installedPackageDir(name: string, from: string): string {
  const found = findPackage(name, from)
  if (found === null) throw new Error(`[e2e] ${name} is not installed (looked from ${from}); run 'bun install'`)
  return found
}
