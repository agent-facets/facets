import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CACHE_INTEGRITY_FILE, cachePath, computeDirIntegrity } from '../../cache/index.ts'
import { loadFacetView } from '../facet-view.ts'

const REGISTRY = 'https://registry.test'
const SERVER_FINGERPRINT = `sha256:${'a'.repeat(64)}`

const MANIFEST = {
  name: 'cowsay',
  version: '1.0.2',
  description: 'What does the cow say?',
  author: 'Cow Co',
  skills: { 'cowsay-rules': { description: 'Rules', files: ['assets/logo.png', 'references/format.md'] } },
  commands: { cowsay: { description: 'Say' } },
  agents: { cowsay: { description: 'Renders the cow' } },
  servers: { cowsrv: { type: 'http', url: 'https://cow.test/mcp' } },
  files: ['README.md'],
}

const FILES: Record<string, string | Uint8Array> = {
  'facet.json': JSON.stringify(MANIFEST),
  'skills/cowsay-rules/SKILL.md': '# Cow rules\n',
  'skills/cowsay-rules/references/format.md': 'Bubble format.\n',
  'skills/cowsay-rules/assets/logo.png': new Uint8Array([137, 80, 78, 71, 0, 1, 2]),
  'commands/cowsay.md': '# Cowsay\n',
  'agents/cowsay.md': '# Cow agent\n',
  'README.md': '# Cowsay\n',
}

let facetDir: string
let projectRoot: string
let originalEnv: { facetDir: string | undefined; token: string | undefined; registry: string | undefined }
let fetchSpy: { mockRestore(): void } | undefined

beforeEach(() => {
  originalEnv = {
    facetDir: process.env.FACET_DIR,
    token: process.env.FACET_TOKEN,
    registry: process.env.FACET_REGISTRY_URL,
  }
  facetDir = mkdtempSync(join(tmpdir(), 'facet-view-home-'))
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-view-project-'))
  process.env.FACET_DIR = facetDir
  process.env.FACET_REGISTRY_URL = REGISTRY
  delete process.env.FACET_TOKEN
})

afterEach(() => {
  fetchSpy?.mockRestore()
  fetchSpy = undefined
  rmSync(facetDir, { recursive: true, force: true })
  rmSync(projectRoot, { recursive: true, force: true })
  restore('FACET_DIR', originalEnv.facetDir)
  restore('FACET_TOKEN', originalEnv.token)
  restore('FACET_REGISTRY_URL', originalEnv.registry)
})

/** Write a verified cache slot for cowsay@1.0.2 and return its canonical integrity. */
function seedSlot(): { slot: string; integrity: string; hashes: Record<string, string> } {
  const slot = cachePath({ kind: 'registry', name: 'cowsay', version: '1.0.2' })
  writeTree(slot, FILES)
  const computed = computeDirIntegrity(slot, Object.keys(FILES))
  if (!computed.ok) expect.unreachable()
  writeFileSync(
    join(slot, CACHE_INTEGRITY_FILE),
    JSON.stringify({ integrity: computed.integrity, assets: computed.assetHashes }),
  )
  return { slot, integrity: computed.integrity, hashes: computed.assetHashes }
}

function writeProject(
  integrity: string,
  hashes: Record<string, string>,
  options: { source?: unknown; commandDisposition?: unknown } = {},
): void {
  const hash = (path: string) => hashes[path] ?? `sha256:${'0'.repeat(64)}`
  writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { cowsay: '1.0.2' } }))
  writeFileSync(
    join(projectRoot, 'facets.lock'),
    JSON.stringify({
      lockfileVersion: 0.4,
      facets: {
        cowsay: {
          source: options.source ?? { kind: 'registry', registry: REGISTRY },
          version: '1.0.2',
          integrity,
          assets: [
            {
              scope: 'project',
              type: 'skill',
              name: 'cowsay-rules',
              materialization: { kind: 'omitted' },
              files: [
                { path: 'skills/cowsay-rules/SKILL.md', integrity: hash('skills/cowsay-rules/SKILL.md') },
                {
                  path: 'skills/cowsay-rules/assets/logo.png',
                  integrity: hash('skills/cowsay-rules/assets/logo.png'),
                },
                {
                  path: 'skills/cowsay-rules/references/format.md',
                  integrity: hash('skills/cowsay-rules/references/format.md'),
                },
              ],
            },
            {
              scope: 'project',
              type: 'command',
              name: 'cowsay',
              materialization: options.commandDisposition ?? { kind: 'aliased', as: 'moo' },
              files: [{ path: 'commands/cowsay.md', integrity: hash('commands/cowsay.md') }],
            },
            {
              scope: 'project',
              type: 'agent',
              name: 'cowsay',
              materialization: { kind: 'authored' },
              files: [{ path: 'agents/cowsay.md', integrity: hash('agents/cowsay.md') }],
            },
          ],
          servers: [{ name: 'cowsrv', fingerprint: SERVER_FINGERPRINT, materialization: { kind: 'omitted' } }],
        },
      },
    }),
  )
}

function stubRegistry(handler: (path: string) => Response): string[] {
  const seen: string[] = []
  const fetcher = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input.toString(), init)
    const path = decodeURIComponent(new URL(request.url).pathname)
    seen.push(path)
    return handler(path)
  }
  fetcher.preconnect = globalThis.fetch.preconnect
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(fetcher)
  return seen
}

describe('loadFacetView — installed', () => {
  test('reads a verified cache slot without contacting the registry', async () => {
    const { slot, integrity, hashes } = seedSlot()
    writeProject(integrity, hashes)
    const seen = stubRegistry(() => new Response('unexpected', { status: 500 }))

    const result = await loadFacetView(projectRoot, 'cowsay')
    if (!result.ok) expect.unreachable()
    const { view } = result
    expect(view.version).toBe('1.0.2')
    expect(view.origin).toEqual({ kind: 'installed', from: 'cache', sourceKind: 'registry', authored: '1.0.2' })
    expect(view.manifest.author).toBe('Cow Co')
    expect(await view.readFile('commands/cowsay.md')).toEqual({ ok: true, kind: 'text', content: '# Cowsay\n' })
    expect(await view.readFile('skills/cowsay-rules/assets/logo.png')).toEqual({
      ok: true,
      kind: 'binary',
      sizeBytes: 7,
    })
    expect(await view.localPath('README.md')).toBe(realpathSync(join(slot, 'README.md')))
    expect(seen).toEqual([])
  })

  test('reports each asset and server disposition from the lockfile', async () => {
    const { integrity, hashes } = seedSlot()
    writeProject(integrity, hashes)
    const result = await loadFacetView(projectRoot, 'cowsay')
    if (!result.ok) expect.unreachable()
    expect(result.view.disposition('command', 'cowsay')).toEqual({ kind: 'aliased', as: 'moo' })
    expect(result.view.disposition('skill', 'cowsay-rules')).toEqual({ kind: 'omitted' })
    expect(result.view.disposition('agent', 'cowsay')).toEqual({ kind: 'authored' })
    expect(result.view.disposition('server', 'cowsrv')).toEqual({ kind: 'omitted' })
  })

  test('the manifest itself can be read', async () => {
    const { integrity, hashes } = seedSlot()
    writeProject(integrity, hashes)
    const result = await loadFacetView(projectRoot, 'cowsay')
    if (!result.ok) expect.unreachable()
    const read = await result.view.readFile('facet.json')
    if (!read.ok || read.kind !== 'text') expect.unreachable()
    expect(JSON.parse(read.content).name).toBe('cowsay')
  })

  test('refuses an undeclared path without reading it', async () => {
    const { integrity, hashes } = seedSlot()
    writeProject(integrity, hashes)
    const result = await loadFacetView(projectRoot, 'cowsay')
    if (!result.ok) expect.unreachable()
    expect(await result.view.readFile('../../facets.lock')).toEqual({ ok: false, code: 'not-declared' })
    expect(await result.view.localPath('../secret')).toBeUndefined()
  })

  test('a tampered slot is refused and left in place, without contacting the registry', async () => {
    const { slot, integrity, hashes } = seedSlot()
    writeProject(integrity, hashes)
    writeFileSync(join(slot, 'commands/cowsay.md'), '# tampered\n')
    const seen = stubRegistry(() => json({}))
    const result = await loadFacetView(projectRoot, 'cowsay')
    expect(result).toEqual({ ok: false, failure: { code: 'local-copy-unavailable', sourceKind: 'registry' } })
    expect(existsSync(slot)).toBe(true)
    expect(seen).toEqual([])
  })

  test('a missing slot is reported as no usable local copy', async () => {
    const { slot, integrity, hashes } = seedSlot()
    writeProject(integrity, hashes)
    rmSync(slot, { recursive: true, force: true })
    const seen = stubRegistry(() => json({}))
    const result = await loadFacetView(projectRoot, 'cowsay')
    expect(result).toEqual({ ok: false, failure: { code: 'local-copy-unavailable', sourceKind: 'registry' } })
    expect(seen).toEqual([])
  })

  test('a slot whose integrity differs from the lockfile is refused', async () => {
    const { integrity, hashes } = seedSlot()
    writeProject(`sha256:${'9'.repeat(64)}`, hashes)
    expect(integrity).not.toBe(`sha256:${'9'.repeat(64)}`)
    const result = await loadFacetView(projectRoot, 'cowsay')
    expect(result).toEqual({ ok: false, failure: { code: 'local-copy-unavailable', sourceKind: 'registry' } })
  })

  test('a git facet with no cached copy reports that no local copy is usable', async () => {
    const { slot, integrity, hashes } = seedSlot()
    rmSync(slot, { recursive: true, force: true })
    writeProject(integrity, hashes, {
      source: { kind: 'git', url: 'https://example.test/cowsay.git', commit: 'abcdef0123' },
    })
    const seen = stubRegistry(() => json({}))
    const result = await loadFacetView(projectRoot, 'cowsay')
    expect(result).toEqual({ ok: false, failure: { code: 'local-copy-unavailable', sourceKind: 'git' } })
    expect(seen).toEqual([])
  })

  test('a local facet is read from its source directory', async () => {
    const source = join(projectRoot, 'vendor', 'cowsay')
    writeTree(source, FILES)
    writeProject(`sha256:${'0'.repeat(64)}`, {}, { source: { kind: 'local', path: 'vendor/cowsay' } })
    const result = await loadFacetView(projectRoot, 'cowsay')
    if (!result.ok) expect.unreachable()
    expect(result.view.origin).toEqual({
      kind: 'installed',
      from: 'local-path',
      sourceKind: 'local',
      authored: '1.0.2',
    })
    expect(await result.view.localPath('README.md')).toBe(realpathSync(join(source, 'README.md')))
  })

  describe('a local facet cannot read outside its directory', () => {
    function localFacetWith(arrange: (source: string, outside: string) => void) {
      const source = join(projectRoot, 'vendor', 'cowsay')
      const outside = join(projectRoot, 'outside')
      writeTree(source, FILES)
      mkdirSync(outside, { recursive: true })
      writeFileSync(join(outside, 'secret'), 'SECRET\n')
      arrange(source, outside)
      writeProject(`sha256:${'0'.repeat(64)}`, {}, { source: { kind: 'local', path: 'vendor/cowsay' } })
    }

    test.each([
      [
        'a declared file that is a symlink',
        (source: string, outside: string) => {
          rmSync(join(source, 'README.md'))
          symlinkSync(join(outside, 'secret'), join(source, 'README.md'))
        },
        'README.md',
      ],
      [
        'a declared file under a symlinked directory',
        (source: string, outside: string) => {
          rmSync(join(source, 'skills', 'cowsay-rules', 'references'), { recursive: true })
          writeFileSync(join(outside, 'format.md'), 'SECRET\n')
          symlinkSync(outside, join(source, 'skills', 'cowsay-rules', 'references'))
        },
        'skills/cowsay-rules/references/format.md',
      ],
      [
        'a declared file that is a hard link',
        (source: string, outside: string) => {
          rmSync(join(source, 'README.md'))
          linkSync(join(outside, 'secret'), join(source, 'README.md'))
        },
        'README.md',
      ],
    ])('%s is refused', async (_label, arrange, path) => {
      localFacetWith(arrange)
      const result = await loadFacetView(projectRoot, 'cowsay')
      if (!result.ok) expect.unreachable()
      expect(await result.view.readFile(path)).toEqual({ ok: false, code: 'unsafe' })
      expect(await result.view.localPath(path)).toBeUndefined()
    })
  })
})

describe('loadFacetView — not installed', () => {
  test('a facet the project does not declare is reported without contacting the registry', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: {} }))
    const seen = stubRegistry(() => json({}))
    const result = await loadFacetView(projectRoot, 'cowsay')
    expect(result).toEqual({ ok: false, failure: { code: 'not-installed' } })
    expect(seen).toEqual([])
  })

  test('a declared facet with no lock entry is reported as not installed', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { cowsay: '1.0.2' } }))
    const result = await loadFacetView(projectRoot, 'cowsay')
    expect(result).toEqual({ ok: false, failure: { code: 'not-installed' } })
  })

  test('outside a project the facet is reported as not installed', async () => {
    const result = await loadFacetView(projectRoot, 'cowsay')
    expect(result).toEqual({ ok: false, failure: { code: 'not-installed' } })
  })

  test.each([
    'constructor',
    '__proto__',
    'toString',
  ])('a name inherited from Object.prototype (%s) is reported as not installed', async (name) => {
    const outside = await loadFacetView(projectRoot, name)
    expect(outside).toEqual({ ok: false, failure: { code: 'not-installed' } })
    const { integrity, hashes } = seedSlot()
    writeProject(integrity, hashes)
    const inside = await loadFacetView(projectRoot, name)
    expect(inside).toEqual({ ok: false, failure: { code: 'not-installed' } })
  })
})

function writeTree(root: string, files: Record<string, string | Uint8Array>): void {
  for (const [path, body] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
