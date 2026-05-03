import { spawnInherit } from './spawn-inherit.ts'
import type { InstallMethod } from './types.ts'

export const bunMethod: InstallMethod = {
  kind: 'bun',
  displayName: 'bun (global)',
  describe: ({ targetVersion }) => `bun add -g agent-facets@${targetVersion}`,
  update: ({ targetVersion, onError }) =>
    spawnInherit(['bun', 'add', '-g', `agent-facets@${targetVersion}`], { onError }),
}
