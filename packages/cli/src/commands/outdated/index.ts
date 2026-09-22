import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import { updateCommand } from '../update/index.ts'

/**
 * `facet outdated` — report which facets have newer releases, without
 * changing anything.
 *
 * There's no discovery or rendering logic here. This command IS `facet
 * update` with `--dry-run` forced on and prompting turned off, so the two
 * can never disagree about what would happen: a second, parallel
 * implementation would just be a second answer waiting to drift from the
 * one `update` actually applies.
 */
export const outdatedCommand: Command = {
  name: 'outdated',
  description: 'Report which facets have newer releases, without changing anything',
  implemented: true,
  flags: {
    latest: {
      type: 'boolean',
      short: 'L',
      description: "Compare against each facet's latest release, ignoring the range in facets.json",
    },
    json: { type: 'boolean', description: 'Emit machine-readable JSON to stdout instead of the plan view' },
  },
  run: async (args, flags) => {
    // No selection to make here — this command never writes, so there is
    // nothing a positional argument could narrow.
    if (args.length > 0) {
      writeCliError({
        what: 'facet outdated does not accept positional arguments',
        detail: 'outdated reports on every facet declared in facets.json',
        fix: "run 'facet outdated --json' for a machine-readable report",
      })
      return 1
    }

    // `dry-run` forced true and `interactive` forced false: this command
    // can only ever report, never prompt or apply.
    return updateCommand.run([], { ...flags, 'dry-run': true, interactive: false })
  },
}
