import type { Adapter } from '@agent-facets/adapter'
import {
  type FirstPartyAdapter,
  getAdapterBaseDir,
  installAdapter,
  listInstalledAdapters,
  loadInstalledAdapters,
} from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import { describeAdapterInstallFailure } from '../../util/adapter-install-errors.ts'
import { writeCliError } from '../../util/errors.ts'
import { InstallPicker } from './install-picker.tsx'

/**
 * Result of `pickAndInstallAdapters`. Discriminated by `ok`:
 *
 *   - `ok: true`: at least one adapter was picked and installed; the
 *     full set of installed adapters (including any that already
 *     existed) is returned for the caller to hand to `runInstall`.
 *   - `ok: false`:
 *       - `'non-tty'`: stdout is not a TTY; the picker can't run.
 *       - `'aborted'`: user pressed Esc / Ctrl-C / Enter-with-no-pick.
 *       - `'install-failed'`: a selected adapter failed to install.
 */
export type PickAndInstallResult =
  | { ok: true; adapters: Adapter[] }
  | { ok: false; reason: 'non-tty' | 'aborted' | 'install-failed' }

/**
 * Mount the adapter picker, install whatever the user selects, and
 * return the freshly-loaded set of installed adapters. Used by:
 *
 *   - `facet adapter install` (no-arg path) — the original caller.
 *   - `facet add` when the project has zero installed adapters and
 *     stdout is a TTY.
 *
 * In both cases the picker is the only thing on stdin between mount
 * and unmount; subsequent Ink mounts (e.g. `<InstallView />`) can
 * reclaim raw mode cleanly.
 */
export async function pickAndInstallAdapters(): Promise<PickAndInstallResult> {
  if (!process.stdout.isTTY) {
    return { ok: false, reason: 'non-tty' }
  }

  const installedNames = await listInstalledAdapters(getAdapterBaseDir())

  // The picker reports its result via callbacks. Wrap the result in a
  // mutable object so TS doesn't narrow `picked` to `null` inside the
  // post-mount check; the assignment happens inside an async Ink
  // callback the type checker can't see through.
  const state: { picked: FirstPartyAdapter[] | null } = { picked: null }
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

  try {
    await instance.waitUntilExit()
  } finally {
    instance.unmount()
  }

  const picked = state.picked
  if (!picked || picked.length === 0) {
    return { ok: false, reason: 'aborted' }
  }

  // Install each selected adapter sequentially so the terminal log
  // stays readable. Stop at the first failure.
  for (const option of picked) {
    const result = await installAdapter(option.npmPackage, {
      onProgress: (stage, detail) => {
        if (stage === 'resolving') console.log(`Resolving "${detail}"...`)
        else if (stage === 'downloading') console.log(`Downloading ${detail}...`)
        else if (stage === 'placing') console.log(`Installing adapter "${detail}"...`)
      },
      onLog: (line) => console.log(line),
    })
    if (!result.ok) {
      writeCliError(describeAdapterInstallFailure(result.failure))
      return { ok: false, reason: 'install-failed' }
    }
    console.log(`Adapter "${result.adapter.name}" installed successfully.`)
  }

  // Re-load adapters from disk so callers see the freshly-installed ones.
  const adapters = await loadInstalledAdapters()
  return { ok: true, adapters }
}
