import type { Command } from './commands.ts'
import { version } from './version.ts'

export function printGlobalHelp(commands: Record<string, Command>): void {
  // Hide stub commands from the global listing — they're still invocable (so
  // typos keep getting "did you mean…" suggestions), but surfacing them here
  // would promise capabilities we haven't shipped yet (Adjustment K).
  const entries = Object.values(commands).filter((c) => c.implemented !== false)
  const maxNameLength = Math.max(...entries.map((c) => c.name.length))

  const lines = [
    `facet v${version}`,
    '',
    'Usage: facet <command> [options]',
    '',
    'Commands:',
    ...entries.map((c) => `  ${c.name.padEnd(maxNameLength + 2)}${c.description}`),
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
