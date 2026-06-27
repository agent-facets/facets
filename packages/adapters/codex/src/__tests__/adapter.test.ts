import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import adapter from '../index.ts'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('codex adapter — identity', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('codex')
  })

  test('declares install support', () => {
    expect(adapter.supportsInstall).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildAssetMetadata
// ---------------------------------------------------------------------------

describe('codex adapter — buildAssetMetadata', () => {
  test('accepts empty metadata', () => {
    const result = adapter.buildAssetMetadata({})
    expect(result.ok).toBe(true)
  })

  test('accepts valid codex agent metadata fields', () => {
    const result = adapter.buildAssetMetadata({
      name: 'reviewer',
      description: 'Code review specialist',
      developer_instructions: 'You are an expert reviewer.',
    })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({
      name: 'reviewer',
      description: 'Code review specialist',
      developer_instructions: 'You are an expert reviewer.',
    })
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

  test('rejects invalid description type', () => {
    const result = adapter.buildAssetMetadata({ description: true })
    expect(result.ok).toBe(false)
  })

  test('rejects invalid developer_instructions type', () => {
    const result = adapter.buildAssetMetadata({ developer_instructions: 123 })
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Project-scope I/O — skills (Markdown + YAML front-matter)
// ---------------------------------------------------------------------------

describe('codex adapter — project-scope skill I/O', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'codex-adapter-test-'))
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
})

// ---------------------------------------------------------------------------
// Project-scope I/O — agents (TOML format)
// ---------------------------------------------------------------------------

describe('codex adapter — project-scope agent I/O', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'codex-agent-test-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('agent installs at .codex/agents/<name>.toml', async () => {
    await adapter.installAsset('project', 'agent', 'reviewer', 'You are a reviewer.', {
      name: 'reviewer',
      description: 'Code review specialist',
    })
    const path = join(workDir, '.codex/agents/reviewer.toml')
    expect(existsSync(path)).toBe(true)
  })

  test('agent TOML file contains developer_instructions from content', async () => {
    await adapter.installAsset('project', 'agent', 'reviewer', 'You are a reviewer.', {
      name: 'reviewer',
      description: 'Code review specialist',
    })
    const path = join(workDir, '.codex/agents/reviewer.toml')
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('developer_instructions')
    expect(raw).toContain('You are a reviewer.')
    expect(raw).toContain('name = "reviewer"')
    expect(raw).toContain('description = "Code review specialist"')
  })

  test('readAsset round-trips agent developer_instructions as content', async () => {
    await adapter.installAsset('project', 'agent', 'reviewer', 'You are a reviewer.', {
      name: 'reviewer',
      description: 'Code review specialist',
    })
    const result = await adapter.readAsset('project', 'agent', 'reviewer')
    expect(result.content).toBe('You are a reviewer.')
    expect(result.metadata).toEqual({ name: 'reviewer', description: 'Code review specialist' })
  })

  test('deleteAsset removes agent TOML file', async () => {
    await adapter.installAsset('project', 'agent', 'reviewer', 'instructions', {})
    await adapter.deleteAsset('project', 'agent', 'reviewer')
    const filePath = join(workDir, '.codex/agents/reviewer.toml')
    expect(existsSync(filePath)).toBe(false)
  })

  test('deleteAsset is a no-op when agent is absent', async () => {
    await expect(adapter.deleteAsset('project', 'agent', 'never-installed')).resolves.toBeUndefined()
  })

  test('installAsset overwrites agent unconditionally (idempotent)', async () => {
    await adapter.installAsset('project', 'agent', 'reviewer', 'v1 instructions', {})
    await adapter.installAsset('project', 'agent', 'reviewer', 'v2 instructions', {})
    const result = await adapter.readAsset('project', 'agent', 'reviewer')
    expect(result.content).toBe('v2 instructions')
  })

  test('namespaced agent path uses subdirectory', async () => {
    await adapter.installAsset('project', 'agent', 'viper-plans/reviewer', 'instructions', {})
    const path = join(workDir, '.codex/agents/viper-plans/reviewer.toml')
    expect(existsSync(path)).toBe(true)
  })

  test('readAsset rejects when the agent TOML file is absent', async () => {
    await expect(adapter.readAsset('project', 'agent', 'never-installed')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Project-scope I/O — commands (Markdown)
// ---------------------------------------------------------------------------

describe('codex adapter — project-scope command I/O', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'codex-command-test-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('command installs at .agents/commands/<name>.md', async () => {
    await adapter.installAsset('project', 'command', 'viper-plans/plan', 'command body', {})
    const path = join(workDir, '.agents/commands/viper-plans/plan.md')
    expect(readFileSync(path, 'utf8')).toBe('command body')
  })
})

// ---------------------------------------------------------------------------
// User-scope base directories
// ---------------------------------------------------------------------------

describe('codex adapter — user-scope base dirs', () => {
  const originalHome = process.env.HOME
  let fakeHome: string

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'codex-home-'))
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

  test('user-scope agent writes under ~/.codex/agents', async () => {
    await adapter.installAsset('user', 'agent', 'reviewer', 'instructions', {
      name: 'reviewer',
    })
    const path = join(fakeHome, '.codex/agents/reviewer.toml')
    expect(existsSync(path)).toBe(true)
  })

  test('user-scope command writes under ~/.agents/commands', async () => {
    await adapter.installAsset('user', 'command', 'plan', 'command body', {})
    const path = join(fakeHome, '.agents/commands/plan.md')
    expect(readFileSync(path, 'utf8')).toBe('command body')
  })
})

// ---------------------------------------------------------------------------
// Unsupported scope
// ---------------------------------------------------------------------------

describe('codex adapter — unsupported scope', () => {
  test('system scope throws', async () => {
    await expect(adapter.installAsset('system', 'skill', 'x', 'y', {})).rejects.toThrow(/system scope/)
  })
})
