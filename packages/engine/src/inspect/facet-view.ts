import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ValidationError } from '@agent-facets/common'
import {
  type FacetManifest,
  lockedDispositionOf,
  type MaterializationDisposition,
  type SupportedLockfileFacet,
  validateFacetManifest,
} from '@agent-facets/protocol'
import { auditCacheSlot, cacheGet, readCachedIntegrity } from '../cache/index.ts'
import { loadLockfile } from '../install/lockfile-io.ts'
import { ownEntry } from '../install/own-entry.ts'
import { loadManifest } from '../loaders/facet.ts'
import { type LoadProjectManifestResult, loadProjectManifest } from '../manifest/project-files.ts'
import { fetchRegistryVersionContents, type RegistryVersionContents } from '../registry/contents.ts'
import type { RegistryError, RegistryResult } from '../registry/types.ts'
import { fetchRegistryVersionDetails, type RegistryVersionDetails } from '../registry/version-details.ts'
import { parseVersionSpec } from '../sources/facet/parse-version.ts'
import { classifyBytes } from './classify.ts'
import { containedPath } from './contained-path.ts'
import { declaredFiles, type InspectAssetType } from './selector.ts'

export type FacetViewOrigin =
  | {
      kind: 'installed'
      /** Where the bytes were read: the audited cache slot, the registry, or a local source directory. */
      from: 'cache' | 'registry' | 'local-path'
      sourceKind: 'registry' | 'git' | 'local'
      /** The specifier `facets.json` declares, as written. */
      authored: string
    }
  | { kind: 'registry-latest' }

export type LoadFacetViewFailure =
  | { code: 'project-manifest'; result: Extract<LoadProjectManifestResult, { ok: false }> }
  | { code: 'lockfile-unreadable'; error: string }
  | { code: 'registry'; error: RegistryError }
  | { code: 'manifest-invalid'; errors: ValidationError[] }
  | { code: 'name-mismatch'; manifestName: string }
  | { code: 'integrity-mismatch'; expected: string; observed: string }
  | { code: 'local-copy-unavailable'; sourceKind: 'registry' | 'git' | 'local' }

export type FacetFileRead =
  | { ok: true; kind: 'text'; content: string }
  | { ok: true; kind: 'binary'; sizeBytes: number }
  /** `unsafe`: a symlink, hard link, or non-regular file, or a path that resolves outside the facet. */
  | { ok: false; code: 'not-declared' | 'unreadable' | 'unsafe' }
  | { ok: false; code: 'registry'; error: RegistryError }
  | { ok: false; code: 'integrity-mismatch'; expected: string; observed: string }

export interface FacetView {
  name: string
  version: string
  manifest: FacetManifest
  origin: FacetViewOrigin
  /** Present whenever this view was read from the registry. */
  details?: RegistryVersionDetails
  disposition(type: InspectAssetType | 'server', authoredName: string): MaterializationDisposition
  /** Read a declared file. A path the manifest does not declare is refused without any I/O. */
  readFile(path: string): Promise<FacetFileRead>
  /**
   * Absolute path of a declared file on this machine, when the view was read
   * from local bytes and the file passes the same checks as `readFile`.
   */
  localPath(path: string): Promise<string | undefined>
}

export type LoadFacetViewResult = { ok: true; view: FacetView } | { ok: false; failure: LoadFacetViewFailure }

/**
 * Load what `facet info` and `facet cat` show for one facet.
 *
 * A facet the project declares and locks is shown at its locked
 * version: from the cache slot when the slot audits clean and matches
 * the locked integrity; otherwise, for a registry facet, from the
 * registry at the locked version, checked against the locked integrity.
 * Any other facet is shown at the registry's latest version.
 *
 * Read-only. Unlike install's locked-hit path, a slot that fails its
 * audit is left in place, not evicted: inspecting a facet must not
 * change what the next install sees.
 */
export async function loadFacetView(projectRoot: string, name: string): Promise<LoadFacetViewResult> {
  const project = loadProjectManifest(projectRoot)
  if (!project.ok) return fail({ code: 'project-manifest', result: project })

  const declared = ownEntry(project.manifest.facets, name)
  if (declared !== undefined) {
    const lockfile = loadLockfile(projectRoot)
    if (!lockfile.ok) return fail({ code: 'lockfile-unreadable', error: lockfile.error })
    const locked = ownEntry(lockfile.parsed.lockfile.facets, name)
    if (locked !== undefined) return loadInstalled(projectRoot, name, declared.source, locked)
  }

  return loadLatest(name)
}

async function loadInstalled(
  projectRoot: string,
  name: string,
  authored: string,
  locked: SupportedLockfileFacet,
): Promise<LoadFacetViewResult> {
  const sourceKind = locked.source.kind
  const disposition = lockedDispositions(locked)
  const origin = (from: 'cache' | 'registry' | 'local-path'): FacetViewOrigin => ({
    kind: 'installed',
    from,
    sourceKind,
    authored,
  })

  if (locked.source.kind === 'local') {
    const root = resolve(projectRoot, locked.source.path)
    return fromLocalBytes(name, locked.version, root, origin('local-path'), disposition)
  }

  const slot = cacheGet({ kind: sourceKind === 'git' ? 'git' : 'registry', name, version: locked.version })
  if (slot.hit && slotMatchesLock(slot.path, locked.integrity)) {
    return fromLocalBytes(name, locked.version, slot.path, origin('cache'), disposition)
  }

  if (sourceKind !== 'registry') {
    return fail({ code: 'local-copy-unavailable', sourceKind })
  }

  const exact = parseVersionSpec(locked.version)
  if (!exact.ok) return fail({ code: 'local-copy-unavailable', sourceKind })
  const details = await fetchRegistryVersionDetails({ name, version: exact.value })
  if (!details.ok) return fail({ code: 'registry', error: details.error })
  if (details.value.contentFingerprint !== locked.integrity) {
    return fail({ code: 'integrity-mismatch', expected: locked.integrity, observed: details.value.contentFingerprint })
  }
  return fromRegistry(details.value, locked.integrity, origin('registry'), disposition)
}

async function loadLatest(name: string): Promise<LoadFacetViewResult> {
  const details = await fetchRegistryVersionDetails({ name, version: { kind: 'latest' } })
  if (!details.ok) return fail({ code: 'registry', error: details.error })
  return fromRegistry(details.value, details.value.contentFingerprint, { kind: 'registry-latest' }, () => ({
    kind: 'authored',
  }))
}

async function fromLocalBytes(
  name: string,
  version: string,
  root: string,
  origin: FacetViewOrigin,
  disposition: FacetView['disposition'],
): Promise<LoadFacetViewResult> {
  const loaded = await loadManifest(root)
  if (!loaded.ok) {
    return origin.kind === 'installed' && origin.from === 'local-path'
      ? fail({ code: 'local-copy-unavailable', sourceKind: 'local' })
      : fail({ code: 'manifest-invalid', errors: loaded.errors })
  }
  if (loaded.data.name !== name) return fail({ code: 'name-mismatch', manifestName: loaded.data.name })
  const manifest = loaded.data
  const declared = new Set(declaredFiles(manifest).map((file) => file.path))

  return {
    ok: true,
    view: {
      name,
      version,
      manifest,
      origin,
      disposition,
      readFile: async (path) => {
        if (!declared.has(path)) return { ok: false, code: 'not-declared' }
        const contained = await containedPath(root, path)
        if (!contained.ok) return { ok: false, code: contained.code === 'unsafe' ? 'unsafe' : 'unreadable' }
        let bytes: Uint8Array
        try {
          bytes = await readFile(contained.path)
        } catch {
          return { ok: false, code: 'unreadable' }
        }
        return { ok: true, ...classifyBytes(bytes) }
      },
      localPath: async (path) => {
        if (!declared.has(path)) return undefined
        const contained = await containedPath(root, path)
        return contained.ok ? contained.path : undefined
      },
    },
  }
}

function fromRegistry(
  details: RegistryVersionDetails,
  expectedIntegrity: string,
  origin: FacetViewOrigin,
  disposition: FacetView['disposition'],
): LoadFacetViewResult {
  const parsed = validateFacetManifest(details.manifestJson)
  if (!parsed.ok) return fail({ code: 'manifest-invalid', errors: parsed.errors })
  if (parsed.data.name !== details.name) return fail({ code: 'name-mismatch', manifestName: parsed.data.name })
  const manifest = parsed.data
  const declared = new Set(declaredFiles(manifest).map((file) => file.path))

  let contents: Promise<RegistryResult<RegistryVersionContents>> | undefined
  const loadContents = () => {
    contents ??= fetchRegistryVersionContents(details.name, details.version)
    return contents
  }

  return {
    ok: true,
    view: {
      name: details.name,
      version: details.version,
      manifest,
      origin,
      details,
      disposition,
      readFile: async (path) => {
        if (!declared.has(path)) return { ok: false, code: 'not-declared' }
        // The contents endpoint omits the manifest; this is the document the summary was parsed from.
        if (path === 'facet.json') return { ok: true, kind: 'text', content: details.manifestJson }
        const loaded = await loadContents()
        if (!loaded.ok) return { ok: false, code: 'registry', error: loaded.error }
        if (loaded.value.contentFingerprint !== expectedIntegrity) {
          return {
            ok: false,
            code: 'integrity-mismatch',
            expected: expectedIntegrity,
            observed: loaded.value.contentFingerprint,
          }
        }
        const file = loaded.value.files.get(path)
        if (file === undefined) return { ok: false, code: 'unreadable' }
        return file.kind === 'text'
          ? { ok: true, kind: 'text', content: file.content }
          : { ok: true, kind: 'binary', sizeBytes: file.sizeBytes }
      },
      localPath: async () => undefined,
    },
  }
}

function slotMatchesLock(slotPath: string, lockedIntegrity: string): boolean {
  const sidecar = readCachedIntegrity(slotPath)
  if (sidecar === null || sidecar.integrity !== lockedIntegrity) return false
  return auditCacheSlot(slotPath, sidecar).ok
}

function lockedDispositions(locked: SupportedLockfileFacet): FacetView['disposition'] {
  return (type, authoredName) => {
    if (type === 'server') {
      const server =
        'servers' in locked && Array.isArray(locked.servers)
          ? locked.servers.find((record) => record.name === authoredName)
          : undefined
      return server?.materialization ?? { kind: 'authored' }
    }
    const asset = locked.assets.find((entry) => entry.type === type && entry.name === authoredName)
    return asset === undefined ? { kind: 'authored' } : lockedDispositionOf(asset)
  }
}

function fail(failure: LoadFacetViewFailure): LoadFacetViewResult {
  return { ok: false, failure }
}
