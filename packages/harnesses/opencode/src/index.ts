import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AssetType, Harness } from '@agent-facets/harness'
import { emptyValidationResult, HARNESS_API_VERSION } from '@agent-facets/harness'

const harness: Harness = {
  name: 'opencode',
  rootDir: '.opencode',

  isAvailable(projectRoot: string): boolean {
    return existsSync(join(projectRoot, '.opencode'))
  },

  validateConfig(_data: unknown) {
    return emptyValidationResult()
  },

  assetPath(type: AssetType, name: string): string {
    if (type === 'skills') return `${this.rootDir}/skills/${name}/SKILL.md`
    return `${this.rootDir}/${type}/${name}.md`
  },
}

export { HARNESS_API_VERSION }
export default harness
