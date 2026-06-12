import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assembleAssetContent,
  deleteAssetFile,
  installAssetFile,
  readAssetFile,
  splitAssetContent,
} from '../asset-fs.ts'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'asset-fs-test-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('installAssetFile', () => {
  test('creates nested parent directories and writes body verbatim when no metadata', async () => {
    const file = join(workDir, 'deeply/nested/skill/SKILL.md')
    await installAssetFile({ file }, '# plan body')
    expect(readFileSync(file, 'utf8')).toBe('# plan body')
  })

  test('prepends YAML front-matter when metadata is non-empty', async () => {
    const file = join(workDir, 'skill.md')
    await installAssetFile({ file }, '# plan body', {
      name: 'planning',
      description: 'plan things',
    })
    const raw = readFileSync(file, 'utf8')
    expect(raw).toContain('---\n')
    expect(raw).toContain('name: planning')
    expect(raw).toContain('description: plan things')
    expect(raw).toContain('# plan body')
  })

  test('overwrites existing content unconditionally', async () => {
    const file = join(workDir, 'skill.md')
    writeFileSync(file, 'old content')
    await installAssetFile({ file }, 'new body', { name: 'new' })
    expect(readFileSync(file, 'utf8')).toContain('new body')
    expect(readFileSync(file, 'utf8')).not.toContain('old content')
  })

  test('does not add front-matter when metadata is omitted', async () => {
    const file = join(workDir, 'skill.md')
    await installAssetFile({ file }, 'just body')
    expect(readFileSync(file, 'utf8')).toBe('just body')
  })

  test('does not add front-matter when metadata is an empty object', async () => {
    const file = join(workDir, 'skill.md')
    await installAssetFile({ file }, 'just body', {})
    expect(readFileSync(file, 'utf8')).toBe('just body')
  })

  test('merges caller metadata over body-embedded front-matter', async () => {
    const file = join(workDir, 'skill.md')
    const bodyWithFM = '---\nexisting: true\nname: from-body\n---\n# body'
    await installAssetFile({ file }, bodyWithFM, { name: 'from-caller' })
    const raw = readFileSync(file, 'utf8')
    expect(raw).toContain('name: from-caller')
    expect(raw).toContain('existing: true')
    expect(raw).toContain('# body')
  })
})

describe('readAssetFile', () => {
  test('returns body-only when the file has no front-matter', async () => {
    const file = join(workDir, 'skill.md')
    await installAssetFile({ file }, 'just body')
    expect(await readAssetFile({ file })).toEqual({ content: 'just body' })
  })

  test('splits front-matter and body', async () => {
    const file = join(workDir, 'skill.md')
    await installAssetFile({ file }, '# body', { name: 'planning', description: 'plan' })
    const result = await readAssetFile({ file })
    expect(result.content.trim()).toBe('# body')
    expect(result.metadata).toEqual({ name: 'planning', description: 'plan' })
  })

  test('throws when the file is absent', async () => {
    await expect(readAssetFile({ file: join(workDir, 'missing.md') })).rejects.toThrow()
  })

  test('tolerates malformed YAML by falling back to body-only', async () => {
    const file = join(workDir, 'skill.md')
    writeFileSync(file, '---\n{not valid: yaml:: at all\n---\n# body')
    const result = await readAssetFile({ file })
    // Either falls back to raw or returns empty metadata — both are acceptable
    // so long as we don't throw.
    expect(result).toBeTruthy()
  })
})

describe('deleteAssetFile', () => {
  test('removes the asset file', async () => {
    const file = join(workDir, 'skill.md')
    await installAssetFile({ file }, 'body')
    await deleteAssetFile({ file })
    expect(existsSync(file)).toBe(false)
  })

  test('also removes a legacy .meta.json sidecar (upgrade path)', async () => {
    const file = join(workDir, 'skill.md')
    writeFileSync(file, 'body')
    writeFileSync(`${file}.meta.json`, '{"old":true}')
    await deleteAssetFile({ file })
    expect(existsSync(`${file}.meta.json`)).toBe(false)
  })

  test('is a no-op when the asset is absent', async () => {
    const missingPath = join(workDir, 'missing.md')
    await expect(deleteAssetFile({ file: missingPath })).resolves.toBe(missingPath)
  })
})

describe('assembleAssetContent / splitAssetContent — round-trip', () => {
  // Inverse-property contract: split(assemble(body, metadata)) === { content: body, metadata }.
  // If this ever drifts, every consumer that compares a write-then-read-
  // back asset (e.g. `materialize`'s skip-if-identical check) will report
  // false drift on every install — see the runaway "repaired" loop.

  test('inverse: simple body recovers byte-for-byte', () => {
    const body = '# body'
    const metadata = { name: 'planning', description: 'plan' }
    const split = splitAssetContent(assembleAssetContent(body, metadata))
    expect(split.metadata).toEqual(metadata)
    expect(split.content).toBe(body)
  })

  test('inverse: body with trailing newline recovers byte-for-byte', () => {
    const body = '# heading\n\nparagraph\n'
    const metadata = { name: 'planning', description: 'plan' }
    const split = splitAssetContent(assembleAssetContent(body, metadata))
    expect(split.content).toBe(body)
    expect(split.metadata).toEqual(metadata)
  })

  test('inverse: body that already starts with a newline recovers byte-for-byte', () => {
    const body = '\n# heading\n'
    const metadata = { name: 'planning' }
    const split = splitAssetContent(assembleAssetContent(body, metadata))
    expect(split.content).toBe(body)
    expect(split.metadata).toEqual(metadata)
  })

  test('inverse: empty body recovers as empty', () => {
    const body = ''
    const metadata = { name: 'planning' }
    const split = splitAssetContent(assembleAssetContent(body, metadata))
    expect(split.content).toBe(body)
    expect(split.metadata).toEqual(metadata)
  })

  test('inverse: extras-rich metadata recovers byte-for-byte', () => {
    const body = '# planning content\n'
    const metadata = {
      customField: 'hello',
      enabled: true,
      name: 'planning',
      description: 'planning skill',
    }
    const split = splitAssetContent(assembleAssetContent(body, metadata))
    expect(split.content).toBe(body)
    expect(split.metadata).toEqual(metadata)
  })

  test('split returns {content: raw} when there is no front-matter', () => {
    expect(splitAssetContent('plain body')).toEqual({ content: 'plain body' })
  })
})
