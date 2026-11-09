import { describe, expect, test } from 'bun:test'
import type { FacetManifest } from '@agent-facets/protocol'
import { classifyBytes } from '../classify.ts'
import { declaredFiles, resolveSelector, selectorFor } from '../selector.ts'

const MANIFEST = {
  name: 'cowsay',
  version: '1.0.2',
  skills: {
    'cowsay-rules': { description: 'Rules', files: ['references/format.md', 'assets/logo.png'] },
  },
  commands: { cowsay: { description: 'Say' }, cowchat: { description: 'Chat' } },
  agents: { cowsay: { description: 'Renders the cow' } },
  servers: { cowsrv: { type: 'http', url: 'https://cow.test/mcp' } },
  files: ['README.md'],
} satisfies FacetManifest

describe('declaredFiles', () => {
  test('lists every declared file in display order, companions under their skill', () => {
    expect(declaredFiles(MANIFEST).map((file) => file.path)).toEqual([
      'facet.json',
      'skills/cowsay-rules/SKILL.md',
      'skills/cowsay-rules/references/format.md',
      'skills/cowsay-rules/assets/logo.png',
      'commands/cowsay.md',
      'commands/cowchat.md',
      'agents/cowsay.md',
      'README.md',
    ])
  })
})

describe('resolveSelector', () => {
  test.each([
    ['cowsay-rules', 'skills/cowsay-rules/SKILL.md'],
    ['cowchat', 'commands/cowchat.md'],
    ['skills/cowsay-rules', 'skills/cowsay-rules/SKILL.md'],
    ['commands/cowsay', 'commands/cowsay.md'],
    ['agents/cowsay', 'agents/cowsay.md'],
    ['commands/cowsay.md', 'commands/cowsay.md'],
    ['skills/cowsay-rules/references/format.md', 'skills/cowsay-rules/references/format.md'],
    ['README.md', 'README.md'],
  ])('%s selects %s', (selector, path) => {
    const resolved = resolveSelector(MANIFEST, selector)
    if (resolved.kind !== 'file') expect.unreachable()
    expect(resolved.file.path).toBe(path)
  })

  test('a bare name shared by a command and an agent is ambiguous', () => {
    expect(resolveSelector(MANIFEST, 'cowsay')).toEqual({
      kind: 'ambiguous',
      candidates: ['commands/cowsay', 'agents/cowsay'],
    })
  })

  test('facet.json selects the manifest', () => {
    expect(resolveSelector(MANIFEST, 'facet.json')).toEqual({
      kind: 'file',
      file: { kind: 'manifest', path: 'facet.json' },
    })
  })

  test('a name that only matches a server says so', () => {
    expect(resolveSelector(MANIFEST, 'cowsrv')).toEqual({ kind: 'server-only' })
  })

  test.each([
    '../../.ssh/id_rsa',
    '/etc/passwd',
    'skills/cowsay-rules/../../facet.json',
    'commands/missing',
    'missing',
  ])('%s matches nothing and lists what can be printed', (selector) => {
    const resolved = resolveSelector(MANIFEST, selector)
    if (resolved.kind !== 'not-found') expect.unreachable()
    expect(resolved.printable).toContain('cowsay-rules')
    expect(resolved.printable).toContain('README.md')
  })
})

describe('selectorFor', () => {
  test('uses the bare name unless an agent shares it with a skill or command', () => {
    const hints = Object.fromEntries(declaredFiles(MANIFEST).map((file) => [file.path, selectorFor(MANIFEST, file)]))
    expect(hints).toEqual({
      'facet.json': 'facet.json',
      'skills/cowsay-rules/SKILL.md': 'cowsay-rules',
      'skills/cowsay-rules/references/format.md': 'skills/cowsay-rules/references/format.md',
      'skills/cowsay-rules/assets/logo.png': 'skills/cowsay-rules/assets/logo.png',
      'commands/cowsay.md': 'commands/cowsay',
      'commands/cowchat.md': 'cowchat',
      'agents/cowsay.md': 'agents/cowsay',
      'README.md': 'README.md',
    })
  })

  test.each([
    ['a bare name', { ...MANIFEST, files: ['README.md', 'cowchat'] }, 'commands/cowchat.md'],
    ['a folder-prefixed name', { ...MANIFEST, files: ['README.md', 'commands/cowsay'] }, 'commands/cowsay.md'],
  ])('falls back to the full path when a declared file shadows %s', (_, manifest, path) => {
    const file = declaredFiles(manifest).find((candidate) => candidate.path === path)
    if (file === undefined) throw new Error(`no declared file ${path}`)
    const selector = selectorFor(manifest, file)
    expect(selector).toBe(path)
    expect(resolveSelector(manifest, selector)).toEqual({ kind: 'file', file })
  })

  test('each ambiguity candidate resolves back to its own asset', () => {
    const manifest = { ...MANIFEST, files: ['README.md', 'commands/cowsay'] }
    const resolved = resolveSelector(manifest, 'cowsay')
    if (resolved.kind !== 'ambiguous') throw new Error(`expected ambiguous, got ${resolved.kind}`)
    expect(resolved.candidates).toEqual(['commands/cowsay.md', 'agents/cowsay'])
    expect(resolved.candidates.map((candidate) => resolveSelector(manifest, candidate))).toEqual([
      { kind: 'file', file: { kind: 'primary', path: 'commands/cowsay.md', type: 'command', name: 'cowsay' } },
      { kind: 'file', file: { kind: 'primary', path: 'agents/cowsay.md', type: 'agent', name: 'cowsay' } },
    ])
  })

  test('every printed selector resolves back to its own file', () => {
    const manifest = { ...MANIFEST, files: ['README.md', 'cowchat', 'commands/cowsay', 'cowsay-rules'] }
    for (const file of declaredFiles(manifest)) {
      expect(resolveSelector(manifest, selectorFor(manifest, file))).toEqual({ kind: 'file', file })
    }
  })
})

describe('classifyBytes', () => {
  test('strict UTF-8 without NUL is text', () => {
    expect(classifyBytes(new TextEncoder().encode('héllo\n'))).toEqual({ kind: 'text', content: 'héllo\n' })
  })

  test('a NUL byte makes it binary', () => {
    expect(classifyBytes(new Uint8Array([104, 0, 105]))).toEqual({ kind: 'binary', sizeBytes: 3 })
  })

  test('malformed UTF-8 is binary, not lossy text', () => {
    expect(classifyBytes(new Uint8Array([0xff, 0xfe, 0x41]))).toEqual({ kind: 'binary', sizeBytes: 3 })
  })
})
