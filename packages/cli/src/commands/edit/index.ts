import { applyEditOperations, buildEditContext } from '@agent-facets/engine'
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

    const buildArg = args[0] ? ` ${displayDir}` : ''
    const completed = await runEditWizardInk(loaded.context, {
      onApply: (result) => applyEditOperations(result.manifest, result.operations, rootDir),
      buildArg,
    })

    if (!completed) {
      console.log('\nCancelled — no changes applied.')
      return 1
    }

    return 0
  },
}
