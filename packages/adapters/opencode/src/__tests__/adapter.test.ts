import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import adapter from '../index.ts'

describe('opencode adapter — identity', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('opencode')
  })

  test('declares install support', () => {
    expect(adapter.supportsInstall).toBe(true)
  })
})

describe('opencode adapter — buildAssetMetadata', () => {
  test('accepts valid metadata', () => {
    const result = adapter.buildAssetMetadata({ tools: { grep: true, bash: false }, model: 'gpt-4' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ tools: { grep: true, bash: false }, model: 'gpt-4' })
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

  test('rejects invalid model', () => {
    const result = adapter.buildAssetMetadata({ model: 123 })
    expect(result.ok).toBe(false)
  })
})

describe('opencode adapter — project-scope I/O round-trip', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'opencode-adapter-test-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('skill installs at .opencode/skills/<name>/SKILL.md', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {})
    const path = join(workDir, '.opencode/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('# plan')
  })

  test('agent installs at .opencode/agents/<name>.md', async () => {
    await adapter.installAsset('project', 'agent', 'viper-plans/reviewer', 'agent body', {})
    const path = join(workDir, '.opencode/agents/viper-plans/reviewer.md')
    expect(readFileSync(path, 'utf8')).toBe('agent body')
  })

  test('command installs at .opencode/commands/<name>.md', async () => {
    await adapter.installAsset('project', 'command', 'viper-plans/plan', 'command body', {})
    const path = join(workDir, '.opencode/commands/viper-plans/plan.md')
    expect(readFileSync(path, 'utf8')).toBe('command body')
  })

  test('writes YAML front-matter with name + description + adapter extras', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
      model: 'sonnet',
    })
    const path = join(workDir, '.opencode/skills/viper-plans/planning/SKILL.md')
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('name: planning')
    expect(raw).toContain('description: plan things')
    expect(raw).toContain('model: sonnet')
    expect(raw).toContain('# plan')
  })

  test('readAsset round-trips body and front-matter metadata', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
      model: 'sonnet',
    })
    const result = await adapter.readAsset('project', 'skill', 'viper-plans/planning')
    expect(result.content.trim()).toBe('# plan')
    expect(result.metadata).toEqual({
      name: 'planning',
      description: 'plan things',
      model: 'sonnet',
    })
  })

  test('deleteAsset removes the asset file', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
    })
    await adapter.deleteAsset('project', 'skill', 'viper-plans/planning')
    const filePath = join(workDir, '.opencode/skills/viper-plans/planning/SKILL.md')
    expect(existsSync(filePath)).toBe(false)
  })

  test('deleteAsset is a no-op when asset is absent', async () => {
    await expect(adapter.deleteAsset('project', 'skill', 'never-installed')).resolves.toBeUndefined()
  })

  test('installAsset overwrites unconditionally (idempotent by contract)', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', 'v1', {})
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', 'v2', {})
    const path = join(workDir, '.opencode/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('v2')
  })
})

describe('opencode adapter — user-scope base dir', () => {
  const originalHome = process.env.HOME
  let fakeHome: string

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'opencode-home-'))
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('user scope writes under ~/.config/opencode', async () => {
    await adapter.installAsset('user', 'skill', 'viper-plans/planning', '# plan', {})
    const path = join(fakeHome, '.config/opencode/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('# plan')
  })
})

describe('opencode adapter — unsupported scope', () => {
  test('system scope throws', async () => {
    await expect(adapter.installAsset('system', 'skill', 'x', 'y', {})).rejects.toThrow(/system scope/)
  })
})
