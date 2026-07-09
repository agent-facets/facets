import { parse } from '@bomb.sh/args'
import { allCommandNames, type Command, resolveCommand } from './commands.ts'
import { printCommandHelp, printGlobalHelp } from './help.ts'
import { findClosestCommand } from './suggest.ts'
import { version } from './version.ts'

export async function run(argv: string[], commands: Record<string, Command>): Promise<number> {
  const args = parse(argv, {
    boolean: ['help', 'version'],
  })

  const commandName = String(args._[0] ?? '')

  // `--version` / `--help` are global ONLY when they precede the command name.
  // Otherwise they belong to the subcommand (e.g. `facet modify facet
  // --version 1.2.3` sets a facet's version and must not print the CLI
  // version). We detect this by checking whether the flag appears in argv
  // before the first positional (the command name).
  const commandIndex = commandName ? argv.indexOf(commandName) : -1
  const flagIsGlobal = (flag: string): boolean => {
    const at = argv.indexOf(flag)
    return at !== -1 && (commandIndex === -1 || at < commandIndex)
  }

  if (args.version && flagIsGlobal('--version')) {
    console.log(version)
    return 0
  }

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
  const arrayFlags: string[] = []

  if (command.flags) {
    for (const [name, def] of Object.entries(command.flags)) {
      if (def.type === 'boolean') booleanFlags.push(name)
      else if (def.type === 'string') stringFlags.push(name)
      else if (def.type === 'array') arrayFlags.push(name)
    }
  }

  // Parse with per-command config. `array` flags collect every occurrence of
  // a repeated flag (`--skill a --skill b` → `['a', 'b']`).
  const parsed = parse(argv.slice(1), {
    boolean: booleanFlags,
    string: stringFlags,
    array: arrayFlags,
  })

  // Build positional args and flags
  const positionalArgs = parsed._.map(String)
  const flags: Record<string, unknown> = {}

  for (const name of [...booleanFlags, ...stringFlags]) {
    if (parsed[name] !== undefined) {
      flags[name] = parsed[name]
    }
  }

  // Array flags always surface as `string[]`. The parser yields a bare value
  // for a single occurrence and an array for multiple; normalize both to an
  // array so command handlers never branch on arity.
  for (const name of arrayFlags) {
    const value = parsed[name]
    if (value === undefined) continue
    flags[name] = Array.isArray(value) ? value.map(String) : [String(value)]
  }

  // Forward any remaining parsed flags the command did not declare. `facet
  // modify` uses open-ended `--adapter-<name>` / `--remove-adapter-<name>`
  // flags whose names can't be declared up front; it reads them from here.
  // Commands that declare all their flags simply never look at the extras.
  const declared = new Set([...booleanFlags, ...stringFlags, ...arrayFlags])
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '_' || declared.has(key) || flags[key] !== undefined) continue
    flags[key] = value
  }

  return command.run(positionalArgs, flags)
}
