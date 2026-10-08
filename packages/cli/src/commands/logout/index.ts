import { logoutCliSession } from '@agent-facets/engine'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'

export const logoutCommand: Command = {
  name: 'logout',
  description: 'Remove the saved registry credential',
  implemented: true,
  flags: {
    local: { type: 'boolean', description: 'Remove the local browser session without confirmed remote revocation' },
  },
  run: async (args, flags) => {
    if (
      args.length > 0 ||
      Object.keys(flags).some((name) => name !== 'local') ||
      (flags.local !== undefined && typeof flags.local !== 'boolean')
    ) {
      writeCliError({ what: 'invalid logout arguments', fix: 'run `facet logout --help` to choose --local' })
      return 1
    }
    const outcome = await logoutCliSession({ localOnly: flags.local === true })
    if (!outcome.ok) {
      writeCliError(translateEngineRegistryError({ code: 'AUTHENTICATION_ERROR', reason: outcome.error }))
      return 1
    }
    if (outcome.value.source === 'absent') {
      process.stdout.write('No saved credential to remove.\n')
      return 0
    }
    if (outcome.value.source === 'pat') {
      process.stdout.write(
        outcome.value.removed ? 'Signed out — removed the saved credential.\n' : 'No saved credential to remove.\n',
      )
      if (outcome.value.removed) {
        process.stdout.write('Note: any saved browser session remains and may be selected on the next command.\n')
      }
      if (!outcome.value.envActive) return 0
      process.stdout.write('\nNote: FACET_TOKEN is still set in your environment and will continue to\n')
      process.stdout.write('authenticate every command. Run `unset FACET_TOKEN` to fully sign out of\n')
      process.stdout.write('this shell.\n')
      return 0
    }
    if (outcome.value.remoteRevocation === 'confirmed') {
      process.stdout.write('Signed out — browser session revoked and local credential removed.\n')
    } else {
      process.stdout.write('Local browser credential removed. Remote sign-out could not be confirmed.\n')
    }
    return 0
  },
}
