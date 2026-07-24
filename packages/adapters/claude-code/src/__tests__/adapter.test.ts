import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
import adapter from '../index.ts'

describe('claude-code adapter — identity', () => {
  test('has correct name', () => {
    expect(adapter.name).toBe('claude-code')
  })

  test('declares install support', () => {
    expect(adapter.supportsInstall).toBe(true)
  })

  test('declares the canonical adapter API version', () => {
    expect(adapter.apiVersion).toBe(ADAPTER_API_VERSION)
  })
})

describe('claude-code adapter — buildAssetMetadata', () => {
  test('accepts valid metadata', () => {
    const result = adapter.buildAssetMetadata({
      tools: { Bash: true, Read: false },
      permissions: { allow: true },
    })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual({
      tools: { Bash: true, Read: false },
      permissions: { allow: true },
    })
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
    const path = join(workDir, '.claude/skills/planning/SKILL.md')
    // macOS tmpdir may resolve through /private — compare the suffix
    expect(result.primaryPath.endsWith('.claude/skills/planning/SKILL.md')).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('# plan')
  })

  test('skill installs companions below the skill root with verbatim bytes', async () => {
    const result = await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: {},
      companions: { 'references/api.md': new TextEncoder().encode('# api') },
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    const companion = join(workDir, '.claude/skills/planning/references/api.md')
    expect(readFileSync(companion, 'utf8')).toBe('# api')
  })

  test('agent installs at .claude/agents/<name>.md', async () => {
    const result = await adapter.installAsset({
      assetType: 'agent',
      scope: 'project',
      name: 'reviewer',
      content: 'agent body',
      metadata: {},
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.claude/agents/reviewer.md'), 'utf8')).toBe('agent body')
  })

  test('command installs at .claude/commands/<name>.md', async () => {
    const result = await adapter.installAsset({
      assetType: 'command',
      scope: 'project',
      name: 'plan',
      content: 'command body',
      metadata: {},
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.claude/commands/plan.md'), 'utf8')).toBe('command body')
  })

  test('writes YAML front-matter with name + description + adapter extras on the primary only', async () => {
    await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: { name: 'planning', description: 'plan things', tools: { Bash: true } },
      companions: { 'notes.md': new TextEncoder().encode('companion body') },
      ownedCompanionPaths: [],
    })
    const raw = readFileSync(join(workDir, '.claude/skills/planning/SKILL.md'), 'utf8')
    expect(raw).toContain('name: planning')
    expect(raw).toContain('description: plan things')
    expect(raw).toContain('Bash: true')
    expect(raw).toContain('# plan')
    // Companion bytes are verbatim — no front-matter injected
    expect(readFileSync(join(workDir, '.claude/skills/planning/notes.md'), 'utf8')).toBe('companion body')
  })

  test('readAsset round-trips body, metadata, and requested owned companions', async () => {
    await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: { name: 'planning', description: 'plan things' },
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
    expect(result.asset.metadata).toEqual({ name: 'planning', description: 'plan things' })
    expect(new TextDecoder().decode(result.asset.companions['references/api.md'])).toBe('# api')
  })

  test('readAsset never sweeps unowned files into the result', async () => {
    await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: {},
      companions: {},
      ownedCompanionPaths: [],
    })
    writeFileSync(join(workDir, '.claude/skills/planning/notes.txt'), 'user notes')
    const result = await adapter.readAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    if (result.asset.assetType !== 'skill') expect.unreachable()
    expect(result.asset.companions).toEqual({})
  })

  test('readAsset returns not-found for a missing asset', async () => {
    const result = await adapter.readAsset({ assetType: 'agent', scope: 'project', name: 'never-installed' })
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
    writeFileSync(join(workDir, '.claude/skills/planning/notes.txt'), 'user notes')
    const result = await adapter.deleteAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      ownedCompanionPaths: ['references/api.md'],
    })
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(true)
    expect(existsSync(join(workDir, '.claude/skills/planning/SKILL.md'))).toBe(false)
    expect(existsSync(join(workDir, '.claude/skills/planning/references'))).toBe(false)
    expect(readFileSync(join(workDir, '.claude/skills/planning/notes.txt'), 'utf8')).toBe('user notes')
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

  test('installAsset rejects an escaping companion path without writing anything', async () => {
    const result = await adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content: '# plan',
      metadata: {},
      companions: { '../../escape.md': new TextEncoder().encode('x') },
      ownedCompanionPaths: [],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
    expect(existsSync(join(workDir, '.claude/skills/planning/SKILL.md'))).toBe(false)
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
    expect(readFileSync(join(workDir, '.claude/skills/planning/SKILL.md'), 'utf8')).toBe('v2')
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
    expect(readFileSync(join(fakeHome, '.claude/skills/planning/SKILL.md'), 'utf8')).toBe('# plan')
  })
})

describe('claude-code adapter — unsupported scope', () => {
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
