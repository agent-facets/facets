import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generateScaffoldManifest,
  previewScaffoldFiles,
  type ScaffoldOptions,
  type ScaffoldReadme,
  writeScaffold,
} from '../scaffold/index.ts'

function baseOptions(overrides: Partial<ScaffoldOptions> = {}): ScaffoldOptions {
  return {
    name: 'cowsay',
    version: '0.0.0',
    description: 'Cowsay tools',
    skills: ['cowsay'],
    agents: [],
    commands: [],
    readme: { kind: 'disabled' },
    ...overrides,
  }
}

const enabled = (content: string): ScaffoldReadme => ({ kind: 'enabled', content })

describe('generateScaffoldManifest privacy', () => {
  test('omits `private` when public (option absent)', () => {
    const manifest = JSON.parse(generateScaffoldManifest(baseOptions()))
    expect('private' in manifest).toBe(false)
  })

  test('writes `private: true` when private option is set', () => {
    const manifest = JSON.parse(generateScaffoldManifest(baseOptions({ private: true })))
    expect(manifest.private).toBe(true)
  })

  test('places `private` after description and before asset sections', () => {
    const json = generateScaffoldManifest(baseOptions({ private: true }))
    const keys = Object.keys(JSON.parse(json))
    expect(keys).toEqual(['name', 'version', 'description', 'private', 'skills'])
  })

  test('omits `private` even when description is absent', () => {
    const manifest = JSON.parse(generateScaffoldManifest(baseOptions({ description: '' })))
    expect('private' in manifest).toBe(false)
    const keys = Object.keys(manifest)
    expect(keys).toEqual(['name', 'version', 'skills'])
  })

  test('serialized manifest ends with a trailing newline', () => {
    const json = generateScaffoldManifest(baseOptions())
    expect(json.endsWith('}\n')).toBe(true)
  })
})

describe('generateScaffoldManifest README declaration', () => {
  test('declares top-level README.md when README is enabled', () => {
    const manifest = JSON.parse(generateScaffoldManifest(baseOptions({ readme: enabled('# cowsay\n') })))
    expect(manifest.files).toEqual(['README.md'])
  })

  test('omits the files declaration when README is disabled', () => {
    const manifest = JSON.parse(generateScaffoldManifest(baseOptions({ readme: { kind: 'disabled' } })))
    expect('files' in manifest).toBe(false)
  })

  test('declares README after asset sections', () => {
    const json = generateScaffoldManifest(baseOptions({ readme: enabled('# cowsay\n') }))
    const keys = Object.keys(JSON.parse(json))
    expect(keys).toEqual(['name', 'version', 'description', 'skills', 'files'])
  })
})

describe('previewScaffoldFiles', () => {
  test('lists README.md immediately after the manifest when enabled', () => {
    const files = previewScaffoldFiles(baseOptions({ readme: enabled('# cowsay\n') }))
    expect(files).toEqual(['facet.json', 'README.md', 'skills/cowsay/SKILL.md'])
  })

  test('omits README.md when disabled', () => {
    const files = previewScaffoldFiles(baseOptions({ readme: { kind: 'disabled' } }))
    expect(files).toEqual(['facet.json', 'skills/cowsay/SKILL.md'])
  })
})

describe('writeScaffold', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'facet-scaffold-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('writes manifest, README, and asset files atomically', async () => {
    const files = await writeScaffold(baseOptions({ readme: enabled('# cowsay\n\nCowsay tools\n') }), dir)
    expect(files).toEqual(['facet.json', 'README.md', 'skills/cowsay/SKILL.md'])
    expect(existsSync(join(dir, 'facet.json'))).toBe(true)
    expect(existsSync(join(dir, 'README.md'))).toBe(true)
    expect(existsSync(join(dir, 'skills/cowsay/SKILL.md'))).toBe(true)
  })

  test('writes the exact provided README content verbatim', async () => {
    const authored = '# Custom Title\n\nAuthored prose that must not be regenerated.\n'
    await writeScaffold(baseOptions({ readme: enabled(authored) }), dir)
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe(authored)
  })

  test('writes no README when disabled', async () => {
    await writeScaffold(baseOptions({ readme: { kind: 'disabled' } }), dir)
    expect(existsSync(join(dir, 'README.md'))).toBe(false)
    const manifest = JSON.parse(readFileSync(join(dir, 'facet.json'), 'utf8'))
    expect('files' in manifest).toBe(false)
  })

  test('rolls back to preexisting content when a write fails', async () => {
    // Pre-seed a manifest, then make skills/ a FILE so the SKILL.md write fails
    // (cannot mkdir a directory under an existing file).
    writeFileSync(join(dir, 'facet.json'), 'ORIGINAL')
    writeFileSync(join(dir, 'skills'), 'not a directory')

    await expect(writeScaffold(baseOptions({ readme: enabled('# cowsay\n') }), dir)).rejects.toThrow()

    // Manifest restored to its original bytes; README not left behind.
    expect(readFileSync(join(dir, 'facet.json'), 'utf8')).toBe('ORIGINAL')
    expect(existsSync(join(dir, 'README.md'))).toBe(false)
  })
})
