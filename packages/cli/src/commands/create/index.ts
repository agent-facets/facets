import { join } from 'node:path'
import { type ScaffoldOptions, writeScaffold } from '@agent-facets/engine'
import { FACET_MANIFEST_FILE } from '@agent-facets/protocol'
import { type } from 'arktype'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { ConfirmPrompt } from '../../tui/components/confirm-prompt.tsx'
import { writeCliError } from '../../util/errors.ts'
import { resolveTargetDir } from '../resolve-dir.ts'
import { decideCreate } from './headless.ts'
import { runCreateWizardInk } from './wizard.tsx'

export type { ScaffoldOptions as CreateOptions }
export { writeScaffold }

/** Version tag for the machine-readable `--json` output document. */
const CREATE_JSON_SCHEMA_VERSION = '1'

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
    name: { type: 'string', description: 'Facet name (headless mode)' },
    description: { type: 'string', description: 'Facet description (headless mode)' },
    version: { type: 'string', description: 'Facet version, semver (headless mode; default 0.0.0)' },
    private: { type: 'boolean', description: 'Mark the facet private (headless mode)' },
    skill: { type: 'array', description: 'Skill to scaffold, repeatable (headless mode)' },
    agent: { type: 'array', description: 'Agent to scaffold, repeatable (headless mode)' },
    command: { type: 'array', description: 'Command to scaffold, repeatable (headless mode)' },
    readme: { type: 'boolean', description: 'Scaffold a README.md (default on; pass --no-readme to skip)' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON to stdout (headless mode)' },
  },
  run: async (args: string[], flags: Record<string, unknown>): Promise<number> => {
    const resolved = await resolveTargetDir(args[0], { mustExist: false })
    if (!resolved.ok) {
      console.error(resolved.message)
      return 1
    }

    const targetDir = resolved.dir
    const displayDir = resolved.display

    // Validate presentation flags via Arktype (content flags are validated in decideCreate)
    const validatedFlags = CreateFlags(flags)
    if (validatedFlags instanceof type.errors) {
      console.error(`Invalid flags: ${validatedFlags.summary}`)
      return 1
    }

    // Narrow the flag bag into a single tagged decision: wizard, headless, or error.
    const decision = decideCreate(flags)
    const json = flags.json === true

    if (decision.mode === 'error') {
      writeCliError(decision.error)
      return 1
    }

    const manifestExists = await Bun.file(join(targetDir, FACET_MANIFEST_FILE)).exists()

    if (decision.mode === 'headless') {
      // Headless can't show an interactive confirm — require --force to overwrite.
      if (manifestExists && validatedFlags.force !== true) {
        writeCliError({
          what: `a facet already exists in ${displayDir}`,
          detail: 'headless create will not overwrite an existing facet.json without confirmation',
          fix: 'pass --force to overwrite',
        })
        return 1
      }
      const files = await writeScaffold(decision.options, targetDir)
      if (json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              schemaVersion: CREATE_JSON_SCHEMA_VERSION,
              ok: true,
              name: decision.options.name,
              version: decision.options.version,
              directory: displayDir,
              files,
            },
            null,
            2,
          )}\n`,
        )
      } else {
        process.stdout.write(`✓ Created ${decision.options.name} in ${displayDir}/ (${files.length} files)\n`)
      }
      return 0
    }

    // Interactive wizard path.
    // Overwrite protection
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
