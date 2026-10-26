import { realpathSync } from 'node:fs'
import { isAbsolute, join, resolve as pathResolve, relative } from 'node:path'

const FORMULA = 'agent-facets/tap/facet'
const PROBE_TIMEOUT_MS = 3000

export type HomebrewResolution =
  | { kind: 'not-homebrew' }
  | { kind: 'verified'; formula: typeof FORMULA }
  | { kind: 'guidance'; reason: 'metadata-unavailable' | 'different-formula' }

export interface HomebrewDependencies {
  execPath: string
  realpath: (path: string) => string
  run: (command: string[]) => Promise<string | null>
}

async function defaultRun(command: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(command, {
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return code === 0 ? stdout.trim() : null
  } catch {
    return null
  }
}

function isInside(path: string, directory: string): boolean {
  const from = relative(directory, path)
  return from !== '' && !from.startsWith('..') && !isAbsolute(from)
}

/**
 * Establish Homebrew ownership from Homebrew's installed formula prefix and
 * the resolved executable, rather than inferring it from a directory name.
 *
 * A binary resolved beneath Homebrew's Cellar but without matching metadata is
 * treated conservatively: callers can provide manual guidance without falling
 * through to an installer that would create another competing binary.
 */
export async function resolveHomebrewInstall(deps?: Partial<HomebrewDependencies>): Promise<HomebrewResolution> {
  const d: HomebrewDependencies = {
    execPath: deps?.execPath ?? process.execPath,
    realpath: deps?.realpath ?? realpathSync,
    run: deps?.run ?? defaultRun,
  }

  const root = await d.run(['brew', '--prefix'])
  if (root === null || root === '') return { kind: 'not-homebrew' }

  const homebrewRoot = pathResolve(root)
  let runningBinary: string
  try {
    runningBinary = d.realpath(d.execPath)
  } catch {
    return isInside(pathResolve(d.execPath), homebrewRoot)
      ? { kind: 'guidance', reason: 'metadata-unavailable' }
      : { kind: 'not-homebrew' }
  }

  const formulaPrefix = await d.run(['brew', '--prefix', '--installed', FORMULA])
  if (formulaPrefix !== null && formulaPrefix !== '') {
    try {
      const expectedBinary = d.realpath(join(pathResolve(formulaPrefix), 'bin', 'facet'))
      if (runningBinary === expectedBinary) return { kind: 'verified', formula: FORMULA }
    } catch {
      // A binary in the Cellar can still be Homebrew-managed even when its
      // formula prefix cannot be resolved, so classify it conservatively below.
    }
  }

  if (!isInside(runningBinary, join(homebrewRoot, 'Cellar'))) return { kind: 'not-homebrew' }
  return { kind: 'guidance', reason: formulaPrefix === null ? 'metadata-unavailable' : 'different-formula' }
}
