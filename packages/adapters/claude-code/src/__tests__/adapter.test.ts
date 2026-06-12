import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import adapter from '../index.ts'

describe('claude-code adapter — identity', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('claude-code')
  })

  test('declares install support', () => {
    expect(adapter.supportsInstall).toBe(true)
  })
})

describe('claude-code adapter — buildAssetMetadata', () => {
  test('accepts valid metadata', () => {
    const result = adapter.buildAssetMetadata({
      tools: { Bash: true, Read: false },
      permissions: { allow: true },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        tools: { Bash: true, Read: false },
        permissions: { allow: true },
      })
    }
  })

  test('accepts empty metadata', () => {
    const result = adapter.buildAssetMetadata({})
    expect(result.ok).toBe(true)
  })

  test('rejects invalid tools', () => {
    const result = adapter.buildAssetMetadata({ tools: 'not-a-record' })
    expect(result.ok).toBe(false)
  })

  test('rejects invalid permissions', () => {
    const result = adapter.buildAssetMetadata({ permissions: 42 })
    expect(result.ok).toBe(false)
  })
})

describe('claude-code adapter — project-scope I/O round-trip', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'claude-code-adapter-test-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('skill installs at .claude/skills/<name>/SKILL.md', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {})
    const path = join(workDir, '.claude/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('# plan')
  })

  test('agent installs at .claude/agents/<name>.md', async () => {
    await adapter.installAsset('project', 'agent', 'viper-plans/reviewer', 'agent body', {})
    const path = join(workDir, '.claude/agents/viper-plans/reviewer.md')
    expect(readFileSync(path, 'utf8')).toBe('agent body')
  })

  test('command installs at .claude/commands/<name>.md', async () => {
    await adapter.installAsset('project', 'command', 'viper-plans/plan', 'command body', {})
    const path = join(workDir, '.claude/commands/viper-plans/plan.md')
    expect(readFileSync(path, 'utf8')).toBe('command body')
  })

  test('writes YAML front-matter with name + description + adapter extras', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
      tools: { Bash: true },
    })
    const path = join(workDir, '.claude/skills/viper-plans/planning/SKILL.md')
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('name: planning')
    expect(raw).toContain('description: plan things')
    expect(raw).toContain('Bash: true')
    expect(raw).toContain('# plan')
  })

  test('readAsset round-trips body and front-matter metadata', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
      tools: { Bash: true },
    })
    const result = await adapter.readAsset('project', 'skill', 'viper-plans/planning')
    expect(result.content.trim()).toBe('# plan')
    expect(result.metadata).toEqual({
      name: 'planning',
      description: 'plan things',
      tools: { Bash: true },
    })
  })

  test('deleteAsset removes the asset file', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
    })
    await adapter.deleteAsset('project', 'skill', 'viper-plans/planning')
    const filePath = join(workDir, '.claude/skills/viper-plans/planning/SKILL.md')
    expect(existsSync(filePath)).toBe(false)
  })

  test('deleteAsset is a no-op when asset is absent', async () => {
    await expect(adapter.deleteAsset('project', 'skill', 'never-installed')).resolves.toBeString()
  })

  test('installAsset overwrites unconditionally (idempotent by contract)', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', 'v1', {})
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', 'v2', {})
    const path = join(workDir, '.claude/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('v2')
  })
})

describe('claude-code adapter — user-scope base dir', () => {
  const originalHome = process.env.HOME
  let fakeHome: string

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'claude-code-home-'))
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('user scope writes under ~/.claude', async () => {
    await adapter.installAsset('user', 'skill', 'viper-plans/planning', '# plan', {})
    const path = join(fakeHome, '.claude/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('# plan')
  })
})

describe('claude-code adapter — unsupported scope', () => {
  test('system scope throws', async () => {
    await expect(adapter.installAsset('system', 'skill', 'x', 'y', {})).rejects.toThrow(/system scope/)
  })
})
