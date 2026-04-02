import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type FacetManifest,
  hasFrontMatter,
  loadManifest,
  reconcile,
  scanAssets,
  writeManifest,
} from '@agent-facets/core'
import type { Command } from '../../commands.ts'
import type { EditContext, EditOperation, EditResult, ReconciliationItem } from '../../tui/views/edit/edit-types.ts'
import { agentTemplate, commandTemplate, skillTemplate } from '../create-scaffold.ts'
import { runEditWizardInk } from './wizard.tsx'

export async function buildEditContext(
  rootDir: string,
): Promise<{ ok: true; context: EditContext } | { ok: false; exitCode: number }> {
  // Load manifest
  const loadResult = await loadManifest(rootDir)
  if (!loadResult.ok) {
    // Hard error — show errors and exit
    console.error('Manifest is invalid:')
    for (const err of loadResult.errors) {
      console.error(`  ${err.message}`)
    }
    console.error('\nFix facet.json and try again.')
    return { ok: false, exitCode: 1 }
  }

  const manifest = loadResult.data

  // Scan disk for assets
  const discovered = await scanAssets(rootDir)

  // Run reconciliation
  const recon = reconcile(manifest, discovered)

  // Build reconciliation items
  const items: ReconciliationItem[] = []

  for (const addition of recon.additions) {
    items.push({ kind: 'addition', type: addition.type, name: addition.name, path: addition.path })
  }

  for (const missing of recon.missing) {
    items.push({ kind: 'missing', type: missing.type, name: missing.name, expectedPath: missing.expectedPath })
  }

  // Check matched assets for front matter
  for (const matched of recon.matched) {
    const filePath = join(rootDir, matched.path)
    const content = await Bun.file(filePath).text()
    if (hasFrontMatter(content)) {
      items.push({ kind: 'front-matter', type: matched.type, name: matched.name, path: matched.path })
    }
  }

  return { ok: true, context: { rootDir, manifest, reconciliationItems: items } }
}

export async function applyOperations(
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
        const { extractFrontMatter } = await import('@agent-facets/core')
        const filePath = join(rootDir, op.path)
        const raw = await Bun.file(filePath).text()
        const { content } = extractFrontMatter(raw)
        await Bun.write(filePath, content)
        break
      }
    }
  }
}

export const editCommand: Command = {
  name: 'edit',
  description: 'Edit a facet project interactively',
  run: async (args: string[]): Promise<number> => {
    const rootDir = args[0] || process.cwd()
    const displayDir = args[0] || '.'

    const loaded = await buildEditContext(rootDir)
    if (!loaded.ok) return loaded.exitCode

    const result: EditResult = await runEditWizardInk(loaded.context)

    if (result.outcome === 'cancelled') {
      console.log('\nCancelled — no changes applied.')
      return 1
    }

    await applyOperations(result.manifest, result.operations, rootDir)

    console.log(`\nChanges applied to ${displayDir}`)
    console.log(`Run "facet build${args[0] ? ` ${displayDir}` : ''}" to validate your facet.`)

    return 0
  },
}
