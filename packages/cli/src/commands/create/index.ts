import { join } from 'node:path'
import { type ScaffoldOptions, writeScaffold } from '@agent-facets/engine'
import { FACET_MANIFEST_FILE } from '@agent-facets/protocol'
import { type } from 'arktype'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { ConfirmPrompt } from '../../tui/components/confirm-prompt.tsx'
import { resolveTargetDir } from '../resolve-dir.ts'
import { runCreateWizardInk } from './wizard.tsx'

export type { ScaffoldOptions as CreateOptions }
export { writeScaffold }

const CreateFlags = type({ 'force?': 'boolean' })

/**
 * Inline Ink-based confirm. Returns the user's answer once they press
 * y/n/Enter/Esc. Single stdin owner — earlier `node:readline` version
 * left stdin in a state Ink couldn't reattach to on the next mount.
 */
async function confirmOverwrite(display: string): Promise<boolean> {
  let answer = false
  const instance = render(
    createElement(ConfirmPrompt, {
      question: `A facet already exists in ${display}. Overwrite?`,
      defaultAnswer: false,
      onAnswer: (a) => {
        answer = a
      },
    }),
  )
  await instance.waitUntilExit()
  return answer
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

    const buildArg = args[0] ? ` ${displayDir}` : ''
    const completed = await runCreateWizardInk({
      onScaffold: (scaffoldOpts) => writeScaffold(scaffoldOpts, targetDir),
      buildArg,
    })

    if (!completed) {
      console.log('\nCancelled.')
      return 1
    }

    return 0
  },
}
