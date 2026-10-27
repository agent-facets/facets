import type { InstallMethod } from './types.ts'

export const homebrewMethod: InstallMethod = {
  kind: 'homebrew',
  displayName: 'Homebrew',
  describe: () => 'brew update && brew upgrade agent-facets/tap/facet',
  update: async ({ dryRun, onStatus }) => {
    onStatus?.({ kind: 'homebrew-update-guidance', dryRun })
    return 0
  },
}
