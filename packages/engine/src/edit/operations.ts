import { mkdir, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { FACET_MANIFEST_FILE } from '@agent-facets/protocol'
import { applyFsTransaction, type FsMutation } from '../fs-transaction.ts'
import { jsonFileText } from '../json-file-text.ts'
import { agentTemplate, commandTemplate, skillTemplate } from '../scaffold/index.ts'
import type { ModifyFileOp } from './apply-modify.ts'
import type { AssetManifestKey } from './scanner.ts'
import type { EditOperation } from './types.ts'

/** Result of a transactional edit apply. Expected failures are data, not throws. */
export type EditApplyResult = { ok: true } | { ok: false; failedPath: string; reason: string; rollbackOk: boolean }

/**
 * Apply a queued edit-operation list to disk as one transaction: the final
 * manifest, asset scaffolds, asset/companion/file writes and deletions all
 * commit together, or the project is left as it was. Ordering the manifest
 * write alongside the file mutations in one transaction removes the old hazard
 * where a manifest could be written before a failing scaffold.
 */
export async function applyEditOperations(operations: EditOperation[], rootDir: string): Promise<EditApplyResult> {
  const encoder = new TextEncoder()
  const mutations: FsMutation[] = []

  for (const op of operations) {
    switch (op.op) {
      case 'write-manifest':
        mutations.push({
          kind: 'write',
          path: join(rootDir, FACET_MANIFEST_FILE),
          bytes: encoder.encode(jsonFileText(op.manifest)),
        })
        break
      case 'scaffold-asset': {
        const { path, content } = assetScaffoldTarget(rootDir, op.assetType, op.name)
        mutations.push({ kind: 'write', path, bytes: encoder.encode(content) })
        break
      }
      case 'delete-asset': {
        mutations.push({ kind: 'delete', path: assetPrimaryPath(rootDir, op.assetType, op.name) })
        for (const companion of op.companionPaths) {
          mutations.push({ kind: 'delete', path: join(rootDir, companion) })
        }
        break
      }
      case 'write-file':
        mutations.push({ kind: 'write', path: join(rootDir, op.path), bytes: encoder.encode(op.content) })
        break
      case 'delete-file':
        mutations.push({ kind: 'delete', path: join(rootDir, op.path) })
        break
    }
  }

  const result = applyFsTransaction(mutations)
  if (result.ok) return { ok: true }
  return { ok: false, failedPath: result.failedPath, reason: result.reason, rollbackOk: result.rollback.ok }
}

/** Conventional primary path for an asset (absolute). */
function assetPrimaryPath(rootDir: string, type: AssetManifestKey, name: string): string {
  return type === 'skills' ? join(rootDir, 'skills', name, 'SKILL.md') : join(rootDir, type, `${name}.md`)
}

/** Conventional primary path + starter template for a scaffolded asset. */
function assetScaffoldTarget(rootDir: string, type: AssetManifestKey, name: string): { path: string; content: string } {
  if (type === 'skills') return { path: join(rootDir, 'skills', name, 'SKILL.md'), content: skillTemplate(name) }
  if (type === 'agents') return { path: join(rootDir, 'agents', `${name}.md`), content: agentTemplate(name) }
  return { path: join(rootDir, 'commands', `${name}.md`), content: commandTemplate(name) }
}

/**
 * Apply the filesystem side effects computed by `applyModify` (scaffold new
 * asset templates, delete removed assets, move renamed asset files). The
 * manifest itself is written separately by the caller. This is the flag-driven
 * `facet add`/`facet modify` path, distinct from the interactive edit apply.
 */
export async function applyModifyFileOps(rootDir: string, fileOps: ModifyFileOp[]): Promise<void> {
  for (const op of fileOps) {
    switch (op.op) {
      case 'scaffold':
        await scaffoldAsset(rootDir, op.target, op.name)
        break
      case 'delete':
        await deleteAsset(rootDir, op.target, op.name)
        break
      case 'move': {
        const from = join(rootDir, op.from)
        const to = join(rootDir, op.to)
        await mkdir(dirname(to), { recursive: true })
        try {
          await rename(from, to)
          // Skills live in a per-name directory (skills/<name>/SKILL.md);
          // after moving the file out, remove the now-empty source directory.
          if (op.target === 'skills') {
            await rmdir(dirname(from)).catch(() => {})
          }
        } catch {
          // Source missing — nothing to move; the manifest change still stands.
        }
        break
      }
    }
  }
}

/** Scaffold a starter template file for a new asset. */
async function scaffoldAsset(rootDir: string, type: AssetManifestKey, name: string): Promise<void> {
  if (type === 'skills') {
    const dir = join(rootDir, 'skills', name)
    await mkdir(dir, { recursive: true })
    await Bun.write(join(dir, 'SKILL.md'), skillTemplate(name))
  } else if (type === 'agents') {
    await mkdir(join(rootDir, 'agents'), { recursive: true })
    await Bun.write(join(rootDir, `agents/${name}.md`), agentTemplate(name))
  } else if (type === 'commands') {
    await mkdir(join(rootDir, 'commands'), { recursive: true })
    await Bun.write(join(rootDir, `commands/${name}.md`), commandTemplate(name))
  }
}

/** Delete an asset's on-disk file. A missing file is not an error. */
async function deleteAsset(rootDir: string, type: AssetManifestKey, name: string): Promise<void> {
  const path = type === 'skills' ? join(rootDir, 'skills', name, 'SKILL.md') : join(rootDir, type, `${name}.md`)
  try {
    await unlink(path)
  } catch {
    // File already gone — that's fine
  }
}
