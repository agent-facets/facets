import { buildCommand } from './commands/build.ts'
import { createCommand } from './commands/create/index.ts'
import { editCommand } from './commands/edit/index.ts'
import { harnessCommand } from './commands/harness/index.ts'

export type FlagDef = {
  type: 'boolean' | 'string'
  description: string
}

export type Command = {
  name: string
  description: string
  usage?: string
  flags?: Record<string, FlagDef>
  run: (args: string[], flags: Record<string, unknown>) => Promise<number>
}

function stubCommand(name: string, description: string): Command {
  return {
    name,
    description,
    run: async (_args, _flags) => {
      console.log(`"${name}" is not yet implemented.`)
      return 0
    },
  }
}

export const commands: Record<string, Command> = {
  add: stubCommand('add', 'Add a facet to the project'),
  build: buildCommand,
  create: createCommand,
  edit: editCommand,
  harness: harnessCommand,
  info: stubCommand('info', 'Show information about a facet'),
  install: stubCommand('install', 'Install all facets from the lockfile'),
  list: stubCommand('list', 'List installed facets'),
  publish: stubCommand('publish', 'Publish a facet to the registry'),
  remove: stubCommand('remove', 'Remove a facet from the project'),
  upgrade: stubCommand('upgrade', 'Upgrade installed facets'),
}
