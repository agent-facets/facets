import type { Command } from '../commands.ts'
import { runSelfUpdate } from '../self-update/index.ts'

/**
 * `facet self-update` (alias: `facet self-upgrade`).
 *
 * Updates the running CLI binary by detecting the install method
 * (curl / npm / yarn / pnpm / bun / dev / unknown) and dispatching to the
 * matching install-method handler. The orchestration lives in
 * `../self-update/index.ts`; this file is just the CLI surface.
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
    return runSelfUpdate({ targetVersion, dryRun })
  },
}
