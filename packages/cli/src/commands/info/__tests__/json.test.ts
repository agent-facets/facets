import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { FacetView, LoadFacetViewResult } from '@agent-facets/engine'
import * as engine from '@agent-facets/engine'
import type { FacetManifest, MaterializationDisposition } from '@agent-facets/protocol'

const { infoCommand } = await import('../index.ts')

const MANIFEST = {
  name: 'cowsay',
  version: '1.0.2',
  description: 'What does the cow say?\nTwo lines.',
  author: 'Cow Co',
  skills: { 'cowsay-rules': { description: 'Rules.', files: ['references/format.md', 'assets/logo.png'] } },
  commands: { cowsay: { description: 'Say it.' } },
  agents: { cowsay: { description: 'Renders the cow.' } },
  servers: {
    cowsrv: { type: 'http', url: 'https://аnthropic.com/mcp' },
    local: { type: 'stdio', command: 'npx', args: ['cow-mcp'], env: { NODE_OPTIONS: '--require ./x.js' } },
  },
  files: ['README.md'],
} satisfies FacetManifest

const DISPOSITIONS: Record<string, MaterializationDisposition> = { 'command:cowsay': { kind: 'aliased', as: 'moo' } }

function fakeView(overrides: Partial<FacetView> = {}): FacetView {
  return {
    name: 'cowsay',
    version: '1.0.2',
    manifest: MANIFEST,
    origin: { kind: 'installed', from: 'cache', sourceKind: 'registry', authored: '1.0.2' },
    disposition: (type, name) => DISPOSITIONS[`${type}:${name}`] ?? { kind: 'authored' },
    readFile: async (path) =>
      path.endsWith('.png') ? { ok: true, kind: 'binary', sizeBytes: 2048 } : { ok: true, kind: 'text', content: 'x' },
    localPath: async (path) => `/cache/cowsay@1.0.2/${path}`,
    ...overrides,
  }
}

let restoreLoader = () => {}
let originalEnv: { web: string | undefined; registry: string | undefined }

function loaderReturns(result: LoadFacetViewResult): void {
  const spy = spyOn(engine, 'loadFacetView').mockImplementation(async () => result)
  restoreLoader = () => spy.mockRestore()
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(() => {
  originalEnv = { web: process.env.FACET_WEB_URL, registry: process.env.FACET_REGISTRY_URL }
  delete process.env.FACET_WEB_URL
  delete process.env.FACET_REGISTRY_URL
})

afterEach(() => {
  restoreLoader()
  restore('FACET_WEB_URL', originalEnv.web)
  restore('FACET_REGISTRY_URL', originalEnv.registry)
})

describe('facet info --json — installed facet', () => {
  test('reports exact manifest values, dispositions, selectors, and files', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const result = await infoCommand.runJson(['cowsay'], { json: true })
    if (!result.ok) expect.unreachable()
    expect(result.warnings).toEqual([])
    expect(result.data).toMatchObject({
      name: 'cowsay',
      version: '1.0.2',
      origin: { kind: 'installed', from: 'cache' },
      description: 'What does the cow say?\nTwo lines.',
      author: 'Cow Co',
      owner: null,
      publisher: null,
      skills: [
        {
          name: 'cowsay-rules',
          disposition: { kind: 'authored' },
          selector: 'cowsay-rules',
          files: [
            { path: 'skills/cowsay-rules/references/format.md', selector: 'skills/cowsay-rules/references/format.md' },
            { path: 'skills/cowsay-rules/assets/logo.png', selector: null, binary: true, sizeBytes: 2048 },
          ],
        },
      ],
      commands: [{ name: 'cowsay', disposition: { kind: 'aliased', as: 'moo' }, selector: 'commands/cowsay' }],
      agents: [{ name: 'cowsay', selector: 'agents/cowsay' }],
      servers: [
        {
          name: 'cowsrv',
          type: 'http',
          url: 'https://аnthropic.com/mcp',
          resolvedUrl: 'https://xn--nthropic-06g.com/mcp',
        },
        { name: 'local', type: 'stdio', command: 'npx', args: ['cow-mcp'], env: { NODE_OPTIONS: '--require ./x.js' } },
      ],
      files: [
        { path: 'facet.json', selector: 'facet.json', binary: false },
        { path: 'README.md', selector: 'README.md', binary: false },
      ],
      webUrl: 'https://agentfacets.io/facets/cowsay',
    })
  })
})

describe('facet info --json — registry facet', () => {
  test('has no dispositions and reports the verified identity', async () => {
    loaderReturns({
      ok: true,
      view: fakeView({
        origin: { kind: 'registry-latest' },
        details: {
          name: 'cowsay',
          version: '1.0.2',
          transportHash: 'sha256:t',
          contentFingerprint: 'sha256:c',
          owner: { kind: 'org', slug: 'cowco' },
          publisher: 'julian',
          publishedAt: '2026-01-01T00:00:00Z',
          manifestJson: '{}',
        },
      }),
    })
    const result = await infoCommand.runJson(['cowsay'], { json: true })
    if (!result.ok) expect.unreachable()
    expect(result.data).toMatchObject({
      origin: { kind: 'registry-latest' },
      owner: { kind: 'org', slug: 'cowco' },
      publisher: 'julian',
      commands: [{ disposition: null }],
      servers: [{ disposition: null }, { disposition: null }],
    })
  })

  test('an identity that fails the verified-name check is reported as absent', async () => {
    loaderReturns({
      ok: true,
      view: fakeView({
        origin: { kind: 'registry-latest' },
        details: {
          name: 'cowsay',
          version: '1.0.2',
          transportHash: 'sha256:t',
          contentFingerprint: 'sha256:c',
          owner: { kind: 'user', username: 'julian' },
          publisher: 'not a name',
          publishedAt: '2026-01-01T00:00:00Z',
          manifestJson: '{}',
        },
      }),
    })
    const result = await infoCommand.runJson(['cowsay'], { json: true })
    if (!result.ok) expect.unreachable()
    expect(result.data).toMatchObject({ owner: null, publisher: null })
  })
})

describe('facet info --json — warnings and failures', () => {
  test('an invalid FACET_WEB_URL becomes a warning and no link', async () => {
    process.env.FACET_WEB_URL = 'http://not-https.test'
    loaderReturns({ ok: true, view: fakeView() })
    const result = await infoCommand.runJson(['cowsay'], { json: true })
    if (!result.ok) expect.unreachable()
    expect(result.data).toMatchObject({ webUrl: null })
    expect(result.warnings?.map((warning) => warning.code)).toEqual(['INVALID_WEB_URL_OVERRIDE'])
  })

  test('wrong argument count', async () => {
    const result = await infoCommand.runJson([], { json: true })
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('INVALID_ARGUMENTS')
  })

  test('a published manifest that is invalid keeps its issues', async () => {
    loaderReturns({
      ok: false,
      failure: { code: 'manifest-invalid', errors: [{ message: 'bad', path: 'skills', expected: '', actual: '' }] },
    })
    const result = await infoCommand.runJson(['cowsay'], { json: true })
    if (result.ok) expect.unreachable()
    expect(result.error).toMatchObject({
      code: 'INVALID_PUBLISHED_MANIFEST',
      details: { issues: [{ message: 'bad', path: 'skills' }] },
    })
  })
})
