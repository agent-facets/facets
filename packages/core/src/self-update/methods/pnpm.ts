import { spawnInherit } from './spawn-inherit.ts'
import type { InstallMethod } from './types.ts'

export const pnpmMethod: InstallMethod = {
  kind: 'pnpm',
  displayName: 'pnpm (global)',
  describe: ({ targetVersion }) => `pnpm add -g agent-facets@${targetVersion}`,
  update: ({ targetVersion, onError }) =>
    spawnInherit(['pnpm', 'add', '-g', `agent-facets@${targetVersion}`], { onError }),
}
