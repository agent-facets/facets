import { afterAll, afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import { bunMethod } from '../methods/bun.ts'
import { curlMethod, runCurlInstaller } from '../methods/curl.ts'
import { localDevMethod } from '../methods/local-dev.ts'
import { npmMethod } from '../methods/npm.ts'
import { pnpmMethod } from '../methods/pnpm.ts'
import type { InstallMethod } from '../methods/types.ts'
import { unknownMethod } from '../methods/unknown.ts'
import { yarnMethod } from '../methods/yarn.ts'

// ─── Spy setup ───────────────────────────────────────────────────────────
//
// We spy on three globals: `Bun.spawn` for the subprocess invocations,
// `globalThis.fetch` for the curl-installer download, and `Bun.which` for
// the post-install PATH-shadowing check. Each test installs a tailored
// `mockImplementation` and asserts on the spy's call args.
//
// `Bun.spawn` and `globalThis.fetch` both have augmented function types
// (with extra properties) that don't matter to our tests — we cast the
// spy handles to plain function shapes so `mockImplementation` accepts
// straightforward arrow-function stubs.

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
  // Reset implementations between tests so a previous test's mock can't
  // bleed into the next one.
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

/** Make `Bun.spawn` resolve with the given exit code. */
function mockSpawnExit(code: number): void {
  spawnSpy.mockImplementation(() => ({
    exited: Promise.resolve(code),
  }))
}

/** Make `Bun.spawn` synchronously throw — simulates ENOENT. */
function mockSpawnThrow(error: Error): void {
  spawnSpy.mockImplementation(() => {
    throw error
  })
}

/** Make `fetch` return a 200 response with a small placeholder body. */
function mockFetchOk(body = 'echo "fake installer"\n'): void {
  fetchSpy.mockImplementation(async () => new Response(body, { status: 200 }))
}

/** Make `fetch` return the given non-2xx status. */
function mockFetchStatus(status: number): void {
  fetchSpy.mockImplementation(async () => new Response('error', { status }))
}

/** Make `fetch` reject — simulates a network error. */
function mockFetchThrow(error: Error): void {
  fetchSpy.mockImplementation(async () => {
    throw error
  })
}

/** Capture stderr writes during a test body and return what was written. */
function captureStderr(fn: () => Promise<void>): Promise<string> {
  return new Promise((resolve, reject) => {
    const original = process.stderr.write.bind(process.stderr)
    let captured = ''
    // biome-ignore lint/suspicious/noExplicitAny: minimal write override
    process.stderr.write = ((chunk: any) => {
      captured += typeof chunk === 'string' ? chunk : String(chunk)
      return true
    }) as typeof process.stderr.write
    fn()
      .then(() => {
        process.stderr.write = original
        resolve(captured)
      })
      .catch((e) => {
        process.stderr.write = original
        reject(e)
      })
  })
}

/** Same idea for stdout. */
function captureStdout(fn: () => Promise<void>): Promise<string> {
  return new Promise((resolve, reject) => {
    const original = process.stdout.write.bind(process.stdout)
    let captured = ''
    // biome-ignore lint/suspicious/noExplicitAny: minimal write override
    process.stdout.write = ((chunk: any) => {
      captured += typeof chunk === 'string' ? chunk : String(chunk)
      return true
    }) as typeof process.stdout.write
    fn()
      .then(() => {
        process.stdout.write = original
        resolve(captured)
      })
      .catch((e) => {
        process.stdout.write = original
        reject(e)
      })
  })
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

  test('update() returns 1 and writes to stderr when spawn throws (ENOENT)', async () => {
    mockSpawnThrow(new Error('ENOENT'))
    const captured = await captureStderr(async () => {
      const code = await method.update({ targetVersion: '0.8.0', dryRun: false })
      expect(code).toBe(1)
    })
    expect(captured).toContain('ENOENT')
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
    const captured = await captureStderr(async () => {
      const code = await curlMethod.update({ targetVersion: '0.8.0', dryRun: false })
      expect(code).toBe(1)
    })
    expect(captured).toContain('failed to fetch installer')
    expect(captured).toContain('ECONNREFUSED')
    // Spawn must not be called when fetch fails.
    expect(spawnSpy).toHaveBeenCalledTimes(0)
  })

  test('update() returns 1 when fetch returns non-2xx', async () => {
    mockFetchStatus(503)
    const captured = await captureStderr(async () => {
      const code = await curlMethod.update({ targetVersion: '0.8.0', dryRun: false })
      expect(code).toBe(1)
    })
    expect(captured).toContain('HTTP 503')
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

  test('update() writes refusal to stderr and returns 1', async () => {
    const captured = await captureStderr(async () => {
      const code = await localDevMethod.update({ targetVersion: '0.8.0', dryRun: false })
      expect(code).toBe(1)
    })
    expect(captured).toContain('disabled in dev mode')
    expect(captured).toContain('FACET_BIN_PATH')
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
    await captureStdout(async () => {
      const code = await unknownMethod.update({ targetVersion: '0.8.0', dryRun: false })
      expect(code).toBe(0)
    })
    const argv = spawnSpy.mock.calls[0]?.[0]
    expect(argv).toEqual(['bash', '-s', '--', '--version', '0.8.0'])
  })

  test('update() prints no warning when which finds the freshly installed binary', async () => {
    mockFetchOk()
    mockSpawnExit(0)
    // Whatever path `Bun.which` returns must agree with the curl bin path
    // (~/.facet/bin/facet by default). We mock both to a simple match.
    const expected = `${process.env.HOME ?? '/home/test'}/.facet/bin/facet`
    whichSpy.mockImplementation(() => expected)
    const captured = await captureStdout(async () => {
      await unknownMethod.update({ targetVersion: '0.8.0', dryRun: false })
    })
    expect(captured).not.toContain('Warning:')
  })

  test('update() prints PATH-shadowing warning when which finds a different binary', async () => {
    mockFetchOk()
    mockSpawnExit(0)
    whichSpy.mockImplementation(() => '/opt/local/bin/facet')
    const captured = await captureStdout(async () => {
      await unknownMethod.update({ targetVersion: '0.8.0', dryRun: false })
    })
    expect(captured).toContain('Warning:')
    expect(captured).toContain('/opt/local/bin/facet')
    expect(captured).toContain('Reorder $PATH')
  })

  test('update() returns the curl installer exit code on failure (no shadow check)', async () => {
    mockFetchOk()
    mockSpawnExit(2) // installer failed
    const code = await captureStdout(async () => {
      const c = await unknownMethod.update({ targetVersion: '0.8.0', dryRun: false })
      expect(c).toBe(2)
    })
    // We didn't run Bun.which because the installer failed — sanity check.
    expect(whichSpy).toHaveBeenCalledTimes(0)
    void code
  })
})
