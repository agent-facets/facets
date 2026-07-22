import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import type { OnLog } from '../install/types.ts'
import { type CloneAdapterGitResult, cloneAdapterGitRepository } from '../sources/adapter/git.ts'
import { type ResolveLocalAdapterResult, resolveLocalAdapterPath } from '../sources/adapter/local.ts'
import {
  type DownloadNpmResult,
  downloadNpmRelease,
  type ResolveNpmAdapterResult,
  resolveNpmAdapter,
} from '../sources/adapter/npm.ts'
import { type ParseAdapterSpecifierResult, parseAdapterSpecifier } from '../sources/adapter/specifier.ts'
import { type BundleFailure, rebundleAdapter, resolveEntryPoint } from './bundler.ts'
import type { InstallationReceipt, InstallationSource } from './installation.ts'
import { type PlaceAdapterFailure, type PlacementWarning, placeAdapterManaged } from './placement.ts'
import { type VerifiedAdapter, type VerifyAdapterFailure, verifyAdapter } from './verify.ts'

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
 *   - `download-failed` — npm resolution/download, git clone, or
 *     local-path resolution failed. The `source` discriminator carries
 *     the resolver-specific reason (for npm: compatible-release
 *     resolution failures and tarball download/integrity failures).
 *   - `bundle-failed` — entry resolution, dependency install, or
 *     bundling failed. Carries the structured `BundleFailure`.
 *   - `verify-failed` — the produced bundle failed verification. Carries
 *     the full structured `VerifyAdapterFailure` (including adapter API
 *     compatibility classifications) for the CLI to render.
 *   - `place-failed` — managed placement failed (lock, staging,
 *     staged-path verification, or receipt activation).
 */
export type AdapterInstallFailure =
  | { kind: 'specifier-invalid'; specifier: string; failure: Extract<ParseAdapterSpecifierResult, { ok: false }> }
  | {
      kind: 'download-failed'
      specifier: string
      source:
        | {
            kind: 'npm'
            failure: Extract<ResolveNpmAdapterResult, { ok: false }> | Extract<DownloadNpmResult, { ok: false }>
          }
        | { kind: 'git'; failure: Extract<CloneAdapterGitResult, { ok: false }> }
        | { kind: 'local'; failure: Extract<ResolveLocalAdapterResult, { ok: false }> }
    }
  | { kind: 'bundle-failed'; specifier: string; failure: BundleFailure }
  | { kind: 'verify-failed'; specifier: string; failure: VerifyAdapterFailure }
  | { kind: 'place-failed'; specifier: string; adapter: string; failure: PlaceAdapterFailure }

/**
 * Result of `installAdapter`. Discriminated by `ok`. On success the
 * caller gets the loaded `Adapter` instance, the activated installation
 * receipt, and any post-activation cleanup warnings; on failure, a
 * structured `AdapterInstallFailure` for the CLI to render.
 */
export type AdapterInstallResult =
  | { ok: true; adapter: Adapter; receipt: InstallationReceipt; warnings: PlacementWarning[] }
  | { ok: false; failure: AdapterInstallFailure }

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
  /** The npm package declaration used for selection, when installing from npm. */
  let expectedApiVersion: string | undefined
  /** Receipt provenance, minus the verified API (known after verification). */
  let source: InstallationSource | undefined

  try {
    opts.onProgress?.('resolving', specifier)

    switch (resolved.type) {
      case 'npm': {
        const resolution = await resolveNpmAdapter(resolved.packageName, resolved.request)
        if (!resolution.ok) {
          return {
            ok: false,
            failure: { kind: 'download-failed', specifier, source: { kind: 'npm', failure: resolution } },
          }
        }
        opts.onProgress?.('downloading', `${resolved.packageName}@${resolution.release.version}`)
        const dl = await downloadNpmRelease(resolution.release)
        if (!dl.ok) {
          return {
            ok: false,
            failure: { kind: 'download-failed', specifier, source: { kind: 'npm', failure: dl } },
          }
        }
        sourceDir = dl.path
        expectedApiVersion = resolution.release.apiVersion
        source = {
          kind: 'npm',
          specifier,
          packageName: resolution.release.packageName,
          version: resolution.release.version,
          integrity: dl.usedIntegrity,
        }
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
        source = {
          kind: 'git',
          specifier,
          url: resolved.url,
          ...(resolved.commitish !== undefined ? { ref: resolved.commitish } : {}),
        }
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
        source = { kind: 'local', specifier, sourcePath: local.path }
        break
      }
    }

    opts.onProgress?.('bundling')
    const located = await locateAndVerifyAdapter(sourceDir, { onLog: opts.onLog, expectedApiVersion })
    if (!located.ok) {
      return {
        ok: false,
        failure:
          located.failure.kind === 'bundle'
            ? { kind: 'bundle-failed', specifier, failure: located.failure.failure }
            : { kind: 'verify-failed', specifier, failure: located.failure.failure },
      }
    }
    bundleCleanup = located.cleanup
    const adapter = located.verified.adapter

    opts.onProgress?.('verifying', adapter.name)
    // verification already happened inside locateAndVerifyAdapter; this
    // stage tick just exists for progress symmetry on the picker.

    opts.onProgress?.('placing', adapter.name)
    const placed = await placeAdapterManaged(adapter.name, located.bundlePath, {
      apiVersion: located.verified.apiVersion,
      source,
    })
    if (!placed.ok) {
      return {
        ok: false,
        failure: { kind: 'place-failed', specifier, adapter: adapter.name, failure: placed.failure },
      }
    }

    return { ok: true, adapter, receipt: placed.receipt, warnings: placed.warnings }
  } finally {
    if (bundleCleanup) await bundleCleanup()
    if (needsCleanup && sourceDir) {
      await rm(sourceDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

const noopCleanup = async (): Promise<void> => {}

/**
 * Result of `locateAndVerifyAdapter`. On success, `bundlePath` is the
 * verified bundle ready for placement and `cleanup` removes any build
 * temp directory (callers MUST invoke it). On failure the function has
 * already cleaned up its own temp resources; the tagged failure
 * distinguishes bundle-production failures from verification failures.
 */
export type LocateAndVerifyResult =
  | { ok: true; bundlePath: string; verified: VerifiedAdapter; cleanup: () => Promise<void> }
  | {
      ok: false
      failure: { kind: 'bundle'; failure: BundleFailure } | { kind: 'verify'; failure: VerifyAdapterFailure }
    }

/**
 * Locates a usable adapter bundle from `sourceDir` and verifies it loads
 * and is API-compatible.
 *
 * Tries the fast path first (prebuilt `dist/index.mjs` or whatever the
 * package's `exports`/`main` points at). If the fast-path bundle fails to
 * *import* — typically because it still has unresolved external imports —
 * falls back to the slow path: `bun install` + `Bun.build()` on the
 * resolved entry point. Only `import-failed` is fallback-eligible: a
 * compatibility contradiction (missing/malformed/unsupported API,
 * metadata mismatch) or an invalid adapter shape is terminal, because
 * rebundling the same source cannot fix a declared contract and must
 * never silently select a different call shape.
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
  opts: { onLog?: OnLog; expectedApiVersion?: string } = {},
): Promise<LocateAndVerifyResult> {
  const resolved = await resolveEntryPoint(sourceDir)
  if (!resolved.ok) {
    return { ok: false, failure: { kind: 'bundle', failure: resolved.failure } }
  }
  const verifyOpts = { expectedApiVersion: opts.expectedApiVersion }

  if (resolved.entry.kind === 'prebuilt') {
    const prebuiltPath = resolved.entry.path
    opts.onLog?.(() => `[verbose]   using prebuilt bundle for ${basename(sourceDir)}`)
    const verifyResult = await verifyPrebuiltInIsolation(prebuiltPath, verifyOpts)
    if (verifyResult.ok) {
      return { ok: true, bundlePath: prebuiltPath, verified: verifyResult.verified, cleanup: noopCleanup }
    }
    const prebuiltFailure = verifyResult.failure
    if (prebuiltFailure.kind !== 'import-failed') {
      // Terminal: the prebuilt bundle loaded but contradicts the
      // contract (or isn't an adapter). No rebundling fallback.
      return { ok: false, failure: { kind: 'verify', failure: prebuiltFailure } }
    }
    opts.onLog?.(
      () =>
        `[verbose]   prebuilt bundle for ${basename(sourceDir)} did not load cleanly (${prebuiltFailure.cause}); rebundling from source`,
    )
    const sourceEntry = await resolveSourceEntry(sourceDir, prebuiltPath)
    return verifyBuilt(await rebundleAdapter(sourceDir, sourceEntry), verifyOpts, sourceEntry)
  }

  return verifyBuilt(await rebundleAdapter(sourceDir, resolved.entry.path), verifyOpts, resolved.entry.path)
}

/**
 * Verify a freshly rebundled adapter; on failure, clean up its temp dir.
 * `reportPath` is the durable source entry the failure should reference —
 * the temp outdir bundle is deleted by the cleanup, so reporting it would
 * point diagnostics at a nonexistent file.
 */
async function verifyBuilt(
  built: Awaited<ReturnType<typeof rebundleAdapter>>,
  verifyOpts: { expectedApiVersion?: string },
  reportPath: string,
): Promise<LocateAndVerifyResult> {
  if (!built.ok) {
    return { ok: false, failure: { kind: 'bundle', failure: built.failure } }
  }
  const result = await verifyAdapter(built.bundlePath, verifyOpts)
  if (!result.ok) {
    await built.cleanup()
    // Report the source entry, not the just-deleted temp bundle.
    return { ok: false, failure: { kind: 'verify', failure: { ...result.failure, bundlePath: reportPath } } }
  }
  return { ok: true, bundlePath: built.bundlePath, verified: result.verified, cleanup: built.cleanup }
}

async function verifyPrebuiltInIsolation(
  prebuiltPath: string,
  verifyOpts: { expectedApiVersion?: string },
): Promise<{ ok: true; verified: VerifiedAdapter } | { ok: false; failure: VerifyAdapterFailure }> {
  const isolationDir = await mkdtemp(join(tmpdir(), 'facet-adapter-verify-'))
  try {
    const isolatedPath = join(isolationDir, basename(prebuiltPath))
    await cp(prebuiltPath, isolatedPath)
    const result = await verifyAdapter(isolatedPath, verifyOpts)
    if (!result.ok) {
      // Report the original prebuilt path, not the transient isolation copy.
      return { ok: false, failure: { ...result.failure, bundlePath: prebuiltPath } }
    }
    return { ok: true, verified: result.verified }
  } finally {
    await rm(isolationDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function resolveSourceEntry(sourceDir: string, fallbackEntry: string): Promise<string> {
  const srcIndex = join(sourceDir, 'src/index.ts')
  return (await Bun.file(srcIndex).exists()) ? srcIndex : fallbackEntry
}
