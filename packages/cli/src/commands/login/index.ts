import type { RegistrySessionFailure } from '@agent-facets/engine'
import {
  beginCliLogin,
  beginDurableCliLogin,
  completeCliLogin,
  completeDurableCliLogin,
  fetchAuthMe,
  resolveCredential,
  writeCredentialsToken,
} from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import { defineCommand, type FlagDefs, type FlagValues } from '../../command.ts'
import { LoginMenu } from '../../tui/components/login-menu.tsx'
import { writeCliError } from '../../util/errors.ts'
import { canPromptInteractively } from '../../util/interactive.ts'
import type { JsonError, JsonResult } from '../../util/json-output.ts'
import { openBrowser } from '../../util/open-browser.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'

type LoginChoice = { kind: 'browser' } | { kind: 'token'; token: string } | { kind: 'cancelled' }

const LOGIN_FLAGS = {
  browser: {
    type: 'boolean',
    description: 'Skip the picker, open the verification page, and wait for sign-in',
    negative: {
      name: 'no-browser',
      description: 'Skip the picker and show the verification URL and code without opening a browser',
    },
  },
  token: { type: 'boolean', description: 'Paste a personal access token in an interactive terminal' },
  complete: { type: 'string', valueName: 'login-id', description: 'Complete a pending login started with --json' },
} as const satisfies FlagDefs

async function runLoginJson(args: string[], flags: FlagValues<typeof LOGIN_FLAGS>): Promise<JsonResult> {
  if (
    args.length > 0 ||
    Object.keys(flags).some((name) => !['browser', 'token', 'complete', 'json'].includes(name)) ||
    flags.token === true ||
    flags.browser === true ||
    (flags.complete !== undefined && (flags.browser !== undefined || typeof flags.complete !== 'string'))
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'incompatible login arguments',
        fix: 'use `facet login --json` to start, then `facet login --complete <login-id> --json`',
      },
    }
  }
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.on('SIGINT', interrupt)
  try {
    if (typeof flags.complete === 'string') {
      const completed = await completeDurableCliLogin(flags.complete, { signal: controller.signal })
      if (!completed.ok) {
        return { ok: false, error: durableLoginError(completed.error) }
      }
      const { profile, registry, cleanupFailed } = completed.value
      return {
        ok: true,
        data: {
          status: 'authenticated',
          registry,
          identity: {
            username: profile.username,
            email: profile.email,
            tier: profile.tier,
            suspended: profile.suspended,
          },
          credentialStored: true,
        },
        warnings: [
          ...jsonCredentialWarnings(),
          ...(cleanupFailed
            ? [{ code: 'LOGIN_CLEANUP_FAILED', message: 'Could not remove pending login state.' }]
            : []),
        ],
      }
    }
    const started = await beginDurableCliLogin({ signal: controller.signal })
    if (!started.ok) return { ok: false, error: durableLoginError(started.error) }
    return {
      ok: true,
      data: {
        status: 'authorization_pending',
        loginId: started.value.loginId,
        registry: started.value.registry,
        verificationUri: started.value.display.verificationUri,
        userCode: started.value.display.userCode,
        expiresAt: new Date(started.value.expiresAt).toISOString(),
      },
      warnings: jsonCredentialWarnings(),
    }
  } finally {
    process.off('SIGINT', interrupt)
  }
}

export const loginCommand = defineCommand({
  name: 'login',
  description: 'Sign in to the registry using a browser or personal access token',
  implemented: true,
  flags: LOGIN_FLAGS,
  runJson: (args, flags) => runLoginJson(args, flags),
  run: async (args, flags) => {
    if (flags.complete !== undefined) {
      const result = await runLoginJson(args, { ...flags, json: true })
      if (!result.ok) {
        writeCliError({ what: result.error.message, fix: result.error.fix ?? 'start a new login' })
        return result.exitCode ?? 1
      }
      process.stdout.write('Login completed.\n')
      return result.exitCode ?? 0
    }
    if (
      args.length > 0 ||
      Object.keys(flags).some((name) => name !== 'browser' && name !== 'token' && name !== 'json') ||
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
})

function durableLoginError(
  failure: Exclude<Awaited<ReturnType<typeof completeDurableCliLogin>>, { ok: true }>['error'],
): JsonError {
  switch (failure.code) {
    case 'LOGIN_STATE_UNCERTAIN':
      return {
        code: failure.code,
        message: 'Login credential persistence could not be confirmed.',
        fix: 'check facet whoami before starting another login',
      }
    case 'LOGIN_RESTART_REQUIRED':
      return {
        code: failure.code,
        message: 'The login attempt cannot be resumed.',
        fix: 'check facet whoami, then start a new login if needed',
      }
    case 'LOGIN_BUSY':
      return { code: failure.code, message: 'Another process is completing this login.', fix: 'wait for that process' }
    case 'LOGIN_NOT_FOUND':
    case 'INVALID_LOGIN_ID':
      return { code: failure.code, message: 'The pending login was not found.', fix: 'start a new login' }
    default: {
      const error = translateEngineRegistryError({ code: 'AUTHENTICATION_ERROR', reason: failure })
      return {
        code: failure.code,
        message: error.what,
        ...(error.detail ? { details: { message: error.detail } } : {}),
        fix: error.fix,
        docsUrl: error.docsUrl,
      }
    }
  }
}

function jsonCredentialWarnings(): { code: string; message: string }[] {
  const existing = resolveCredential()
  if (existing.source === 'env') {
    return [{ code: 'ENV_CREDENTIAL_ACTIVE', message: 'FACET_TOKEN takes precedence over the browser session.' }]
  }
  if (existing.source === 'file') {
    return [
      {
        code: 'PAT_CREDENTIAL_ACTIVE',
        message: 'The saved personal access token takes precedence over the browser session.',
      },
    ]
  }
  if (existing.reason !== undefined) {
    return [{ code: 'PAT_CREDENTIAL_UNREADABLE', message: 'The saved personal access token could not be read.' }]
  }
  return []
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
  let viewExit: Promise<{ kind: 'view-exit' } | { kind: 'view-error'; error: unknown }> | undefined
  try {
    const started = await beginCliLogin({ signal: controller.signal })
    if (controller.signal.aborted) return cancelled()
    if (!started.ok) return authenticationFailure(started.error)

    const { verificationUri, userCode, verificationUriComplete } = started.value.display
    process.stdout.write(`Visit ${verificationUri}\nEnter code: ${userCode}\n`)
    if (autoLaunch) {
      process.stdout.write('If the browser does not open, use the URL and code above to finish sign-in.\n')
      // The optional opener may outlive this command; polling and cancellation do not wait for it.
      void openBrowser(verificationUriComplete).then(
        () => undefined,
        () => undefined,
      )
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
      viewExit = progress.waitUntilExit().then(
        () => ({ kind: 'view-exit' as const }),
        (error: unknown) => ({ kind: 'view-error' as const, error }),
      )
    }
    const completion = completeCliLogin(started.value, { signal: controller.signal }).then(
      (value): { kind: 'completed'; value: typeof value } => ({ kind: 'completed', value }),
      (error: unknown): { kind: 'completion-error'; error: unknown } => ({ kind: 'completion-error', error }),
    )
    const first = viewExit === undefined ? await completion : await Promise.race([completion, viewExit])
    if (first.kind === 'view-error' || first.kind === 'view-exit') {
      controller.abort()
      // An in-progress credential write may outlive abort; let it finish cleanup before command exit.
      await completion
      if (first.kind === 'view-error') throw first.error
      return cancelled()
    }
    if (first.kind === 'completion-error') throw first.error
    const completed = first.value
    if (progress !== undefined) {
      const mounted = progress
      progress = undefined
      clearAndUnmount(mounted)
    }
    if (viewExit !== undefined) {
      const settled = await viewExit
      if (settled.kind === 'view-error') throw settled.error
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
