import { FACET_MANIFEST_FILE } from '@agent-facets/protocol'
import type { AssetManifestKey } from './scanner.ts'
import type { EditOperation } from './types.ts'

/** One preview line for a queued edit operation, with its exact repo-relative path. */
export interface OperationPreviewLine {
  verb: 'Update' | 'Scaffold' | 'Write' | 'Delete'
  path: string
}

/** Conventional primary path (repo-relative) for an asset. */
function primaryPath(type: AssetManifestKey, name: string): string {
  return type === 'skills' ? `skills/${name}/SKILL.md` : `${type}/${name}.md`
}

/**
 * Expand a queued operation list into exact-path preview lines for the
 * confirmation and success views. Every file the apply will touch — including
 * each deleted companion — is listed with its exact path (design D11 "show every
 * queued exact-path operation before Apply").
 */
export function previewEditOperations(operations: EditOperation[]): OperationPreviewLine[] {
  const lines: OperationPreviewLine[] = []
  for (const op of operations) {
    switch (op.op) {
      case 'write-manifest':
        lines.push({ verb: 'Update', path: FACET_MANIFEST_FILE })
        break
      case 'scaffold-asset':
        lines.push({ verb: 'Scaffold', path: primaryPath(op.assetType, op.name) })
        break
      case 'delete-asset':
        lines.push({ verb: 'Delete', path: primaryPath(op.assetType, op.name) })
        for (const companion of op.companionPaths) lines.push({ verb: 'Delete', path: companion })
        break
      case 'write-file':
        lines.push({ verb: 'Write', path: op.path })
        break
      case 'delete-file':
        lines.push({ verb: 'Delete', path: op.path })
        break
    }
  }
  return lines
}
