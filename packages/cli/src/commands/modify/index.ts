import {
  type ApplyModifyError,
  applyModify,
  applyModifyFileOps,
  loadManifest,
  writeManifest,
} from '@agent-facets/engine'
import type { Command } from '../../commands.ts'
import { type CliError, writeCliError } from '../../util/errors.ts'
import { resolveTargetDir } from '../resolve-dir.ts'
import { parseModifyArgs } from './parse.ts'

/** Version tag for the machine-readable `--json` output document. */
const MODIFY_JSON_SCHEMA_VERSION = '1'

/**
 * `facet modify <target> <name> [directory] [flags]` — headless, flag-driven
 * authoring edits to an existing `facet.json` (and its asset files). The
 * scriptable counterpart to the interactive `facet edit` wizard.
 */
export const modifyCommand: Command = {
  name: 'modify',
  description: 'Make a headless edit to a facet (scriptable counterpart to `edit`)',
  usage: '<skill|agent|command|facet> [name] [directory]',
  implemented: true,
  flags: {
    add: { type: 'boolean', description: 'Add a new asset (scaffold + manifest entry)' },
    remove: { type: 'boolean', description: 'Remove an asset (delete file + manifest entry)' },
    rename: { type: 'string', description: 'Rename an asset to the given name' },
    description: { type: 'string', description: "Set the asset's (or facet's) description" },
    name: { type: 'string', description: 'Set the facet name (facet target only)' },
    version: { type: 'string', description: 'Set the facet version (facet target only)' },
    private: { type: 'boolean', description: 'Set the facet private flag (facet target only)' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON to stdout' },
    // Note: `--adapter-<name> '<json>'` and `--remove-adapter-<name>` are
    // open-ended flags handled by parseModifyArgs; they can't be declared here.
  },
  run: async (args: string[], flags: Record<string, unknown>): Promise<number> => {
    // The optional [directory] positional comes AFTER <target> [name]. Peel it
    // off if present so it isn't mistaken for an asset name.
    const { positionals, directory } = splitDirectory(args)

    const parsed = parseModifyArgs(positionals, flags)
    if (!parsed.ok) {
      writeCliError(parsed.error)
      return 1
    }

    const resolved = await resolveTargetDir(directory, { mustExist: true, facetMustExist: true })
    if (!resolved.ok) {
      console.error(resolved.message)
      return 1
    }
    const rootDir = resolved.dir

    const loaded = await loadManifest(rootDir)
    if (!loaded.ok) {
      writeCliError({
        what: 'could not load facet.json',
        detail: loaded.errors.map((e) => e.message).join('; '),
        fix: 'fix the manifest and try again',
      })
      return 1
    }

    const result = applyModify(loaded.data, parsed.op)
    if (!result.ok) {
      writeCliError(describeApplyError(result.error))
      return 1
    }

    // Persist: write the mutated manifest first, then apply file side effects.
    await writeManifest(result.manifest, rootDir)
    await applyModifyFileOps(rootDir, result.fileOps)

    const json = flags.json === true
    if (json) {
      process.stdout.write(
        `${JSON.stringify(
          { schemaVersion: MODIFY_JSON_SCHEMA_VERSION, ok: true, changes: result.summary },
          null,
          2,
        )}\n`,
      )
    } else {
      for (const change of result.summary) {
        process.stdout.write(`✓ ${change}\n`)
      }
    }
    return 0
  },
}

/**
 * The `[directory]` positional is optional and trails `<target> [name]`. It is
 * present only when there are more positionals than the operation needs: the
 * `facet` target takes 0 names, asset targets take 1. Anything beyond that is
 * the directory.
 */
function splitDirectory(args: string[]): { positionals: string[]; directory: string | undefined } {
  const target = args[0]
  const nameSlots = target === 'facet' ? 1 : 2 // target(+name)
  if (args.length > nameSlots) {
    return { positionals: args.slice(0, nameSlots), directory: args[nameSlots] }
  }
  return { positionals: args, directory: undefined }
}

/** Map an engine `ApplyModifyError` to the CLI's 3-line error block. */
function describeApplyError(error: ApplyModifyError): CliError {
  switch (error.reason) {
    case 'asset-exists':
      return {
        what: `${singular(error.target)} "${error.name}" already exists`,
        detail: 'cannot add an asset that is already in the manifest',
        fix: 'use --description or an adapter flag to modify it, or pick a new name',
      }
    case 'asset-not-found':
      return {
        what: `${singular(error.target)} "${error.name}" not found`,
        detail: 'no such asset in the manifest',
        fix: 'check the name, or use --add to create it',
      }
    case 'rename-target-exists':
      return {
        what: `${singular(error.target)} "${error.name}" already exists`,
        detail: 'cannot rename onto an existing asset',
        fix: 'pick a different target name',
      }
    case 'adapter-not-found':
      return {
        what: `adapter "${error.adapter}" not set on ${singular(error.target)} "${error.name}"`,
        detail: 'nothing to remove',
        fix: 'check the adapter name',
      }
    case 'no-such-facet-field':
      return {
        what: 'no facet fields to set',
        detail: 'pass at least one of --name, --description, --version, or --private',
        fix: 'e.g. facet modify facet --version 1.0.0',
      }
    case 'manifest-invalid':
      return {
        what: 'the change would make facet.json invalid',
        detail: error.messages.join('; '),
        fix: 'adjust the operation so the resulting manifest is valid',
      }
  }
}

function singular(target: string): string {
  return target.slice(0, -1)
}
