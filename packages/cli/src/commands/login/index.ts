import type { RegistrySessionFailure } from '@agent-facets/engine'
import {
  beginCliLogin,
  completeCliLogin,
  fetchAuthMe,
  resolveCredential,
  writeCredentialsToken,
} from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { LoginMenu } from '../../tui/components/login-menu.tsx'
import { writeCliError } from '../../util/errors.ts'
import { canPromptInteractively } from '../../util/interactive.ts'
import { openBrowser } from '../../util/open-browser.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'

type LoginChoice = { kind: 'browser' } | { kind: 'token'; token: string } | { kind: 'cancelled' }

export const loginCommand: Command = {
  name: 'login',
  description: 'Sign in to the registry using a browser or personal access token',
  implemented: true,
  flags: {
    browser: {
      type: 'boolean',
      description: 'Use browser sign-in; --no-browser shows the code without opening a browser',
    },
    token: { type: 'boolean', description: 'Paste a personal access token in an interactive terminal' },
  },
  run: async (args, flags) => {
    if (
      args.length > 0 ||
      Object.keys(flags).some((name) => name !== 'browser' && name !== 'token') ||
      (flags.browser !== undefined && typeof flags.browser !== 'boolean') ||
      (flags.token !== undefined && typeof flags.token !== 'boolean')
    ) {
      writeCliError({
        what: 'invalid login arguments',
        fix: 'run `facet login --help` to choose --browser, --no-browser, or --token',
      })
      return 1
    }
    if (flags.token === true && flags.browser !== undefined) {
      writeCliError({
        what: 'choose one sign-in method',
        fix: 'use --token by itself, or choose --browser or --no-browser',
      })
      return 1
    }
    if (flags.token === true && !canPromptInteractively()) {
      writeCliError({
        what: 'token entry requires an interactive terminal',
        fix: 'run `facet login --token` in a terminal, or set FACET_TOKEN',
      })
      return 1
    }
    if (flags.browser === undefined && flags.token !== true && !canPromptInteractively()) {
      writeCliError({
        what: 'facet login requires a sign-in mode outside a terminal',
        fix: 'use `facet login --browser` or `facet login --no-browser`, or set FACET_TOKEN',
      })
      return 1
    }

    if (flags.browser !== undefined) return runBrowserLogin(flags.browser)
    if (flags.token === true) return runTokenLogin()

    const choice = await promptForChoice()
    if (choice.kind === 'browser') return runBrowserLogin(true)
    if (choice.kind === 'token') return runTokenLogin(choice.token)
    process.stdout.write('Cancelled.\n')
    return 1
  },
}

function warnShadowedCredential(): void {
  const existing = resolveCredential()
  if (existing.source === 'env') {
    process.stdout.write(
      'Note: FACET_TOKEN is active and takes precedence over this login. Unset FACET_TOKEN to use it.\n',
    )
  } else if (existing.source === 'file') {
    process.stdout.write(
      'Note: a saved personal access token takes precedence over browser sign-in. Run `facet logout` to clear it.\n',
    )
  } else if (existing.reason !== undefined) {
    process.stdout.write(
      'Note: the saved personal access token could not be read. Check its permissions before using this login.\n',
    )
  }
}

async function runBrowserLogin(autoLaunch: boolean): Promise<number> {
  warnShadowedCredential()
  const controller = new AbortController()
  const onInterrupt = () => controller.abort()
  process.on('SIGINT', onInterrupt)
  let progress: ReturnType<typeof render> | undefined
  try {
    const started = await beginCliLogin({ signal: controller.signal })
    if (controller.signal.aborted) return cancelled()
    if (!started.ok) return authenticationFailure(started.error)

    const { verificationUri, userCode, verificationUriComplete } = started.value.display
    process.stdout.write(`Visit ${verificationUri}\nEnter code: ${userCode}\n`)
    if (autoLaunch) {
      const opened = await openBrowser(verificationUriComplete)
      if (!opened.ok)
        process.stdout.write('Note: the browser could not be opened. Use the URL and code above to finish sign-in.\n')
    }
    if (controller.signal.aborted) return cancelled()

    if (canPromptInteractively()) {
      progress = render(
        createElement(LoginMenu, {
          polling: true,
          onSubmitToken: () => {},
          onCancel: () => controller.abort(),
        }),
        { exitOnCtrlC: false },
      )
    }
    const completed = await completeCliLogin(started.value, { signal: controller.signal })
    if (progress !== undefined) {
      const mounted = progress
      progress = undefined
      clearAndUnmount(mounted)
    }
    if (completed.ok) {
      process.stdout.write(`Logged in as ${completed.value.username}.\n`)
      return 0
    }
    if (controller.signal.aborted || completed.error.code === 'CANCELLED') return cancelled()
    return authenticationFailure(completed.error)
  } finally {
    try {
      if (progress !== undefined) clearAndUnmount(progress)
    } finally {
      process.off('SIGINT', onInterrupt)
    }
  }
}

async function runTokenLogin(firstToken?: string): Promise<number> {
  const existing = resolveCredential()
  if (existing.source === 'env') {
    process.stdout.write(
      'Note: FACET_TOKEN is active and takes precedence over the saved token. Unset FACET_TOKEN to use it.\n',
    )
  } else if (existing.source === 'absent' && existing.reason !== undefined) {
    process.stdout.write('Note: an existing credentials file cannot be read; saving a token will replace it.\n')
  }

  let token = firstToken
  let lastError: string | undefined
  for (;;) {
    if (token === undefined) {
      const choice = await promptForChoice(lastError, true)
      if (choice.kind !== 'token') return cancelled()
      token = choice.token
    }
    const profile = await fetchAuthMe(token)
    if (profile.ok) {
      writeCredentialsToken(token)
      process.stdout.write(`Logged in as ${profile.value.username} (${profile.value.tier}).\n`)
      return 0
    }
    const rendered = translateEngineRegistryError(profile.error)
    lastError = `${rendered.what} — ${rendered.fix}`
    token = undefined
  }
}

function authenticationFailure(reason: RegistrySessionFailure): number {
  writeCliError(translateEngineRegistryError({ code: 'AUTHENTICATION_ERROR', reason }))
  return 1
}

function cancelled(): number {
  process.stdout.write('Cancelled.\n')
  return 1
}

async function promptForChoice(initialError?: string, tokenOnly = false): Promise<LoginChoice> {
  const state: { choice: LoginChoice } = { choice: { kind: 'cancelled' } }
  const instance = render(
    createElement(LoginMenu, {
      initialError,
      tokenOnly,
      onChooseBrowser: () => {
        state.choice = { kind: 'browser' }
      },
      onSubmitToken: (token: string) => {
        state.choice = { kind: 'token', token }
      },
      onCancel: () => {
        state.choice = { kind: 'cancelled' }
      },
    }),
    { exitOnCtrlC: false },
  )
  try {
    await instance.waitUntilExit()
    return state.choice
  } finally {
    clearAndUnmount(instance)
  }
}

function clearAndUnmount(instance: ReturnType<typeof render>): void {
  try {
    instance.clear()
  } finally {
    instance.unmount()
  }
}
