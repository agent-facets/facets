import { type AdapterCompatibilityFailure, compatibilityFailureFor } from './api-compatibility.ts'
import { FIRST_PARTY_ADAPTERS } from './first-party.ts'
import { generationBundlePath, generationDir, readInstallationReceipt } from './installation.ts'
import { getAdapterBundlePath, getAdapterDir, listInstalledAdapters } from './placement.ts'
import { type VerifiedAdapter, type VerifyAdapterFailure, verifyAdapter } from './verify.ts'

/**
 * Shared installed-adapter inspection — the single path used by runtime
 * loading and `facet adapter list`. Every installation directory
 * produces exactly one tagged outcome; consumers fail closed on
 * anything that is not `compatible`.
 */

/**
 * How the user can repair or replace this installation.
 *
 *   - `managed` — the receipt retains the original install specifier.
 *   - `first-party-alias` — unmanaged, but the directory name is a
 *     first-party catalog alias, which is itself a valid specifier.
 *   - `unmanaged-name` — unmanaged and unknown; the name is the best
 *     available specifier and original source provenance is unavailable.
 */
export type RepairSource =
  | { kind: 'managed'; specifier: string }
  | { kind: 'first-party-alias'; alias: string }
  | { kind: 'unmanaged-name'; name: string }

/** Why an installation is broken (as opposed to API-incompatible). */
export type BrokenReason =
  | { kind: 'invalid-receipt'; detail: string }
  | { kind: 'missing-active-generation'; generation: string }
  | { kind: 'load-failed'; failure: VerifyAdapterFailure }

/**
 * One tagged outcome per installation directory:
 *
 *   - `compatible` — verified adapter with a supported runtime API.
 *   - `incompatible` — structurally sound, but its API declaration is
 *     missing, malformed, unsupported, or contradicts the receipt.
 *   - `broken` — invalid installation metadata, unresolvable active
 *     generation, unloadable bundle, or invalid adapter export.
 *     `declaredApi` carries the receipt's recorded API when one exists.
 */
export type InstalledAdapterInspection =
  | { kind: 'compatible'; name: string; managed: boolean; verified: VerifiedAdapter; repair: RepairSource }
  | { kind: 'incompatible'; name: string; managed: boolean; failure: AdapterCompatibilityFailure; repair: RepairSource }
  | {
      kind: 'broken'
      name: string
      managed: boolean
      reason: BrokenReason
      declaredApi?: string
      repair: RepairSource
    }

/** Best available repair source for an entry without a usable receipt. */
function unmanagedRepair(name: string): RepairSource {
  const isFirstParty = FIRST_PARTY_ADAPTERS.some((adapter) => adapter.name === name)
  return isFirstParty ? { kind: 'first-party-alias', alias: name } : { kind: 'unmanaged-name', name }
}

/**
 * Inspect every installed adapter directory under `baseDir`, in sorted
 * name order. Staging/crash leftovers are not installations and are
 * already excluded by enumeration.
 */
export async function inspectInstalledAdapters(baseDir?: string): Promise<InstalledAdapterInspection[]> {
  const names = await listInstalledAdapters(baseDir)
  const inspections: InstalledAdapterInspection[] = []
  for (const name of names) {
    inspections.push(await inspectInstalledAdapter(name, baseDir))
  }
  return inspections
}

/** Inspect one installed adapter directory. */
export async function inspectInstalledAdapter(name: string, baseDir?: string): Promise<InstalledAdapterInspection> {
  const adapterDir = getAdapterDir(name, baseDir)
  const receipt = await readInstallationReceipt(adapterDir)

  if (receipt.ok) {
    return inspectManaged(name, adapterDir, receipt.receipt)
  }
  if (receipt.reason === 'invalid') {
    return {
      kind: 'broken',
      name,
      managed: true,
      reason: { kind: 'invalid-receipt', detail: receipt.detail },
      repair: unmanagedRepair(name),
    }
  }

  // No receipt: unmanaged historical `<name>/adapter.js` layout.
  return inspectUnmanaged(name, baseDir)
}

async function inspectManaged(
  name: string,
  adapterDir: string,
  receipt: { activeGeneration: string; apiVersion: string; source: { specifier: string } },
): Promise<InstalledAdapterInspection> {
  const repair: RepairSource = { kind: 'managed', specifier: receipt.source.specifier }

  // Reject a recorded unsupported API before importing anything — a
  // known-incompatible install must not run module initialization.
  const recordedFailure = compatibilityFailureFor(name, receipt.apiVersion)
  if (recordedFailure !== null) {
    return { kind: 'incompatible', name, managed: true, failure: recordedFailure, repair }
  }

  const genDir = generationDir(adapterDir, receipt.activeGeneration)
  if (genDir === null) {
    // Unreachable for a validated receipt; classify honestly anyway.
    return {
      kind: 'broken',
      name,
      managed: true,
      reason: { kind: 'invalid-receipt', detail: 'active generation failed containment' },
      declaredApi: receipt.apiVersion,
      repair,
    }
  }
  const bundlePath = generationBundlePath(genDir)
  if (!(await Bun.file(bundlePath).exists())) {
    return {
      kind: 'broken',
      name,
      managed: true,
      reason: { kind: 'missing-active-generation', generation: receipt.activeGeneration },
      declaredApi: receipt.apiVersion,
      repair,
    }
  }

  // The receipt's API is the expected declaration; a runtime
  // disagreement classifies as api-metadata-mismatch.
  const verified = await verifyAdapter(bundlePath, { expectedApiVersion: receipt.apiVersion })
  if (verified.ok) {
    return { kind: 'compatible', name, managed: true, verified: verified.verified, repair }
  }
  if (verified.failure.kind === 'incompatible') {
    return { kind: 'incompatible', name, managed: true, failure: verified.failure.failure, repair }
  }
  return {
    kind: 'broken',
    name,
    managed: true,
    reason: { kind: 'load-failed', failure: verified.failure },
    declaredApi: receipt.apiVersion,
    repair,
  }
}

async function inspectUnmanaged(name: string, baseDir?: string): Promise<InstalledAdapterInspection> {
  const repair = unmanagedRepair(name)
  const bundlePath = getAdapterBundlePath(name, baseDir)

  const verified = await verifyAdapter(bundlePath)
  if (verified.ok) {
    return { kind: 'compatible', name, managed: false, verified: verified.verified, repair }
  }
  if (verified.failure.kind === 'incompatible') {
    return { kind: 'incompatible', name, managed: false, failure: verified.failure.failure, repair }
  }
  return { kind: 'broken', name, managed: false, reason: { kind: 'load-failed', failure: verified.failure }, repair }
}
