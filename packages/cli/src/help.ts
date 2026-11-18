import type { AnyCommand, FlagDef, FlagPatternDef } from './command.ts'
import { version } from './version.ts'

const JSON_OPTION = { name: 'json', type: 'boolean', description: 'Emit machine-readable JSON' } as const
const HELP_OPTION = { name: 'help', type: 'boolean', description: 'Show help' } as const

/** One accepted spelling of a command option, as both help formats show it. */
export interface HelpOption {
  name: string
  type: FlagDef['type']
  description: string
  short?: string
  valueName?: string
  /** Set on a negative spelling: the option it sets to `false`. */
  negates?: string
  /** Set on a pattern family such as `adapter-<name>`. */
  pattern?: true
}

/** Every spelling a command accepts, from its declarations, in help order. */
export function commandOptions(command: AnyCommand): HelpOption[] {
  const options: HelpOption[] = []
  for (const [name, def] of Object.entries<FlagDef>(command.flags ?? {})) {
    options.push({
      name,
      type: def.type,
      description: def.description,
      ...(def.short !== undefined ? { short: def.short } : {}),
      ...(def.type !== 'boolean' ? { valueName: def.valueName } : {}),
    })
    if (def.type === 'boolean' && def.negative !== undefined) {
      options.push({ name: def.negative.name, type: 'boolean', description: def.negative.description, negates: name })
    }
  }
  for (const [prefix, def] of Object.entries<FlagPatternDef>(command.patterns ?? {})) {
    options.push({
      name: `${prefix}<${def.nameLabel}>`,
      type: def.type,
      description: def.description,
      ...(def.type === 'string' ? { valueName: def.valueName } : {}),
      pattern: true,
    })
  }
  return options
}

/** Machine-readable help comes from the same registry as terminal help. */
export function globalHelpData(commands: Record<string, AnyCommand>) {
  const entries = [...new Set(Object.values(commands))].filter((command) => command.implemented !== false)
  return {
    version,
    usage: 'facet <command> [options]',
    commands: entries.map(({ name, description, aliases }) => ({ name, description, aliases: aliases ?? [] })),
    options: [HELP_OPTION, { name: 'version', type: 'boolean', description: 'Show version' }, JSON_OPTION],
  }
}

export function commandHelpData(command: AnyCommand) {
  return {
    name: command.name,
    description: command.description,
    usage: `facet ${command.name}${command.usage ? ` ${command.usage}` : ''} [options]`,
    aliases: command.aliases ?? [],
    options: [...commandOptions(command), HELP_OPTION, JSON_OPTION],
    ...(command.name === 'adapter'
      ? {
          subcommands: [
            { name: 'add', usage: '<specifier>', description: 'Install an adapter', aliases: ['install'] },
            { name: 'list', usage: '', description: 'List installed adapters', aliases: [] },
            { name: 'remove', usage: '<name>', description: 'Remove an installed adapter', aliases: [] },
          ],
        }
      : {}),
  }
}

/**
 * Render a command's listing label in global help: canonical name plus
 * any aliases, comma-joined. `self-update, self-upgrade` rather than two
 * separate lines so the user sees both names at once and the relationship
 * is unambiguous.
 */
function commandLabel(c: AnyCommand): string {
  if (c.aliases === undefined || c.aliases.length === 0) return c.name
  return [c.name, ...c.aliases].join(', ')
}

/**
 * Render an option's label in per-command help: `--latest`, `-L, --latest`,
 * or `--complete <login-id>`. The same string is used to measure the Options
 * column and to print the row, so labels never shift descriptions out of
 * alignment.
 */
function optionLabel(option: HelpOption): string {
  const long = `--${option.name}${option.valueName !== undefined ? ` <${option.valueName}>` : ''}`
  return option.short === undefined ? long : `-${option.short}, ${long}`
}

export function printGlobalHelp(commands: Record<string, AnyCommand>): void {
  // Hide stub commands from the global listing — they're still invocable (so
  // typos keep getting "did you mean…" suggestions), but surfacing them here
  // would promise capabilities we haven't shipped yet (Adjustment K).
  //
  // Dedupe by reference identity in case the same Command is registered
  // under multiple keys (defensive — current convention is one map entry
  // plus `aliases`).
  const seen = new Set<AnyCommand>()
  const entries: AnyCommand[] = []
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
    '  --json       Emit machine-readable JSON',
  ]

  console.log(lines.join('\n'))
}

export function printCommandHelp(command: AnyCommand): void {
  const usage = command.usage ? ` ${command.usage}` : ''
  const lines = [`Usage: facet ${command.name}${usage} [options]`, '', `  ${command.description}`, '', 'Options:']
  const rows = [
    ...commandOptions(command).map((option) => ({ label: optionLabel(option), description: option.description })),
    { label: '--json', description: JSON_OPTION.description },
    { label: '--help', description: HELP_OPTION.description },
  ]
  const width = Math.max(...rows.map((row) => row.label.length))
  for (const row of rows) lines.push(`  ${row.label.padEnd(width + 4)}${row.description}`)
  console.log(lines.join('\n'))
}
