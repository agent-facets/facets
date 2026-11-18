import type { AnyCommand } from './command.ts'
import { adapterCommand } from './commands/adapter/index.ts'
import { addCommand } from './commands/add/index.ts'
import { buildCommand } from './commands/build.ts'
import { catCommand } from './commands/cat/index.ts'
import { createCommand } from './commands/create/index.ts'
import { editCommand } from './commands/edit/index.ts'
import { infoCommand } from './commands/info/index.ts'
import { installCommand } from './commands/install/index.ts'
import { instructionsCommand } from './commands/instructions/index.ts'
import { listCommand } from './commands/list/index.ts'
import { loginCommand } from './commands/login/index.ts'
import { logoutCommand } from './commands/logout/index.ts'
import { modifyCommand } from './commands/modify/index.ts'
import { outdatedCommand } from './commands/outdated/index.ts'
import { publishCommand } from './commands/publish/index.ts'
import { removeCommand } from './commands/remove/index.ts'
import { searchCommand } from './commands/search/index.ts'
import { selfUpdateCommand } from './commands/self-update.ts'
import { updateCommand } from './commands/update/index.ts'
import { whoamiCommand } from './commands/whoami/index.ts'

export type {
  AnyCommand,
  BooleanFlagDef,
  Command,
  CommandContext,
  FlagDef,
  FlagDefs,
  FlagPatternDef,
  FlagPatterns,
  FlagValues,
  ShortFlagCollision,
  ShortFlagName,
  ValueFlagDef,
} from './command.ts'
export { defineCommand, describeShortFlagCollision, findShortFlagCollisions } from './command.ts'

export const commands: Record<string, AnyCommand> = {
  adapter: adapterCommand,
  add: addCommand,
  build: buildCommand,
  cat: catCommand,
  create: createCommand,
  edit: editCommand,
  info: infoCommand,
  install: installCommand,
  instructions: instructionsCommand,
  list: listCommand,
  login: loginCommand,
  logout: logoutCommand,
  modify: modifyCommand,
  outdated: outdatedCommand,
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
export function resolveCommand(registry: Record<string, AnyCommand>, name: string): AnyCommand | undefined {
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
export function allCommandNames(registry: Record<string, AnyCommand>): string[] {
  const names: string[] = []
  for (const [key, cmd] of Object.entries(registry)) {
    names.push(key)
    if (cmd.aliases !== undefined) names.push(...cmd.aliases)
  }
  return names
}
