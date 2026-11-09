import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ValidationError } from '@agent-facets/common'
import {
  type FacetManifest,
  lockedDispositionOf,
  type MaterializationDisposition,
  type SupportedLockfileFacet,
} from '@agent-facets/protocol'
import { auditCacheSlot, cacheGet, readCachedIntegrity } from '../cache/index.ts'
import { loadLockfile } from '../install/lockfile-io.ts'
import { ownEntry } from '../install/own-entry.ts'
import { loadManifest } from '../loaders/facet.ts'
import { type LoadProjectManifestResult, loadProjectManifest } from '../manifest/project-files.ts'
import { classifyBytes } from './classify.ts'
import { containedPath } from './contained-path.ts'
import { declaredFiles, type InspectAssetType } from './selector.ts'

export type FacetViewOrigin = {
  kind: 'installed'
  /** Where the bytes were read: the audited cache slot, or a local source directory. */
  from: 'cache' | 'local-path'
  sourceKind: 'registry' | 'git' | 'local'
  /** The specifier `facets.json` declares, as written. */
  authored: string
}

export type LoadFacetViewFailure =
  | { code: 'project-manifest'; result: Extract<LoadProjectManifestResult, { ok: false }> }
  | { code: 'lockfile-unreadable'; error: string }
  | { code: 'not-installed' }
  | { code: 'manifest-invalid'; errors: ValidationError[] }
  | { code: 'name-mismatch'; manifestName: string }
  | { code: 'local-copy-unavailable'; sourceKind: 'registry' | 'git' | 'local' }

export type FacetFileRead =
  | { ok: true; kind: 'text'; content: string }
  | { ok: true; kind: 'binary'; sizeBytes: number }
  /** `unsafe`: a symlink, hard link, or non-regular file, or a path that resolves outside the facet. */
  | { ok: false; code: 'not-declared' | 'unreadable' | 'unsafe' }

export interface FacetView {
  name: string
  version: string
  manifest: FacetManifest
  origin: FacetViewOrigin
  disposition(type: InspectAssetType | 'server', authoredName: string): MaterializationDisposition
  /** Read a declared file. A path the manifest does not declare is refused without any I/O. */
  readFile(path: string): Promise<FacetFileRead>
  /** Absolute path of a declared file on this machine, when it passes the same checks as `readFile`. */
  localPath(path: string): Promise<string | undefined>
}

export type LoadFacetViewResult = { ok: true; view: FacetView } | { ok: false; failure: LoadFacetViewFailure }

/**
 * Load what `facet info` and `facet cat` show for an installed facet,
 * from its verified local copy and without contacting the registry.
 *
 * A registry or git facet is read from its cache slot, and only when the
 * slot audits clean and matches the locked integrity. A local facet is
 * read from its source directory, as install reads it.
 *
 * Read-only. Unlike install's locked-hit path, a slot that fails its
 * audit is left in place, not evicted: inspecting a facet must not
 * change what the next install sees.
 */
export async function loadFacetView(projectRoot: string, name: string): Promise<LoadFacetViewResult> {
  const project = loadProjectManifest(projectRoot)
  if (!project.ok) return fail({ code: 'project-manifest', result: project })

  const declared = ownEntry(project.manifest.facets, name)
  if (declared === undefined) return fail({ code: 'not-installed' })
  const lockfile = loadLockfile(projectRoot)
  if (!lockfile.ok) return fail({ code: 'lockfile-unreadable', error: lockfile.error })
  const locked = ownEntry(lockfile.parsed.lockfile.facets, name)
  if (locked === undefined) return fail({ code: 'not-installed' })

  const sourceKind = locked.source.kind
  const origin = (from: 'cache' | 'local-path'): FacetViewOrigin => ({
    kind: 'installed',
    from,
    sourceKind,
    authored: declared.source,
  })

  if (locked.source.kind === 'local') {
    return fromLocalBytes(name, locked, resolve(projectRoot, locked.source.path), origin('local-path'))
  }

  const slot = cacheGet({ kind: sourceKind === 'git' ? 'git' : 'registry', name, version: locked.version })
  if (slot.hit && slotMatchesLock(slot.path, locked.integrity)) {
    return fromLocalBytes(name, locked, slot.path, origin('cache'))
  }
  return fail({ code: 'local-copy-unavailable', sourceKind })
}

async function fromLocalBytes(
  name: string,
  locked: SupportedLockfileFacet,
  root: string,
  origin: FacetViewOrigin,
): Promise<LoadFacetViewResult> {
  const loaded = await loadManifest(root)
  if (!loaded.ok) {
    return origin.from === 'local-path'
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
      version: locked.version,
      manifest,
      origin,
      disposition: lockedDispositions(locked),
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
