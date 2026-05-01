import { runSelfUpdate } from '@agent-facets/core'
import type { Command } from '../commands.ts'
import { version as currentVersion } from '../version.ts'

/**
 * `facet self-update` (alias: `facet self-upgrade`).
 *
 * Updates the running CLI binary by detecting the install method
 * (curl / npm / yarn / pnpm / bun / dev / unknown) and dispatching to the
 * matching install-method handler. The orchestration lives in
 * `@agent-facets/core`; this file is just the CLI surface that supplies
 * the running binary's version and routes output to the user's terminal.
 */
export const selfUpdateCommand: Command = {
  name: 'self-update',
  aliases: ['self-upgrade'],
  description: 'Update the facet CLI to a newer version',
  usage: '[--version <x.y.z>] [--dry-run]',
  implemented: true,
  flags: {
    version: {
      type: 'string',
      description: 'Pin to a specific version instead of the latest',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print the plan; do not modify any files',
    },
  },
  run: async (_args, flags) => {
    const targetVersion = typeof flags.version === 'string' && flags.version !== '' ? flags.version : undefined
    const dryRun = flags['dry-run'] === true
    return runSelfUpdate({
      currentVersion,
      targetVersion,
      dryRun,
      onOutput: (line) => process.stdout.write(line),
      onError: (line) => process.stderr.write(line),
    })
  },
}
