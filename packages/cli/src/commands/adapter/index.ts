import {
  type FirstPartyAdapter,
  getAdapterBaseDir,
  installAdapter,
  listInstalledAdapters,
  removeAdapter,
} from '@agent-facets/core'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'

/**
 * `facet adapter` command — manages adapter installations.
 *
 * Subcommands:
 * - `facet adapter install <specifier>` — Install an adapter
 * - `facet adapter list` — List installed adapters
 * - `facet adapter remove <name>` — Remove an installed adapter
 */
export const adapterCommand: Command = {
  name: 'adapter',
  description: 'Manage adapter installations',
  usage: '<install|list|remove> [args]',
  implemented: true,

  async run(args, _flags) {
    const subcommand = args[0]

    switch (subcommand) {
      case 'install':
        return handleInstall(args.slice(1))
      case 'list':
        return handleList()
      case 'remove':
        return handleRemove(args.slice(1))
      default: {
        if (subcommand) {
          console.error(`Unknown adapter subcommand "${subcommand}". Use install, list, or remove.`)
        } else {
          console.error('Usage: facet adapter <install|list|remove> [args]')
        }
        return 1
      }
    }
  },
}

/**
 * Terminal-log adapter installer. Thin wrapper around the picker-safe
 * `installAdapter()` service (Adjustment Q) that maps progress stages to
 * console.log lines.
 */
async function handleInstall(args: string[]): Promise<number> {
  const specifier = args[0]
  if (!specifier) {
    // No-arg path: launch the shared zero-adapter picker (Adjustment A).
    return handleInstallPicker()
  }

  try {
    const { adapter } = await installAdapter(specifier, {
      onProgress: (stage, detail) => {
        switch (stage) {
          case 'resolving':
            console.log(`Resolving "${detail}"...`)
            break
          case 'downloading':
            console.log(`Downloading ${detail}...`)
            break
          case 'bundling':
          case 'verifying':
            // bundling + verifying are surfaced through `onLog`'s
            // "Using prebuilt bundle..." / fallback diagnostics.
            break
          case 'placing':
            console.log(`Installing adapter "${detail}"...`)
            break
        }
      },
      onLog: (line) => console.log(line),
    })
    console.log(`Adapter "${adapter.name}" installed successfully.`)
    return 0
  } catch (err) {
    console.error(`Failed to install adapter: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function handleInstallPicker(): Promise<number> {
  if (!process.stdout.isTTY) {
    // Adjustment D — non-TTY guard. No picker possible; point at the
    // explicit-arg path instead.
    writeCliError({
      what: 'no adapters installed',
      detail: 'this is a non-interactive environment; the picker cannot run here',
      fix: "run 'facet adapter install <name>' with an explicit adapter (e.g. claude-code, opencode)",
    })
    return 1
  }

  // Discover which adapters are already installed so the picker can show
  // "(installed — select to update)" rows in green instead of mislabeling
  // them as uninstalled. Falls back to an empty list if the adapter dir
  // doesn't exist (first-run case).
  const installedNames = await listInstalledAdapters(getAdapterBaseDir())

  // Wrap the result in an object so TS doesn't narrow `picked` to `null`
  // inside the `if (!picked)` check below — the assignment happens inside
  // an async Ink callback that TS can't see through statically.
  const state: { picked: FirstPartyAdapter[] | null } = { picked: null }
  const { render } = await import('ink')
  const { createElement } = await import('react')
  const { InstallPicker } = await import('./install-picker.tsx')

  const instance = render(
    createElement(InstallPicker, {
      installedNames,
      onConfirm: (selection) => {
        state.picked = selection
      },
      onAbort: () => {
        state.picked = null
      },
    }),
  )
  await runInstallPickerWait(instance)

  const picked = state.picked
  if (!picked || picked.length === 0) {
    process.stderr.write('Aborted: no adapters installed.\n')
    return 1
  }

  // Install each selected adapter sequentially so the terminal log stays
  // readable. Stop at the first failure.
  let installed = 0
  for (const option of picked) {
    try {
      const { adapter } = await installAdapter(option.npmPackage, {
        onProgress: (stage, detail) => {
          if (stage === 'resolving') console.log(`Resolving "${detail}"...`)
          else if (stage === 'downloading') console.log(`Downloading ${detail}...`)
          else if (stage === 'placing') console.log(`Installing adapter "${detail}"...`)
        },
        onLog: (line) => console.log(line),
      })
      console.log(`Adapter "${adapter.name}" installed successfully.`)
      installed++
    } catch (err) {
      writeCliError({
        what: `failed to install adapter "${option.name}"`,
        detail: err instanceof Error ? err.message : String(err),
        fix: 'see the stderr output above and retry; filesystem and network errors are usually transient',
      })
      return 1
    }
  }

  return installed > 0 ? 0 : 1
}

/**
 * Wait for an Ink instance rendering the picker to exit. The picker's
 * useInput handler calls the Ink `exit()` helper on confirm or abort,
 * which resolves `waitUntilExit()`. Abstracted out so both install and
 * (future) materialize paths can reuse the same wait pattern.
 */
async function runInstallPickerWait(instance: {
  waitUntilExit: () => Promise<unknown>
  unmount: () => void
}): Promise<void> {
  try {
    await instance.waitUntilExit()
  } finally {
    instance.unmount()
  }
}

async function handleList(): Promise<number> {
  const names = await listInstalledAdapters()

  if (names.length === 0) {
    console.log('No adapters installed.')
    console.log('')
    console.log('Install one with: facet adapter install <specifier>')
    return 0
  }

  console.log('Installed adapters:')
  for (const name of names) {
    console.log(`  ${name}`)
  }
  return 0
}

async function handleRemove(args: string[]): Promise<number> {
  const name = args[0]
  if (!name) {
    console.error('Usage: facet adapter remove <name>')
    return 1
  }

  const removed = await removeAdapter(name)
  if (removed) {
    console.log(`Adapter "${name}" removed.`)
    return 0
  }

  console.error(`Adapter "${name}" is not installed.`)
  return 1
}
