import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import type { Command } from '../../commands.ts'
import { rebundleAdapter, resolveEntryPoint } from './bundler.ts'
import { listInstalledAdapters, placeAdapter, removeAdapter } from './placement.ts'
import { cloneGitRepository } from './sources/git.ts'
import { resolveLocalPath } from './sources/local.ts'
import { downloadNpmPackage } from './sources/npm.ts'
import { parseSpecifier } from './specifier.ts'
import { verifyAdapter } from './verify.ts'

/**
 * `facet adapter` command — manages adapter installations.
 *
 * Subcommands:
 * - `facet adapter install <specifier>` — Install an adapter
 * - `facet adapter list` — List installed adapters
 * - `facet adapter remove <name>` — Remove an installed adapter
 */
export const adapterCommand: Command = {
  name: 'adapter',
  description: 'Manage adapter installations',
  usage: '<install|list|remove> [args]',

  async run(args, _flags) {
    const subcommand = args[0]

    switch (subcommand) {
      case 'install':
        return handleInstall(args.slice(1))
      case 'list':
        return handleList()
      case 'remove':
        return handleRemove(args.slice(1))
      default: {
        if (subcommand) {
          console.error(`Unknown adapter subcommand "${subcommand}". Use install, list, or remove.`)
        } else {
          console.error('Usage: facet adapter <install|list|remove> [args]')
        }
        return 1
      }
    }
  },
}

async function handleInstall(args: string[]): Promise<number> {
  const specifier = args[0]
  if (!specifier) {
    console.error('Usage: facet adapter install <specifier>')
    console.error('')
    console.error('Specifier formats:')
    console.error('  opencode                    Built-in adapter name')
    console.error('  @scope/adapter-name         npm package')
    console.error('  git+https://repo.git        Git repository')
    console.error('  ./path/to/adapter           Local path')
    return 1
  }

  const resolved = parseSpecifier(specifier)
  let sourceDir: string | undefined
  let needsCleanup = true
  let bundleCleanup: (() => Promise<void>) | undefined

  try {
    // Step 1: Resolve source
    console.log(`Resolving "${specifier}"...`)

    switch (resolved.type) {
      case 'npm':
        console.log(`Downloading ${resolved.packageName} from npm...`)
        sourceDir = await downloadNpmPackage(resolved.packageName)
        break
      case 'git':
        console.log(`Cloning ${resolved.url}...`)
        sourceDir = await cloneGitRepository(resolved.url, resolved.commitish)
        break
      case 'local':
        sourceDir = await resolveLocalPath(resolved.path)
        needsCleanup = false // Don't delete user's local directory
        break
    }

    // Step 2: Locate / build the bundle, with fast-path + slow-path fallback.
    //   - Fast path: adapter ships a prebuilt dist/index.mjs — return it directly.
    //   - If that bundle fails to load (missing externals, corrupt, etc.),
    //     fall back to the slow path: bun install + Bun.build() on the
    //     package's entry point.
    const located = await locateAndVerifyAdapter(sourceDir)
    bundleCleanup = located.cleanup

    // Step 3: Place
    console.log(`Installing adapter "${located.adapter.name}"...`)
    await placeAdapter(located.adapter.name, located.bundlePath)

    console.log(`Adapter "${located.adapter.name}" installed successfully.`)
    return 0
  } catch (err) {
    console.error(`Failed to install adapter: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  } finally {
    // Clean up the slow-path build output dir, if any.
    if (bundleCleanup) {
      await bundleCleanup()
    }
    // Clean up source temp directory if needed
    if (needsCleanup && sourceDir) {
      await rm(sourceDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/** A no-op cleanup, used when the fast path needs no temp dir. */
const noopCleanup = async (): Promise<void> => {}

/**
 * Locates a usable adapter bundle from `sourceDir` and verifies it loads.
 *
 * Tries the fast path first (prebuilt `dist/index.mjs` or whatever the
 * package's `exports`/`main` points at). If the fast-path bundle fails to
 * load — typically because it still has unresolved external imports — falls
 * back to the slow path: `bun install` + `Bun.build()` on the resolved
 * entry point.
 *
 * Fast-path verification is performed by copying the candidate bundle into
 * a freshly-created temp directory and importing it from there. This is
 * critical: if we imported it in-place, Node's module resolution would
 * find unresolved externals via the source tree's neighboring
 * `node_modules/`, falsely reporting success — only for the bundle to fail
 * to load later, after `placeAdapter()` copies it to
 * `~/.facets/adapters/<name>/adapter.js` where no such `node_modules` exists.
 * The isolated verification dir has no `node_modules`, so any unresolved
 * import fails fast and triggers the slow-path fallback.
 *
 * Returns the path to the final bundle, the verified Adapter object, and a
 * `cleanup` function that removes any temp build output created by the
 * slow path. The caller is responsible for invoking `cleanup()` after
 * placement (e.g. in a `finally` block). The fast path returns a no-op
 * cleanup since the original `resolved.path` is owned by the source tree
 * (or the source-tree temp dir, which has its own cleanup).
 *
 * Exported for integration testing.
 */
export async function locateAndVerifyAdapter(
  sourceDir: string,
): Promise<{ bundlePath: string; adapter: Adapter; cleanup: () => Promise<void> }> {
  const resolved = await resolveEntryPoint(sourceDir)

  // Fast path candidate: the resolver returned a prebuilt .mjs/.js.
  if (resolved.kind === 'prebuilt') {
    console.log('Using prebuilt bundle...')
    const verifyResult = await verifyPrebuiltInIsolation(resolved.path)
    if (verifyResult.ok) {
      return { bundlePath: resolved.path, adapter: verifyResult.adapter, cleanup: noopCleanup }
    }
    console.log(`Prebuilt bundle did not load cleanly (${verifyResult.message}). Rebundling from source...`)
    // Fall through to slow path. Re-resolve the source entry: the prebuilt
    // path itself is unusable as a build entrypoint, so prefer src/index.ts.
    const sourceEntry = await resolveSourceEntry(sourceDir, resolved.path)
    const built = await rebundleAdapter(sourceDir, sourceEntry)
    const adapter = await verifyAdapter(built.bundlePath)
    return { bundlePath: built.bundlePath, adapter, cleanup: built.cleanup }
  }

  // Source-kind entry: feed `resolved.path` straight into rebundleAdapter.
  // We deliberately do NOT call `bundleAdapter(sourceDir)` here, even
  // though it would do the same thing — that would re-run `resolveEntryPoint`,
  // and if filesystem state has changed (e.g. a prebuilt has appeared) it
  // could incorrectly take the fast path and bypass the install+build we
  // just decided we need.
  const built = await rebundleAdapter(sourceDir, resolved.path)
  const adapter = await verifyAdapter(built.bundlePath)
  return { bundlePath: built.bundlePath, adapter, cleanup: built.cleanup }
}

/**
 * Verifies a prebuilt bundle by copying it into a fresh temp directory
 * (with no `node_modules` siblings) and importing it from there.
 *
 * Returns a discriminated result rather than throwing, so the caller can
 * trivially distinguish "bundle is good, here's the adapter" from "bundle
 * failed, here's why we're falling through to the slow path" without
 * re-stringifying error messages.
 */
async function verifyPrebuiltInIsolation(
  prebuiltPath: string,
): Promise<{ ok: true; adapter: Adapter } | { ok: false; message: string }> {
  const isolationDir = await mkdtemp(join(tmpdir(), 'facet-adapter-verify-'))
  try {
    const isolatedPath = join(isolationDir, basename(prebuiltPath))
    await cp(prebuiltPath, isolatedPath)
    const adapter = await verifyAdapter(isolatedPath)
    return { ok: true, adapter }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  } finally {
    await rm(isolationDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * When the fast-path prebuilt bundle fails, find a source-level entry to
 * feed into `rebundleAdapter()`. Prefers `src/index.ts` if present;
 * otherwise reuses the original resolved path (it may still be usable as
 * a Bun.build entrypoint).
 */
async function resolveSourceEntry(sourceDir: string, fallbackEntry: string): Promise<string> {
  const srcIndex = join(sourceDir, 'src/index.ts')
  return (await Bun.file(srcIndex).exists()) ? srcIndex : fallbackEntry
}

async function handleList(): Promise<number> {
  const names = await listInstalledAdapters()

  if (names.length === 0) {
    console.log('No adapters installed.')
    console.log('')
    console.log('Install one with: facet adapter install <specifier>')
    return 0
  }

  console.log('Installed adapters:')
  for (const name of names) {
    console.log(`  ${name}`)
  }
  return 0
}

async function handleRemove(args: string[]): Promise<number> {
  const name = args[0]
  if (!name) {
    console.error('Usage: facet adapter remove <name>')
    return 1
  }

  const removed = await removeAdapter(name)
  if (removed) {
    console.log(`Adapter "${name}" removed.`)
    return 0
  }

  console.error(`Adapter "${name}" is not installed.`)
  return 1
}
