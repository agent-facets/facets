import { describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBuildPipeline } from '@agent-facets/core'
import dedent from 'dedent'
import { applyOperations, buildEditContext } from '../commands/edit/index.ts'
import type { EditOperation } from '../tui/views/edit/edit-types.ts'

async function createFixtureDir(name: string): Promise<string> {
  const dir = join(tmpdir(), `facets-edit-integ-${name}-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  return dir
}

async function writeManifest(dir: string, manifest: Record<string, unknown>): Promise<void> {
  await Bun.write(join(dir, 'facet.json'), JSON.stringify(manifest, null, 2))
}

describe('edit integration', () => {
  test('buildEditContext detects new files on disk not in manifest', async () => {
    const dir = await createFixtureDir('detect-additions')
    await writeManifest(dir, {
      name: 'test',
      version: '1.0.0',
      skills: { existing: { description: 'Existing skill' } },
    })
    await mkdir(join(dir, 'skills/existing'), { recursive: true })
    await Bun.write(join(dir, 'skills/existing/SKILL.md'), '# Existing')
    // Add a file not in manifest
    await mkdir(join(dir, 'skills/new-one'), { recursive: true })
    await Bun.write(join(dir, 'skills/new-one/SKILL.md'), '# New')

    const result = await buildEditContext(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const additions = result.context.reconciliationItems.filter((i) => i.kind === 'addition')
    expect(additions).toHaveLength(1)
    expect(additions[0]?.name).toBe('new-one')
  })

  test('buildEditContext detects missing files in manifest', async () => {
    const dir = await createFixtureDir('detect-missing')
    await writeManifest(dir, {
      name: 'test',
      version: '1.0.0',
      skills: {
        present: { description: 'Present' },
        gone: { description: 'Gone' },
      },
    })
    await mkdir(join(dir, 'skills/present'), { recursive: true })
    await Bun.write(join(dir, 'skills/present/SKILL.md'), '# Present')
    // 'gone' has no file on disk

    const result = await buildEditContext(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const missing = result.context.reconciliationItems.filter((i) => i.kind === 'missing')
    expect(missing).toHaveLength(1)
    expect(missing[0]?.name).toBe('gone')
  })

  test('buildEditContext detects front matter in matched files', async () => {
    const dir = await createFixtureDir('detect-frontmatter')
    await writeManifest(dir, {
      name: 'test',
      version: '1.0.0',
      skills: { review: { description: 'Review' } },
    })
    await mkdir(join(dir, 'skills/review'), { recursive: true })
    await Bun.write(
      join(dir, 'skills/review/SKILL.md'),
      dedent`
        ---
        name: Review
        ---
        # Review skill
      `,
    )

    const result = await buildEditContext(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const fm = result.context.reconciliationItems.filter((i) => i.kind === 'front-matter')
    expect(fm).toHaveLength(1)
    expect(fm[0]?.name).toBe('review')
  })

  test('applyOperations scaffolds new skill files', async () => {
    const dir = await createFixtureDir('scaffold-skill')
    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: { helper: { description: 'A helper skill' } },
    }
    const operations: EditOperation[] = [{ op: 'write-manifest' }, { op: 'scaffold', type: 'skills', name: 'helper' }]

    await applyOperations(manifest, operations, dir)

    const manifestExists = await Bun.file(join(dir, 'facet.json')).exists()
    expect(manifestExists).toBe(true)

    const skillExists = await Bun.file(join(dir, 'skills/helper/SKILL.md')).exists()
    expect(skillExists).toBe(true)
  })

  test('applyOperations strips front matter from files', async () => {
    const dir = await createFixtureDir('strip-fm')
    await mkdir(join(dir, 'skills/review'), { recursive: true })
    await Bun.write(
      join(dir, 'skills/review/SKILL.md'),
      dedent`
        ---
        name: Review
        description: A review skill
        ---
        # Review
        Review all code.
      `,
    )

    const manifest = {
      name: 'test',
      version: '1.0.0',
      skills: { review: { description: 'A review skill' } },
    }
    const operations: EditOperation[] = [
      { op: 'write-manifest' },
      { op: 'strip-front-matter', type: 'skills', name: 'review', path: 'skills/review/SKILL.md' },
    ]

    await applyOperations(manifest, operations, dir)

    const content = await Bun.file(join(dir, 'skills/review/SKILL.md')).text()
    expect(content).not.toContain('---')
    expect(content).toContain('# Review')
  })

  test('applyOperations deletes removed asset files', async () => {
    const dir = await createFixtureDir('delete-asset')
    await mkdir(join(dir, 'skills/old'), { recursive: true })
    await Bun.write(join(dir, 'skills/old/SKILL.md'), '# Old skill')

    const manifest = { name: 'test', version: '1.0.0', skills: { remaining: { description: 'Remaining' } } }
    const operations: EditOperation[] = [{ op: 'write-manifest' }, { op: 'delete-file', type: 'skills', name: 'old' }]

    await applyOperations(manifest, operations, dir)

    const deleted = await Bun.file(join(dir, 'skills/old/SKILL.md')).exists()
    expect(deleted).toBe(false)
  })

  test('scaffold then build succeeds end-to-end', async () => {
    const dir = await createFixtureDir('scaffold-then-build')
    const manifest = {
      name: 'test-facet',
      version: '1.0.0',
      skills: { example: { description: 'An example skill' } },
    }
    const operations: EditOperation[] = [{ op: 'write-manifest' }, { op: 'scaffold', type: 'skills', name: 'example' }]

    await applyOperations(manifest, operations, dir)

    const buildResult = await runBuildPipeline(dir)
    expect(buildResult.ok).toBe(true)
  })
})
