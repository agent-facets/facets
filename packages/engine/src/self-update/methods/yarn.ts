import { spawnInherit } from './spawn-inherit.ts'
import type { InstallMethod } from './types.ts'

/**
 * Yarn classic (v1) command. Yarn Berry (v2+) deprecated `yarn global`,
 * so on a Berry system this will fail with Berry's own error — which is
 * the right outcome: the user installed via something else (probably npm)
 * and detection should have classified them as that.
 */
export const yarnMethod: InstallMethod = {
  kind: 'yarn',
  displayName: 'yarn (global)',
  describe: ({ targetVersion }) => `yarn global add agent-facets@${targetVersion}`,
  update: ({ targetVersion, onError }) =>
    spawnInherit(['yarn', 'global', 'add', `agent-facets@${targetVersion}`], { onError }),
}
