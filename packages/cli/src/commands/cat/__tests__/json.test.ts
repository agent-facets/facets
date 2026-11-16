import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { FacetFileRead, FacetView, LoadFacetViewResult } from '@agent-facets/engine'
import * as engine from '@agent-facets/engine'
import type { FacetManifest } from '@agent-facets/protocol'

const { catCommand } = await import('../index.ts')

const MANIFEST = {
  name: 'cowsay',
  version: '1.0.2',
  skills: { 'cowsay-rules': { description: 'Rules', files: ['assets/logo.png'] } },
  commands: { cowsay: { description: 'Say' } },
  agents: { cowsay: { description: 'Agent' } },
  servers: { cowsrv: { type: 'http', url: 'https://cow.test/mcp' } },
  files: ['README.md', 'LINK.md'],
} satisfies FacetManifest

const CONTENT: Record<string, FacetFileRead> = {
  'skills/cowsay-rules/SKILL.md': { ok: true, kind: 'text', content: '# Rules\r\n' },
  'README.md': { ok: true, kind: 'text', content: '# Cowsay\n' },
  'LINK.md': { ok: false, code: 'unsafe' },
  'skills/cowsay-rules/assets/logo.png': { ok: true, kind: 'binary', sizeBytes: 7 },
}

function fakeView(
  origin: FacetView['origin'] = { kind: 'installed', from: 'cache', sourceKind: 'registry', authored: '1.0.2' },
): FacetView {
  return {
    name: 'cowsay',
    version: '1.0.2',
    manifest: MANIFEST,
    origin,
    disposition: () => ({ kind: 'authored' }),
    readFile: async (path) => CONTENT[path] ?? { ok: false, code: 'unreadable' },
    localPath: async (path) =>
      origin.kind === 'installed' && path in CONTENT ? `/cache/cowsay@1.0.2/${path}` : undefined,
  }
}

let restoreLoader = () => {}

function loaderReturns(result: LoadFacetViewResult): void {
  const spy = spyOn(engine, 'loadFacetView').mockImplementation(async () => result)
  restoreLoader = () => spy.mockRestore()
}

afterEach(() => restoreLoader())

describe('facet cat --json — success', () => {
  test('returns the exact text with where it came from', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const result = await catCommand.runJson(['cowsay', 'cowsay-rules'], { json: true })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({
      name: 'cowsay',
      version: '1.0.2',
      origin: { kind: 'installed', from: 'cache', sourceKind: 'registry', authored: '1.0.2' },
      path: 'skills/cowsay-rules/SKILL.md',
      content: '# Rules\r\n',
    })
  })

  test('--path returns the local path instead of content', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const result = await catCommand.runJson(['cowsay', 'README.md'], { json: true, path: true })
    if (!result.ok) expect.unreachable()
    expect(result.data).toMatchObject({ path: 'README.md', localPath: '/cache/cowsay@1.0.2/README.md' })
    expect(result.data).not.toHaveProperty('content')
  })

  test('a registry read is identified by its origin', async () => {
    loaderReturns({ ok: true, view: fakeView({ kind: 'registry-latest' }) })
    const result = await catCommand.runJson(['cowsay', 'README.md'], { json: true })
    if (!result.ok) expect.unreachable()
    expect(result.data).toMatchObject({ origin: { kind: 'registry-latest' } })
  })
})

describe('facet cat --json — refusals', () => {
  const cases: Array<[string, string[], Record<string, unknown>, string, Record<string, unknown>?]> = [
    ['wrong argument count', ['cowsay'], {}, 'INVALID_ARGUMENTS'],
    [
      'ambiguous selector',
      ['cowsay', 'cowsay'],
      {},
      'SELECTOR_AMBIGUOUS',
      { candidates: ['commands/cowsay', 'agents/cowsay'] },
    ],
    ['server selector', ['cowsay', 'cowsrv'], {}, 'SELECTOR_IS_SERVER', { selector: 'cowsrv' }],
    ['unknown selector', ['cowsay', 'nope'], {}, 'SELECTOR_NOT_FOUND', { selector: 'nope' }],
    ['binary file', ['cowsay', 'skills/cowsay-rules/assets/logo.png'], {}, 'FILE_BINARY', { sizeBytes: 7 }],
    ['unsafe file', ['cowsay', 'LINK.md'], {}, 'FILE_UNSAFE', { path: 'LINK.md' }],
  ]

  for (const [label, args, flags, code, details] of cases) {
    test(label, async () => {
      loaderReturns({ ok: true, view: fakeView() })
      const result = await catCommand.runJson(args, { json: true, ...flags })
      if (result.ok) expect.unreachable()
      expect(result.error.code).toBe(code)
      if (details !== undefined) expect(result.error.details).toMatchObject(details)
    })
  }

  test('--path for a facet that is not installed', async () => {
    loaderReturns({ ok: true, view: fakeView({ kind: 'registry-latest' }) })
    const result = await catCommand.runJson(['cowsay', 'README.md'], { json: true, path: true })
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('NOT_INSTALLED')
  })

  test('a load failure keeps its structured fields', async () => {
    loaderReturns({ ok: false, failure: { code: 'integrity-mismatch', expected: 'sha256:a', observed: 'sha256:b' } })
    const result = await catCommand.runJson(['cowsay', 'README.md'], { json: true })
    if (result.ok) expect.unreachable()
    expect(result.error).toMatchObject({
      code: 'INTEGRITY_MISMATCH',
      details: { expected: 'sha256:a', observed: 'sha256:b' },
      fix: 'run: facet install',
    })
  })

  test('a registry NOT_FOUND keeps the registry code', async () => {
    loaderReturns({
      ok: false,
      failure: { code: 'registry', error: { code: 'NOT_FOUND', name: 'nope', spec: 'latest' } },
    })
    const result = await catCommand.runJson(['nope', 'README.md'], { json: true })
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('NOT_FOUND')
  })
})
