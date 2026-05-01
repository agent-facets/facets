import type { InstallMethod } from './types.ts'

/**
 * Dev-mode refusal. Per Decision 8, a dev who triggers `facet self-update`
 * with `FACET_BIN_PATH` set sees a clear stderr message and a non-zero
 * exit. Better to let the red exit indicator surface a misconfigured CI
 * job than to silently no-op.
 */
export const localDevMethod: InstallMethod = {
  kind: 'local-dev',
  displayName: 'dev mode (FACET_BIN_PATH set)',
  describe: () => '(refused — dev mode)',
  update: async () => {
    process.stderr.write('facet self-update is disabled in dev mode (FACET_BIN_PATH is set).\n')
    return 1
  },
}
