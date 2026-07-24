import type { FacetManifest } from '@agent-facets/protocol'
import { isReadmePath } from '../readme.ts'
import type { ReconciliationItem } from './types.ts'

/** Disk facts about supplementary files, gathered by the context builder. */
export interface SupplementaryDiscovery {
  /** Declared skill name → companion relPaths present on disk (excludes SKILL.md). */
  companionsBySkill: Record<string, string[]>
  /**
   * Repo-relative top-level paths present on disk that are candidates for
   * reconciliation: the union of present common root files and present declared
   * top-level files. README paths are excluded (handled by the README panel).
   */
  presentRootFiles: string[]
}

/**
 * Pure reconciliation of supplementary declarations against disk facts. Emits
 * companion additions/missings per declared skill and top-level (root) file
 * additions/missings, all as structured items. README paths never appear here.
 */
export function reconcileSupplementary(manifest: FacetManifest, disc: SupplementaryDiscovery): ReconciliationItem[] {
  const items: ReconciliationItem[] = []

  // Companions, per declared skill.
  for (const [skill, descriptor] of Object.entries(manifest.skills ?? {})) {
    const declared = new Set(descriptor.files ?? [])
    const onDisk = disc.companionsBySkill[skill] ?? []
    const onDiskSet = new Set(onDisk)
    for (const relPath of onDisk) {
      if (!declared.has(relPath)) {
        items.push({ kind: 'companion-addition', skill, relPath, path: `skills/${skill}/${relPath}` })
      }
    }
    for (const relPath of declared) {
      if (!onDiskSet.has(relPath)) {
        items.push({ kind: 'companion-missing', skill, relPath, expectedPath: `skills/${skill}/${relPath}` })
      }
    }
  }

  // Top-level supplementary files, excluding README (README panel owns those).
  const present = new Set(disc.presentRootFiles)
  const declaredFiles = (manifest.files ?? []).filter((p) => !isReadmePath(p))
  const declaredSet = new Set(declaredFiles)
  for (const path of declaredFiles) {
    if (!present.has(path)) items.push({ kind: 'root-missing', path })
  }
  for (const path of disc.presentRootFiles) {
    if (isReadmePath(path)) continue
    if (!declaredSet.has(path)) items.push({ kind: 'root-addition', path })
  }

  return items
}
