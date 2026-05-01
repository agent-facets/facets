import type { Command } from './commands.ts'
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
    const flagEntries = Object.entries(command.flags)
    const maxFlagLength = Math.max(...flagEntries.map(([name]) => `--${name}`.length), '--help'.length)

    for (const [name, def] of flagEntries) {
      lines.push(`  ${`--${name}`.padEnd(maxFlagLength + 4)}${def.description}`)
    }

    lines.push(`  ${'--help'.padEnd(maxFlagLength + 4)}Show help`)
  } else {
    lines.push('  --help    Show help')
  }

  console.log(lines.join('\n'))
}
