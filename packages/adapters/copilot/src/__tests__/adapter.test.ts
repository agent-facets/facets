import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import adapter from '../index.ts'

describe('copilot adapter — identity', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('copilot')
  })

  test('declares install support', () => {
    expect(adapter.supportsInstall).toBe(true)
  })
})

describe('copilot adapter — buildAssetMetadata', () => {
  test('accepts valid instruction metadata', () => {
    const result = adapter.buildAssetMetadata({
      applyTo: '**/*.ts,**/*.tsx',
      description: 'TypeScript standards',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        applyTo: '**/*.ts,**/*.tsx',
        description: 'TypeScript standards',
      })
    }
  })

  test('accepts valid prompt metadata', () => {
    const result = adapter.buildAssetMetadata({
      description: 'Generate a form',
      name: 'create-form',
      'argument-hint': '[form name]',
      agent: 'agent',
      model: 'GPT-4o',
      tools: ['search/codebase'],
    })
    expect(result.ok).toBe(true)
  })

  test('accepts empty metadata', () => {
    const result = adapter.buildAssetMetadata({})
    expect(result.ok).toBe(true)
  })

  test('rejects invalid applyTo', () => {
    const result = adapter.buildAssetMetadata({ applyTo: 42 })
    expect(result.ok).toBe(false)
  })

  test('rejects invalid tools', () => {
    const result = adapter.buildAssetMetadata({ tools: 'not-an-array' })
    expect(result.ok).toBe(false)
  })
})

describe('copilot adapter — project-scope I/O round-trip', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'copilot-adapter-test-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('skill installs at .github/skills/<name>/SKILL.md', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {})
    const path = join(workDir, '.github/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('# plan')
  })

  test('agent installs at .github/agents/<name>.agent.md', async () => {
    await adapter.installAsset('project', 'agent', 'viper-plans/reviewer', 'agent body', {})
    const path = join(workDir, '.github/agents/viper-plans/reviewer.agent.md')
    expect(readFileSync(path, 'utf8')).toBe('agent body')
  })

  test('command installs at .github/prompts/<name>.prompt.md', async () => {
    await adapter.installAsset('project', 'command', 'viper-plans/plan', 'command body', {})
    const path = join(workDir, '.github/prompts/viper-plans/plan.prompt.md')
    expect(readFileSync(path, 'utf8')).toBe('command body')
  })

  test('writes YAML front-matter with name + description + adapter extras', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
      applyTo: '**/*.ts',
    })
    const path = join(workDir, '.github/skills/viper-plans/planning/SKILL.md')
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('name: planning')
    expect(raw).toContain('description: plan things')
    expect(raw).toContain('applyTo:')
    expect(raw).toContain('# plan')
  })

  test('readAsset round-trips body and front-matter metadata', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
      applyTo: '**/*.ts',
    })
    const result = await adapter.readAsset('project', 'skill', 'viper-plans/planning')
    expect(result.content.trim()).toBe('# plan')
    expect(result.metadata).toEqual({
      name: 'planning',
      description: 'plan things',
      applyTo: '**/*.ts',
    })
  })

  test('deleteAsset removes the asset file', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', '# plan', {
      name: 'planning',
      description: 'plan things',
    })
    await adapter.deleteAsset('project', 'skill', 'viper-plans/planning')
    const filePath = join(workDir, '.github/skills/viper-plans/planning/SKILL.md')
    expect(existsSync(filePath)).toBe(false)
  })

  test('deleteAsset is a no-op when asset is absent', async () => {
    await expect(adapter.deleteAsset('project', 'skill', 'never-installed')).resolves.toBeString()
  })

  test('installAsset overwrites unconditionally (idempotent by contract)', async () => {
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', 'v1', {})
    await adapter.installAsset('project', 'skill', 'viper-plans/planning', 'v2', {})
    const path = join(workDir, '.github/skills/viper-plans/planning/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('v2')
  })
})

describe('copilot adapter — unsupported scopes', () => {
  test('user scope throws', async () => {
    await expect(adapter.installAsset('user', 'skill', 'x', 'y', {})).rejects.toThrow(/user scope/)
  })

  test('system scope throws', async () => {
    await expect(adapter.installAsset('system', 'skill', 'x', 'y', {})).rejects.toThrow(/system scope/)
  })
})
