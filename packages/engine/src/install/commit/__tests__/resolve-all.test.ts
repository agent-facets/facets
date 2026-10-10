import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeMcpServerFingerprint,
  type McpServerFingerprint,
  parseLockfileDocument,
  type SupportedLockfile,
} from '@agent-facets/protocol'
import { cachePath } from '../../../cache/index.ts'
import type { RunInstallFailure, StageEvent } from '../../types.ts'
import { type ResolvedFacetRecord, resolveAll } from '../resolve-all.ts'

/**
 * `resolveAll` reconciles a `0.4` server inventory for git sources on both
 * acquisition paths: a verified warm cache slot and a cold clone.
 *
 * Nothing on the resolution path is stubbed. The manifest names an ordinary
 * `https://…/*.git` source — a `file:` specifier would parse as a LOCAL
 * source and test the wrong resolver — and git's own `insteadOf` rewriting,
 * supplied through environment configuration, points it at a local
 * repository so the clone runs offline.
 */

const FACET = 'gitfacet'
const VERSION = '1.0.0'
const URL = 'https://git.example.test/team/gitfacet.git'
const STDIO = { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'] } as const
const WRONG: McpServerFingerprint = `sha256:${'9'.repeat(64)}`

let repo: string
let projectRoot: string
let facetDir: string
const savedEnv: Record<string, string | undefined> = {}
const GIT_ENV = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'FACET_DIR'] as const

function git(args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: repo, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`test setup: git ${args.join(' ')} failed: ${result.stderr.toString()}`)
}

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-all-git-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({
      name: FACET,
      version: VERSION,
      skills: { planning: { description: 'planning skill' } },
      servers: { filesystem: STDIO },
    }),
  )
  mkdirSync(join(repo, 'skills/planning'), { recursive: true })
  writeFileSync(join(repo, 'skills/planning/SKILL.md'), '# planning\n')
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  git(['add', '.'])
  git(['commit', '-q', '-m', 'initial'])
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

beforeEach(() => {
  for (const key of GIT_ENV) savedEnv[key] = process.env[key]
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.GIT_CONFIG_KEY_0 = `url.file://${repo}.insteadOf`
  process.env.GIT_CONFIG_VALUE_0 = URL
  facetDir = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-all-facetdir-')))
  process.env.FACET_DIR = facetDir
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-all-project-')))
})

afterEach(() => {
  for (const key of GIT_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  rmSync(facetDir, { recursive: true, force: true })
  rmSync(projectRoot, { recursive: true, force: true })
})

function parse(document: unknown): SupportedLockfile {
  const result = parseLockfileDocument(JSON.stringify(document))
  if (!result.ok) expect.unreachable()
  return result.data.lockfile
}

async function resolve(previousLockfile: SupportedLockfile, stages: StageEvent[] = []) {
  return resolveAll({
    desiredFacets: { [FACET]: { source: URL, overrides: undefined } },
    intents: {},
    previousLockfile,
    projectRoot,
    adapters: [],
    frozenLockfile: false,
    onStage: (event) => stages.push(event),
    onLog: () => {},
  })
}

/** A fresh add, which clones, verifies, and fills the cache slot. */
async function firstResolution(): Promise<ResolvedFacetRecord> {
  const result = await resolve(parse({ lockfileVersion: 0.3, facets: {} }))
  if (!result.ok) expect.unreachable(`test setup: fresh resolution failed with ${result.failure.code}`)
  const [record] = result.value.resolved
  if (record === undefined) expect.unreachable()
  return record
}

/** An explicit `0.4` lockfile pinning the resolved facet, with the given inventory. */
function lock04(record: ResolvedFacetRecord, fingerprint: string): SupportedLockfile {
  return parse({
    lockfileVersion: 0.4,
    facets: {
      [FACET]: {
        source: record.source,
        version: record.version,
        integrity: record.integrity,
        assets: record.plan.assets.map((asset) => ({ ...asset, materialization: { kind: 'authored' } })),
        servers: [{ name: 'filesystem', fingerprint, materialization: { kind: 'authored' } }],
      },
    },
  })
}

const slot = () => cachePath({ kind: 'git', name: FACET, version: VERSION })

describe('resolveAll — git server-inventory reconciliation', () => {
  test('the source really is git, resolved offline through the rewrite', async () => {
    const record = await firstResolution()
    expect(record.source.kind).toBe('git')
    expect(record.servers.map((server) => server.name)).toEqual(['filesystem'])
  })

  test('a warm slot and a cold clone report the same mismatch', async () => {
    const record = await firstResolution()
    const tampered = lock04(record, WRONG)
    const expected: Extract<RunInstallFailure, { code: 'RECONCILE_SERVER_FINGERPRINT' }> = {
      code: 'RECONCILE_SERVER_FINGERPRINT',
      facet: FACET,
      authoredName: 'filesystem',
      expected: WRONG,
      actual: computeMcpServerFingerprint(STDIO),
    }

    expect(existsSync(slot())).toBe(true)
    const stages: StageEvent[] = []
    const warm = await resolve(tampered, stages)
    if (warm.ok) expect.unreachable()
    expect(warm.failure).toEqual(expected)
    expect(stages).toContainEqual({ kind: 'facet-failure', facet: FACET, failure: expected })

    rmSync(slot(), { recursive: true, force: true })
    expect(existsSync(slot())).toBe(false)
    const cold = await resolve(tampered)
    if (cold.ok) expect.unreachable()
    expect(cold.failure).toEqual(expected)
    // The cold path really cloned and re-verified: the slot is back.
    expect(existsSync(slot())).toBe(true)
  })

  test('a matching inventory resolves on both paths', async () => {
    const record = await firstResolution()
    const matching = lock04(record, computeMcpServerFingerprint(STDIO))

    expect((await resolve(matching)).ok).toBe(true)
    rmSync(slot(), { recursive: true, force: true })
    expect((await resolve(matching)).ok).toBe(true)
  })
})
