import { deleteCredentialsFile } from '@agent-facets/engine'
import type { Command } from '../../commands.ts'

/**
 * `facet logout` — remove the saved credentials file. Makes no server
 * call and revokes no token server-side (the user revokes PATs in the
 * web UI). When `FACET_TOKEN` is set, the env var still authenticates
 * every command after the file is gone, so the user is told the file
 * was removed but the env var is still active.
 */
export const logoutCommand: Command = {
  name: 'logout',
  description: 'Remove the saved registry credential',
  implemented: true,
  run: async (_args, _flags) => {
    const removed = deleteCredentialsFile()
    if (removed) {
      process.stdout.write('Signed out — removed the saved credential.\n')
    } else {
      process.stdout.write('No saved credential to remove.\n')
    }

    const envToken = process.env.FACET_TOKEN?.trim()
    if (envToken !== undefined && envToken.length > 0) {
      process.stdout.write('\nNote: FACET_TOKEN is still set in your environment and will continue to\n')
      process.stdout.write('authenticate every command. Run `unset FACET_TOKEN` to fully sign out of\n')
      process.stdout.write('this shell.\n')
    }
    return 0
  },
}
