import type { Adapter } from '@agent-facets/adapter'
import { loadInstalledAdapters } from '@agent-facets/engine'
import { describeInstalledAdapterFailure } from '../../util/adapter-install-errors.ts'
import { writeCliError } from '../../util/errors.ts'
import { pickAndInstallAdapters } from '../adapter/pick-and-install.ts'

/**
 * Discover install-capable adapters for commands that materialize or
 * delete assets (`add`, `remove`, `install`). If none are installable,
 * auto-launch the picker on a TTY; on a non-TTY return `null` with a CLI
 * error already written.
 *
 * Shared by `add`, `remove`, and `install` because all three drive the
 * install pipeline, which writes (`add`/`install`) or deletes (`remove`)
 * assets across every selected adapter — the adapter-discovery contract
 * is identical for all of them.
 */
export async function ensureAdapters(): Promise<ReadonlyArray<Adapter> | null> {
  // Fail closed: incompatible or broken installed adapters block the
  // operation entirely — they must NOT fall through to the zero-adapter
  // picker, which would misreport them as "no adapters installed".
  const loaded = await loadInstalledAdapters()
  if (!loaded.ok) {
    for (const failure of loaded.failures) {
      writeCliError(describeInstalledAdapterFailure(failure))
    }
    return null
  }
  const adapters = loaded.adapters
  const installable = adapters.filter((a) => a.supportsInstall === true)
  if (installable.length > 0) return installable

  if (adapters.length > 0) {
    const stale = adapters.map((a) => a.name).join(', ')
    writeCliError({
      what: `installed adapters do not support install yet: ${stale}`,
      detail: 'these adapters were bundled before install support shipped; the capability flag is missing',
      fix: "update each with 'facet adapter install <name>' to pull a version with install support",
    })
    return null
  }

  // Zero installable adapters. TTY → picker; non-TTY → fail.
  const result = await pickAndInstallAdapters()
  if (result.ok) {
    const installableAfter = result.adapters.filter((a) => a.supportsInstall === true)
    if (installableAfter.length === 0) {
      writeCliError({
        what: 'no adapters with install support after picker',
        detail: 'the selected adapter(s) bundled an old SDK without install support',
        fix: 'pick a different adapter or update one with install support',
      })
      return null
    }
    return installableAfter
  }

  if (result.reason === 'non-tty') {
    writeCliError({
      what: 'no adapters installed',
      detail: 'this is a non-interactive environment; the picker cannot run here',
      fix: "run 'facet adapter install <name>' first (e.g. claude-code, opencode)",
    })
  } else if (result.reason === 'aborted') {
    process.stderr.write('Aborted: no adapters installed.\n')
  }
  // 'install-failed': pickAndInstallAdapters wrote its own CLI error.
  return null
}
