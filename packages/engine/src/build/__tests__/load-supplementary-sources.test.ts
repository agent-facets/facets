import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArchivePlanEntry } from '@agent-facets/protocol'
import { collectArchiveEntriesFromPlan, loadSupplementarySources } from '../load-supplementary-sources.ts'

/**
 * Filesystem-identity failure matrix for the producer's supplementary-source
 * loader (task 11.5). The pure path-grammar/collision classes are exercised in
 * `packages/protocol/src/__tests__/archive-plan.test.ts`; this file owns only
 * the disk-identity classes the archive plan cannot see: missing, symlink
 * (target + parent), hard link, non-regular, out-of-tree escape, and
 * resolved-source aliasing — plus the happy path and byte fidelity.
 */

let root: string

beforeEach(() => {
  // realpath the root so macOS /var → /private/var doesn't cause spurious
  // containment failures.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'supp-src-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** An archive-only plan entry for a top-level path. */
function archiveOnly(path: string): ArchivePlanEntry {
  return { kind: 'archive-only', path }
}

/** A skill-companion plan entry (path already prefixed with skills/<name>/). */
function companion(skill: string, path: string): ArchivePlanEntry {
  return { kind: 'skill-companion', path, skill }
}

describe('loadSupplementarySources — happy path', () => {
  test('loads top-level and nested companion bytes verbatim', async () => {
    writeFileSync(join(root, 'README.md'), '# hi\n')
    mkdirSync(join(root, 'skills/review/references'), { recursive: true })
    const binary = new Uint8Array([0, 1, 2, 255, 254])
    writeFileSync(join(root, 'skills/review/references/logo.bin'), binary)

    const result = await loadSupplementarySources(root, [
      archiveOnly('README.md'),
      companion('review', 'skills/review/references/logo.bin'),
    ])
    if (!result.ok) expect.unreachable()

    const readme = result.files.find((f) => f.archivePath === 'README.md')
    const logo = result.files.find((f) => f.archivePath === 'skills/review/references/logo.bin')
    expect(new TextDecoder().decode(readme?.content)).toBe('# hi\n')
    expect(logo?.content).toEqual(binary)
  })

  test('an empty supplementary file loads as zero bytes', async () => {
    writeFileSync(join(root, 'EMPTY'), '')
    const result = await loadSupplementarySources(root, [archiveOnly('EMPTY')])
    if (!result.ok) expect.unreachable()
    expect(result.files[0]?.content.length).toBe(0)
  })

  test('a plan with no supplementary entries loads nothing', async () => {
    const result = await loadSupplementarySources(root, [{ kind: 'manifest', path: 'facet.json' }])
    if (!result.ok) expect.unreachable()
    expect(result.files).toEqual([])
  })
})

describe('loadSupplementarySources — filesystem-identity failures', () => {
  test('missing declared file', async () => {
    const result = await loadSupplementarySources(root, [archiveOnly('LICENSE')])
    if (result.ok) expect.unreachable()
    expect(result.failures[0]?.code).toBe('missing')
  })

  test('declared path is a directory', async () => {
    mkdirSync(join(root, 'docs'), { recursive: true })
    const result = await loadSupplementarySources(root, [archiveOnly('docs')])
    if (result.ok) expect.unreachable()
    if (result.failures[0]?.code !== 'not-regular-file') expect.unreachable()
    expect(result.failures[0].kind).toBe('directory')
  })

  test('declared path is a symlink to a regular file', async () => {
    writeFileSync(join(root, 'real.md'), 'x')
    symlinkSync(join(root, 'real.md'), join(root, 'link.md'))
    const result = await loadSupplementarySources(root, [archiveOnly('link.md')])
    if (result.ok) expect.unreachable()
    if (result.failures[0]?.code !== 'not-regular-file') expect.unreachable()
    expect(result.failures[0].kind).toBe('symlink')
  })

  test('a symlinked parent component is rejected', async () => {
    mkdirSync(join(root, 'realdir'), { recursive: true })
    writeFileSync(join(root, 'realdir/note.md'), 'x')
    symlinkSync(join(root, 'realdir'), join(root, 'linkdir'))
    const result = await loadSupplementarySources(root, [archiveOnly('linkdir/note.md')])
    if (result.ok) expect.unreachable()
    if (result.failures[0]?.code !== 'symlinked-parent') expect.unreachable()
    expect(result.failures[0].component).toBe('linkdir')
  })

  test('a hard link is rejected', async () => {
    writeFileSync(join(root, 'original.md'), 'x')
    linkSync(join(root, 'original.md'), join(root, 'hard.md'))
    // Only declare the hard link; both files now have nlink === 2.
    const result = await loadSupplementarySources(root, [archiveOnly('hard.md')])
    if (result.ok) expect.unreachable()
    expect(result.failures[0]?.code).toBe('hard-link')
  })

  test('a symlink escaping the facet root is rejected', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'outside-')))
    writeFileSync(join(outside, 'secret.md'), 'x')
    symlinkSync(outside, join(root, 'escape'))
    const result = await loadSupplementarySources(root, [archiveOnly('escape/secret.md')])
    if (result.ok) expect.unreachable()
    const code = result.failures[0]?.code
    if (code === undefined) expect.unreachable()
    // Caught as a symlinked parent before realpath containment even runs.
    expect(['symlinked-parent', 'escapes-root']).toContain(code)
    rmSync(outside, { recursive: true, force: true })
  })

  test('two hard-linked declarations are each rejected as hard links', async () => {
    // Two distinct spellings backed by one inode is the shape the
    // resolved-source-alias guard exists for, but hard links carry nlink>1 and
    // are rejected by the earlier hard-link check before aliasing is reached.
    // This documents that the earlier, stricter check fires first: both
    // declarations fail, and neither smuggles duplicate bytes into the archive.
    writeFileSync(join(root, 'a.md'), 'x')
    linkSync(join(root, 'a.md'), join(root, 'b.md'))
    const result = await loadSupplementarySources(root, [archiveOnly('a.md'), archiveOnly('b.md')])
    if (result.ok) expect.unreachable()
    expect(result.failures.map((f) => f.code)).toEqual(['hard-link', 'hard-link'])
  })

  test('a distinct single-link file is not flagged as an alias', async () => {
    writeFileSync(join(root, 'one.md'), 'x')
    writeFileSync(join(root, 'two.md'), 'y')
    const result = await loadSupplementarySources(root, [archiveOnly('one.md'), archiveOnly('two.md')])
    if (!result.ok) expect.unreachable()
    expect(result.files).toHaveLength(2)
  })
})

describe('collectArchiveEntriesFromPlan', () => {
  test('assembles entries in the plan order with resolved content by kind', () => {
    const plan: ArchivePlanEntry[] = [
      { kind: 'archive-only', path: 'README.md' },
      { kind: 'manifest', path: 'facet.json' },
      { kind: 'primary-asset', path: 'skills/review/SKILL.md', assetType: 'skill', name: 'review' },
      { kind: 'skill-companion', path: 'skills/review/api.md', skill: 'review' },
    ]
    const resolved = {
      name: 'x',
      version: '1.0.0',
      skills: { review: { description: 'd', prompt: '# review\n' } },
    }
    const entries = collectArchiveEntriesFromPlan(plan, '{"name":"x"}', resolved, [
      { archivePath: 'README.md', content: new TextEncoder().encode('# readme\n') },
      { archivePath: 'skills/review/api.md', content: new TextEncoder().encode('api') },
    ])

    // Order preserved from the (already-sorted) plan.
    expect(entries.map((e) => e.path)).toEqual([
      'README.md',
      'facet.json',
      'skills/review/SKILL.md',
      'skills/review/api.md',
    ])
    // Manifest and primary carry their strings; supplementary carry bytes.
    expect(entries[1]?.content).toBe('{"name":"x"}')
    expect(entries[2]?.content).toBe('# review\n')
    expect(entries[3]?.content).toBeInstanceOf(Uint8Array)
  })

  test('throws if a supplementary entry has no loaded bytes (pipeline bug)', () => {
    const plan: ArchivePlanEntry[] = [{ kind: 'archive-only', path: 'README.md' }]
    expect(() => collectArchiveEntriesFromPlan(plan, '{}', { name: 'x', version: '1.0.0' }, [])).toThrow(
      /no loaded bytes/,
    )
  })
})
