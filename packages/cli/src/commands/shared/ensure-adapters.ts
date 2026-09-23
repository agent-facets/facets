import type { Adapter } from '@agent-facets/adapter'
import { loadInstalledAdapters } from '@agent-facets/engine'
import { adapterAddCommandFor } from '../../util/adapter-command.ts'
import { describeInstalledAdapterFailure } from '../../util/adapter-install-errors.ts'
import { type CliError, writeCliError } from '../../util/errors.ts'
import { pickAndInstallAdapters } from '../adapter/pick-and-install.ts'

/** How a caller wants adapter discovery to behave when it cannot proceed. */
export interface EnsureAdaptersOptions {
  /**
   * Never open the picker, even on a terminal that could show it. A run
   * whose stdout is a machine-readable document has nowhere to draw a
   * selection screen, so with no installable adapter it fails instead of
   * prompting.
   */
  headless?: boolean
  /**
   * Where errors go. Defaults to the usual stderr block. A caller that
   * has to say the same thing in another format passes its own collector
   * and formats what it gets.
   */
  report?: (error: CliError) => void
}

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
 *
 * `update --json` is the fourth caller and the reason for the options:
 * it needs the same decisions with none of the output and none of the
 * prompting. What this function decides is the same either way — only
 * where the reason goes, and whether a picker may open, can change.
 */
export async function ensureAdapters(options: EnsureAdaptersOptions = {}): Promise<ReadonlyArray<Adapter> | null> {
  const { headless = false, report = writeCliError } = options

  // Fail closed: incompatible or broken installed adapters block the
  // operation entirely — they must NOT fall through to the zero-adapter
  // picker, which would misreport them as "no adapters installed".
  const loaded = await loadInstalledAdapters()
  if (!loaded.ok) {
    for (const failure of loaded.failures) {
      report(describeInstalledAdapterFailure(failure))
    }
    return null
  }
  const adapters = loaded.adapters
  const installable = adapters.filter((a) => a.assets !== false)
  if (installable.length > 0) return installable

  if (adapters.length > 0) {
    const stale = adapters.map((a) => a.name).join(', ')
    report({
      what: `installed adapters do not support install yet: ${stale}`,
      detail:
        'these adapters declare no asset capability, so they can validate manifest config but materialize nothing',
      fix: `update each with '${adapterAddCommandFor('<name>')}' to pull a version that materializes assets`,
    })
    return null
  }

  // Zero installable adapters, and a headless caller has no screen to
  // put a picker on. Refused here rather than inside the picker so the
  // picker is never mounted at all: mounting it would write to the same
  // stdout the caller's document is going to.
  if (headless) {
    report({
      what: 'no adapters installed',
      detail: 'this is a non-interactive environment; the picker cannot run here',
      fix: `run '${adapterAddCommandFor('<name>')}' first (e.g. claude-code, opencode)`,
    })
    return null
  }

  // Zero installable adapters. TTY → picker; non-TTY → fail.
  const result = await pickAndInstallAdapters()
  if (result.ok) {
    const installableAfter = result.adapters.filter((a) => a.assets !== false)
    if (installableAfter.length === 0) {
      report({
        what: 'no adapters with install support after picker',
        detail: 'the selected adapter(s) declare no asset capability',
        fix: 'pick a different adapter or update one with install support',
      })
      return null
    }
    return installableAfter
  }

  if (result.reason === 'non-tty') {
    report({
      what: 'no adapters installed',
      detail: 'this is a non-interactive environment; the picker cannot run here',
      fix: `run '${adapterAddCommandFor('<name>')}' first (e.g. claude-code, opencode)`,
    })
  } else if (result.reason === 'aborted') {
    process.stderr.write('Aborted: no adapters installed.\n')
  }
  // 'install-failed': pickAndInstallAdapters wrote its own CLI error.
  return null
}
