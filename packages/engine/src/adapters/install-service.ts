import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import type { OnLog } from '../install/types.ts'
import { type CloneAdapterGitResult, cloneAdapterGitRepository } from '../sources/adapter/git.ts'
import { type ResolveLocalAdapterResult, resolveLocalAdapterPath } from '../sources/adapter/local.ts'
import { type DownloadNpmResult, downloadNpmPackage } from '../sources/adapter/npm.ts'
import { type ParseAdapterSpecifierResult, parseAdapterSpecifier } from '../sources/adapter/specifier.ts'
import { rebundleAdapter, resolveEntryPoint } from './bundler.ts'
import { placeAdapter } from './placement.ts'
import { verifyAdapter } from './verify.ts'

/**
 * Picker-safe adapter install pipeline (Adjustment Q).
 *
 * Extracted from the historic `handleInstall()` so both the terminal-log
 * code path AND an Ink picker can drive adapter installs without colliding
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
  onLog?: OnLog
}

/**
 * Discriminated failure for `installAdapter`. Each `kind` corresponds
 * to a stage of the install pipeline; structured fields preserve the
 * source-level detail so the CLI can render a precise message.
 *
 *   - `specifier-invalid` — `parseAdapterSpecifier` rejected the
 *     specifier (e.g. `git+ftp://…` with a disallowed scheme).
 *   - `download-failed` — npm registry / git clone / local-path
 *     resolution failed. The `source` discriminator carries the
 *     resolver-specific reason.
 *   - `bundle-failed` / `verify-failed` / `place-failed` — bundler
 *     load, verification, or placement threw. These three still wrap
 *     thrown errors today (their internals weren't part of the #3
 *     scope); the fix here is to surface them as structured failures
 *     to the caller instead of letting them escape the boundary.
 */
export type AdapterInstallFailure =
  | { kind: 'specifier-invalid'; specifier: string; failure: Extract<ParseAdapterSpecifierResult, { ok: false }> }
  | {
      kind: 'download-failed'
      specifier: string
      source:
        | { kind: 'npm'; failure: Extract<DownloadNpmResult, { ok: false }> }
        | { kind: 'git'; failure: Extract<CloneAdapterGitResult, { ok: false }> }
        | { kind: 'local'; failure: Extract<ResolveLocalAdapterResult, { ok: false }> }
    }
  | { kind: 'bundle-failed'; specifier: string; cause: string }
  | { kind: 'verify-failed'; specifier: string; cause: string }
  | { kind: 'place-failed'; specifier: string; adapter: string; cause: string }

/**
 * Result of `installAdapter`. Discriminated by `ok`. On success the
 * caller gets the loaded `Adapter` instance; on failure, a structured
 * `AdapterInstallFailure` for the CLI to render.
 */
export type AdapterInstallResult = { ok: true; adapter: Adapter } | { ok: false; failure: AdapterInstallFailure }

export async function installAdapter(
  specifier: string,
  opts: AdapterInstallOptions = {},
): Promise<AdapterInstallResult> {
  const parsed = parseAdapterSpecifier(specifier)
  if (!parsed.ok) {
    return { ok: false, failure: { kind: 'specifier-invalid', specifier, failure: parsed } }
  }
  const resolved = parsed.resolved

  let sourceDir: string | undefined
  let needsCleanup = true
  let bundleCleanup: (() => Promise<void>) | undefined

  try {
    opts.onProgress?.('resolving', specifier)

    switch (resolved.type) {
      case 'npm': {
        opts.onProgress?.('downloading', resolved.packageName)
        const dl = await downloadNpmPackage(resolved.packageName)
        if (!dl.ok) {
          return {
            ok: false,
            failure: { kind: 'download-failed', specifier, source: { kind: 'npm', failure: dl } },
          }
        }
        sourceDir = dl.path
        break
      }
      case 'git': {
        opts.onProgress?.('downloading', resolved.url)
        const clone = await cloneAdapterGitRepository(resolved.url, resolved.commitish)
        if (!clone.ok) {
          return {
            ok: false,
            failure: { kind: 'download-failed', specifier, source: { kind: 'git', failure: clone } },
          }
        }
        sourceDir = clone.path
        break
      }
      case 'local': {
        const local = await resolveLocalAdapterPath(resolved.path)
        if (!local.ok) {
          return {
            ok: false,
            failure: { kind: 'download-failed', specifier, source: { kind: 'local', failure: local } },
          }
        }
        sourceDir = local.path
        needsCleanup = false // Don't delete user's local directory
        break
      }
    }

    opts.onProgress?.('bundling')
    let located: { bundlePath: string; adapter: Adapter; cleanup: () => Promise<void> }
    try {
      located = await locateAndVerifyAdapter(sourceDir, { onLog: opts.onLog })
    } catch (err) {
      // bundler internals (`rebundleAdapter`, `verifyAdapter`,
      // `resolveEntryPoint`) still throw today — converting them is
      // out of scope for #3. Catch at this boundary so the
      // `installAdapter` contract stays result-typed even though its
      // dependencies haven't been converted yet.
      const cause = err instanceof Error ? err.message : String(err)
      return { ok: false, failure: { kind: 'bundle-failed', specifier, cause } }
    }
    bundleCleanup = located.cleanup

    opts.onProgress?.('verifying', located.adapter.name)
    // verification already happened inside locateAndVerifyAdapter; this
    // stage tick just exists for progress symmetry on the picker.

    opts.onProgress?.('placing', located.adapter.name)
    try {
      await placeAdapter(located.adapter.name, located.bundlePath)
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        failure: { kind: 'place-failed', specifier, adapter: located.adapter.name, cause },
      }
    }

    return { ok: true, adapter: located.adapter }
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
 * `$FACET_DIR/adapters/<name>/adapter.js` where no such `node_modules` exists.
 */
export async function locateAndVerifyAdapter(
  sourceDir: string,
  opts: { onLog?: OnLog } = {},
): Promise<{ bundlePath: string; adapter: Adapter; cleanup: () => Promise<void> }> {
  const resolved = await resolveEntryPoint(sourceDir)

  if (resolved.kind === 'prebuilt') {
    opts.onLog?.(() => `[verbose]   using prebuilt bundle for ${basename(sourceDir)}`)
    const verifyResult = await verifyPrebuiltInIsolation(resolved.path)
    if (verifyResult.ok) {
      return { bundlePath: resolved.path, adapter: verifyResult.adapter, cleanup: noopCleanup }
    }
    opts.onLog?.(
      () =>
        `[verbose]   prebuilt bundle for ${basename(sourceDir)} did not load cleanly (${verifyResult.message}); rebundling from source`,
    )
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
