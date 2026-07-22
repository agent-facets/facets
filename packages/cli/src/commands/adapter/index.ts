import {
  type InstalledAdapterInspection,
  inspectInstalledAdapters,
  installAdapter,
  removeAdapter,
} from '@agent-facets/engine'
import type { Command } from '../../commands.ts'
import {
  describeAdapterInstallFailure,
  formatPlacementWarning,
  repairCommand,
} from '../../util/adapter-install-errors.ts'
import { writeCliError } from '../../util/errors.ts'
import { pickAndInstallAdapters } from './pick-and-install.ts'

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

  const result = await installAdapter(specifier, {
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
    onLog: (build) => console.log(build()),
  })
  if (!result.ok) {
    writeCliError(describeAdapterInstallFailure(result.failure))
    return 1
  }
  console.log(`Adapter "${result.adapter.name}" installed successfully.`)
  for (const warning of result.warnings) {
    console.error(formatPlacementWarning(warning))
  }
  return 0
}

async function handleInstallPicker(): Promise<number> {
  const result = await pickAndInstallAdapters()
  if (result.ok) return 0
  if (result.reason === 'non-tty') {
    writeCliError({
      what: 'no adapters installed',
      detail: 'this is a non-interactive environment; the picker cannot run here',
      fix: "run 'facet adapter install <name>' with an explicit adapter (e.g. claude-code, opencode)",
    })
    return 1
  }
  if (result.reason === 'aborted') {
    process.stderr.write('Aborted: no adapters installed.\n')
    return 1
  }
  // 'install-failed': pickAndInstallAdapters already wrote the CLI error.
  return 1
}

/** The API column for one inspected entry: exact id, missing, malformed, or unknown. */
function apiColumn(inspection: InstalledAdapterInspection): string {
  switch (inspection.kind) {
    case 'compatible':
      return `api ${inspection.verified.apiVersion}`
    case 'incompatible':
      switch (inspection.failure.kind) {
        case 'api-missing':
          return 'api missing'
        case 'api-malformed':
          return `api malformed ("${inspection.failure.found}")`
        case 'api-unsupported':
          return `api ${inspection.failure.found}`
        case 'api-metadata-mismatch':
          return `api ${inspection.failure.runtimeDeclared}`
      }
      break
    case 'broken':
      return inspection.declaredApi !== undefined ? `api ${inspection.declaredApi}` : 'api unknown'
  }
}

/** The status column plus recovery hint for one inspected entry. */
function statusColumn(inspection: InstalledAdapterInspection): string {
  switch (inspection.kind) {
    case 'compatible':
      return 'supported'
    case 'incompatible':
      return `unsupported — reinstall: ${repairCommand(inspection.repair)}`
    case 'broken': {
      const why =
        inspection.reason.kind === 'invalid-receipt'
          ? 'invalid installation record'
          : inspection.reason.kind === 'missing-active-generation'
            ? 'missing active bundle'
            : 'bundle failed to load'
      return `broken (${why}) — reinstall: ${repairCommand(inspection.repair)}`
    }
  }
}

async function handleList(): Promise<number> {
  const inspections = await inspectInstalledAdapters()

  if (inspections.length === 0) {
    console.log('No adapters installed.')
    console.log('')
    console.log('Install one with: facet adapter install <specifier>')
    return 0
  }

  const nameWidth = Math.max(...inspections.map((inspection) => inspection.name.length))
  const apiWidth = Math.max(...inspections.map((inspection) => apiColumn(inspection).length))

  console.log('Installed adapters:')
  for (const inspection of inspections) {
    const name = inspection.name.padEnd(nameWidth)
    const api = apiColumn(inspection).padEnd(apiWidth)
    console.log(`  ${name}  ${api}  ${statusColumn(inspection)}`)
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
