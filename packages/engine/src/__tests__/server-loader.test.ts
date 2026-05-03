import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadServerManifest } from '../loaders/server.ts'

let testDir: string

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'server-loader-test-'))
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

async function writeFixture(dir: string, filename: string, content: string) {
  const path = join(dir, filename)
  await Bun.write(path, content)
  return path
}

async function createFixtureDir(name: string): Promise<string> {
  const dir = join(testDir, name)
  await Bun.write(join(dir, '.keep'), '')
  return dir
}

describe('loadServerManifest', () => {
  test('successful load', async () => {
    const dir = await createFixtureDir('valid-server')
    await writeFixture(
      dir,
      'server.json',
      JSON.stringify({
        name: 'jira',
        version: '1.5.0',
        runtime: 'bun',
        entry: 'index.ts',
        description: 'Jira integration',
        author: 'acme-org',
      }),
    )

    const result = await loadServerManifest(dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('jira')
      expect(result.data.version).toBe('1.5.0')
      expect(result.data.runtime).toBe('bun')
      expect(result.data.entry).toBe('index.ts')
      expect(result.data.description).toBe('Jira integration')
      expect(result.data.author).toBe('acme-org')
    }
  })

  test('file not found', async () => {
    const dir = await createFixtureDir('missing-server')

    const result = await loadServerManifest(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors.at(0)?.message).toContain('File not found')
    }
  })

  test('malformed JSON', async () => {
    const dir = await createFixtureDir('malformed-server')
    await writeFixture(dir, 'server.json', '{ "name": [unterminated')

    const result = await loadServerManifest(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.at(0)?.message).toContain('JSON syntax error')
    }
  })

  test('validation errors for missing required fields', async () => {
    const dir = await createFixtureDir('invalid-server')
    await writeFixture(
      dir,
      'server.json',
      JSON.stringify({
        name: 'jira',
        version: '1.5.0',
      }),
    )

    const result = await loadServerManifest(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Should have errors for missing runtime and entry
      expect(result.errors.length).toBeGreaterThanOrEqual(1)
      const messages = result.errors.map((e) => e.message).join(' ')
      expect(messages).toContain('runtime')
    }
  })
})
