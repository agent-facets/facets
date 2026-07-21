import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
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

  test('declares the canonical adapter API version', () => {
    expect(adapter.apiVersion).toBe(ADAPTER_API_VERSION)
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

  function skillInstall(content: string, metadata: unknown = {}, companions: Record<string, Uint8Array> = {}) {
    return adapter.installAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      content,
      metadata,
      companions,
      ownedCompanionPaths: [],
    })
  }

  test('skill installs at .agents/skills/<name>/SKILL.md', async () => {
    const result = await skillInstall('# plan')
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.agents/skills/planning/SKILL.md'), 'utf8')).toBe('# plan')
  })

  test('skill installs companions below the skill root', async () => {
    const result = await skillInstall('# plan', {}, { 'references/api.md': new TextEncoder().encode('# api') })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.agents/skills/planning/references/api.md'), 'utf8')).toBe('# api')
  })

  test('skill writes YAML front-matter with name + description', async () => {
    await skillInstall('# plan', { name: 'planning', description: 'plan things' })
    const raw = readFileSync(join(workDir, '.agents/skills/planning/SKILL.md'), 'utf8')
    expect(raw).toContain('name: planning')
    expect(raw).toContain('description: plan things')
    expect(raw).toContain('# plan')
  })

  test('readAsset round-trips skill body and front-matter metadata', async () => {
    await skillInstall('# plan', { name: 'planning', description: 'plan things' })
    const result = await adapter.readAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    expect(result.asset.content.trim()).toBe('# plan')
    expect(result.asset.metadata).toEqual({ name: 'planning', description: 'plan things' })
  })

  test('deleteAsset removes the skill bundle and prunes the emptied directory', async () => {
    await skillInstall('# plan', {}, { 'references/api.md': new TextEncoder().encode('# api') })
    const result = await adapter.deleteAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      ownedCompanionPaths: ['references/api.md'],
    })
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(true)
    expect(existsSync(join(workDir, '.agents/skills/planning'))).toBe(false)
  })

  test('deleteAsset preserves unowned files in the skill directory', async () => {
    await skillInstall('# plan')
    writeFileSync(join(workDir, '.agents/skills/planning/notes.txt'), 'user notes')
    const result = await adapter.deleteAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'planning',
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.agents/skills/planning/notes.txt'), 'utf8')).toBe('user notes')
  })

  test('deleteAsset is success with existed: false when skill is absent', async () => {
    const result = await adapter.deleteAsset({
      assetType: 'skill',
      scope: 'project',
      name: 'never-installed',
      ownedCompanionPaths: [],
    })
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(false)
  })

  test('installAsset overwrites skill unconditionally (idempotent)', async () => {
    await skillInstall('v1')
    await skillInstall('v2')
    expect(readFileSync(join(workDir, '.agents/skills/planning/SKILL.md'), 'utf8')).toBe('v2')
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

  function agentInstall(name: string, content: string, metadata: unknown = {}) {
    return adapter.installAsset({ assetType: 'agent', scope: 'project', name, content, metadata })
  }

  test('agent installs at .codex/agents/<name>.toml', async () => {
    const result = await agentInstall('reviewer', 'You are a reviewer.', {
      name: 'reviewer',
      description: 'Code review specialist',
    })
    if (!result.ok) expect.unreachable()
    expect(existsSync(join(workDir, '.codex/agents/reviewer.toml'))).toBe(true)
  })

  test('agent TOML file contains developer_instructions from content', async () => {
    await agentInstall('reviewer', 'You are a reviewer.', {
      name: 'reviewer',
      description: 'Code review specialist',
    })
    const raw = readFileSync(join(workDir, '.codex/agents/reviewer.toml'), 'utf8')
    expect(raw).toContain('developer_instructions')
    expect(raw).toContain('You are a reviewer.')
    expect(raw).toContain('name = "reviewer"')
    expect(raw).toContain('description = "Code review specialist"')
  })

  test('readAsset round-trips agent developer_instructions as canonical content', async () => {
    await agentInstall('reviewer', 'You are a reviewer.', {
      name: 'reviewer',
      description: 'Code review specialist',
    })
    const result = await adapter.readAsset({ assetType: 'agent', scope: 'project', name: 'reviewer' })
    if (!result.ok) expect.unreachable()
    expect(result.asset.content).toBe('You are a reviewer.')
    expect(result.asset.metadata).toEqual({ name: 'reviewer', description: 'Code review specialist' })
  })

  test('deleteAsset removes agent TOML file', async () => {
    await agentInstall('reviewer', 'instructions')
    const result = await adapter.deleteAsset({ assetType: 'agent', scope: 'project', name: 'reviewer' })
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(true)
    expect(existsSync(join(workDir, '.codex/agents/reviewer.toml'))).toBe(false)
  })

  test('deleteAsset is success with existed: false when agent is absent', async () => {
    const result = await adapter.deleteAsset({ assetType: 'agent', scope: 'project', name: 'never-installed' })
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(false)
    expect(result.deletedPaths).toEqual([])
  })

  test('installAsset overwrites agent unconditionally (idempotent)', async () => {
    await agentInstall('reviewer', 'v1 instructions')
    await agentInstall('reviewer', 'v2 instructions')
    const result = await adapter.readAsset({ assetType: 'agent', scope: 'project', name: 'reviewer' })
    if (!result.ok) expect.unreachable()
    expect(result.asset.content).toBe('v2 instructions')
  })

  test('readAsset returns not-found when the agent TOML file is absent', async () => {
    const result = await adapter.readAsset({ assetType: 'agent', scope: 'project', name: 'never-installed' })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('not-found')
  })

  test('readAsset returns io-failed for malformed TOML', async () => {
    await agentInstall('reviewer', 'instructions')
    writeFileSync(join(workDir, '.codex/agents/reviewer.toml'), 'not = [valid toml')
    const result = await adapter.readAsset({ assetType: 'agent', scope: 'project', name: 'reviewer' })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('io-failed')
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
    const result = await adapter.installAsset({
      assetType: 'command',
      scope: 'project',
      name: 'plan',
      content: 'command body',
      metadata: {},
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(workDir, '.agents/commands/plan.md'), 'utf8')).toBe('command body')
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
    expect(readFileSync(join(fakeHome, '.agents/skills/planning/SKILL.md'), 'utf8')).toBe('# plan')
  })

  test('user-scope agent writes under ~/.codex/agents', async () => {
    const result = await adapter.installAsset({
      assetType: 'agent',
      scope: 'user',
      name: 'reviewer',
      content: 'instructions',
      metadata: { name: 'reviewer' },
    })
    if (!result.ok) expect.unreachable()
    expect(existsSync(join(fakeHome, '.codex/agents/reviewer.toml'))).toBe(true)
  })

  test('user-scope command writes under ~/.agents/commands', async () => {
    const result = await adapter.installAsset({
      assetType: 'command',
      scope: 'user',
      name: 'plan',
      content: 'command body',
      metadata: {},
    })
    if (!result.ok) expect.unreachable()
    expect(readFileSync(join(fakeHome, '.agents/commands/plan.md'), 'utf8')).toBe('command body')
  })
})

// ---------------------------------------------------------------------------
// Unsupported scope
// ---------------------------------------------------------------------------

describe('codex adapter — unsupported scope', () => {
  test('system scope returns a structured unsupported-scope failure', async () => {
    const result = await adapter.installAsset({
      assetType: 'skill',
      scope: 'system',
      name: 'x',
      content: 'y',
      metadata: {},
      companions: {},
      ownedCompanionPaths: [],
    })
    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'unsupported-scope', scope: 'system' })
  })
})
