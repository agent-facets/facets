import { mkdir, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FacetManifest } from '@agent-facets/protocol'
import { agentTemplate, commandTemplate, skillTemplate } from '../scaffold/index.ts'
import type { ModifyFileOp } from './apply-modify.ts'
import { writeManifest } from './manifest-writer.ts'
import type { AssetManifestKey } from './scanner.ts'
import type { EditOperation } from './types.ts'

/**
 * Apply a sequence of edit operations to disk: write the manifest, scaffold
 * new asset templates, and delete files.
 */
export async function applyEditOperations(
  manifest: FacetManifest,
  operations: EditOperation[],
  rootDir: string,
): Promise<void> {
  for (const op of operations) {
    switch (op.op) {
      case 'write-manifest':
        await writeManifest(manifest, rootDir)
        break
      case 'scaffold':
        await scaffoldAsset(rootDir, op.type, op.name)
        break
      case 'delete-file':
        await deleteAsset(rootDir, op.type, op.name)
        break
    }
  }
}

/**
 * Apply the filesystem side effects computed by `applyModify` (scaffold new
 * asset templates, delete removed assets, move renamed asset files). The
 * manifest itself is written separately by the caller.
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
