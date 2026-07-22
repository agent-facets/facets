import { join, relative, resolve, sep } from 'node:path'
import { atomicWriteFileSync } from '@agent-facets/common'
import { jsonFileText } from '../json-file-text.ts'

/**
 * Managed adapter installation receipts.
 *
 * A managed adapter directory looks like:
 *
 *   $FACET_DIR/adapters/<name>/
 *   ├── installation.json          ← atomic activation record (this module)
 *   └── generations/<generation-id>/adapter.js
 *
 * `installation.json` is the single pointer that decides which generation
 * is active. Replacing it with `atomicWriteFileSync` (tmp + same-dir
 * rename) IS the activation switch — everything staged before that
 * rename is invisible to loaders.
 */

export const INSTALLATION_RECEIPT_NAME = 'installation.json'
export const GENERATIONS_DIR_NAME = 'generations'
export const INSTALLATION_SCHEMA_VERSION = 1

/**
 * Tagged source provenance. Source-specific fields live only on their
 * variant so impossible npm/git/local combinations cannot be
 * constructed. `specifier` is always the original user input — the
 * repair command renders `facet adapter install <specifier>`.
 */
export type InstallationSource =
  | {
      kind: 'npm'
      specifier: string
      packageName: string
      /** Exact resolved package version (M.N.P). */
      version: string
      /** The registry integrity anchor that authenticated the tarball. */
      integrity: { kind: 'sri' | 'shasum'; value: string }
    }
  | { kind: 'git'; specifier: string; url: string; ref?: string }
  | { kind: 'local'; specifier: string; sourcePath: string }

export interface InstallationReceipt {
  schemaVersion: typeof INSTALLATION_SCHEMA_VERSION
  /** The sole active generation id — a validated safe path segment. */
  activeGeneration: string
  /** The verified runtime adapter API at activation time. */
  apiVersion: string
  source: InstallationSource
}

/**
 * A generation id must be one safe path segment: alphanumeric start,
 * then alphanumerics, dots, underscores, or hyphens. This shape cannot
 * contain a separator, be empty, or start with a dot — so `..`,
 * absolute paths, and hidden entries are unrepresentable.
 */
const GENERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** True iff `id` is a safe single-segment generation id. */
export function isSafeGenerationId(id: string): boolean {
  return GENERATION_ID_RE.test(id) && !id.includes('..')
}

/** Mint a fresh, unique generation id (time-ordered plus random suffix). */
export function newGenerationId(): string {
  const random = Math.random().toString(16).slice(2, 10).padEnd(8, '0')
  return `gen-${Date.now()}-${random}`
}

/**
 * Resolve the directory of a generation, containment-checked against
 * the adapter directory. Returns null when the id is unsafe or the
 * derived path escapes — callers treat that as an invalid receipt, not
 * a path to read or delete.
 */
export function generationDir(adapterDir: string, generationId: string): string | null {
  if (!isSafeGenerationId(generationId)) return null
  const dir = resolve(adapterDir, GENERATIONS_DIR_NAME, generationId)
  const rel = relative(resolve(adapterDir), dir)
  if (rel.startsWith('..') || rel.split(sep).some((segment) => segment === '..')) return null
  return dir
}

/** Path of the active bundle inside a generation directory. */
export function generationBundlePath(genDir: string): string {
  return join(genDir, 'adapter.js')
}

export type ReadReceiptResult =
  | { ok: true; receipt: InstallationReceipt }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'invalid'; detail: string }

/**
 * Read and validate `installation.json` from an adapter directory.
 * Never throws for expected failures; malformed JSON, unknown shapes,
 * unknown source kinds, and unsafe generation ids all classify as
 * `invalid` with a human-readable detail (rendered by the CLI).
 */
export async function readInstallationReceipt(adapterDir: string): Promise<ReadReceiptResult> {
  const path = join(adapterDir, INSTALLATION_RECEIPT_NAME)
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return { ok: false, reason: 'not-found' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch (err) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return validateReceipt(parsed)
}

/** Pure receipt validation, exported for direct unit testing. */
export function validateReceipt(parsed: unknown): ReadReceiptResult {
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'invalid', detail: 'receipt is not an object' }
  }
  const record = parsed as Record<string, unknown>

  if (record.schemaVersion !== INSTALLATION_SCHEMA_VERSION) {
    return { ok: false, reason: 'invalid', detail: `unsupported schemaVersion ${String(record.schemaVersion)}` }
  }
  if (typeof record.activeGeneration !== 'string' || !isSafeGenerationId(record.activeGeneration)) {
    return { ok: false, reason: 'invalid', detail: 'activeGeneration is not a safe path segment' }
  }
  if (typeof record.apiVersion !== 'string' || record.apiVersion.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'apiVersion is missing' }
  }

  const source = validateSource(record.source)
  if (!source.ok) return source

  return {
    ok: true,
    receipt: {
      schemaVersion: INSTALLATION_SCHEMA_VERSION,
      activeGeneration: record.activeGeneration,
      apiVersion: record.apiVersion,
      source: source.source,
    },
  }
}

function validateSource(
  value: unknown,
): { ok: true; source: InstallationSource } | { ok: false; reason: 'invalid'; detail: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'invalid', detail: 'source is not an object' }
  }
  const record = value as Record<string, unknown>
  if (typeof record.specifier !== 'string' || record.specifier.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'source.specifier is missing' }
  }

  switch (record.kind) {
    case 'npm': {
      if (typeof record.packageName !== 'string' || record.packageName.length === 0) {
        return { ok: false, reason: 'invalid', detail: 'npm source.packageName is missing' }
      }
      if (typeof record.version !== 'string' || record.version.length === 0) {
        return { ok: false, reason: 'invalid', detail: 'npm source.version is missing' }
      }
      const integrity = record.integrity as Record<string, unknown> | null | undefined
      if (
        typeof integrity !== 'object' ||
        integrity === null ||
        (integrity.kind !== 'sri' && integrity.kind !== 'shasum') ||
        typeof integrity.value !== 'string' ||
        integrity.value.length === 0
      ) {
        return { ok: false, reason: 'invalid', detail: 'npm source.integrity is missing or malformed' }
      }
      return {
        ok: true,
        source: {
          kind: 'npm',
          specifier: record.specifier,
          packageName: record.packageName,
          version: record.version,
          integrity: { kind: integrity.kind, value: integrity.value },
        },
      }
    }
    case 'git': {
      if (typeof record.url !== 'string' || record.url.length === 0) {
        return { ok: false, reason: 'invalid', detail: 'git source.url is missing' }
      }
      if (record.ref !== undefined && typeof record.ref !== 'string') {
        return { ok: false, reason: 'invalid', detail: 'git source.ref is not a string' }
      }
      return {
        ok: true,
        source: {
          kind: 'git',
          specifier: record.specifier,
          url: record.url,
          ...(record.ref !== undefined ? { ref: record.ref } : {}),
        },
      }
    }
    case 'local': {
      if (typeof record.sourcePath !== 'string' || record.sourcePath.length === 0) {
        return { ok: false, reason: 'invalid', detail: 'local source.sourcePath is missing' }
      }
      return { ok: true, source: { kind: 'local', specifier: record.specifier, sourcePath: record.sourcePath } }
    }
    default:
      return { ok: false, reason: 'invalid', detail: `unknown source.kind ${String(record.kind)}` }
  }
}

/**
 * Atomically write `installation.json` — this is the activation switch.
 * The tmp file lives in the same directory, so the rename is atomic on
 * every POSIX filesystem.
 */
export function writeInstallationReceipt(adapterDir: string, receipt: InstallationReceipt): void {
  atomicWriteFileSync(join(adapterDir, INSTALLATION_RECEIPT_NAME), jsonFileText(receipt))
}
