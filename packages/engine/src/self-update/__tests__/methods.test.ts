import { afterAll, afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import { bunMethod } from '../methods/bun.ts'
import { curlMethod, runCurlInstaller } from '../methods/curl.ts'
import { localDevMethod } from '../methods/local-dev.ts'
import { npmMethod } from '../methods/npm.ts'
import { pnpmMethod } from '../methods/pnpm.ts'
import type { InstallMethod, SelfUpdateErrorEvent } from '../methods/types.ts'
import { unknownMethod } from '../methods/unknown.ts'
import { yarnMethod } from '../methods/yarn.ts'

// ─── Spy setup ───────────────────────────────────────────────────────────
//
// We spy on three globals: `Bun.spawn` for the subprocess invocations,
// `globalThis.fetch` for the curl-installer download, and `Bun.which` for
// the post-install PATH-shadowing check.
//
// All output is collected through the `onError` / `onOutput` callbacks the
// methods accept, so we no longer need to monkey-patch `process.stderr.write`.

type PlainFetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
type PlainSpawn = (cmd: string[], opts?: unknown) => { exited: Promise<number> }

const spawnSpy = spyOn(Bun, 'spawn') as unknown as Mock<PlainSpawn>
const fetchSpy = spyOn(globalThis, 'fetch') as unknown as Mock<PlainFetch>
const whichSpy = spyOn(Bun, 'which')

beforeEach(() => {
  spawnSpy.mockClear()
  fetchSpy.mockClear()
  whichSpy.mockClear()
})

afterEach(() => {
  spawnSpy.mockReset()
  fetchSpy.mockReset()
  whichSpy.mockReset()
})

afterAll(() => {
  spawnSpy.mockRestore()
  fetchSpy.mockRestore()
  whichSpy.mockRestore()
})

// ─── Helpers ─────────────────────────────────────────────────────────────

function mockSpawnExit(code: number): void {
  spawnSpy.mockImplementation(() => ({
    exited: Promise.resolve(code),
  }))
}

function mockSpawnThrow(error: Error): void {
  spawnSpy.mockImplementation(() => {
    throw error
  })
}

function mockFetchOk(body = 'echo "fake installer"\n'): void {
  fetchSpy.mockImplementation(async () => new Response(body, { status: 200 }))
}

function mockFetchStatus(status: number): void {
  fetchSpy.mockImplementation(async () => new Response('error', { status }))
}

function mockFetchThrow(error: Error): void {
  fetchSpy.mockImplementation(async () => {
    throw error
  })
}

/**
 * Build a pair of `onError` and `onOutput` callbacks that accumulate into
 * arrays — replaces the old captureStderr/captureStdout helpers.
 *
 * `onError` receives a tagged `SelfUpdateErrorEvent`. The methods covered
 * by this test file only emit the `message` kind (engine reserves
 * `latest-version-failure` for the orchestrator); we collect the raw
 * events plus a flattened-string view of `message` lines, so individual
 * tests can assert either way.
 */
function makeCallbacks() {
  const events: SelfUpdateErrorEvent[] = []
  const outputs: string[] = []
  return {
    onError: (event: SelfUpdateErrorEvent) => {
      events.push(event)
    },
    onOutput: (line: string) => {
      outputs.push(line)
    },
    events: () => events,
    stderr: () => events.map((e) => (e.kind === 'message' ? e.line : '')).join(''),
    stdout: () => outputs.join(''),
  }
}

// ─── Package-manager methods (shared shape) ──────────────────────────────

describe.each<{ method: InstallMethod; expectedArgv: string[]; expectedDescribe: string }>([
  {
    method: npmMethod,
    expectedArgv: ['npm', 'install', '-g', 'agent-facets@0.8.0'],
    expectedDescribe: 'npm install -g agent-facets@0.8.0',
  },
  {
    method: yarnMethod,
    expectedArgv: ['yarn', 'global', 'add', 'agent-facets@0.8.0'],
    expectedDescribe: 'yarn global add agent-facets@0.8.0',
  },
  {
    method: pnpmMethod,
    expectedArgv: ['pnpm', 'add', '-g', 'agent-facets@0.8.0'],
    expectedDescribe: 'pnpm add -g agent-facets@0.8.0',
  },
  {
    method: bunMethod,
    expectedArgv: ['bun', 'add', '-g', 'agent-facets@0.8.0'],
    expectedDescribe: 'bun add -g agent-facets@0.8.0',
  },
])('package-manager method: $method.kind', ({ method, expectedArgv, expectedDescribe }) => {
  test('describe() returns the canonical command string', () => {
    expect(method.describe({ targetVersion: '0.8.0', dryRun: true })).toBe(expectedDescribe)
  })

  test('update() spawns the right argv and inherits stdio', async () => {
    mockSpawnExit(0)
    const code = await method.update({ targetVersion: '0.8.0', dryRun: false })
    expect(code).toBe(0)
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    expect(spawnSpy.mock.calls[0]?.[0]).toEqual(expectedArgv)
  })

  test('update() passes through a non-zero exit code from the package manager', async () => {
    mockSpawnExit(127)
    const code = await method.update({ targetVersion: '0.8.0', dryRun: false })
    expect(code).toBe(127)
  })

  test('update() returns 1 and emits onError when spawn throws (ENOENT)', async () => {
    mockSpawnThrow(new Error('ENOENT'))
    const cb = makeCallbacks()
    const code = await method.update({ targetVersion: '0.8.0', dryRun: false, onError: cb.onError })
    expect(code).toBe(1)
    expect(cb.stderr()).toContain('ENOENT')
  })
})

// ─── curl method ─────────────────────────────────────────────────────────

describe('curlMethod', () => {
  test('describe() returns the canonical command string', () => {
    expect(curlMethod.describe({ targetVersion: '0.8.0', dryRun: true })).toBe(
      'curl -fsSL https://agentfacets.io/install | bash -s -- --no-modify-path --version 0.8.0',
    )
  })

  test('update() fetches the installer and pipes it to bash with --no-modify-path', async () => {
    mockFetchOk()
    mockSpawnExit(0)
    const code = await curlMethod.update({ targetVersion: '0.8.0', dryRun: false })
    expect(code).toBe(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://agentfacets.io/install')
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    const argv = spawnSpy.mock.calls[0]?.[0]
    expect(argv).toEqual(['bash', '-s', '--', '--version', '0.8.0', '--no-modify-path'])
  })

  test('update() honors FACET_INSTALL_URL', async () => {
    const original = process.env.FACET_INSTALL_URL
    process.env.FACET_INSTALL_URL = 'https://example.com/install.sh'
    try {
      mockFetchOk()
      mockSpawnExit(0)
      await curlMethod.update({ targetVersion: '0.8.0', dryRun: false })
      expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://example.com/install.sh')
    } finally {
      if (original === undefined) {
        delete process.env.FACET_INSTALL_URL
      } else {
        process.env.FACET_INSTALL_URL = original
      }
    }
  })

  test('update() returns 1 when fetch fails', async () => {
    mockFetchThrow(new Error('ECONNREFUSED'))
    const cb = makeCallbacks()
    const code = await curlMethod.update({ targetVersion: '0.8.0', dryRun: false, onError: cb.onError })
    expect(code).toBe(1)
    expect(cb.stderr()).toContain('failed to fetch installer')
    expect(cb.stderr()).toContain('ECONNREFUSED')
    // Spawn must not be called when fetch fails.
    expect(spawnSpy).toHaveBeenCalledTimes(0)
  })

  test('update() returns 1 when fetch returns non-2xx', async () => {
    mockFetchStatus(503)
    const cb = makeCallbacks()
    const code = await curlMethod.update({ targetVersion: '0.8.0', dryRun: false, onError: cb.onError })
    expect(code).toBe(1)
    expect(cb.stderr()).toContain('HTTP 503')
    expect(spawnSpy).toHaveBeenCalledTimes(0)
  })

  test('update() passes through bash exit code', async () => {
    mockFetchOk()
    mockSpawnExit(2)
    const code = await curlMethod.update({ targetVersion: '0.8.0', dryRun: false })
    expect(code).toBe(2)
  })
})

// ─── runCurlInstaller (modifyPath: true) — used by unknown ───────────────

describe('runCurlInstaller with modifyPath: true', () => {
  test('does NOT pass --no-modify-path to bash', async () => {
    mockFetchOk()
    mockSpawnExit(0)
    await runCurlInstaller('0.8.0', { modifyPath: true })
    const argv = spawnSpy.mock.calls[0]?.[0]
    expect(argv).toEqual(['bash', '-s', '--', '--version', '0.8.0'])
  })
})

// ─── local-dev method ────────────────────────────────────────────────────

describe('localDevMethod', () => {
  test('describe() returns the refusal sentence', () => {
    expect(localDevMethod.describe({ targetVersion: '0.8.0', dryRun: true })).toBe('(refused — dev mode)')
  })

  test('update() emits refusal via onError and returns 1', async () => {
    const cb = makeCallbacks()
    const code = await localDevMethod.update({ targetVersion: '0.8.0', dryRun: false, onError: cb.onError })
    expect(code).toBe(1)
    expect(cb.stderr()).toContain('disabled in dev mode')
    expect(cb.stderr()).toContain('FACET_BIN_PATH')
    // Must not spawn or fetch anything.
    expect(spawnSpy).toHaveBeenCalledTimes(0)
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })
})

// ─── unknown method ──────────────────────────────────────────────────────

describe('unknownMethod', () => {
  test('describe() includes the unclassified callout and the version', () => {
    const out = unknownMethod.describe({ targetVersion: '0.8.0', dryRun: true })
    expect(out).toContain('(unclassified install)')
    expect(out).toContain('--version 0.8.0')
  })

  test('update() invokes runCurlInstaller WITHOUT --no-modify-path', async () => {
    mockFetchOk()
    mockSpawnExit(0)
    whichSpy.mockImplementation(() => null) // no facet on $PATH yet
    const cb = makeCallbacks()
    const code = await unknownMethod.update({
      targetVersion: '0.8.0',
      dryRun: false,
      onOutput: cb.onOutput,
      onError: cb.onError,
    })
    expect(code).toBe(0)
    const argv = spawnSpy.mock.calls[0]?.[0]
    expect(argv).toEqual(['bash', '-s', '--', '--version', '0.8.0'])
  })

  test('update() emits no warning when which finds the freshly installed binary', async () => {
    mockFetchOk()
    mockSpawnExit(0)
    const expected = `${process.env.HOME ?? '/home/test'}/.facet/bin/facet`
    whichSpy.mockImplementation(() => expected)
    const cb = makeCallbacks()
    await unknownMethod.update({
      targetVersion: '0.8.0',
      dryRun: false,
      onOutput: cb.onOutput,
      onError: cb.onError,
    })
    expect(cb.stdout()).not.toContain('Warning:')
  })

  test('update() emits PATH-shadowing warning when which finds a different binary', async () => {
    mockFetchOk()
    mockSpawnExit(0)
    whichSpy.mockImplementation(() => '/opt/local/bin/facet')
    const cb = makeCallbacks()
    await unknownMethod.update({
      targetVersion: '0.8.0',
      dryRun: false,
      onOutput: cb.onOutput,
      onError: cb.onError,
    })
    expect(cb.stdout()).toContain('Warning:')
    expect(cb.stdout()).toContain('/opt/local/bin/facet')
    expect(cb.stdout()).toContain('Reorder $PATH')
  })

  test('update() returns the curl installer exit code on failure (no shadow check)', async () => {
    mockFetchOk()
    mockSpawnExit(2) // installer failed
    const cb = makeCallbacks()
    const c = await unknownMethod.update({
      targetVersion: '0.8.0',
      dryRun: false,
      onOutput: cb.onOutput,
      onError: cb.onError,
    })
    expect(c).toBe(2)
    // We didn't run Bun.which because the installer failed — sanity check.
    expect(whichSpy).toHaveBeenCalledTimes(0)
  })
})
