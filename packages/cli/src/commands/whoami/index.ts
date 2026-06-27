import { fetchAuthMe, getRegistryBaseUrl, resolveCredential } from '@agent-facets/engine'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'

/**
 * `facet whoami` — print the identity associated with the resolved
 * credential. Reads the profile from `GET /v0/auth/me`. When the
 * credential comes from `FACET_TOKEN`, the output names the env var as
 * the source so the user is not confused about which credential
 * authenticated the call.
 */
export const whoamiCommand: Command = {
  name: 'whoami',
  description: 'Show the signed-in registry identity',
  implemented: true,
  run: async (_args, _flags) => {
    const cred = resolveCredential()
    if (cred.source === 'absent') {
      if (cred.reason?.code === 'unreadable') {
        writeCliError({
          what: "couldn't read your registry credentials file",
          detail: `${cred.reason.path}: ${cred.reason.cause}`,
          fix: "fix the file's permissions, or run `facet logout` then `facet login`",
        })
        return 1
      }
      writeCliError({
        what: 'not signed in — no registry credential found',
        fix: 'run `facet login` to sign in, or set FACET_TOKEN in your environment',
      })
      return 1
    }

    const profile = await fetchAuthMe(cred.token)
    if (!profile.ok) {
      writeCliError(translateEngineRegistryError(profile.error))
      return 1
    }

    const { username, email, tier, suspended } = profile.value
    process.stdout.write(`${username} <${email}>\n`)
    process.stdout.write(`  tier: ${tier}\n`)
    if (suspended) {
      process.stdout.write('  status: suspended\n')
    }
    process.stdout.write(`  registry: ${getRegistryBaseUrl()}\n`)
    if (cred.source === 'env') {
      process.stdout.write('  credential: FACET_TOKEN (environment)\n')
    }
    return 0
  },
}
