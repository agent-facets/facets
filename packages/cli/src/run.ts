import { parse } from '@bomb.sh/args'
import {
  allCommandNames,
  type Command,
  describeShortFlagCollision,
  findShortFlagCollisions,
  resolveCommand,
} from './commands.ts'
import { commandHelpData, globalHelpData, printCommandHelp, printGlobalHelp } from './help.ts'
import { findClosestCommand } from './suggest.ts'
import { writeJsonResult } from './util/json-output.ts'
import { version } from './version.ts'

export async function run(fullArgv: string[], commands: Record<string, Command>): Promise<number> {
  // Everything after the first `--` is positional, even when it looks like a
  // flag (`facet cat cowsay -- --help` selects a file named `--help`). The
  // parser has no notion of `--`, so the split happens here, before any
  // parsing, and the operands are appended to the command's positionals.
  // Both the human and the JSON path read from this one split.
  const separator = fullArgv.indexOf('--')
  const argv = separator === -1 ? fullArgv : fullArgv.slice(0, separator)
  const operands = separator === -1 ? [] : fullArgv.slice(separator + 1)

  const jsonArgs = parse(argv, { boolean: ['help', 'version', 'json'] })
  if (argv.some((arg) => arg.startsWith('--json=') && arg !== '--json=true' && arg !== '--json=false')) {
    const commandName = String(jsonArgs._[0] ?? 'help')
    const command = resolveCommand(commands, commandName)
    return writeJsonResult(command?.name ?? commandName, {
      ok: false,
      error: { code: 'INVALID_ARGUMENTS', message: '--json must be a boolean' },
    })
  }
  if (jsonArgs.json === true) return runJson(argv, operands, commands)

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
  if (
    command.name === 'login' &&
    argv.slice(commandIndex + 1).filter((arg) => arg === '--complete' || arg.startsWith('--complete=')).length > 1
  ) {
    console.error('invalid login arguments: --complete must not be repeated')
    return 1
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
  const positionalArgs = [...parsed._.map(String), ...operands]
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

async function runJson(before: string[], after: string[], commands: Record<string, Command>): Promise<number> {
  let name = 'help'
  try {
    const discovery = parse(before, { boolean: ['help', 'version', 'json'] })
    const commandName = String(discovery._[0] ?? '')
    const commandIndex = commandName ? before.indexOf(commandName) : -1
    const versionIndex = before.indexOf('--version')
    if (versionIndex >= 0 && (commandIndex < 0 || versionIndex < commandIndex)) {
      return writeJsonResult('version', { ok: true, data: { version } })
    }
    if (!commandName || commandName === 'help') {
      const topic = commandName === 'help' ? String(discovery._[1] ?? '') : ''
      const command = topic ? resolveCommand(commands, topic) : undefined
      return writeJsonResult('help', { ok: true, data: command ? commandHelpData(command) : globalHelpData(commands) })
    }
    const command = resolveCommand(commands, commandName)
    if (!command) {
      const suggestion = findClosestCommand(commandName, allCommandNames(commands))
      return writeJsonResult(commandName, {
        ok: false,
        error: { code: 'UNKNOWN_COMMAND', message: `Unknown command "${commandName}".`, details: { suggestion } },
      })
    }
    name = command.name
    if (discovery.help) return writeJsonResult('help', { ok: true, data: commandHelpData(command) })
    if (
      name === 'login' &&
      before.slice(commandIndex + 1).filter((arg) => arg === '--complete' || arg.startsWith('--complete=')).length > 1
    ) {
      return writeJsonResult(name, {
        ok: false,
        error: { code: 'INVALID_ARGUMENTS', message: '--complete must not be repeated' },
      })
    }
    const booleanFlags = ['json']
    const stringFlags: string[] = []
    const arrayFlags: string[] = []
    const alias: Record<string, string> = {}
    const definitions = command.flags ?? {}
    const collisions = findShortFlagCollisions(definitions)
    if (collisions.length > 0) throw new Error('ambiguous short flags')
    for (const [key, def] of Object.entries(definitions)) {
      const bucket = def.type === 'boolean' ? booleanFlags : def.type === 'string' ? stringFlags : arrayFlags
      if (!bucket.includes(key)) bucket.push(key)
      if (def.short !== undefined) {
        bucket.push(def.short)
        alias[def.short] = key
      }
    }
    const parsed = parse(before.slice(commandIndex + 1), {
      boolean: booleanFlags,
      string: stringFlags,
      array: arrayFlags,
      alias,
    })
    const flags: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (key === '_' || key in alias) continue
      flags[key] = arrayFlags.includes(key) && value !== undefined ? (Array.isArray(value) ? value : [value]) : value
    }
    flags.json = true
    const args = [...parsed._.map(String), ...after]
    if (name === 'adapter' && args[0]) name = `adapter ${args[0] === 'install' ? 'add' : args[0]}`
    if (!command.runJson) {
      return writeJsonResult(name, {
        ok: false,
        error: { code: 'JSON_NOT_IMPLEMENTED', message: `JSON output is not yet available for ${name}.` },
      })
    }
    return writeJsonResult(name, await command.runJson(args, flags))
  } catch {
    return writeJsonResult(name, {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
      exitCode: 2,
    })
  }
}
