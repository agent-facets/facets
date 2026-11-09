import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { FacetFileRead, FacetView, LoadFacetViewResult } from '@agent-facets/engine'
import * as engine from '@agent-facets/engine'
import type { FacetManifest } from '@agent-facets/protocol'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'

const { catCommand } = await import('../index.ts')

// Built from a code point: the formatter rewrites a `\u` escape for it into an invisible literal.
const BOM = String.fromCodePoint(0xfeff)

const MANIFEST = {
  name: 'cowsay',
  version: '1.0.2',
  skills: { 'cowsay-rules': { description: 'Rules', files: ['assets/logo.png'] } },
  commands: { cowsay: { description: 'Say' } },
  agents: { cowsay: { description: 'Agent' } },
  servers: { cowsrv: { type: 'http', url: 'https://cow.test/mcp' } },
  files: ['README.md'],
} satisfies FacetManifest

const CONTENT: Record<string, FacetFileRead> = {
  'skills/cowsay-rules/SKILL.md': { ok: true, kind: 'text', content: `${BOM}# Rules\r\nno trailing newline` },
  'agents/cowsay.md': { ok: true, kind: 'text', content: '# Agent\n' },
  'README.md': { ok: true, kind: 'text', content: '# Cowsay\n' },
  'commands/cowsay.md': { ok: true, kind: 'text', content: 'hi\u001b[2J there\u202E\n' },
  'skills/cowsay-rules/assets/logo.png': { ok: true, kind: 'binary', sizeBytes: 7 },
}

const reads: string[] = []

function fakeView(): FacetView {
  return {
    name: 'cowsay',
    version: '1.0.2',
    manifest: MANIFEST,
    origin: { kind: 'installed', from: 'cache', sourceKind: 'registry', authored: '1.0.2' },
    disposition: () => ({ kind: 'authored' }),
    readFile: async (path) => {
      reads.push(path)
      return CONTENT[path] ?? { ok: false, code: 'not-declared' }
    },
    localPath: async (path) => (path in CONTENT ? `/cache/cowsay@1.0.2/${path}` : undefined),
  }
}

let restoreLoader = () => {}

function loaderReturns(result: LoadFacetViewResult): void {
  const spy = spyOn(engine, 'loadFacetView').mockImplementation(async () => result)
  restoreLoader = () => spy.mockRestore()
}

afterEach(() => {
  restoreLoader()
  reads.length = 0
})

async function run(
  args: string[],
  flags: Record<string, unknown> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { result, stderr } = await captureStderr(() => captureStdout(() => catCommand.run(args, flags), { raw: true }))
  return { code: result.result, stdout: result.stdout, stderr }
}

describe('facet cat — printing', () => {
  test('prints a skill by bare name exactly as stored, BOM and CRLF included', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout, stderr } = await run(['cowsay', 'cowsay-rules'])
    expect(code).toBe(0)
    expect(stdout).toBe(`${BOM}# Rules\r\nno trailing newline`)
    expect(stderr).toBe('')
  })

  test.each([
    ['agents/cowsay', '# Agent\n'],
    ['commands/cowsay', 'hi\u001b[2J there\u202E\n'],
    ['commands/cowsay.md', 'hi\u001b[2J there\u202E\n'],
    ['README.md', '# Cowsay\n'],
  ])('%s selects its file', async (selector, expected) => {
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout } = await run(['cowsay', selector])
    expect(code).toBe(0)
    expect(stdout).toBe(expected)
  })

  test('--path prints the local location instead of the content', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout } = await run(['cowsay', 'README.md'], { path: true })
    expect(code).toBe(0)
    expect(stdout).toBe('/cache/cowsay@1.0.2/README.md\n')
    expect(reads).toEqual([])
  })
})

describe('facet cat — terminal safety', () => {
  let restoreTty = () => {}

  function stdoutIsTty(value: boolean): void {
    const original = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
    restoreTty = () => {
      if (original === undefined) delete (process.stdout as { isTTY?: boolean }).isTTY
      else Object.defineProperty(process.stdout, 'isTTY', original)
    }
  }

  afterEach(() => restoreTty())

  test('on a terminal, escapes are made visible and a note goes to stderr', async () => {
    stdoutIsTty(true)
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout, stderr } = await run(['cowsay', 'commands/cowsay'])
    expect(code).toBe(0)
    expect(stdout).toBe('hi^[[2J there<U+202E>\n')
    expect(stderr).toContain('2 characters shown as escapes; redirect output for raw bytes')
  })

  test('piped, the bytes are written unchanged and nothing is added', async () => {
    stdoutIsTty(false)
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout, stderr } = await run(['cowsay', 'commands/cowsay'])
    expect(code).toBe(0)
    expect(stdout).toBe('hi\u001b[2J there\u202E\n')
    expect(stderr).toBe('')
  })

  test('on a terminal, a file from the registry says so on stderr', async () => {
    stdoutIsTty(true)
    loaderReturns({ ok: true, view: { ...fakeView(), origin: { kind: 'registry-latest' } } })
    const { code, stdout, stderr } = await run(['cowsay', 'README.md'])
    expect(code).toBe(0)
    expect(stdout).toBe('# Cowsay\n')
    expect(stderr).toContain('note: from the registry: cowsay v1.0.2 (not installed)')
  })

  test('piped, a file from the registry adds nothing to stderr', async () => {
    stdoutIsTty(false)
    loaderReturns({ ok: true, view: { ...fakeView(), origin: { kind: 'registry-latest' } } })
    const { stderr } = await run(['cowsay', 'README.md'])
    expect(stderr).toBe('')
  })

  test('on a terminal, a file from the local copy adds no note', async () => {
    stdoutIsTty(true)
    loaderReturns({ ok: true, view: fakeView() })
    const { stderr } = await run(['cowsay', 'README.md'])
    expect(stderr).toBe('')
  })

  test('on a terminal, --path is shell-quoted', async () => {
    stdoutIsTty(true)
    const view = { ...fakeView(), localPath: async () => '/cache/my facets/README.md' }
    loaderReturns({ ok: true, view })
    const { stdout } = await run(['cowsay', 'README.md'], { path: true })
    expect(stdout).toBe("'/cache/my facets/README.md'\n")
  })
})

describe('facet cat — registry reads', () => {
  function registryView(read: FacetFileRead): FacetView {
    return {
      ...fakeView(),
      origin: { kind: 'registry-latest' },
      readFile: async () => read,
      localPath: async () => undefined,
    }
  }

  test('an unreachable registry renders the network guidance', async () => {
    loaderReturns({
      ok: true,
      view: registryView({
        ok: false,
        code: 'registry',
        error: { code: 'NETWORK_ERROR', cause: 'fetch failed', attempts: 1 },
      }),
    })
    const { code, stdout, stderr } = await run(['cowsay', 'README.md'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('could not reach the registry')
  })

  test('registry content that does not match is refused with the install fix', async () => {
    loaderReturns({
      ok: true,
      view: registryView({ ok: false, code: 'integrity-mismatch', expected: 'sha256:a', observed: 'sha256:b' }),
    })
    const { code, stdout, stderr } = await run(['cowsay', 'README.md'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('does not match')
    expect(stderr).toContain('facet install')
  })

  test('--path for a facet that is not installed points to facet add', async () => {
    loaderReturns({ ok: true, view: registryView({ ok: true, kind: 'text', content: 'x' }) })
    const { code, stdout, stderr } = await run(['cowsay', 'README.md'], { path: true })
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('facet add cowsay')
  })
})

describe('facet cat — refusals', () => {
  test('a file that is a link or leaves the facet is refused, with nothing on stdout', async () => {
    const view: FacetView = { ...fakeView(), readFile: async () => ({ ok: false, code: 'unsafe' }) }
    loaderReturns({ ok: true, view })
    const { code, stdout, stderr } = await run(['cowsay', 'README.md'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('refusing to read README.md from cowsay')
    expect(stderr).toContain('resolves outside the facet')
  })

  test('a name shared by a command and an agent lists both forms', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout, stderr } = await run(['cowsay', 'cowsay'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('commands/cowsay')
    expect(stderr).toContain('agents/cowsay')
  })

  test('an MCP server has no content and points to facet info', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout, stderr } = await run(['cowsay', 'cowsrv'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('MCP server')
    expect(stderr).toContain('facet info cowsay')
  })

  test.each([
    '../../.ssh/id_rsa',
    '/etc/passwd',
    'missing',
  ])('%s matches nothing, reads nothing, and lists what can be printed', async (selector) => {
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout, stderr } = await run(['cowsay', selector])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('matches nothing')
    expect(stderr).toContain('cowsay-rules')
    expect(reads).toEqual([])
  })

  test('a binary file is refused with its size and nothing on stdout', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout, stderr } = await run(['cowsay', 'skills/cowsay-rules/assets/logo.png'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('binary file (7 bytes)')
    expect(stderr).toContain('facet cat --path cowsay')
  })

  test.each([[['cowsay']], [['a', 'b', 'c']]])('rejects %p with the usage', async (args) => {
    const { code, stderr } = await run(args)
    expect(code).toBe(1)
    expect(stderr).toContain('facet cat <name> <asset-or-path>')
  })

  test('a facet the registry does not have points to facet search', async () => {
    loaderReturns({
      ok: false,
      failure: { code: 'registry', error: { code: 'NOT_FOUND', name: 'mobbin', spec: 'latest' } },
    })
    const { code, stdout, stderr } = await run(['mobbin', 'using-mobbin'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('facet search mobbin')
  })
})
