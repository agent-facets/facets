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
// normalizeForCompare — install→read round-trip identity (TASK-192)
// ---------------------------------------------------------------------------

describe('codex adapter — normalizeForCompare', () => {
  let originalCwd: string
  let workDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    workDir = mkdtempSync(join(tmpdir(), 'codex-normalize-test-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('agent prompt containing YAML front-matter normalizes equal to the real round-trip', async () => {
    // TASK-192 regression: an agent prompt that *contains* a `---` block
    // must round-trip verbatim through the TOML serialization. The install
    // pipeline compares normalizeForCompare(candidate) against readAsset;
    // if they differ, every `facet install` re-writes ("repairs") the agent.
    const prompt = '---\nrole: reviewer\n---\nYou are an expert reviewer.\n'
    const metadata = { name: 'reviewer', description: 'Code review specialist' }

    await adapter.installAsset('project', 'agent', 'reviewer', prompt, metadata)
    const onDisk = await adapter.readAsset('project', 'agent', 'reviewer')

    if (!adapter.normalizeForCompare) expect.unreachable()
    const candidate = adapter.normalizeForCompare('agent', prompt, metadata)

    expect(onDisk.content).toBe(candidate.content)
    expect(onDisk.metadata ?? {}).toEqual(candidate.metadata)
  })

  test('whitespace-only agent content normalizes to the empty string readAsset yields', async () => {
    // installAgentToml omits developer_instructions for whitespace-only
    // content; readAgentToml then returns ''. The normalization must mirror
    // that edge or blank-prompt agents would repair forever.
    const metadata = { name: 'blank' }
    await adapter.installAsset('project', 'agent', 'blank', '   \n', metadata)
    const onDisk = await adapter.readAsset('project', 'agent', 'blank')

    if (!adapter.normalizeForCompare) expect.unreachable()
    const candidate = adapter.normalizeForCompare('agent', '   \n', metadata)

    expect(onDisk.content).toBe(candidate.content)
    expect(candidate.content).toBe('')
  })

  test('skill normalization matches the standard YAML front-matter round-trip', async () => {
    const body = '---\nauthor-key: kept\n---\n# skill body\n'
    const metadata = { name: 'planning', description: 'plan things' }

    await adapter.installAsset('project', 'skill', 'planning', body, metadata)
    const onDisk = await adapter.readAsset('project', 'skill', 'planning')

    if (!adapter.normalizeForCompare) expect.unreachable()
    const candidate = adapter.normalizeForCompare('skill', body, metadata)

    expect(onDisk.content).toBe(candidate.content)
    expect(onDisk.metadata ?? {}).toEqual(candidate.metadata)
  })
})

// ---------------------------------------------------------------------------
// Project-scope I/O — commands (installed as skills + openai.yaml sidecar)
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

  test('command installs as a skill at .agents/skills/<name>/SKILL.md', async () => {
    await adapter.installAsset('project', 'command', 'viper-plans/plan', 'command body', {})
    const path = join(workDir, '.agents/skills/viper-plans/plan/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('command body')
    // The legacy .agents/commands/ path must no longer be written.
    expect(existsSync(join(workDir, '.agents/commands/viper-plans/plan.md'))).toBe(false)
  })

  test('command writes SKILL.md front-matter with name + description only', async () => {
    await adapter.installAsset('project', 'command', 'plan', '# body', {
      name: 'plan',
      description: 'plan things',
    })
    const raw = readFileSync(join(workDir, '.agents/skills/plan/SKILL.md'), 'utf8')
    expect(raw).toContain('name: plan')
    expect(raw).toContain('description: plan things')
    expect(raw).toContain('# body')
    // openai.yaml-only keys never leak into SKILL.md front-matter.
    expect(raw).not.toContain('allow_implicit_invocation')
    expect(raw).not.toContain('interface')
  })

  test('command writes agents/openai.yaml disabling implicit invocation', async () => {
    await adapter.installAsset('project', 'command', 'plan', '# body', {
      name: 'plan',
      description: 'plan things',
    })
    const yamlPath = join(workDir, '.agents/skills/plan/agents/openai.yaml')
    const yaml = readFileSync(yamlPath, 'utf8')
    expect(yaml).toContain('allow_implicit_invocation: false')
    expect(yaml).toContain('display_name: plan')
    expect(yaml).toContain('short_description: plan things')
  })

  test('command passes through author interface + dependencies blocks', async () => {
    await adapter.installAsset('project', 'command', 'plan', '# body', {
      name: 'plan',
      description: 'auto desc',
      interface: {
        display_name: 'Planner',
        icon_small: './assets/small.svg',
        brand_color: '#3B82F6',
      },
      dependencies: {
        tools: [{ type: 'mcp', value: 'docs', url: 'https://example.com/mcp' }],
      },
    })
    const yaml = readFileSync(join(workDir, '.agents/skills/plan/agents/openai.yaml'), 'utf8')
    // Author-provided display_name wins over the auto fallback.
    expect(yaml).toContain('display_name: Planner')
    // Auto short_description still fills the gap the author left.
    expect(yaml).toContain('short_description: auto desc')
    expect(yaml).toContain('icon_small: ./assets/small.svg')
    expect(yaml).toContain('brand_color: "#3B82F6"')
    expect(yaml).toContain('value: docs')
    expect(yaml).toContain('allow_implicit_invocation: false')
  })

  test('command cannot re-enable implicit invocation via author policy', async () => {
    await adapter.installAsset('project', 'command', 'plan', '# body', {
      name: 'plan',
      policy: { allow_implicit_invocation: true },
    })
    const yaml = readFileSync(join(workDir, '.agents/skills/plan/agents/openai.yaml'), 'utf8')
    expect(yaml).toContain('allow_implicit_invocation: false')
    expect(yaml).not.toContain('allow_implicit_invocation: true')
  })

  test('readAsset round-trips a command body from its SKILL.md', async () => {
    await adapter.installAsset('project', 'command', 'plan', '# body', {
      name: 'plan',
      description: 'plan things',
    })
    const result = await adapter.readAsset('project', 'command', 'plan')
    expect(result.content.trim()).toBe('# body')
    expect(result.metadata).toEqual({ name: 'plan', description: 'plan things' })
  })

  test('command with sidecar-routed metadata normalizes equal to its round-trip (idempotency)', async () => {
    // TASK-192/193 coupling guard: `interface`/`policy`/`dependencies` are
    // stripped into the sidecar, so they're absent from readAsset's view.
    // normalizeForCompare must strip them from the candidate too, or every
    // re-install reports "repaired".
    const metadata = {
      name: 'plan',
      description: 'plan things',
      interface: { display_name: 'Planner' },
      policy: { allow_implicit_invocation: true },
      dependencies: { tools: [] },
    }
    await adapter.installAsset('project', 'command', 'plan', '# body', metadata)
    const onDisk = await adapter.readAsset('project', 'command', 'plan')

    if (!adapter.normalizeForCompare) expect.unreachable()
    const candidate = adapter.normalizeForCompare('command', '# body', metadata)

    expect(onDisk.content).toBe(candidate.content)
    expect(onDisk.metadata ?? {}).toEqual(candidate.metadata)
  })

  test('deleteAsset removes the command SKILL.md, sidecar, and empty dir', async () => {
    await adapter.installAsset('project', 'command', 'plan', '# body', { name: 'plan' })
    await adapter.deleteAsset('project', 'command', 'plan')
    expect(existsSync(join(workDir, '.agents/skills/plan/SKILL.md'))).toBe(false)
    expect(existsSync(join(workDir, '.agents/skills/plan/agents/openai.yaml'))).toBe(false)
    expect(existsSync(join(workDir, '.agents/skills/plan'))).toBe(false)
  })

  test('deleteAsset is a no-op when command is absent', async () => {
    await expect(adapter.deleteAsset('project', 'command', 'never-installed')).resolves.toBeUndefined()
  })

  test('deleting a command does not recurse into a namespaced sibling skill', async () => {
    // Command "space" lives at .agents/skills/space/; skill "space/spec" lives at
    // .agents/skills/space/spec/ — i.e. inside the command's directory. Deleting
    // the command must NOT remove the sibling skill via a recursive dir delete.
    await adapter.installAsset('project', 'command', 'space', '# cmd', { name: 'space' })
    await adapter.installAsset('project', 'skill', 'space/spec', '# skill', { name: 'spec' })

    await adapter.deleteAsset('project', 'command', 'space')

    // Command's own files are gone...
    expect(existsSync(join(workDir, '.agents/skills/space/SKILL.md'))).toBe(false)
    expect(existsSync(join(workDir, '.agents/skills/space/agents/openai.yaml'))).toBe(false)
    // ...but the nested skill (and the shared parent dir) survive.
    expect(readFileSync(join(workDir, '.agents/skills/space/spec/SKILL.md'), 'utf8')).toContain('# skill')
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

  test('user-scope command writes under ~/.agents/skills as a skill', async () => {
    await adapter.installAsset('user', 'command', 'plan', 'command body', {})
    const path = join(fakeHome, '.agents/skills/plan/SKILL.md')
    expect(readFileSync(path, 'utf8')).toBe('command body')
    const yaml = readFileSync(join(fakeHome, '.agents/skills/plan/agents/openai.yaml'), 'utf8')
    expect(yaml).toContain('allow_implicit_invocation: false')
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
