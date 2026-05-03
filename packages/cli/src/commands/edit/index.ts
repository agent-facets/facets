import { applyEditOperations, buildEditContext, type EditResult } from '@agent-facets/engine'
import type { Command } from '../../commands.ts'
import { resolveTargetDir } from '../resolve-dir.ts'
import { runEditWizardInk } from './wizard.tsx'

export const editCommand: Command = {
  name: 'edit',
  description: 'Edit a facet project interactively',
  usage: '[directory]',
  implemented: true,
  run: async (args: string[], _flags: Record<string, unknown>): Promise<number> => {
    const resolved = await resolveTargetDir(args[0], { mustExist: true, facetMustExist: true })
    if (!resolved.ok) {
      console.error(resolved.message)
      return 1
    }

    const rootDir = resolved.dir
    const displayDir = resolved.display

    const loaded = await buildEditContext(rootDir, {
      onError: (line) => console.error(line),
    })
    if (!loaded.ok) return loaded.exitCode

    const result: EditResult = await runEditWizardInk(loaded.context)

    if (result.outcome === 'cancelled') {
      console.log('\nCancelled — no changes applied.')
      return 1
    }

    await applyEditOperations(result.manifest, result.operations, rootDir)

    console.log(`\nChanges applied to ${displayDir}`)
    console.log(`Run "facet build${args[0] ? ` ${displayDir}` : ''}" to validate your facet.`)

    return 0
  },
}
