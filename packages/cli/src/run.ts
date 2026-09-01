import { parse } from '@bomb.sh/args'
import {
  allCommandNames,
  type Command,
  describeShortFlagCollision,
  findShortFlagCollisions,
  resolveCommand,
} from './commands.ts'
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

  // Build per-command flag parsing config.
  //
  // A flag that declares a short alias contributes BOTH spellings to its
  // type bucket, and an `alias` entry pointing the short one at the long
  // one. Both halves are needed: the parser decides whether a token takes a
  // value from the name as typed, before it applies aliases, so a `-i` that
  // is aliased but not also declared boolean would swallow the next argument
  // as its value instead of leaving it a positional.
  const booleanFlags: string[] = []
  const stringFlags: string[] = []
  const arrayFlags: string[] = []
  // Canonical long names only — what handlers are allowed to see.
  const scalarNames: string[] = []
  const arrayNames: string[] = []
  const alias: Record<string, string> = {}

  if (command.flags) {
    // Before the alias map is built, not after: building it is what
    // destroys the evidence. A second claim on the same short spelling
    // overwrites the first, leaving a parser that quietly does the wrong
    // thing with no trace of what it dropped. This is a declaration bug
    // in this repository's own command table, so it fails loudly rather
    // than becoming a user-facing error about an invocation that was
    // fine.
    const collisions = findShortFlagCollisions(command.flags)
    if (collisions.length > 0) {
      throw new Error(
        `internal: command "${command.name}" declares ambiguous short flags: ` +
          collisions.map(describeShortFlagCollision).join('; '),
      )
    }

    for (const [name, def] of Object.entries(command.flags)) {
      const bucket = def.type === 'boolean' ? booleanFlags : def.type === 'string' ? stringFlags : arrayFlags
      bucket.push(name)
      if (def.type === 'array') arrayNames.push(name)
      else scalarNames.push(name)
      if (def.short !== undefined) {
        bucket.push(def.short)
        alias[def.short] = name
      }
    }
  }

  // Parse with per-command config. `array` flags collect every occurrence of
  // a repeated flag (`--skill a --skill b` → `['a', 'b']`).
  const parsed = parse(argv.slice(1), {
    boolean: booleanFlags,
    string: stringFlags,
    array: arrayFlags,
    alias,
  })

  // Build positional args and flags
  const positionalArgs = parsed._.map(String)
  const flags: Record<string, unknown> = {}

  for (const name of scalarNames) {
    if (parsed[name] !== undefined) {
      flags[name] = parsed[name]
    }
  }

  // Array flags always surface as `string[]`. The parser yields a bare value
  // for a single occurrence and an array for multiple; normalize both to an
  // array so command handlers never branch on arity.
  for (const name of arrayNames) {
    const value = parsed[name]
    if (value === undefined) continue
    flags[name] = Array.isArray(value) ? value.map(String) : [String(value)]
  }

  // Forward any remaining parsed flags the command did not declare. `facet
  // modify` uses open-ended `--adapter-<name>` / `--remove-adapter-<name>`
  // flags whose names can't be declared up front; it reads them from here.
  // Commands that declare all their flags simply never look at the extras.
  //
  // Short aliases are in these buckets too, so a declared short name can
  // never reach a handler as a second, independent value.
  const declared = new Set([...booleanFlags, ...stringFlags, ...arrayFlags])
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '_' || declared.has(key) || flags[key] !== undefined) continue
    flags[key] = value
  }

  return command.run(positionalArgs, flags)
}
