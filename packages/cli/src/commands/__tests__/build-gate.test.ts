import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import { captureStderr } from '../../__tests__/helpers/capture-std.ts'
import { buildCommand } from '../build.ts'

/**
 * Command-level gate: `facet build` fails closed on an incompatible
 * installed adapter, rendering the full diagnostic (adapter, declared
 * API, supported set, reinstall command) before the pipeline starts.
 */

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let adaptersDir: string
let originalFacetDir: string | undefined

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-build-gate-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  const facetDir = join(fakeHome, '.facet')
  adaptersDir = join(facetDir, 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_DIR = facetDir
  process.chdir(projectRoot)

  // A valid facet source tree — the build would succeed if the gate let
  // the pipeline run. The skill declares an `adapters` block targeting
  // the incompatible adapter, so if the gate ever regressed and let the
  // pipeline run, `buildAssetMetadata` on the throwing bundle would fire
  // and fail the test loudly (rather than the gate passing silently).
  writeFileSync(
    join(projectRoot, 'facet.json'),
    JSON.stringify({
      name: 'gate-facet',
      version: '0.1.0',
      skills: { planning: { description: 'planning skill', adapters: { 'future-adapter': {} } } },
    }),
  )
  mkdirSync(join(projectRoot, 'skills/planning'), { recursive: true })
  writeFileSync(join(projectRoot, 'skills/planning/SKILL.md'), '# planning\n')
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('facet build — incompatible installed adapter gate', () => {
  test('exits 1 with the full diagnostic before the pipeline starts', async () => {
    // Unmanaged bundle declaring an unsupported API; contract methods
    // throw loudly so any invocation fails the test.
    const dir = join(adaptersDir, 'future-adapter')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'adapter.js'),
      `export default {
  name: 'future-adapter',
  apiVersion: '9.9',
  supportsInstall: true,
  buildAssetMetadata() { throw new Error('contract method invoked despite incompatibility') },
  async installAsset() { throw new Error('contract method invoked despite incompatibility') },
  async readAsset() { throw new Error('contract method invoked despite incompatibility') },
  async deleteAsset() { throw new Error('contract method invoked despite incompatibility') },
}
`,
    )

    const { result: code, stderr } = await captureStderr(() => buildCommand.run([], { verify: true }))
    expect(code).toBe(1)

    // The diagnostic identifies the adapter, its declared API, the
    // supported set, and the reinstall command.
    expect(stderr).toContain('future-adapter')
    expect(stderr).toContain('9.9')
    expect(stderr).toContain(ADAPTER_API_VERSION)
    expect(stderr).toContain('facet adapter add future-adapter')

    // Secondary check: no dist/ output. Under --verify writeBuildOutput is
    // skipped regardless, so this alone can't prove ordering — the throwing
    // adapter contract methods (which would fire if the incompatible
    // adapter reached the pipeline) are the real observability tripwire.
    expect(existsSync(join(projectRoot, 'dist'))).toBe(false)
  })
})
