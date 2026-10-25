import { realpathSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'

const BACKEND = 'github:agent-facets/facets'
const VERSION_PREFIX = 'agent-facets@'

export interface MiseInstall {
  backend: typeof BACKEND
  versionPrefix: typeof VERSION_PREFIX
  configPath: string
}

export type MiseResolution =
  | { kind: 'not-mise' }
  | { kind: 'updatable'; install: MiseInstall }
  | { kind: 'guidance'; reason: 'metadata-unavailable' | 'invalid-metadata' | 'unsupported-tool' }

export interface MiseDependencies {
  execPath: string
  env: NodeJS.ProcessEnv
  realpath: (path: string) => string
  run: (command: string[]) => Promise<string | null>
}

async function defaultRun(command: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return code === 0 ? stdout.trim() : null
  } catch {
    return null
  }
}

function isToolMetadata(
  value: unknown,
): value is { backend: string; config_source: { path: string }; tool_options: { version_prefix?: string } } {
  if (typeof value !== 'object' || value === null) return false
  const metadata = value as Record<string, unknown>
  if (
    typeof metadata.backend !== 'string' ||
    typeof metadata.config_source !== 'object' ||
    metadata.config_source === null
  ) {
    return false
  }
  if (typeof metadata.tool_options !== 'object' || metadata.tool_options === null) return false
  const source = metadata.config_source as Record<string, unknown>
  return typeof source.path === 'string'
}

/**
 * Establish mise ownership from mise's machine-readable view, rather than
 * guessing from an installation-directory-shaped executable path.
 */
export async function resolveMiseInstall(deps?: Partial<MiseDependencies>): Promise<MiseResolution> {
  const d: MiseDependencies = {
    execPath: deps?.execPath ?? process.execPath,
    env: deps?.env ?? process.env,
    realpath: deps?.realpath ?? realpathSync,
    run: deps?.run ?? defaultRun,
  }
  const expectedBinary = await d.run(['mise', 'which', 'facet'])
  if (expectedBinary === null) return { kind: 'not-mise' }

  let runningBinary: string
  let miseBinary: string
  try {
    runningBinary = d.realpath(d.execPath)
    miseBinary = d.realpath(expectedBinary)
  } catch {
    return { kind: 'guidance', reason: 'metadata-unavailable' }
  }
  if (runningBinary !== miseBinary) return { kind: 'not-mise' }

  const provider = await d.run(['mise', 'which', 'facet', '--plugin'])
  if (provider === null) return { kind: 'guidance', reason: 'metadata-unavailable' }
  if (provider !== BACKEND) return { kind: 'guidance', reason: 'unsupported-tool' }

  const rawMetadata = await d.run(['mise', 'tool', BACKEND, '--json'])
  if (rawMetadata === null) return { kind: 'guidance', reason: 'metadata-unavailable' }

  let metadata: unknown
  try {
    metadata = JSON.parse(rawMetadata)
  } catch {
    return { kind: 'guidance', reason: 'invalid-metadata' }
  }
  if (!isToolMetadata(metadata)) return { kind: 'guidance', reason: 'invalid-metadata' }
  if (metadata.backend !== BACKEND || metadata.tool_options.version_prefix !== VERSION_PREFIX) {
    return { kind: 'guidance', reason: 'unsupported-tool' }
  }

  const configPath = pathResolve(metadata.config_source.path)
  // A config source can be a global, project, or custom file. `mise use --path`
  // modifies exactly that established source, avoiding an inferred `-g` scope.
  return { kind: 'updatable', install: { backend: BACKEND, versionPrefix: VERSION_PREFIX, configPath } }
}
