import type { MiseInstall } from '../mise.ts'
import { spawnInherit } from './spawn-inherit.ts'
import type { InstallMethod } from './types.ts'

function toolSpec(install: MiseInstall, targetVersion: string): string {
  return `${install.backend}[version_prefix=${install.versionPrefix}]@${targetVersion}`
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function createMiseMethod(install: MiseInstall): InstallMethod {
  return {
    kind: 'mise',
    displayName: 'mise',
    describe: ({ targetVersion }) =>
      `mise use --path ${shellQuote(install.configPath)} ${shellQuote(toolSpec(install, targetVersion))}`,
    update: ({ targetVersion, onError }) =>
      spawnInherit(['mise', 'use', '--path', install.configPath, toolSpec(install, targetVersion)], { onError }),
  }
}
