import { adapterCommand } from './commands/adapter/index.ts'
import { addCommand } from './commands/add/index.ts'
import { buildCommand } from './commands/build.ts'
import { createCommand } from './commands/create/index.ts'
import { editCommand } from './commands/edit/index.ts'
import { installCommand } from './commands/install/index.ts'
import { instructionsCommand } from './commands/instructions/index.ts'
import { listCommand } from './commands/list/index.ts'
import { loginCommand } from './commands/login/index.ts'
import { logoutCommand } from './commands/logout/index.ts'
import { modifyCommand } from './commands/modify/index.ts'
import { publishCommand } from './commands/publish/index.ts'
import { removeCommand } from './commands/remove/index.ts'
import { searchCommand } from './commands/search/index.ts'
import { selfUpdateCommand } from './commands/self-update.ts'
import { updateCommand } from './commands/update/index.ts'
import { whoamiCommand } from './commands/whoami/index.ts'

type LowercaseLetter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'

/**
 * A flag's single-character short form. Spelled as a letter union rather
 * than `string` so `short: 'latest'` — which would parse as five clustered
 * one-letter flags, not one long one — cannot be written in the first
 * place.
 */
export type ShortFlagName = LowercaseLetter | Uppercase<LowercaseLetter>

export type FlagDef = {
  type: 'boolean' | 'string' | 'array'
  /**
   * Optional one-character alias. `-L` and `--latest` are the same flag:
   * the router hands the handler only the canonical long name, and help
   * renders both forms from this one declaration. There is deliberately
   * no second alias map to keep in sync.
   */
  short?: ShortFlagName
  description: string
}

export type Command = {
  name: string
  description: string
  usage?: string
  flags?: Record<string, FlagDef>
  /**
   * Alternate names that resolve to this same command. Aliases inherit
   * everything (description, flags, behavior) — including the canonical
   * `name` shown in per-command help. Useful for synonyms (`self-update`
   * ↔ `self-upgrade`) and shorthands.
   */
  aliases?: string[]
  /**
   * True when the command is wired to a real implementation. Absent or
   * false marks a stub — stubs are hidden from `facet --help` but still
   * invocable so typos surface helpful "did you mean…" suggestions.
   */
  implemented?: boolean
  run: (args: string[], flags: Record<string, unknown>) => Promise<number>
}

function stubCommand(name: string, description: string): Command {
  return {
    name,
    description,
    implemented: false,
    run: async (_args, _flags) => {
      console.log(`"${name}" is not yet implemented.`)
      return 0
    },
  }
}

export const commands: Record<string, Command> = {
  adapter: adapterCommand,
  add: addCommand,
  build: buildCommand,
  create: createCommand,
  edit: editCommand,
  info: stubCommand('info', 'Show information about a facet'),
  install: installCommand,
  instructions: instructionsCommand,
  list: listCommand,
  login: loginCommand,
  logout: logoutCommand,
  modify: modifyCommand,
  publish: publishCommand,
  remove: removeCommand,
  search: searchCommand,
  'self-update': selfUpdateCommand,
  // `upgrade` is deliberately NOT a second key here. It is an alias on
  // `updateCommand`, so both names resolve to one object with one help
  // page and one behavior — the thing two registry entries could not
  // promise.
  update: updateCommand,
  whoami: whoamiCommand,
}

/**
 * Resolve a command name (canonical or alias) to its `Command`.
 *
 * Direct map lookup is checked first so canonical names cost O(1). Alias
 * resolution scans the registered commands; with a small command surface
 * (~12 entries) this is fast enough that caching would be premature
 * optimization.
 *
 * Operates on a passed-in registry rather than the module-level `commands`
 * map so callers (like the test harness) can resolve against custom
 * registries.
 */
export function resolveCommand(registry: Record<string, Command>, name: string): Command | undefined {
  const direct = registry[name]
  if (direct !== undefined) return direct
  for (const cmd of Object.values(registry)) {
    if (cmd.aliases?.includes(name) === true) return cmd
  }
  return undefined
}

/**
 * All names a user could type to invoke any registered command — canonical
 * names plus every alias. Used by typo suggestions so that `self-upgrad`
 * suggests `self-upgrade` (not just `self-update`).
 */
export function allCommandNames(registry: Record<string, Command>): string[] {
  const names: string[] = []
  for (const [key, cmd] of Object.entries(registry)) {
    names.push(key)
    if (cmd.aliases !== undefined) names.push(...cmd.aliases)
  }
  return names
}
