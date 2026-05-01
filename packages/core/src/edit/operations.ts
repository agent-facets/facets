import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { extractFrontMatter } from '../front-matter.ts'
import { agentTemplate, commandTemplate, skillTemplate } from '../scaffold/index.ts'
import type { FacetManifest } from '../schemas/facet-manifest.ts'
import { writeManifest } from './manifest-writer.ts'
import type { EditOperation } from './types.ts'

/**
 * Apply a sequence of edit operations to disk: write the manifest, scaffold
 * new asset templates, delete files, and strip front matter from existing
 * asset files.
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

      case 'scaffold': {
        if (op.type === 'skills') {
          const dir = join(rootDir, 'skills', op.name)
          await mkdir(dir, { recursive: true })
          await Bun.write(join(dir, 'SKILL.md'), skillTemplate(op.name))
        } else if (op.type === 'agents') {
          await mkdir(join(rootDir, 'agents'), { recursive: true })
          await Bun.write(join(rootDir, `agents/${op.name}.md`), agentTemplate(op.name))
        } else if (op.type === 'commands') {
          await mkdir(join(rootDir, 'commands'), { recursive: true })
          await Bun.write(join(rootDir, `commands/${op.name}.md`), commandTemplate(op.name))
        }
        break
      }

      case 'delete-file': {
        const path =
          op.type === 'skills' ? join(rootDir, 'skills', op.name, 'SKILL.md') : join(rootDir, op.type, `${op.name}.md`)
        try {
          const { unlink } = await import('node:fs/promises')
          await unlink(path)
        } catch {
          // File already gone — that's fine
        }
        break
      }

      case 'strip-front-matter': {
        const filePath = join(rootDir, op.path)
        const raw = await Bun.file(filePath).text()
        const { content } = extractFrontMatter(raw)
        await Bun.write(filePath, content)
        break
      }
    }
  }
}
