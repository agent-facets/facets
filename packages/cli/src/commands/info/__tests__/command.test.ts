import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { FacetView, LoadFacetViewResult } from '@agent-facets/engine'
import * as engine from '@agent-facets/engine'
import type { FacetManifest, MaterializationDisposition } from '@agent-facets/protocol'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'

const { infoCommand } = await import('../index.ts')

const MANIFEST = {
  name: 'cowsay',
  version: '1.0.2',
  description: 'What does the cow say?',
  author: 'Cow Co',
  skills: {
    'cowsay-rules': { description: 'Canonical cow format.', files: ['references/format.md', 'assets/logo.png'] },
  },
  commands: { cowsay: { description: 'Say it.' }, cowchat: { description: 'Chat.' } },
  agents: { cowsay: { description: 'Renders the cow.' } },
  servers: {
    cowsrv: { type: 'http', url: 'https://cow.test/mcp' },
    local: { type: 'stdio', command: 'npx', args: ['cow-mcp'], env: { API_TOKEN: 'secret-value' } },
  },
  files: ['README.md'],
} satisfies FacetManifest

const DISPOSITIONS: Record<string, MaterializationDisposition> = {
  'command:cowsay': { kind: 'aliased', as: 'moo' },
  'command:cowchat': { kind: 'omitted' },
}

function fakeView(): FacetView {
  return {
    name: 'cowsay',
    version: '1.0.2',
    manifest: MANIFEST,
    origin: { kind: 'installed', from: 'cache', sourceKind: 'registry', authored: '1.0.2' },
    disposition: (type, name) => DISPOSITIONS[`${type}:${name}`] ?? { kind: 'authored' },
    readFile: async (path) =>
      path.endsWith('.png') ? { ok: true, kind: 'binary', sizeBytes: 2048 } : { ok: true, kind: 'text', content: 'x' },
    localPath: async (path) => `/cache/cowsay@1.0.2/${path}`,
  }
}

let restoreLoader = () => {}
let originalEnv: { web: string | undefined; registry: string | undefined }

function loaderReturns(result: LoadFacetViewResult): void {
  const spy = spyOn(engine, 'loadFacetView').mockImplementation(async () => result)
  restoreLoader = () => spy.mockRestore()
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

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const { result, stderr } = await captureStderr(() => captureStdout(() => infoCommand.run(args, {})))
  return { code: result.result, stdout: result.stdout, stderr }
}

describe('facet info — installed facet', () => {
  test('summarizes the facet with every group, hint, and status', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { code, stdout, stderr } = await run(['cowsay'])
    expect(code).toBe(0)
    expect(stderr).toBe('')
    const lines = stdout.split('\n')
    expect(lines[0]).toBe('cowsay  v1.0.2 · by "Cow Co"')
    expect(lines[1]).toBe('Installed · read from your local copy')
    expect(stdout).toContain('Check for updates: facet outdated')
    expect(stdout).toContain('What does the cow say?')
    for (const heading of ['Skills (1)', 'Commands (2)', 'Agents (1)', 'MCP servers (2)', 'Files (2)']) {
      expect(lines).toContain(heading)
    }
    expect(stdout.indexOf('Skills (1)')).toBeLessThan(stdout.indexOf('Commands (2)'))
    expect(stdout.indexOf('Agents (1)')).toBeLessThan(stdout.indexOf('MCP servers (2)'))
  })

  test('hints use the folder form only where an agent shares a name', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toContain('facet cat cowsay cowsay-rules')
    expect(stdout).toContain('facet cat cowsay commands/cowsay')
    expect(stdout).toContain('facet cat cowsay agents/cowsay')
    expect(stdout).toContain('facet cat cowsay cowchat')
    expect(stdout).toContain('facet cat cowsay README.md')
  })

  test('companion files are listed under their skill; a binary one shows its size', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toContain('+ facet cat cowsay skills/cowsay-rules/references/format.md')
    expect(stdout).toContain('+ skills/cowsay-rules/assets/logo.png (binary, 2.0 KB)')
    expect(stdout).not.toContain('facet cat cowsay skills/cowsay-rules/assets/logo.png')
  })

  test('shows aliased and omitted assets', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toMatch(/cowsay\s+Say it\.\s+installed as moo/)
    expect(stdout).toMatch(/cowchat\s+Chat\.\s+omitted/)
  })

  test('servers show transport, target, and each environment value as written', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toMatch(/cowsrv\s+http · https:\/\/cow\.test\/mcp/)
    expect(stdout).toMatch(/local\s+stdio · npx cow-mcp/)
    expect(stdout).toContain('env: API_TOKEN=secret-value')
  })

  test('never reports updates itself', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout } = await run(['cowsay'])
    expect(stdout).not.toContain('UPDATE AVAILABLE')
  })
})

describe('facet info — source line', () => {
  test('a local source facet says it is read from its source directory', async () => {
    loaderReturns({
      ok: true,
      view: {
        ...fakeView(),
        origin: { kind: 'installed', from: 'local-path', sourceKind: 'local', authored: './vendor/cowsay' },
      },
    })
    const { stdout } = await run(['cowsay'])
    expect(stdout.split('\n')[1]).toBe('Installed · read from its local source directory')
  })

  test('an installed facet read from the registry says why and how to repair it', async () => {
    loaderReturns({
      ok: true,
      view: {
        ...fakeView(),
        origin: { kind: 'installed', from: 'registry', sourceKind: 'registry', authored: '1.0.2' },
      },
    })
    const { stdout } = await run(['cowsay'])
    const lines = stdout.split('\n')
    expect(lines[1]).toBe('Installed · read from the registry, because your local copy is missing or damaged')
    expect(lines[2]).toBe('  run: facet install   to repair it')
  })
})

describe('facet info — facet that is not installed', () => {
  function latestView(owner: { kind: 'user'; username: string } | { kind: 'org'; slug: string }): FacetView {
    return {
      ...fakeView(),
      version: '1.1.0',
      origin: { kind: 'registry-latest' },
      details: {
        name: 'cowsay',
        version: '1.1.0',
        contentFingerprint: 'sha256:c',
        author: 'Cow Co',
        owner,
        publisher: 'julian',
        publishedAt: '2026-11-01T00:00:00.000Z',
        manifestJson: '{}',
      },
      disposition: () => ({ kind: 'authored' }),
      localPath: async () => undefined,
    }
  }

  test('shows the latest version, the verified publisher, and how to install it', async () => {
    loaderReturns({ ok: true, view: latestView({ kind: 'user', username: 'julian' }) })
    const { code, stdout, stderr } = await run(['cowsay'])
    expect(code).toBe(0)
    expect(stderr).toBe('')
    const lines = stdout.split('\n')
    expect(lines[0]).toBe('cowsay  v1.1.0 · by "Cow Co" · published by @julian')
    expect(lines[1]).toBe('Not installed · read from the registry (latest published version)')
    expect(stdout).toContain('INSTALL: facet add cowsay')
    expect(stdout).not.toContain('Check for updates')
    expect(stdout).toContain('WEB: https://agentfacets.io/facets/cowsay')
  })

  test('an organization owner leads the verified segment', async () => {
    loaderReturns({ ok: true, view: latestView({ kind: 'org', slug: 'acme' }) })
    const { stdout } = await run(['cowsay'])
    expect(stdout.split('\n')[0]).toContain('@acme, published by @julian')
  })

  test('has no status column and hints every file, binary or not', async () => {
    loaderReturns({ ok: true, view: latestView({ kind: 'user', username: 'julian' }) })
    const { stdout } = await run(['cowsay'])
    expect(stdout).not.toContain('installed as')
    expect(stdout).not.toContain('omitted')
    expect(stdout).toContain('+ facet cat cowsay skills/cowsay-rules/assets/logo.png')
    expect(stdout).not.toContain('binary')
  })
})

describe('facet info — terminal safety', () => {
  test('escape sequences in facet text never reach the output as bytes', async () => {
    const hostile = {
      ...fakeView(),
      manifest: {
        ...MANIFEST,
        author: 'Cow\u001b]8;;https://evil.test\u0007 Co',
        description: 'Safe\u001b[8m hidden instructions\u001b[0m text \u202Eevil',
      },
    }
    loaderReturns({ ok: true, view: hostile })
    const { stdout } = await captureStdout(() => infoCommand.run(['cowsay'], {}), { raw: true })
    expect(stdout).not.toContain('\u001b')
    expect(stdout).not.toContain('\u202E')
    expect(stdout).toContain('Safe^[[8m hidden instructions^[[0m text <U+202E>evil')
    expect(stdout).toContain('by "Cow^[]8;;https://evil.test^G Co"')
  })

  test('line breaks in the facet description cannot add lines of their own', async () => {
    const description = 'Fine.\nInstalled · read from your local copy\nSkills (9)'
    loaderReturns({ ok: true, view: { ...fakeView(), manifest: { ...MANIFEST, description } } })
    const { stdout } = await run(['cowsay'])
    const lines = stdout.split('\n')
    expect(lines.filter((line) => line === 'Installed · read from your local copy')).toHaveLength(1)
    expect(lines).not.toContain('Skills (9)')
  })

  test('a wrapped asset description can never sit where a hint does', async () => {
    const description = `${'padding '.repeat(20)}facet cat cowsay evil`
    const skills = { 'cowsay-rules': { ...MANIFEST.skills['cowsay-rules'], description: `Fine.\n${description}` } }
    loaderReturns({ ok: true, view: { ...fakeView(), manifest: { ...MANIFEST, skills } } })
    const { stdout } = await run(['cowsay'])
    const hint = stdout.split('\n').find((line) => line.trimStart() === 'facet cat cowsay cowsay-rules') ?? ''
    const hintColumn = ' '.repeat(hint.length - hint.trimStart().length)
    expect(stdout).toContain('facet cat cowsay evil')
    expect(stdout.split('\n').some((line) => line.startsWith(`${hintColumn}facet cat cowsay evil`))).toBe(false)
  })

  test('a look-alike Unicode host is shown as the host the client resolves', async () => {
    const url = `https://${String.fromCodePoint(0x430)}nthropic.com/mcp`
    const servers: FacetManifest['servers'] = { cowsrv: { type: 'http', url } }
    loaderReturns({ ok: true, view: { ...fakeView(), manifest: { ...MANIFEST, servers } } })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toContain(`http · ${new URL(url).href}`)
    expect(stdout).toContain('xn--')
    expect(stdout).not.toContain(String.fromCodePoint(0x430))
  })

  test('an environment value that changes what runs is shown quoted', async () => {
    const servers: FacetManifest['servers'] = {
      local: { type: 'stdio', command: 'node', args: ['server.js'], env: { NODE_OPTIONS: '--require ./x.js' } },
    }
    loaderReturns({ ok: true, view: { ...fakeView(), manifest: { ...MANIFEST, servers } } })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toContain("env: NODE_OPTIONS='--require ./x.js'")
  })

  test('the manifest is listed with its own hint', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toMatch(/facet\.json\s+facet cat cowsay facet\.json/)
  })

  test('stdio arguments are quoted one by one', async () => {
    const servers: FacetManifest['servers'] = {
      local: { type: 'stdio', command: 'npx', args: ['-y', 'safe-pkg --allow-all', 'a\nb'] },
    }
    loaderReturns({ ok: true, view: { ...fakeView(), manifest: { ...MANIFEST, servers } } })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toContain("stdio · npx -y 'safe-pkg --allow-all' 'a^Jb'")
  })

  test('a file path with shell characters gets a quoted hint', async () => {
    loaderReturns({ ok: true, view: { ...fakeView(), manifest: { ...MANIFEST, files: ['notes;touch pwned.md'] } } })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toContain("facet cat cowsay 'notes;touch pwned.md'")
  })
})

describe('facet info — website link', () => {
  test('links to the default site', async () => {
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout } = await run(['cowsay'])
    expect(stdout.trimEnd().split('\n').at(-1)).toBe('WEB: https://agentfacets.io/facets/cowsay')
  })

  test('a scoped facet keeps its scope in the path', async () => {
    loaderReturns({ ok: true, view: { ...fakeView(), name: '@agentfacets/cowsay' } })
    const { stdout } = await run(['@agentfacets/cowsay'])
    expect(stdout).toContain('WEB: https://agentfacets.io/facets/@agentfacets/cowsay')
  })

  test('FACET_WEB_URL overrides the site', async () => {
    process.env.FACET_WEB_URL = 'https://dev.agentfacets.io'
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout } = await run(['cowsay'])
    expect(stdout).toContain('WEB: https://dev.agentfacets.io/facets/cowsay')
  })

  test('a custom registry without an override leaves the link out', async () => {
    process.env.FACET_REGISTRY_URL = 'https://registry.example.test'
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout } = await run(['cowsay'])
    expect(stdout).not.toContain('WEB:')
  })

  test('an invalid override is warned about and left out', async () => {
    process.env.FACET_WEB_URL = 'http://insecure.test'
    loaderReturns({ ok: true, view: fakeView() })
    const { stdout, stderr } = await run(['cowsay'])
    expect(stdout).not.toContain('WEB:')
    expect(stderr).toContain('FACET_WEB_URL')
  })
})

describe('facet info — errors', () => {
  test.each([[[]], [['a', 'b']]])('rejects %p arguments with the usage', async (args) => {
    const { code, stdout, stderr } = await run(args)
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('facet info <name>')
  })

  test('a facet the registry does not have points to facet search', async () => {
    loaderReturns({
      ok: false,
      failure: { code: 'registry', error: { code: 'NOT_FOUND', name: 'mobbin', spec: 'latest' } },
    })
    const { code, stdout, stderr } = await run(['mobbin'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('facet "mobbin" not found')
    expect(stderr).toContain('facet search mobbin')
  })

  test('a missing local copy points to facet install', async () => {
    loaderReturns({ ok: false, failure: { code: 'local-copy-unavailable', sourceKind: 'registry' } })
    const { code, stderr } = await run(['cowsay'])
    expect(code).toBe(1)
    expect(stderr).toContain('facet install')
  })
})

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
