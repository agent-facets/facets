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

/**
 * A short-alias declaration that would make an invocation ambiguous.
 *
 * Both arms describe the same class of bug — two flags answering to one
 * spelling — but they are reached differently and read differently in
 * the message, so they stay separate rather than sharing an optional
 * field that only one of them fills in.
 */
export type ShortFlagCollision =
  /** Two long flags claim the same short alias. */
  | { kind: 'duplicate-short'; short: ShortFlagName; first: string; second: string }
  /** A short alias is spelled the same as a long flag on the same command. */
  | { kind: 'short-shadows-long'; short: ShortFlagName; declaredBy: string }

/**
 * Every ambiguity in one command's short-alias declarations.
 *
 * The parser is configured from an alias map, and a map cannot hold two
 * targets for one key: the second declaration silently replaces the
 * first, so `-x` starts setting a flag its author never associated with
 * it and the flag that declared `-x` stops responding to it. Nothing
 * about that failure is visible at the call site — it looks exactly like
 * a working command until someone uses the losing spelling.
 *
 * Returns every collision rather than the first, so a registry with more
 * than one is repaired in a single pass.
 *
 * Pure: takes the declarations, returns data, decides nothing about what
 * to do with them.
 */
export function findShortFlagCollisions(flags: Record<string, FlagDef>): ShortFlagCollision[] {
  const collisions: ShortFlagCollision[] = []
  const claimedBy = new Map<ShortFlagName, string>()
  const longNames = new Set(Object.keys(flags))

  for (const [name, def] of Object.entries(flags)) {
    const short = def.short
    if (short === undefined) continue

    const first = claimedBy.get(short)
    if (first === undefined) claimedBy.set(short, name)
    else collisions.push({ kind: 'duplicate-short', short, first, second: name })

    // A one-character long flag is legal on its own; it is only a problem
    // when some other flag also claims that character as its short form,
    // because the parser rewrites the short spelling to the long one and
    // the two names are then the same token meaning two things.
    if (longNames.has(short)) collisions.push({ kind: 'short-shadows-long', short, declaredBy: name })
  }

  return collisions
}

/** One collision, phrased for the invariant failure that reports it. */
export function describeShortFlagCollision(collision: ShortFlagCollision): string {
  switch (collision.kind) {
    case 'duplicate-short':
      return `-${collision.short} is claimed by both --${collision.first} and --${collision.second}`
    case 'short-shadows-long':
      return `-${collision.short} is claimed by --${collision.declaredBy} but --${collision.short} is also a flag`
  }
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
