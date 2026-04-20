import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { FACET_MANIFEST_FILE } from '@agent-facets/core'
import { type } from 'arktype'
import type { Command } from '../../commands.ts'
import { writeScaffold } from '../create-scaffold.ts'
import { resolveTargetDir } from '../resolve-dir.ts'
import { runCreateWizardInk } from './wizard.tsx'

export type { CreateOptions } from '../create-scaffold.ts'
export { writeScaffold } from '../create-scaffold.ts'

const CreateFlags = type({ 'force?': 'boolean' })

async function confirmOverwrite(display: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    rl.question(`A facet already exists in ${display}. Overwrite? (y/N) `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}

export const createCommand: Command = {
  name: 'create',
  description: 'Create a new facet project interactively',
  usage: '[directory]',
  implemented: true,
  flags: {
    force: { type: 'boolean', description: 'Overwrite existing facet.json' },
  },
  run: async (args: string[], flags: Record<string, unknown>): Promise<number> => {
    const resolved = await resolveTargetDir(args[0], { mustExist: false })
    if (!resolved.ok) {
      console.error(resolved.message)
      return 1
    }

    const targetDir = resolved.dir
    const displayDir = resolved.display

    // Validate flags via Arktype
    const validatedFlags = CreateFlags(flags)
    if (validatedFlags instanceof type.errors) {
      console.error(`Invalid flags: ${validatedFlags.summary}`)
      return 1
    }

    // Overwrite protection
    const manifestExists = await Bun.file(join(targetDir, FACET_MANIFEST_FILE)).exists()
    if (manifestExists && !validatedFlags.force) {
      const confirmed = await confirmOverwrite(displayDir)
      if (!confirmed) {
        console.log('Cancelled.')
        return 1
      }
    }

    const opts = await runCreateWizardInk()
    if (!opts) {
      console.log('\nCancelled.')
      return 1
    }

    const files = await writeScaffold(opts, targetDir)

    console.log(`\nFacet created: ${opts.name} → ${displayDir}`)
    for (const file of files) {
      console.log(`  ${displayDir}/${file}`)
    }
    console.log(`\nRun "facet build${args[0] ? ` ${displayDir}` : ''}" to validate your facet.`)

    return 0
  },
}
