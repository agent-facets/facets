import { runSelfUpdate } from '@agent-facets/engine'
import { defineCommand } from '../command.ts'
import { formatSelfUpdateError } from '../util/self-update-errors.ts'
import { version as currentVersion } from '../version.ts'

/**
 * `facet self-update` (alias: `facet self-upgrade`).
 *
 * Updates the running CLI binary by detecting the install method
 * (curl / npm / yarn / pnpm / bun / dev / unknown) and dispatching to the
 * matching install-method handler. The orchestration lives in
 * `@agent-facets/engine`; this file is just the CLI surface that supplies
 * the running binary's version and routes output to the user's terminal.
 */
export const selfUpdateCommand = defineCommand({
  name: 'self-update',
  aliases: ['self-upgrade'],
  description: 'Update the facet CLI to a newer version',
  implemented: true,
  flags: {
    version: {
      type: 'string',
      valueName: 'version',
      description: 'Pin to a specific version instead of the latest',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print the plan; do not modify any files',
    },
  },
  runJson: async (args, flags) => {
    if (args.length > 0) {
      return {
        ok: false,
        error: { code: 'INVALID_ARGUMENTS', message: 'self-update does not accept positional arguments' },
      }
    }
    let result: unknown
    const errors: string[] = []
    const warnings: { code: string; message: string }[] = []
    const exitCode = await runSelfUpdate({
      currentVersion,
      targetVersion: typeof flags.version === 'string' && flags.version !== '' ? flags.version : undefined,
      dryRun: flags['dry-run'] === true,
      machine: true,
      onResult: (value) => {
        result = value
      },
      onOutput: (message) => warnings.push({ code: 'SELF_UPDATE_NOTICE', message }),
      onError: (event) => errors.push(formatSelfUpdateError(event)),
    })
    if (exitCode !== 0) {
      return {
        ok: false,
        error: { code: 'SELF_UPDATE_FAILED', message: errors.join('').trim() || 'self-update failed' },
        exitCode,
        warnings,
      }
    }
    if (errors.length > 0) warnings.push({ code: 'SELF_UPDATE_GUIDANCE', message: errors.join('').trim() })
    return { ok: true, data: result, warnings }
  },
  run: async (_args, flags) => {
    const targetVersion = typeof flags.version === 'string' && flags.version !== '' ? flags.version : undefined
    const dryRun = flags['dry-run'] === true
    return runSelfUpdate({
      currentVersion,
      targetVersion,
      dryRun,
      onOutput: (line) => process.stdout.write(line),
      onError: (event) => process.stderr.write(formatSelfUpdateError(event)),
    })
  },
})
