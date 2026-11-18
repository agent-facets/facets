import { type AnyCommand, describeShortFlagCollision, findShortFlagCollisions } from './command.ts'
import { allCommandNames, resolveCommand } from './commands.ts'
import { commandHelpData, globalHelpData, printCommandHelp, printGlobalHelp } from './help.ts'
import { parseCommandFlags } from './parse-flags.ts'
import { findClosestCommand } from './suggest.ts'
import { writeCliError } from './util/errors.ts'
import { writeJsonResult } from './util/json-output.ts'
import { version } from './version.ts'

/** Tokens accepted before the command name. */
const LEADING_GLOBALS = new Set(['--help', '--version', '--json', '--json=true', '--json=false'])

export async function run(fullArgv: string[], commands: Record<string, AnyCommand>): Promise<number> {
  // Everything after the first `--` is an operand, even when it looks like a
  // flag (`facet cat cowsay -- --help` selects a file named `--help`).
  const separator = fullArgv.indexOf('--')
  const argv = separator === -1 ? fullArgv : fullArgv.slice(0, separator)
  const operands = separator === -1 ? [] : fullArgv.slice(separator + 1)

  // Decided before anything can fail, so every failure below is reported in
  // the format the caller asked for. A token equal to `--json` is never an
  // option value: value-taking options refuse a following token that starts
  // with `-`.
  let json = false
  let malformedJson: string | undefined
  for (const token of argv) {
    if (token === '--json' || token === '--json=true') json = true
    else if (token === '--json=false') json = false
    else if (token.startsWith('--json=')) malformedJson = token
  }

  const commandIndex = argv.findIndex((token) => !token.startsWith('-') || token === '-')
  const leading = commandIndex === -1 ? argv : argv.slice(0, commandIndex)
  const commandName = commandIndex === -1 ? '' : (argv[commandIndex] ?? '')
  const rest = commandIndex === -1 ? [] : argv.slice(commandIndex + 1)
  const resolved = commandName ? resolveCommand(commands, commandName) : undefined

  const refuse = (name: string, message: string, fix: string): number => {
    if (json || malformedJson !== undefined) {
      return writeJsonResult(name, { ok: false, error: { code: 'INVALID_ARGUMENTS', message, fix } })
    }
    writeCliError({ what: message, fix })
    return 1
  }

  if (malformedJson !== undefined) {
    return refuse(
      resolved?.name ?? (commandName || 'help'),
      `${malformedJson} must be --json=true or --json=false`,
      'pass --json',
    )
  }
  const unknownLeading = leading.find((token) => !LEADING_GLOBALS.has(token))
  if (unknownLeading !== undefined) {
    return refuse(resolved?.name ?? 'help', `unknown option ${unknownLeading}`, 'run `facet --help` to see the options')
  }

  // `--version` is global ONLY before the command name. After it, the token
  // belongs to the command (`facet modify facet --version 1.2.3`).
  if (leading.includes('--version')) {
    if (json) return writeJsonResult('version', { ok: true, data: { version } })
    console.log(version)
    return 0
  }

  if (!commandName || commandName === 'help') {
    const topic = commandName === 'help' ? rest.find((token) => !token.startsWith('-')) : undefined
    const command = topic !== undefined ? resolveCommand(commands, topic) : undefined
    if (json) {
      return writeJsonResult('help', { ok: true, data: command ? commandHelpData(command) : globalHelpData(commands) })
    }
    if (command) printCommandHelp(command)
    else printGlobalHelp(commands)
    return 0
  }

  if (!resolved) {
    const suggestion = findClosestCommand(commandName, allCommandNames(commands))
    const message = suggestion
      ? `Unknown command "${commandName}". Did you mean "${suggestion}"?`
      : `Unknown command "${commandName}".`
    if (json) {
      return writeJsonResult(commandName, {
        ok: false,
        error: { code: 'UNKNOWN_COMMAND', message: `Unknown command "${commandName}".`, details: { suggestion } },
      })
    }
    console.error(message)
    return 1
  }
  const command = resolved

  if (leading.includes('--help') || rest.includes('--help')) {
    if (json) return writeJsonResult('help', { ok: true, data: commandHelpData(command) })
    printCommandHelp(command)
    return 0
  }

  // A declaration bug in this repository's own command table, so it fails
  // loudly rather than becoming a user-facing error.
  const collisions = findShortFlagCollisions(command.flags ?? {})
  if (collisions.length > 0) {
    throw new Error(
      `internal: command "${command.name}" declares ambiguous short flags: ` +
        collisions.map(describeShortFlagCollision).join('; '),
    )
  }

  const parsed = parseCommandFlags(command, rest, operands)
  if (!parsed.ok) return refuse(command.name, parsed.message, `run \`facet ${command.name} --help\` to see its options`)

  const flags = parsed.flags as Parameters<AnyCommand['run']>[1]
  if (!json) return command.run(parsed.args, flags)

  let name = command.name
  const subcommand = parsed.args[0]
  if (name === 'adapter' && subcommand !== undefined) name = `adapter ${subcommand === 'install' ? 'add' : subcommand}`
  try {
    return writeJsonResult(name, await command.runJson(parsed.args, { ...flags, json: true }))
  } catch {
    return writeJsonResult(name, {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
      exitCode: 2,
    })
  }
}
