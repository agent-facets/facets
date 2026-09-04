import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { facetAdaptersDir } from '../facet-dir.ts'
import { type AcquireLockResult, acquireAdapterLock, computeAdapterLockPath } from '../install/lockfile-guard.ts'
import {
  GENERATIONS_DIR_NAME,
  generationBundlePath,
  generationDir,
  INSTALLATION_RECEIPT_NAME,
  INSTALLATION_SCHEMA_VERSION,
  type InstallationReceipt,
  type InstallationSource,
  newGenerationId,
  writeInstallationReceipt,
} from './installation.ts'
import { type VerifyAdapterFailure, verifyAdapter } from './verify.ts'

/** The filename for the bundled adapter file (legacy direct layout). */
const ADAPTER_BUNDLE_FILENAME = 'adapter.js'

/**
 * Resolves the base directory for installed adapters: `$FACET_DIR/adapters/`.
 *
 * Delegates to `facetAdaptersDir()` (the single source of truth for the
 * facet directory tree). No per-subsystem env var — `FACET_DIR` is the
 * one override. Read on every call so test subprocesses with a different
 * `FACET_DIR` see the redirected path.
 *
 * A per-install `--target-dir` CLI flag was considered but deliberately
 * deferred: a per-install override would require persistent config so
 * that later invocations (`facet adapter list`, `facet build`, etc.)
 * could locate adapters installed to a non-default location. That
 * requires real config plumbing which isn't built yet.
 */
function resolveAdapterBaseDir(): string {
  return facetAdaptersDir()
}

/**
 * Returns the default base directory for all installed adapters.
 * Respects `FACET_DIR` if set.
 */
export function getAdapterBaseDir(): string {
  return resolveAdapterBaseDir()
}

/**
 * Returns the path to a specific adapter's directory.
 *
 * @param name - The adapter name
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 */
export function getAdapterDir(name: string, baseDir: string = resolveAdapterBaseDir()): string {
  return join(baseDir, name)
}

/**
 * Returns the path to an adapter's bundle file.
 *
 * @param name - The adapter name
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 */
export function getAdapterBundlePath(name: string, baseDir: string = resolveAdapterBaseDir()): string {
  return join(baseDir, name, ADAPTER_BUNDLE_FILENAME)
}

/**
 * Places a built adapter.js file into the legacy flat layout
 * (`<base>/<name>/adapter.js`) WITHOUT a receipt.
 *
 * Production installs use `placeAdapterManaged`. This helper remains for
 * tests that fabricate unmanaged historical installations.
 *
 * @param name - The adapter name (used as the directory name)
 * @param bundlePath - Absolute path to the built adapter.js file
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 */
export async function placeAdapter(
  name: string,
  bundlePath: string,
  baseDir: string = resolveAdapterBaseDir(),
): Promise<void> {
  const adapterDir = getAdapterDir(name, baseDir)
  await mkdir(adapterDir, { recursive: true })

  const destPath = getAdapterBundlePath(name, baseDir)
  const content = await Bun.file(bundlePath).arrayBuffer()
  await Bun.write(destPath, content)
}

/** Non-fatal issue after successful activation (old-state cleanup). */
export type PlacementWarning = { kind: 'cleanup-failed'; path: string; cause: string }

/**
 * Discriminated failure for `placeAdapterManaged`. Every failure leaves
 * the previous installation (receipt, active generation, legacy bundle)
 * byte-for-byte unchanged.
 */
export type PlaceAdapterFailure =
  | { kind: 'lock-held'; adapter: string; heldByPid: number; lockPath: string }
  | { kind: 'lock-io'; adapter: string; lockPath: string; code?: string; cause: string }
  | { kind: 'stage-failed'; adapter: string; cause: string }
  | { kind: 'verify-failed'; adapter: string; failure: VerifyAdapterFailure }
  | { kind: 'name-mismatch'; adapter: string; runtimeName: string }
  | { kind: 'receipt-write-failed'; adapter: string; cause: string }

export type PlaceAdapterResult =
  | { ok: true; receipt: InstallationReceipt; warnings: PlacementWarning[] }
  | { ok: false; failure: PlaceAdapterFailure }

/** Provenance recorded in the receipt at activation. */
export interface PlacementProvenance {
  /** The verified runtime adapter SDK API of the candidate. */
  apiVersion: string
  source: InstallationSource
}

/**
 * Install a verified candidate bundle as the active managed installation
 * for `name`, atomically.
 *
 * Sequence (design decision 5):
 *   1. acquire the per-adapter replacement lock;
 *   2. copy the bundle into a fresh unique generation directory on the
 *      same filesystem as the receipt;
 *   3. re-verify the bundle at its final staged path (runtime API must
 *      equal `provenance.apiVersion`; runtime name must equal `name`);
 *   4. atomically replace `installation.json` — the activation switch;
 *   5. best-effort cleanup of non-active generations and the legacy
 *      direct bundle (failures are warnings, never install failures).
 *
 * Any failure before step 4 removes the staged generation and leaves
 * the previous installation untouched and active.
 */
export async function placeAdapterManaged(
  name: string,
  bundlePath: string,
  provenance: PlacementProvenance,
  baseDir: string = resolveAdapterBaseDir(),
): Promise<PlaceAdapterResult> {
  const adapterDir = getAdapterDir(name, baseDir)

  // 1. Acquire the per-adapter replacement lock. Lock-file I/O failures
  // (unwritable or read-only $FACET_DIR, locks path occupied by a file)
  // are expected environmental failures — classify them at this boundary
  // so the documented result contract holds instead of rejecting.
  let lockResult: AcquireLockResult
  try {
    lockResult = acquireAdapterLock(name)
  } catch (err) {
    return {
      ok: false,
      failure: {
        kind: 'lock-io',
        adapter: name,
        lockPath: computeAdapterLockPath(name),
        code: (err as NodeJS.ErrnoException | undefined)?.code,
        cause: err instanceof Error ? err.message : String(err),
      },
    }
  }
  if (!lockResult.ok) {
    return {
      ok: false,
      failure: { kind: 'lock-held', adapter: name, heldByPid: lockResult.heldByPid, lockPath: lockResult.path },
    }
  }

  const generationId = newGenerationId()
  // Non-null by construction: newGenerationId always mints a safe segment.
  const genDir = generationDir(adapterDir, generationId)
  if (genDir === null) {
    await lockResult.lock.release()
    return { ok: false, failure: { kind: 'stage-failed', adapter: name, cause: 'generated id failed containment' } }
  }

  const removeStaged = async (): Promise<void> => {
    await rm(genDir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    // 2. Stage the bundle into its final generation directory.
    const stagedBundle = generationBundlePath(genDir)
    try {
      await mkdir(genDir, { recursive: true })
      await cp(bundlePath, stagedBundle)
    } catch (err) {
      await removeStaged()
      return {
        ok: false,
        failure: { kind: 'stage-failed', adapter: name, cause: err instanceof Error ? err.message : String(err) },
      }
    }

    // 3. Verify the exact bytes that will be activated, at their final path.
    const verified = await verifyAdapter(stagedBundle, { expectedApiVersion: provenance.apiVersion })
    if (!verified.ok) {
      await removeStaged()
      return { ok: false, failure: { kind: 'verify-failed', adapter: name, failure: verified.failure } }
    }
    if (verified.verified.adapter.name !== name) {
      await removeStaged()
      return {
        ok: false,
        failure: { kind: 'name-mismatch', adapter: name, runtimeName: verified.verified.adapter.name },
      }
    }

    // 4. Atomic activation: replace the receipt in one rename.
    const receipt: InstallationReceipt = {
      schemaVersion: INSTALLATION_SCHEMA_VERSION,
      activeGeneration: generationId,
      apiVersion: verified.verified.adapter.apiVersion,
      source: provenance.source,
    }
    try {
      writeInstallationReceipt(adapterDir, receipt)
    } catch (err) {
      await removeStaged()
      return {
        ok: false,
        failure: {
          kind: 'receipt-write-failed',
          adapter: name,
          cause: err instanceof Error ? err.message : String(err),
        },
      }
    }

    // 5. Post-activation cleanup — warnings only.
    const warnings: PlacementWarning[] = []
    const generationsDir = join(adapterDir, GENERATIONS_DIR_NAME)
    let staleGenerations: string[] = []
    try {
      staleGenerations = (await readdir(generationsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name !== generationId)
        .map((entry) => entry.name)
    } catch {
      // generations dir unreadable — nothing to clean.
    }
    for (const stale of staleGenerations) {
      const stalePath = join(generationsDir, stale)
      try {
        await rm(stalePath, { recursive: true, force: true })
      } catch (err) {
        warnings.push({
          kind: 'cleanup-failed',
          path: stalePath,
          cause: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const legacyBundle = getAdapterBundlePath(name, baseDir)
    if (await Bun.file(legacyBundle).exists()) {
      try {
        await rm(legacyBundle, { force: true })
      } catch (err) {
        warnings.push({
          kind: 'cleanup-failed',
          path: legacyBundle,
          cause: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { ok: true, receipt, warnings }
  } finally {
    await lockResult.lock.release()
  }
}

/**
 * True when a directory holds an adapter installation: a managed
 * receipt (valid or not — an invalid receipt is still an installation
 * the user must be able to remove and see listed as broken) or a legacy
 * direct bundle. Directories containing only staging/crash leftovers
 * (e.g. an orphaned `generations/` tree) do not qualify.
 */
async function isInstallationDir(adapterDir: string): Promise<boolean> {
  if (await Bun.file(join(adapterDir, INSTALLATION_RECEIPT_NAME)).exists()) return true
  return Bun.file(join(adapterDir, ADAPTER_BUNDLE_FILENAME)).exists()
}

/**
 * Removes an installed adapter by deleting its whole directory —
 * without loading or verifying it, so incompatible and broken
 * installations remain removable.
 *
 * @param name - The adapter name to remove
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 * @returns true if the adapter was removed, false if it didn't exist
 */
export async function removeAdapter(name: string, baseDir: string = resolveAdapterBaseDir()): Promise<boolean> {
  const adapterDir = getAdapterDir(name, baseDir)
  if (!(await isInstallationDir(adapterDir))) {
    return false
  }

  await rm(adapterDir, { recursive: true, force: true })
  return true
}

/**
 * Lists the names of all installed adapters by scanning the base
 * directory. An entry qualifies when it holds a managed receipt or a
 * legacy direct bundle; staging/crash leftovers are ignored.
 *
 * @param baseDir - Base directory for installed adapters (defaults to the
 *   resolved base dir, which honors `FACET_DIR`).
 */
export async function listInstalledAdapters(baseDir: string = resolveAdapterBaseDir()): Promise<string[]> {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    const names: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory() && (await isInstallationDir(join(baseDir, entry.name)))) {
        names.push(entry.name)
      }
    }

    return names.sort()
  } catch {
    // Directory doesn't exist yet
    return []
  }
}
