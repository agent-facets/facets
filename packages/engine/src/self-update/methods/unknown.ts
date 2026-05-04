import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installerUrl, runCurlInstaller } from './curl.ts'
import type { InstallMethod } from './types.ts'

/**
 * Resolve a path through symlinks, returning the input unchanged on
 * failure. Used to compare two `facet` binary paths when one (or both)
 * may be a symlink.
 */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * The expected binary location after a curl install — same expression the
 * installer script uses (`${FACET_INSTALL_DIR:-$HOME/.facet}/bin/facet`).
 */
function curlBinaryPath(): string {
  const installRoot = process.env.FACET_INSTALL_DIR ?? join(homedir(), '.facet')
  return join(installRoot, 'bin', 'facet')
}

/**
 * Unknown install method. We couldn't classify how the running binary got
 * onto the user's machine, so we fall back to the curl installer (which
 * is universally available). Crucially, we DO let the installer modify
 * `$PATH` — the new `~/.facet/bin/facet` location may not be on the
 * user's `$PATH` at all, and silently installing somewhere unreachable
 * would be worse than a "your shell rc was edited" message.
 *
 * After install, we check whether `facet` on `$PATH` resolves to the
 * binary we just placed. If not, the original install is still shadowing
 * the new one (or vice versa); we surface a warning naming both paths so
 * the user can decide what to do. We do NOT remove the original — we
 * don't know what it is.
 */
export const unknownMethod: InstallMethod = {
  kind: 'unknown',
  displayName: 'unknown (falling back to curl installer)',
  describe: ({ targetVersion }) =>
    `(unclassified install) curl -fsSL ${installerUrl()} | bash -s -- --version ${targetVersion}`,
  update: async ({ targetVersion, onOutput, onError }) => {
    const runningPath = process.execPath
    onOutput?.(`facet self-update: running binary at ${runningPath} could not be classified.\n`)
    onOutput?.('Falling back to the curl installer (will install to ~/.facet/bin/facet).\n\n')

    // unknown method is the one place we want PATH modification: the new
    // install location may not be reachable otherwise.
    const code = await runCurlInstaller(targetVersion, { modifyPath: true, onError })
    if (code !== 0) return code

    // After install, check $PATH shadowing. If `which facet` points to
    // something that isn't the binary we just placed, warn — both
    // versions exist and the user needs to decide which one wins.
    const expected = curlBinaryPath()
    const onPath = Bun.which('facet')
    if (onPath !== null && safeRealpath(onPath) !== safeRealpath(expected)) {
      onOutput?.(
        `\nWarning: \`facet\` on your $PATH still resolves to a different binary.\n` +
          `  newly installed: ${expected}\n` +
          `  on $PATH:        ${onPath}\n` +
          `  Reorder $PATH or remove the older binary to use the new one.\n`,
      )
    }
    return 0
  },
}
