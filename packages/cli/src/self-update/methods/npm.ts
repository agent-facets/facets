import { spawnInherit } from './spawn-inherit.ts'
import type { InstallMethod } from './types.ts'

export const npmMethod: InstallMethod = {
  kind: 'npm',
  displayName: 'npm (global)',
  describe: ({ targetVersion }) => `npm install -g agent-facets@${targetVersion}`,
  update: ({ targetVersion }) => spawnInherit(['npm', 'install', '-g', `agent-facets@${targetVersion}`]),
}
