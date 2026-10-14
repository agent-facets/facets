import { spawnInherit } from './spawn-inherit.ts'
import type { InstallMethod } from './types.ts'

export const miseMethod: InstallMethod = {
  kind: 'mise',
  displayName: 'mise (global)',
  describe: ({ targetVersion }) => `mise use -g facet@${targetVersion}`,
  update: ({ targetVersion, onError }) => spawnInherit(['mise', 'use', '-g', `facet@${targetVersion}`], { onError }),
}
