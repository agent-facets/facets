import type { InstallMethod } from './types.ts'

const UPGRADE_COMMAND = 'brew upgrade agent-facets/tap/facet'

export const homebrewMethod: InstallMethod = {
  kind: 'homebrew',
  displayName: 'Homebrew',
  describe: () => `brew update && ${UPGRADE_COMMAND}`,
  update: async ({ dryRun, onOutput }) => {
    onOutput?.(
      dryRun
        ? `Homebrew manages this facet binary.\nWould run:\n  brew update\n  ${UPGRADE_COMMAND}\n`
        : `Homebrew manages this facet binary. No update was performed.\nRun:\n  brew update\n  ${UPGRADE_COMMAND}\n`,
    )
    return 0
  },
}
