import type { Command, FlagDef } from './commands.ts'
import { version } from './version.ts'

/**
 * Render a command's listing label in global help: canonical name plus
 * any aliases, comma-joined. `self-update, self-upgrade` rather than two
 * separate lines so the user sees both names at once and the relationship
 * is unambiguous.
 */
function commandLabel(c: Command): string {
  if (c.aliases === undefined || c.aliases.length === 0) return c.name
  return [c.name, ...c.aliases].join(', ')
}

/**
 * Render a flag's label in per-command help: `--latest`, or `-L, --latest`
 * when the flag declares a short form. The same string is used to measure
 * the Options column and to print the row, so a short alias can never
 * shift a description out of alignment.
 */
function flagLabel(name: string, def: FlagDef): string {
  return def.short === undefined ? `--${name}` : `-${def.short}, --${name}`
}

export function printGlobalHelp(commands: Record<string, Command>): void {
  // Hide stub commands from the global listing — they're still invocable (so
  // typos keep getting "did you mean…" suggestions), but surfacing them here
  // would promise capabilities we haven't shipped yet (Adjustment K).
  //
  // Dedupe by reference identity in case the same Command is registered
  // under multiple keys (defensive — current convention is one map entry
  // plus `aliases`).
  const seen = new Set<Command>()
  const entries: Command[] = []
  for (const c of Object.values(commands)) {
    if (c.implemented === false) continue
    if (seen.has(c)) continue
    seen.add(c)
    entries.push(c)
  }
  const labels = entries.map(commandLabel)
  const maxLabelLength = Math.max(...labels.map((l) => l.length))

  const lines = [
    `facet v${version}`,
    '',
    'Usage: facet <command> [options]',
    '',
    'Commands:',
    ...entries.map((c, i) => `  ${(labels[i] ?? c.name).padEnd(maxLabelLength + 2)}${c.description}`),
    '',
    'Options:',
    '  --help       Show help',
    '  --version    Show version',
  ]

  console.log(lines.join('\n'))
}

export function printCommandHelp(command: Command): void {
  const usage = command.usage ? ` ${command.usage}` : ''

  const lines = [`Usage: facet ${command.name}${usage} [options]`, '', `  ${command.description}`, '', 'Options:']

  if (command.flags) {
    const rows = Object.entries(command.flags).map(([name, def]) => ({
      label: flagLabel(name, def),
      description: def.description,
    }))
    rows.push({ label: '--help', description: 'Show help' })

    const maxFlagLength = Math.max(...rows.map((row) => row.label.length))
    for (const row of rows) {
      lines.push(`  ${row.label.padEnd(maxFlagLength + 4)}${row.description}`)
    }
  } else {
    lines.push('  --help    Show help')
  }

  console.log(lines.join('\n'))
}
