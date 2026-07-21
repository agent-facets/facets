import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
import adapter from '../index.ts'

describe('opencode adapter — identity', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('opencode')
  })

  test('declares install support', () => {
    expect(adapter.supportsInstall).toBe(true)
  })

  test('declares the canonical adapter API version', () => {
    expect(adapter.apiVersion).toBe(ADAPTER_API_VERSION)
  })
})

describe('opencode adapter — buildAssetMetadata', () => {
  test('accepts valid metadata', () => {
    const result = adapter.buildAssetMetadata({ tools: { grep: true, bash: false }, model: 'gpt-4' })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({ tools: { grep: true, bash: false }, model: 'gpt-4' })
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

  test('accepts command frontmatter: agent + subtask', () => {
    const result = adapter.buildAssetMetadata({ agent: 'opencode-adversary', subtask: true })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({ agent: 'opencode-adversary', subtask: true })
  })

  test('accepts agent frontmatter: mode subagent', () => {
    const result = adapter.buildAssetMetadata({ mode: 'subagent' })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({ mode: 'subagent' })
  })

  test('accepts scoped permission block (string shorthand + nested glob object)', () => {
    const result = adapter.buildAssetMetadata({
      permission: { edit: { '*': 'deny', 'openspec/changes/*/adversarial/**': 'allow' }, bash: 'ask' },
    })
    expect(result.ok).toBe(true)
  })

  test('rejects invalid mode', () => {
    const result = adapter.buildAssetMetadata({ mode: 'nonsense' })
    expect(result.ok).toBe(false)
  })

  test('rejects non-boolean subtask', () => {
    const result = adapter.buildAssetMetadata({ subtask: 'yes' })
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
    const result = await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: {},
      companions: {},
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.opencode/skills/planning/SKILL.md'), 'utf8')).toBe('# plan')
  })

  test('skill installs companions below the skill root', async () => {
    const result = await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: {},
      companions: { 'scripts/run.ts': new TextEncoder().encode('console.log(1)') },
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.opencode/skills/planning/scripts/run.ts'), 'utf8')).toBe('console.log(1)')
  })

  test('agent installs at .opencode/agents/<name>.md', async () => {
    const result = await adapter.installAsset({
      assetType: 'agent',
      scope: 'project',
      name: 'reviewer',
      content: 'agent body',
      metadata: {},
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.opencode/agents/reviewer.md'), 'utf8')).toBe('agent body')
  })

  test('command installs at .opencode/commands/<name>.md', async () => {
    const result = await adapter.installAsset({
      assetType: 'command',
      scope: 'project',
      name: 'plan',
      content: 'command body',
      metadata: {},
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.opencode/commands/plan.md'), 'utf8')).toBe('command body')
  })

  test('writes YAML front-matter with name + description + adapter extras', async () => {
    await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: { name: 'planning', description: 'plan things', model: 'sonnet' },
      companions: {},
      ownedCompanionPaths: [],
    })
    const raw = readFileSync(join(workDir, '.opencode/skills/planning/SKILL.md'), 'utf8')
    expect(raw).toContain('name: planning')
    expect(raw).toContain('description: plan things')
    expect(raw).toContain('model: sonnet')
    expect(raw).toContain('# plan')
  })

  test('agent installs with mode: subagent front-matter and round-trips', async () => {
    await adapter.installAsset({
      assetType: 'agent',
      scope: 'project',
      name: 'adversary',
      content: 'agent body',
      metadata: { name: 'adversary', description: 'adversary subagent', mode: 'subagent' },
    })
    const raw = readFileSync(join(workDir, '.opencode/agents/adversary.md'), 'utf8')
    expect(raw).toContain('mode: subagent')
    expect(raw).toContain('agent body')

    const result = await adapter.readAsset({ assetType: 'agent', scope: 'project', name: 'adversary' })
    if (!result.ok) expect.unreachable()
    expect(result.asset.content.trim()).toBe('agent body')
    expect(result.asset.metadata).toEqual({ name: 'adversary', description: 'adversary subagent', mode: 'subagent' })
  })

  test('command installs with agent + subtask front-matter', async () => {
    await adapter.installAsset({
      assetType: 'command',
      scope: 'project',
      name: 'run-adversary',
      content: 'command body',
      metadata: { name: 'run-adversary', description: 'authoring half', agent: 'opencode-adversary', subtask: true },
    })
    const raw = readFileSync(join(workDir, '.opencode/commands/run-adversary.md'), 'utf8')
    expect(raw).toContain('agent: opencode-adversary')
    expect(raw).toContain('subtask: true')
    expect(raw).toContain('command body')
  })

  test('readAsset round-trips skill body, metadata, and owned companions', async () => {
    await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: { name: 'planning', description: 'plan things', model: 'sonnet' },
      companions: { 'references/api.md': new TextEncoder().encode('# api') },
      ownedCompanionPaths: [],
    })
    const result = await adapter.readAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      ownedCompanionPaths: ['references/api.md'],
    })
    if (!result.ok) expect.unreachable()
    if (result.asset.assetType !== 'skill') expect.unreachable()
    expect(result.asset.content.trim()).toBe('# plan')
    expect(result.asset.metadata).toEqual({ name: 'planning', description: 'plan things', model: 'sonnet' })
    expect(new TextDecoder().decode(result.asset.companions['references/api.md'])).toBe('# api')
  })

  test('readAsset returns not-found for a missing asset', async () => {
    const result = await adapter.readAsset({ assetType: 'command', scope: 'project', name: 'never-installed' })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('not-found')
  })

  test('deleteAsset removes the skill bundle and preserves unowned files', async () => {
    await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: {},
      companions: { 'references/api.md': new TextEncoder().encode('# api') },
      ownedCompanionPaths: [],
    })
    writeFileSync(join(workDir, '.opencode/skills/planning/notes.txt'), 'user notes')
    const result = await adapter.deleteAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      ownedCompanionPaths: ['references/api.md'],
    })
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(true)
    expect(existsSync(join(workDir, '.opencode/skills/planning/SKILL.md'))).toBe(false)
    expect(readFileSync(join(workDir, '.opencode/skills/planning/notes.txt'), 'utf8')).toBe('user notes')
  })

  test('deleteAsset is success with existed: false when asset is absent', async () => {
    const result = await adapter.deleteAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'never-installed',
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(false)
  })

  test('installAsset rejects an escaping owned path without writing anything', async () => {
    const result = await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: {},
      companions: {},
      ownedCompanionPaths: ['/etc/passwd'],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
    expect(existsSync(join(workDir, '.opencode/skills/planning/SKILL.md'))).toBe(false)
  })

  test('installAsset overwrites unconditionally (idempotent by contract)', async () => {
    const request = (content: string) =>
      ({
        assetType: 'skill',
        scope: 'project',
        name: 'planning',
        content,
        metadata: {},
        companions: {},
        ownedCompanionPaths: [],
      }) as const
    await adapter.installAsset(request('v1'))
    await adapter.installAsset(request('v2'))
    expect(readFileSync(join(workDir, '.opencode/skills/planning/SKILL.md'), 'utf8')).toBe('v2')
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
    const result = await adapter.installAsset({
      assetType: 'skill',
      scope: 'user',
      name: 'planning',
      content: '# plan',
      metadata: {},
      companions: {},
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(fakeHome, '.config/opencode/skills/planning/SKILL.md'), 'utf8')).toBe('# plan')
  })
})

describe('opencode adapter — unsupported scope', () => {
  test('system scope returns a structured unsupported-scope failure', async () => {
    const result = await adapter.installAsset({
      assetType: 'agent',
      scope: 'system',
      name: 'x',
      content: 'y',
      metadata: {},
    })
    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'unsupported-scope', scope: 'system' })
  })
})
