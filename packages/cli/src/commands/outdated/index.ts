import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import { updateCommand } from '../update/index.ts'
import { buildUpdateErrorJson } from '../update/json.ts'

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
    // Read before the refusal below, not after it: a run refused for its
    // arguments owes the same one document on stdout that every other
    // `--json` outcome produces.
    const json = flags.json === true

    // No selection to make here — this command never writes, so there is
    // nothing a positional argument could narrow.
    if (args.length > 0) {
      const error = {
        what: 'facet outdated does not accept positional arguments',
        detail: 'outdated reports on every facet declared in facets.json',
        fix: "run 'facet outdated --json' for a machine-readable report",
      }
      if (json) {
        // Same document shape `update --json` emits, built from the same
        // function — inlined rather than reaching into `update`'s private
        // `writeJsonDocument` for what is just this one write.
        process.stdout.write(`${JSON.stringify(buildUpdateErrorJson(error), null, 2)}\n`)
        return 1
      }
      writeCliError(error)
      return 1
    }

    // `dry-run` forced true and `interactive` forced false: this command
    // can only ever report, never prompt or apply.
    return updateCommand.run([], { ...flags, 'dry-run': true, interactive: false })
  },
}
