import { adapterCommand } from './commands/adapter/index.ts'
import { addCommand } from './commands/add/index.ts'
import { buildCommand } from './commands/build.ts'
import { createCommand } from './commands/create/index.ts'
import { editCommand } from './commands/edit/index.ts'
import { installCommand } from './commands/install/index.ts'

export type FlagDef = {
  type: 'boolean' | 'string'
  description: string
}

export type Command = {
  name: string
  description: string
  usage?: string
  flags?: Record<string, FlagDef>
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
  list: stubCommand('list', 'List installed facets'),
  publish: stubCommand('publish', 'Publish a facet to the registry'),
  remove: stubCommand('remove', 'Remove a facet from the project'),
  upgrade: stubCommand('upgrade', 'Upgrade installed facets'),
}
