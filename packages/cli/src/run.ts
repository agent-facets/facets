import { parse } from '@bomb.sh/args'
import { allCommandNames, type Command, resolveCommand } from './commands.ts'
import { printCommandHelp, printGlobalHelp } from './help.ts'
import { findClosestCommand } from './suggest.ts'
import { version } from './version.ts'

export async function run(argv: string[], commands: Record<string, Command>): Promise<number> {
  const args = parse(argv, {
    boolean: ['help', 'version'],
  })

  if (args.version) {
    console.log(version)
    return 0
  }

  const commandName = String(args._[0] ?? '')

  // No command given — show global help
  if (!commandName) {
    printGlobalHelp(commands)
    return 0
  }

  // Explicit `help` command: `facets help` or `facets help build`
  if (commandName === 'help') {
    const subCommandName = String(args._[1] ?? '')
    const subCommand = subCommandName ? resolveCommand(commands, subCommandName) : undefined
    if (subCommand) {
      printCommandHelp(subCommand)
    } else {
      printGlobalHelp(commands)
    }
    return 0
  }

  const command = resolveCommand(commands, commandName)

  if (!command) {
    const suggestion = findClosestCommand(commandName, allCommandNames(commands))
    const message = suggestion
      ? `Unknown command "${commandName}". Did you mean "${suggestion}"?`
      : `Unknown command "${commandName}".`
    console.error(message)
    return 1
  }

  // Per-command help: `facets build --help`
  if (args.help) {
    printCommandHelp(command)
    return 0
  }

  // Build per-command flag parsing config
  const booleanFlags: string[] = []
  const stringFlags: string[] = []

  if (command.flags) {
    for (const [name, def] of Object.entries(command.flags)) {
      if (def.type === 'boolean') booleanFlags.push(name)
      else if (def.type === 'string') stringFlags.push(name)
    }
  }

  // Parse with per-command config
  const parsed = parse(argv.slice(1), {
    boolean: booleanFlags,
    string: stringFlags,
  })

  // Build positional args and flags
  const positionalArgs = parsed._.map(String)
  const flags: Record<string, unknown> = {}

  for (const name of [...booleanFlags, ...stringFlags]) {
    if (parsed[name] !== undefined) {
      flags[name] = parsed[name]
    }
  }

  return command.run(positionalArgs, flags)
}
