import { bunMethod } from './methods/bun.ts'
import { curlMethod } from './methods/curl.ts'
import { localDevMethod } from './methods/local-dev.ts'
import { npmMethod } from './methods/npm.ts'
import { pnpmMethod } from './methods/pnpm.ts'
import type { InstallMethod, MethodKind } from './methods/types.ts'
import { unknownMethod } from './methods/unknown.ts'
import { yarnMethod } from './methods/yarn.ts'

/**
 * Registry of install methods, keyed by the `MethodKind` returned from
 * `detectInstallMethod`. Adding a new method is a matter of writing a new
 * `methods/<kind>.ts` and adding one entry here — no changes to existing
 * methods, no changes to the orchestrator.
 */
export const installMethods: Record<MethodKind, InstallMethod> = {
  curl: curlMethod,
  npm: npmMethod,
  yarn: yarnMethod,
  pnpm: pnpmMethod,
  bun: bunMethod,
  'local-dev': localDevMethod,
  unknown: unknownMethod,
}
