import { fetchAuthMe, resolveCredential, writeCredentialsToken } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { LoginMenu } from '../../tui/components/login-menu.tsx'
import { writeCliError } from '../../util/errors.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'

/**
 * `facet login` — guided sign-in. V0 supports pasting a personal access
 * token minted in the web UI; a browser sign-in option is shown as a
 * disabled "coming soon" placeholder.
 *
 * The pasted token is verified against `GET /v0/auth/me` BEFORE it is
 * written to disk, so a typo or expired paste fails fast with the
 * registry's own message and the user is reprompted rather than left
 * with an unusable saved credential.
 */
export const loginCommand: Command = {
  name: 'login',
  description: 'Sign in to the registry',
  implemented: true,
  run: async (_args, _flags) => {
    // The menu and masked prompt require an interactive terminal.
    if (!process.stdout.isTTY) {
      writeCliError({
        what: 'facet login requires an interactive terminal',
        detail: 'this is a non-interactive environment; the sign-in prompt cannot run here',
        fix: 'run `facet login` in an interactive shell, or set FACET_TOKEN for non-interactive use',
      })
      return 1
    }

    // If FACET_TOKEN is set it takes precedence over the file we are
    // about to write — warn before prompting so the user is not
    // surprised when `login` "doesn't take effect".
    const existing = resolveCredential()
    if (existing.source === 'env') {
      process.stdout.write('Note: FACET_TOKEN is set in your environment and will be used for every command\n')
      process.stdout.write('in preference to the credential you are about to save. Run `unset FACET_TOKEN`\n')
      process.stdout.write('if you want the saved login to take effect.\n\n')
    } else if (existing.source === 'absent' && existing.reason?.code === 'unreadable') {
      // An existing credentials file is present but unreadable; logging in
      // will overwrite it. Surface the situation so the overwrite is not a
      // surprise.
      process.stdout.write(`Note: an existing credentials file at ${existing.reason.path} could not be read\n`)
      process.stdout.write(`(${existing.reason.cause}); signing in will overwrite it.\n\n`)
    }

    // Reprompt loop: each rejected token re-mounts the prompt with the
    // registry's error shown above it. The user aborts with Esc.
    let lastError: string | undefined
    for (;;) {
      const token = await promptForToken(lastError)
      if (token === null) {
        process.stdout.write('Cancelled.\n')
        return 1
      }

      const profile = await fetchAuthMe(token)
      if (!profile.ok) {
        // Render the registry's own error verbatim, then reprompt.
        const cli = translateEngineRegistryError(profile.error)
        lastError = cli.fix !== undefined ? `${cli.what} — ${cli.fix}` : cli.what
        continue
      }

      writeCredentialsToken(token)
      process.stdout.write(`Logged in as ${profile.value.username} (${profile.value.tier}).\n`)
      return 0
    }
  },
}

/**
 * Mount the interactive login menu and resolve with the submitted token,
 * or `null` if the user cancels. `initialError`, when present, is shown
 * above the prompt and starts the flow directly at the token entry.
 */
async function promptForToken(initialError: string | undefined): Promise<string | null> {
  let submitted: string | null = null
  const instance = render(
    createElement(LoginMenu, {
      initialError,
      onSubmitToken: (t: string) => {
        submitted = t
      },
      onCancel: () => {
        submitted = null
      },
    }),
  )
  await instance.waitUntilExit()
  return submitted
}
