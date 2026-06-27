import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import adapter from '../index.ts'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('openclaw adapter — identity', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('openclaw')
  })

  test('declares install support', () => {
    expect(adapter.supportsInstall).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildAssetMetadata
// ---------------------------------------------------------------------------

describe('openclaw adapter — buildAssetMetadata', () => {
  test('accepts empty metadata', () => {
    const result = adapter.buildAssetMetadata({})
    expect(result.ok).toBe(true)
  })

  test('accepts valid skill front-matter fields', () => {
    const result = adapter.buildAssetMetadata({
      name: 'research',
      description: 'Search the web',
      'user-invocable': true,
    })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({
      name: 'research',
      description: 'Search the web',
      'user-invocable': true,
    })
  })

  test('accepts command-dispatch tool front-matter', () => {
    const result = adapter.buildAssetMetadata({
      'command-dispatch': 'tool',
      'command-tool': 'image_generate',
      'command-arg-mode': 'raw',
    })
    expect(result.ok).toBe(true)
  })

  test('accepts os platform gate', () => {
    const result = adapter.buildAssetMetadata({ os: 'darwin' })
    expect(result.ok).toBe(true)
  })

  test('accepts partial metadata (only name)', () => {
    const result = adapter.buildAssetMetadata({ name: 'planner' })
    expect(result.ok).toBe(true)
  })

  test('rejects invalid name type', () => {
    const result = adapter.buildAssetMetadata({ name: 42 })
    if (result.ok) expect.unreachable()
    expect(result.errors[0]?.message).toBeTruthy()
  })

  test('rejects non-boolean user-invocable', () => {
    const result = adapter.buildAssetMetadata({ 'user-invocable': 'yes' })
    expect(result.ok).toBe(false)
  })

  test('rejects invalid os literal', () => {
    const result = adapter.buildAssetMetadata({ os: 'solaris' })
    expect(result.ok).toBe(false)
  })

  test('rejects nested object values (single-line front-matter constraint)', () => {
    const result = adapter.buildAssetMetadata({ permission: { edit: 'deny' } })
    if (result.ok) expect.unreachable()
    expect(result.errors[0]?.path).toBe('permission')
    expect(result.errors[0]?.actual).toBe('object')
  })

  test('rejects array values (single-line front-matter constraint)', () => {
    const result = adapter.buildAssetMetadata({ tags: ['a', 'b'] })
    if (result.ok) expect.unreachable()
    expect(result.errors[0]?.actual).toBe('array')
  })
})

// ---------------------------------------------------------------------------
// Project-scope I/O — skills (Markdown + YAML front-matter)
// ---------------------------------------------------------------------------

describe('openclaw adapter — project-scope skill I/O', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'openclaw-adapter-test-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('skill installs at .agents/skills/<name>/SKILL.md', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {})
    const path = join(workDir, '.agents/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('# plan')
  })

  test('skill writes YAML front-matter with name + description', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
    })
    const path = join(workDir, '.agents/skills/viper-plans/planning/SKILL.md')
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('name: planning')
    expect(raw).toContain('description: plan things')
    expect(raw).toContain('# plan')
  })

  test('readAsset round-trips skill body and front-matter metadata', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
    })
    const result = await adapter.readAsset('project', 'skill', 'viper-plans/planning')
    expect(result.content.trim()).toBe('# plan')
    expect(result.metadata).toEqual({ name: 'planning', description: 'plan things' })
  })

  test('deleteAsset removes skill file', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {})
    await adapter.deleteAsset('project', 'skill', 'viper-plans/planning')
    const filePath = join(workDir, '.agents/skills/viper-plans/planning/SKILL.md')
    expect(existsSync(filePath)).toBe(false)
  })

  test('deleteAsset is a no-op when skill is absent', async () => {
    await expect(adapter.deleteAsset('project', 'skill', 'never-installed')).resolves.toBeUndefined()
  })

  test('installAsset overwrites skill unconditionally (idempotent)', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', 'v1', {})
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', 'v2', {})
    const path = join(workDir, '.agents/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('v2')
  })

  test('readAsset rejects when the skill file is absent', async () => {
    await expect(adapter.readAsset('project', 'skill', 'never-installed')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Project-scope I/O — commands (skill with user-invocable defaults)
// ---------------------------------------------------------------------------

describe('openclaw adapter — project-scope command I/O', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'openclaw-command-test-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('command installs as a skill at .agents/skills/<name>/SKILL.md', async () => {
    await adapter.installAsset('project', 'command', 'viper-plans/plan', 'command body', {})
    const path = join(workDir, '.agents/skills/viper-plans/plan/SKILL.md')
    expect(existsSync(path)).toBe(true)
  })

  test('command gets user-invocable + disable-model-invocation defaults', async () => {
    await adapter.installAsset('project', 'command', 'viper-plans/plan', 'command body', {
      name: 'plan',
      description: 'make a plan',
    })
    const path = join(workDir, '.agents/skills/viper-plans/plan/SKILL.md')
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('user-invocable: true')
    expect(raw).toContain('disable-model-invocation: true')
    expect(raw).toContain('command body')
  })

  test('facet metadata overrides command defaults', async () => {
    await adapter.installAsset('project', 'command', 'viper-plans/plan', 'body', {
      'disable-model-invocation': false,
    })
    const result = await adapter.readAsset('project', 'command', 'viper-plans/plan')
    expect(result.metadata).toMatchObject({ 'user-invocable': true, 'disable-model-invocation': false })
  })
})

// ---------------------------------------------------------------------------
// Project-scope I/O — agents (mapped to skills; OpenClaw has no agent file)
// ---------------------------------------------------------------------------

describe('openclaw adapter — project-scope agent I/O (mapped to skill)', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'openclaw-agent-test-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('agent installs as a skill at .agents/skills/<name>/SKILL.md', async () => {
    await adapter.installAsset('project', 'agent', 'openspec-adversary/adversary', 'agent body', {
      name: 'adversary',
      description: 'adversary subagent',
    })
    const path = join(workDir, '.agents/skills/openspec-adversary/adversary/SKILL.md')
    expect(existsSync(path)).toBe(true)
  })

  test('agent round-trips body and metadata verbatim (no command defaults)', async () => {
    await adapter.installAsset('project', 'agent', 'openspec-adversary/adversary', 'agent body', {
      name: 'adversary',
      description: 'adversary subagent',
    })
    const result = await adapter.readAsset('project', 'agent', 'openspec-adversary/adversary')
    expect(result.content.trim()).toBe('agent body')
    expect(result.metadata).toEqual({ name: 'adversary', description: 'adversary subagent' })
  })
})

// ---------------------------------------------------------------------------
// User-scope base directories
// ---------------------------------------------------------------------------

describe('openclaw adapter — user-scope base dirs', () => {
  const originalHome = process.env.HOME
  let fakeHome: string

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'openclaw-home-'))
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('user-scope skill writes under ~/.agents/skills', async () => {
    await adapter.installAsset('user', 'skill', 'viper-plans/planning', '# plan', {})
    const path = join(fakeHome, '.agents/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('# plan')
  })

  test('user-scope command writes under ~/.agents/skills', async () => {
    await adapter.installAsset('user', 'command', 'plan', 'command body', {})
    const path = join(fakeHome, '.agents/skills/plan/SKILL.md')
    expect(existsSync(path)).toBe(true)
  })

  test('user-scope agent writes under ~/.agents/skills', async () => {
    await adapter.installAsset('user', 'agent', 'reviewer', 'instructions', { name: 'reviewer' })
    const path = join(fakeHome, '.agents/skills/reviewer/SKILL.md')
    expect(existsSync(path)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unsupported scope
// ---------------------------------------------------------------------------

describe('openclaw adapter — unsupported scope', () => {
  test('system scope throws', async () => {
    await expect(adapter.installAsset('system', 'skill', 'x', 'y', {})).rejects.toThrow(/system scope/)
  })
})
