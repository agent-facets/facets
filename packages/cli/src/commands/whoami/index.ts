import {
  fetchAuthMe,
  getRegistryBaseUrl,
  resolveRegistryCredential,
  type WireAuthMeResponse,
} from '@agent-facets/engine'
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
    const resolved = await resolveRegistryCredential()
    if (!resolved.ok) {
      writeCliError(translateEngineRegistryError({ code: 'AUTHENTICATION_ERROR', reason: resolved.error }))
      return 1
    }
    const cred = resolved.value
    if (cred.source === 'absent') {
      writeCliError({
        what: 'not signed in — no registry credential found',
        fix: 'run `facet login` to sign in, or set FACET_TOKEN in your environment',
      })
      return 1
    }

    let profile: Readonly<WireAuthMeResponse>
    if (cred.source === 'oauth') {
      profile = cred.profile
    } else {
      const checked = await fetchAuthMe(cred.token)
      if (!checked.ok) {
        writeCliError(translateEngineRegistryError(checked.error))
        return 1
      }
      profile = checked.value
    }

    const { username, email, tier, suspended } = profile
    process.stdout.write(`${username} <${email}>\n`)
    process.stdout.write(`  tier: ${tier}\n`)
    if (suspended) {
      process.stdout.write('  status: suspended\n')
    }
    process.stdout.write(`  registry: ${cred.source === 'oauth' ? cred.registryOrigin : getRegistryBaseUrl()}\n`)
    if (cred.source === 'env') {
      process.stdout.write('  credential: FACET_TOKEN (environment)\n')
    } else if (cred.source === 'oauth') {
      process.stdout.write('  credential: browser session\n')
    }
    return 0
  },
}
