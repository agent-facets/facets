import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveLocalSource } from '../resolve-local.ts'

let projectRoot: string
let outsideDir: string

beforeEach(() => {
  // Use realpath so macOS /var → /private/var redirection doesn't confuse
  // symlink-escape checks during tests.
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-project-')))
  outsideDir = realpathSync(mkdtempSync(join(tmpdir(), 'facet-outside-')))
  mkdirSync(join(projectRoot, 'facets'))
  mkdirSync(join(projectRoot, 'facets/viper-plans'))
  writeFileSync(join(projectRoot, 'facets/viper-plans/facet.json'), '{"name":"v","version":"0"}')
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(outsideDir, { recursive: true, force: true })
})

describe('resolveLocalSource', () => {
  test('resolves a relative path inside the project tree', async () => {
    const result = await resolveLocalSource('./facets/viper-plans', projectRoot)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.dir).toBe(join(projectRoot, 'facets/viper-plans'))
    }
  })

  test('resolves an absolute path inside the project tree', async () => {
    const abs = join(projectRoot, 'facets/viper-plans')
    const result = await resolveLocalSource(abs, projectRoot)
    expect(result.ok).toBe(true)
  })

  test('rejects a path that escapes the project tree via ..', async () => {
    // Create a sibling of projectRoot so the escape resolves to something real.
    const sibling = realpathSync(mkdtempSync(join(tmpdir(), 'facet-sibling-')))
    try {
      // Compute the ../ path that lands in the sibling from projectRoot's perspective.
      const relEscape = `../${sibling.split('/').pop()}`
      const result = await resolveLocalSource(relEscape, projectRoot)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('outside the project tree')
      }
    } finally {
      rmSync(sibling, { recursive: true, force: true })
    }
  })

  test('rejects an absolute path outside the project tree', async () => {
    const result = await resolveLocalSource(outsideDir, projectRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('outside the project tree')
    }
  })

  test('rejects a non-existent path', async () => {
    const result = await resolveLocalSource('./facets/does-not-exist', projectRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('no facet found')
    }
  })

  test('rejects a symlink that points outside the project tree', async () => {
    const link = join(projectRoot, 'facets/escape-link')
    symlinkSync(outsideDir, link, 'dir')
    const result = await resolveLocalSource('./facets/escape-link', projectRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('outside the project tree')
    }
  })

  // F7: a chain of symlinks A → B → outside should be caught by realpath's
  // full resolution, same as a single-hop escape. Guards against incremental
  // containment checks that only look at the first link.
  test('rejects a nested symlink chain that ultimately escapes', async () => {
    // Inside project: escapeLink → intermediate → outsideDir
    const intermediateTarget = outsideDir // final escape target
    const intermediate = join(projectRoot, 'facets/intermediate-link')
    symlinkSync(intermediateTarget, intermediate, 'dir')
    const escapeLink = join(projectRoot, 'facets/escape-link')
    symlinkSync(intermediate, escapeLink, 'dir')
    const result = await resolveLocalSource('./facets/escape-link', projectRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('outside the project tree')
    }
  })

  test('rejects a file (not a directory)', async () => {
    writeFileSync(join(projectRoot, 'facets/stray.txt'), 'x')
    const result = await resolveLocalSource('./facets/stray.txt', projectRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('not a directory')
    }
  })
})
