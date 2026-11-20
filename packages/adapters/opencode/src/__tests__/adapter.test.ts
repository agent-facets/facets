import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ADAPTER_API_VERSION, type AssetCapability, type PlanningContext } from '@agent-facets/adapter'
import { commitPlannedAction } from '@agent-facets/adapter-test-kit'
import definition from '../index.ts'

/** The adapter the package default-exports, once its definition result is checked. */
const adapter = (() => {
  if (!definition.ok) throw new Error('the adapter definition must be valid')
  return definition.data
})()

/**
 * The adapter plans; it never writes. Every test here commits the plan itself,
 * which is also how the engine works — and is what makes "planning changed
 * nothing" checkable rather than assumed.
 */

let projectRoot: string
let home: string
let originalHome: string | undefined
let originalXdg: string | undefined

beforeEach(() => {
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-project-')))
  home = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-home-')))
  originalHome = process.env.HOME
  originalXdg = process.env.XDG_CONFIG_HOME
  process.env.HOME = home
  delete process.env.XDG_CONFIG_HOME
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalXdg
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const assets: AssetCapability = (() => {
  const capability = adapter.assets
  if (capability === false) throw new Error('opencode must declare an asset capability')
  return capability
})()

async function install(request: Parameters<typeof assets.planInstall>[0]): Promise<string> {
  const result = await assets.planInstall(request)
  if (!result.ok) expect.unreachable()
  commitPlannedAction(result.plan.action)
  return result.plan.primaryPath
}

/** A project planning context, with a home that must never be consulted for project placement. */
function projectContext(projectRoot: string): PlanningContext {
  return {
    target: { scope: 'project', projectRoot },
    homeDirectory: '/home/unused',
    environment: {},
  }
}

const read = (path: string): string => readFileSync(path, 'utf8')
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('adapter identity', () => {
  test('declares the canonical adapter SDK API', () => {
    expect(adapter.name).toBe('opencode')
    expect(adapter.apiVersion).toBe(ADAPTER_API_VERSION)
  })
})

describe('project layout', () => {
  test('resolves project scope from the request, not the process directory', async () => {
    const primaryPath = await install({
      assetType: 'agent',
      context: projectContext(projectRoot),
      name: 'reviewer',
      content: '# reviewer\n',
      metadata: {},
    })

    expect(primaryPath).toBe(join(projectRoot, '.opencode', 'agents', 'reviewer.md'))
    expect(existsSync(join(process.cwd(), '.opencode'))).toBe(false)
  })

  test('places a command under the project tree', async () => {
    const primaryPath = await install({
      assetType: 'command',
      context: projectContext(projectRoot),
      name: 'review-pr',
      content: '# review\n',
      metadata: {},
    })
    expect(primaryPath).toBe(join(projectRoot, '.opencode', 'commands', 'review-pr.md'))
  })

  test('places a skill bundle under the project tree', async () => {
    const primaryPath = await install({
      assetType: 'skill',
      context: projectContext(projectRoot),
      name: 'planning',
      content: '# planning\n',
      metadata: {},
      companions: { 'references/api.md': encode('api\n') },
      ownedCompanionPaths: [],
    })

    expect(primaryPath).toBe(join(projectRoot, '.opencode', 'skills', 'planning', 'SKILL.md'))
    expect(read(join(projectRoot, '.opencode', 'skills', 'planning', 'references', 'api.md'))).toBe('api\n')
  })

  test('user scope is refused until its native layout is established', async () => {
    // User placement needs the tool's own override rules and verified native
    // layout; until those exist this adapter declares project scope only, and
    // the SDK refuses a user request before the planner runs or anything is read.
    const result = await assets.planInstall({
      assetType: 'agent',
      context: { target: { scope: 'user' }, homeDirectory: home, environment: {} },
      name: 'reviewer',
      content: '# reviewer\n',
      metadata: {},
    })

    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'unsupported-scope', scope: 'user', supportedScopes: ['project'] })
    expect(assets.supportedScopes).toEqual(['project'])
  })

  test('system scope is refused with a structured failure', async () => {
    const result = await assets.planInstall({
      assetType: 'agent',
      // biome-ignore lint/suspicious/noExplicitAny: system scope is unrepresentable in the type, as intended
      context: { target: { scope: 'system' }, homeDirectory: home, environment: {} } as any,
      name: 'reviewer',
      content: '',
      metadata: {},
    })

    if (result.ok) expect.unreachable()
    expect(result.failure).toEqual({ code: 'unsupported-scope', scope: 'system', supportedScopes: ['project'] })
  })
})

describe('planning', () => {
  test('metadata is rendered as YAML front matter', async () => {
    const primaryPath = await install({
      assetType: 'agent',
      context: projectContext(projectRoot),
      name: 'reviewer',
      content: '# body\n',
      metadata: { name: 'reviewer', tools: { grep: true } },
    })

    const written = read(primaryPath)
    expect(written.startsWith('---\n')).toBe(true)
    expect(written).toContain('name: reviewer')
    expect(written.endsWith('---\n# body\n')).toBe(true)
  })

  test('re-planning an unchanged asset produces no mutation at all', async () => {
    const request = {
      assetType: 'agent',
      context: projectContext(projectRoot),
      name: 'reviewer',
      content: '# body\n',
      metadata: { name: 'reviewer' },
    } as const

    await install(request)
    const second = await assets.planInstall(request)

    if (!second.ok) expect.unreachable()
    expect(second.plan.occupancy).toBe('equivalent')
    expect(second.plan.action.kind).toBe('unchanged')
  })

  test('an occupied destination is reported as divergent with its exact prior bytes', async () => {
    const file = join(projectRoot, '.opencode', 'agents', 'reviewer.md')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'hand written\n')

    const result = await assets.planInstall({
      assetType: 'agent',
      context: projectContext(projectRoot),
      name: 'reviewer',
      content: '# body\n',
      metadata: {},
    })

    if (!result.ok) expect.unreachable()
    expect(result.plan.occupancy).toBe('divergent')
    if (result.plan.action.kind !== 'mutate') expect.unreachable()
    const [mutation] = result.plan.action.mutations
    if (mutation.expected.kind !== 'regular-file') expect.unreachable()
    expect(new TextDecoder().decode(mutation.expected.contents)).toBe('hand written\n')
  })

  test('planning writes nothing', async () => {
    await assets.planInstall({
      assetType: 'skill',
      context: projectContext(projectRoot),
      name: 'planning',
      content: '# planning\n',
      metadata: {},
      companions: {},
      ownedCompanionPaths: [],
    })

    expect(existsSync(join(projectRoot, '.opencode'))).toBe(false)
  })
})

describe('removal', () => {
  test('removes a skill primary and exactly the owned companions', async () => {
    await install({
      assetType: 'skill',
      context: projectContext(projectRoot),
      name: 'planning',
      content: '# planning\n',
      metadata: {},
      companions: { 'notes.md': encode('notes\n') },
      ownedCompanionPaths: [],
    })
    const root = join(projectRoot, '.opencode', 'skills', 'planning')
    writeFileSync(join(root, 'mine.md'), 'not ours\n')

    const result = await assets.planRemoval({
      assetType: 'skill',
      context: projectContext(projectRoot),
      name: 'planning',
      ownedCompanionPaths: ['notes.md'],
    })

    if (!result.ok) expect.unreachable()
    if (result.plan.kind !== 'remove') expect.unreachable()
    commitPlannedAction(result.plan.action)

    expect(existsSync(join(root, 'SKILL.md'))).toBe(false)
    expect(existsSync(join(root, 'notes.md'))).toBe(false)
    expect(read(join(root, 'mine.md'))).toBe('not ours\n')
  })

  test('removing an absent asset is reported as absence, not failure', async () => {
    const result = await assets.planRemoval({
      assetType: 'command',
      context: projectContext(projectRoot),
      name: 'never-installed',
    })

    if (!result.ok) expect.unreachable()
    expect(result.plan.kind).toBe('absent')
  })
})
