import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateContainedRelativePath } from '../asset-fs.ts'
import { deleteSkillBundle, installSkillBundle, readSkillBundle, type SkillBundlePaths } from '../skill-bundle.ts'

let baseDir: string

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'skill-bundle-test-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

function paths(name = 'review'): SkillBundlePaths {
  const root = join(baseDir, 'skills', name)
  return { root, primaryFile: join(root, 'SKILL.md'), pruneBoundary: baseDir }
}

function bytes(text: string): Uint8Array<ArrayBuffer> {
  // Copy into a fresh ArrayBuffer-backed view so strict Uint8Array
  // generics (Uint8Array<ArrayBuffer> vs ArrayBufferLike) line up.
  return new Uint8Array(new TextEncoder().encode(text))
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  )
}

describe('validateContainedRelativePath', () => {
  test('accepts simple and nested relative paths', () => {
    expect(validateContainedRelativePath('api.md').ok).toBe(true)
    expect(validateContainedRelativePath('references/api.md').ok).toBe(true)
    expect(validateContainedRelativePath('a/b/c/d.bin').ok).toBe(true)
  })

  test.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['C:/windows', 'Windows drive'],
    ['c:relative', 'Windows drive'],
    ['a\\b.md', 'backslash'],
    ['a/\0/b', 'NUL'],
    ['a//b.md', 'empty segment'],
    ['./a.md', '"." segment'],
    ['../outside.md', '".." segment'],
    ['a/../../b.md', '".." segment'],
  ])('rejects %j (%s)', (path, _label) => {
    expect(validateContainedRelativePath(path).ok).toBe(false)
  })
})

describe('installSkillBundle', () => {
  test('installs a companion-less skill (empty map, empty owned set)', async () => {
    const result = await installSkillBundle(paths(), {
      content: '# Review',
      metadata: { name: 'review', description: 'reviews things' },
      companions: {},
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    expect(result.primaryPath).toBe(paths().primaryFile)
    const written = await readFile(paths().primaryFile, 'utf8')
    expect(written).toContain('# Review')
    expect(written).toContain('name: review')
  })

  test('installs primary plus companions with verbatim bytes and no metadata leakage', async () => {
    const logo = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
    const result = await installSkillBundle(paths(), {
      content: '# Review',
      metadata: { name: 'review' },
      companions: { 'references/api.md': bytes('# API docs'), 'assets/logo.png': logo },
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    const api = await readFile(join(paths().root, 'references/api.md'))
    expect(new Uint8Array(api)).toEqual(bytes('# API docs'))
    const png = await readFile(join(paths().root, 'assets/logo.png'))
    expect(new Uint8Array(png)).toEqual(logo)
    // No front-matter transformation on companions
    expect(api.toString()).not.toContain('---')
  })

  test('writes empty companion bytes', async () => {
    const result = await installSkillBundle(paths(), {
      content: '# Review',
      companions: { 'empty.txt': new Uint8Array() },
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    const empty = await readFile(join(paths().root, 'empty.txt'))
    expect(empty.length).toBe(0)
  })

  test('reinstall removes owned companions absent from the new bundle and preserves unowned files', async () => {
    const p = paths()
    await installSkillBundle(p, {
      content: '# v1',
      companions: { 'references/old.md': bytes('old'), 'keep.md': bytes('keep') },
      ownedCompanionPaths: [],
    })
    // An unowned user file inside the skill directory
    await writeFile(join(p.root, 'notes.txt'), 'user notes')

    const result = await installSkillBundle(p, {
      content: '# v2',
      companions: { 'keep.md': bytes('keep v2') },
      ownedCompanionPaths: ['references/old.md', 'keep.md'],
    })
    if (!result.ok) expect.unreachable()
    expect(await exists(join(p.root, 'references/old.md'))).toBe(false)
    // Directory emptied by owned-file removal is pruned
    expect(await exists(join(p.root, 'references'))).toBe(false)
    expect(await readFile(join(p.root, 'keep.md'), 'utf8')).toBe('keep v2')
    expect(await readFile(join(p.root, 'notes.txt'), 'utf8')).toBe('user notes')
  })

  test('reinstall is idempotent', async () => {
    const options = {
      content: '# Review',
      metadata: { name: 'review' },
      companions: { 'references/api.md': bytes('api') },
      ownedCompanionPaths: ['references/api.md'],
    }
    const first = await installSkillBundle(paths(), options)
    const second = await installSkillBundle(paths(), options)
    if (!first.ok || !second.ok) expect.unreachable()
    expect(await readFile(join(paths().root, 'references/api.md'), 'utf8')).toBe('api')
  })

  test.each([
    ['../escape.md'],
    ['/abs.md'],
    ['a\\b.md'],
    ['references/../../escape.md'],
  ])('rejects escaping companion path %j in the new bundle before any filesystem access', async (bad) => {
    const result = await installSkillBundle(paths(), {
      content: '# Review',
      companions: { [bad]: bytes('x') },
      ownedCompanionPaths: [],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
    // Nothing was written — not even the primary
    expect(await exists(paths().primaryFile)).toBe(false)
  })

  test('rejects escaping path in the owned set before any filesystem access', async () => {
    const result = await installSkillBundle(paths(), {
      content: '# Review',
      companions: {},
      ownedCompanionPaths: ['../../outside.md'],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
    expect(await exists(paths().primaryFile)).toBe(false)
  })

  test('failed companion write rolls back the prior bundle', async () => {
    const p = paths()
    await installSkillBundle(p, {
      content: '# v1',
      companions: { 'api.md': bytes('v1 api') },
      ownedCompanionPaths: [],
    })
    // Force the companion write to fail: a directory occupies the target path.
    await mkdir(join(p.root, 'broken.md'))

    const result = await installSkillBundle(p, {
      content: '# v2',
      companions: { 'api.md': bytes('v2 api'), 'broken.md': bytes('x') },
      ownedCompanionPaths: ['api.md'],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('io-failed')
    // Prior bundle intact: primary and companion carry v1 content.
    expect(await readFile(p.primaryFile, 'utf8')).toContain('# v1')
    expect(await readFile(join(p.root, 'api.md'), 'utf8')).toBe('v1 api')
  })

  test('failed primary write leaves nothing behind for a fresh install', async () => {
    const p = paths()
    // A directory occupies the primary path.
    await mkdir(p.root, { recursive: true })
    await mkdir(p.primaryFile)

    const result = await installSkillBundle(p, {
      content: '# Review',
      companions: { 'api.md': bytes('api') },
      ownedCompanionPaths: [],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('io-failed')
    expect(await exists(join(p.root, 'api.md'))).toBe(false)
  })
})

describe('readSkillBundle', () => {
  test('returns canonical primary content plus exactly the requested owned companions', async () => {
    const p = paths()
    await installSkillBundle(p, {
      content: '# Review',
      metadata: { name: 'review', description: 'd' },
      companions: { 'references/api.md': bytes('api'), 'assets/logo.png': bytes('png') },
      ownedCompanionPaths: [],
    })
    // Unowned file present in the directory
    await writeFile(join(p.root, 'notes.txt'), 'user notes')

    const result = await readSkillBundle(p, ['references/api.md', 'assets/logo.png'])
    if (!result.ok) expect.unreachable()
    // Canonical content: front-matter storage encoding stripped
    expect(result.asset.content).toBe('# Review')
    expect(result.asset.metadata).toEqual({ name: 'review', description: 'd' })
    if (result.asset.assetType !== 'skill') expect.unreachable()
    expect(Object.keys(result.asset.companions).sort()).toEqual(['assets/logo.png', 'references/api.md'])
    expect(new TextDecoder().decode(result.asset.companions['references/api.md'])).toBe('api')
  })

  test('never sweeps unowned files into the result', async () => {
    const p = paths()
    await installSkillBundle(p, { content: '# Review', companions: {}, ownedCompanionPaths: [] })
    await writeFile(join(p.root, 'notes.txt'), 'user notes')

    const result = await readSkillBundle(p, [])
    if (!result.ok) expect.unreachable()
    if (result.asset.assetType !== 'skill') expect.unreachable()
    expect(result.asset.companions).toEqual({})
  })

  test('omits owned companions missing from disk (drift signal)', async () => {
    const p = paths()
    await installSkillBundle(p, { content: '# Review', companions: {}, ownedCompanionPaths: [] })

    const result = await readSkillBundle(p, ['references/gone.md'])
    if (!result.ok) expect.unreachable()
    if (result.asset.assetType !== 'skill') expect.unreachable()
    expect(result.asset.companions).toEqual({})
  })

  test('returns not-found for a missing skill', async () => {
    const result = await readSkillBundle(paths('missing'), [])
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('not-found')
  })

  test('rejects an escaping owned path before any filesystem access', async () => {
    const result = await readSkillBundle(paths('missing'), ['../secret.md'])
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
  })
})

describe('deleteSkillBundle', () => {
  test('deletes primary plus exactly the owned companions and prunes emptied directories', async () => {
    const p = paths()
    await installSkillBundle(p, {
      content: '# Review',
      companions: { 'references/api.md': bytes('api') },
      ownedCompanionPaths: [],
    })

    const result = await deleteSkillBundle(p, ['references/api.md'])
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(true)
    expect([...result.deletedPaths].sort()).toEqual([p.primaryFile, join(p.root, 'references/api.md')].sort())
    // The whole skill root is pruned once emptied (boundary is baseDir)
    expect(await exists(p.root)).toBe(false)
    expect(
      await readdir(baseDir).then(
        (entries) => entries,
        () => null,
      ),
    ).not.toBeNull()
  })

  test('preserves unowned files and the directories containing them', async () => {
    const p = paths()
    await installSkillBundle(p, {
      content: '# Review',
      companions: { 'references/api.md': bytes('api') },
      ownedCompanionPaths: [],
    })
    await writeFile(join(p.root, 'notes.txt'), 'user notes')

    const result = await deleteSkillBundle(p, ['references/api.md'])
    if (!result.ok) expect.unreachable()
    expect(await readFile(join(p.root, 'notes.txt'), 'utf8')).toBe('user notes')
    expect(await exists(join(p.root, 'references/api.md'))).toBe(false)
  })

  test('deleting a non-existent skill is success with existed: false', async () => {
    const result = await deleteSkillBundle(paths('missing'), [])
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(false)
    expect(result.deletedPaths).toEqual([])
  })

  test('rejects escaping owned paths without deleting anything', async () => {
    const p = paths()
    await installSkillBundle(p, { content: '# Review', companions: {}, ownedCompanionPaths: [] })

    for (const bad of ['../outside.md', '/abs.md']) {
      const result = await deleteSkillBundle(p, [bad])
      if (result.ok) expect.unreachable()
      expect(result.failure.code).toBe('invalid-companion-path')
    }
    expect(await exists(p.primaryFile)).toBe(true)
  })

  test('failed deletion restores the already-removed files', async () => {
    const p = paths()
    await installSkillBundle(p, {
      content: '# Review',
      companions: { 'sub/locked.md': bytes('locked') },
      ownedCompanionPaths: [],
    })
    // Make the companion's parent directory read-only so its rm fails
    // after the primary has already been deleted.
    await chmod(join(p.root, 'sub'), 0o555)
    try {
      const result = await deleteSkillBundle(p, ['sub/locked.md'])
      if (result.ok) expect.unreachable()
      expect(result.failure.code).toBe('io-failed')
      // Rollback restored the primary.
      expect(await readFile(p.primaryFile, 'utf8')).toContain('# Review')
      expect(await readFile(join(p.root, 'sub/locked.md'), 'utf8')).toBe('locked')
    } finally {
      await chmod(join(p.root, 'sub'), 0o755)
    }
  })
})

describe('skill-bundle containment hardening', () => {
  test('rejects a companion that targets the primary file', async () => {
    const p = paths()
    const result = await installSkillBundle(p, {
      content: '# Review',
      companions: { 'SKILL.md': bytes('malicious') },
      ownedCompanionPaths: [],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
    // A companion NAMED SKILL.md but in a sub-directory is allowed.
    const ok = await installSkillBundle(p, {
      content: '# Review',
      companions: { 'references/SKILL.md': bytes('fine') },
      ownedCompanionPaths: [],
    })
    if (!ok.ok) expect.unreachable()
    expect(await readFile(join(p.root, 'references/SKILL.md'), 'utf8')).toBe('fine')
  })

  test('rejects the primary file escaping the skill root', async () => {
    const root = join(baseDir, 'skills', 'review')
    const escaping: SkillBundlePaths = {
      root,
      primaryFile: join(baseDir, 'victim.md'),
      pruneBoundary: baseDir,
    }
    const result = await installSkillBundle(escaping, { content: '# x', companions: {}, ownedCompanionPaths: [] })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
    expect(await exists(join(baseDir, 'victim.md'))).toBe(false)
  })

  test('rejects companions colliding by portable case folding', async () => {
    const p = paths()
    const result = await installSkillBundle(p, {
      content: '# Review',
      companions: { 'References/api.md': bytes('a'), 'references/api.md': bytes('b') },
      ownedCompanionPaths: [],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
  })

  test('rejects a companion whose existing parent directory is a symlink', async () => {
    const p = paths()
    await installSkillBundle(p, { content: '# Review', companions: {}, ownedCompanionPaths: [] })
    // Create an escape target and a symlink inside the skill root pointing at it.
    const outside = join(baseDir, 'outside')
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(p.root, 'references'))

    const result = await installSkillBundle(p, {
      content: '# Review',
      companions: { 'references/api.md': bytes('escaped') },
      ownedCompanionPaths: [],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
    // Nothing was written through the symlink.
    expect(await exists(join(outside, 'api.md'))).toBe(false)
  })

  test('reads back an owned companion literally named __proto__', async () => {
    const p = paths()
    // Build the map so `__proto__` is a real own key, not a prototype set.
    const companions: Record<string, Uint8Array> = Object.create(null)
    companions.__proto__ = bytes('proto-bytes')
    await installSkillBundle(p, {
      content: '# Review',
      companions,
      ownedCompanionPaths: [],
    })
    const result = await readSkillBundle(p, ['__proto__'])
    if (!result.ok) expect.unreachable()
    if (result.asset.assetType !== 'skill') expect.unreachable()
    expect(Object.hasOwn(result.asset.companions, '__proto__')).toBe(true)
    expect(new TextDecoder().decode(result.asset.companions.__proto__)).toBe('proto-bytes')
  })
})
