import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { cloneAdapterGitRepository } from '../sources/adapter/git.ts'
import { resolveLocalAdapterPath } from '../sources/adapter/local.ts'
import { downloadNpmPackage } from '../sources/adapter/npm.ts'
import { parseAdapterSpecifier } from '../sources/adapter/specifier.ts'
import { rebundleAdapter, resolveEntryPoint } from './bundler.ts'
import { placeAdapter } from './placement.ts'
import { verifyAdapter } from './verify.ts'

/**
 * Picker-safe adapter install pipeline (Adjustment Q).
 *
 * Extracted from the historic `handleInstall()` so both the terminal-log
 * code path AND an Ink picker can drive adapter installs without collide
 * on stdout. The service writes nothing — it emits progress via an
 * optional `onProgress` callback. Callers decide how to render each stage
 * (plain console.log, Ink StageRow, etc).
 */

export type AdapterInstallStage = 'resolving' | 'downloading' | 'bundling' | 'verifying' | 'placing'

export interface AdapterInstallOptions {
  /** Stage ticker. Drives terminal log and Ink StageRow. */
  onProgress?: (stage: AdapterInstallStage, detail?: string) => void
  /**
   * Free-form diagnostic lines (fast-path/slow-path transitions, fallback
   * reasons). Terminal mode prints these; the Ink picker can route them
   * into a `detail` slot under the running stage.
   */
  onLog?: (line: string) => void
}

export interface AdapterInstallResult {
  adapter: Adapter
}

export async function installAdapter(
  specifier: string,
  opts: AdapterInstallOptions = {},
): Promise<AdapterInstallResult> {
  const resolved = parseAdapterSpecifier(specifier)
  let sourceDir: string | undefined
  let needsCleanup = true
  let bundleCleanup: (() => Promise<void>) | undefined

  try {
    opts.onProgress?.('resolving', specifier)

    switch (resolved.type) {
      case 'npm':
        opts.onProgress?.('downloading', resolved.packageName)
        sourceDir = await downloadNpmPackage(resolved.packageName)
        break
      case 'git':
        opts.onProgress?.('downloading', resolved.url)
        sourceDir = await cloneAdapterGitRepository(resolved.url, resolved.commitish)
        break
      case 'local':
        sourceDir = await resolveLocalAdapterPath(resolved.path)
        needsCleanup = false // Don't delete user's local directory
        break
    }

    opts.onProgress?.('bundling')
    const located = await locateAndVerifyAdapter(sourceDir, { onLog: opts.onLog })
    bundleCleanup = located.cleanup

    opts.onProgress?.('verifying', located.adapter.name)
    // verification already happened inside locateAndVerifyAdapter; this
    // stage tick just exists for progress symmetry on the picker.

    opts.onProgress?.('placing', located.adapter.name)
    await placeAdapter(located.adapter.name, located.bundlePath)

    return { adapter: located.adapter }
  } finally {
    if (bundleCleanup) await bundleCleanup()
    if (needsCleanup && sourceDir) {
      await rm(sourceDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

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
 */
export async function locateAndVerifyAdapter(
  sourceDir: string,
  opts: { onLog?: (line: string) => void } = {},
): Promise<{ bundlePath: string; adapter: Adapter; cleanup: () => Promise<void> }> {
  const resolved = await resolveEntryPoint(sourceDir)

  if (resolved.kind === 'prebuilt') {
    opts.onLog?.('Using prebuilt bundle...')
    const verifyResult = await verifyPrebuiltInIsolation(resolved.path)
    if (verifyResult.ok) {
      return { bundlePath: resolved.path, adapter: verifyResult.adapter, cleanup: noopCleanup }
    }
    opts.onLog?.(`Prebuilt bundle did not load cleanly (${verifyResult.message}). Rebundling from source...`)
    const sourceEntry = await resolveSourceEntry(sourceDir, resolved.path)
    const built = await rebundleAdapter(sourceDir, sourceEntry)
    const adapter = await verifyAdapter(built.bundlePath)
    return { bundlePath: built.bundlePath, adapter, cleanup: built.cleanup }
  }

  const built = await rebundleAdapter(sourceDir, resolved.path)
  const adapter = await verifyAdapter(built.bundlePath)
  return { bundlePath: built.bundlePath, adapter, cleanup: built.cleanup }
}

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

async function resolveSourceEntry(sourceDir: string, fallbackEntry: string): Promise<string> {
  const srcIndex = join(sourceDir, 'src/index.ts')
  return (await Bun.file(srcIndex).exists()) ? srcIndex : fallbackEntry
}
