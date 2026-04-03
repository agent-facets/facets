import { describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTargetDir } from '../commands/resolve-dir.ts'

async function createFixtureDir(name: string): Promise<string> {
  const dir = join(tmpdir(), `facets-resolve-test-${name}-${Date.now()}`)
  await mkdir(dir, { recursive: true })

  return dir
}

describe('resolveTargetDir', () => {
  test('no arg defaults to cwd', async () => {
    const result = await resolveTargetDir(undefined, { mustExist: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.dir).toBe(process.cwd())
    expect(result.display).toBe('.')
  })

  test('facet.json path uses parent directory', async () => {
    const dir = await createFixtureDir('facet-json')
    await Bun.write(join(dir, 'facet.json'), '{}')

    const result = await resolveTargetDir(join(dir, 'facet.json'), { mustExist: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.dir).toBe(dir)
  })

  test('non-directory file returns error', async () => {
    const dir = await createFixtureDir('non-dir')
    const filePath = join(dir, 'not-a-dir.txt')
    await Bun.write(filePath, 'hello')

    const result = await resolveTargetDir(filePath, { mustExist: true })
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.message).toContain('Expected a directory')
  })

  test('non-existent dir with mustExist true returns error', async () => {
    const result = await resolveTargetDir(`/tmp/does-not-exist-${Date.now()}`, { mustExist: true })
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.message).toContain('does not exist')
  })

  test('non-existent dir with mustExist false auto-creates it', async () => {
    const dir = join(tmpdir(), `facets-resolve-autocreate-${Date.now()}`)

    const result = await resolveTargetDir(dir, { mustExist: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { stat } = await import('node:fs/promises')
    const dirStat = await stat(result.dir)
    expect(dirStat.isDirectory()).toBe(true)
  })

  test('valid existing directory passes', async () => {
    const dir = await createFixtureDir('valid-dir')

    const result = await resolveTargetDir(dir, { mustExist: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.dir).toBe(dir)
    expect(result.display).toBe(dir)
  })

  test('facetMustExist true without facet.json returns error', async () => {
    const dir = await createFixtureDir('no-manifest')

    const result = await resolveTargetDir(dir, { mustExist: true, facetMustExist: true })
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.message).toContain('facet.json')
  })

  test('facetMustExist true with facet.json passes', async () => {
    const dir = await createFixtureDir('has-manifest')
    await Bun.write(join(dir, 'facet.json'), '{}')

    const result = await resolveTargetDir(dir, { mustExist: true, facetMustExist: true })
    expect(result.ok).toBe(true)
  })
})
