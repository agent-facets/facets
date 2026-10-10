import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeMcpServerFingerprint, type McpServerDeclaration } from '@agent-facets/protocol'
import { spawnCli } from './helpers/cli-process.ts'
import { installFakeAdapter } from './helpers/fake-adapter.ts'
import {
  buildFacet,
  countingEndpoint,
  forgetConfigurationClaims,
  readJson,
  readLock,
  receiptFile,
  relockLegacy,
  sentinelServer,
  snapshot,
  writeManifest,
} from './helpers/mcp-project.ts'

/**
 * End-to-end coverage for MCP configuration consent, driving the compiled
 * binary with piped stdio.
 *
 * Piped stdio is the whole point: this is the path CI takes, and it is the
 * one where the rich Ink block goes to a stream nobody reads. Everything a
 * blocked user needs has to survive on stderr, and the regression mode for
 * the interactive half is a hang rather than an error.
 */

let projectRoot: string
let fakeHome: string
let adaptersDir: string

const runCli = (args: string[]) =>
  spawnCli(args, { cwd: projectRoot, env: { HOME: fakeHome, FACET_DIR: join(fakeHome, '.facet') } })

const COMMAND = 'npx'
const ARGUMENT = 'server-filesystem'
const ENV_NAME = 'TOKEN_NAME'
const ENV_VALUE = 'hunter2'

/** A facet whose only deliverable is one standard-input MCP server. */
function buildServerFixture(name: string, server: string): string {
  const repo = realpathSync(mkdtempSync(join(projectRoot, 'fixture-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({
      name,
      version: '0.1.0',
      servers: {
        [server]: { type: 'stdio', command: COMMAND, args: ['-y', ARGUMENT], env: { [ENV_NAME]: ENV_VALUE } },
      },
    }),
  )
  return `./${repo.split('/').pop()}`
}

function mcpDocumentFor(adapter: string): string {
  return join(projectRoot, `.${adapter}-mcp.json`)
}

beforeEach(() => {
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-mcp-e2e-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-mcp-home-')))
  adaptersDir = join(fakeHome, '.facet', 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('facet <command> --help', () => {
  // One definition, every command that runs the install pipeline. `rm` is
  // included because the alias is how many people invoke removal, and an
  // alias that silently lacked the flag would leave them with no
  // non-interactive way to finish. `update` is included for the same
  // reason: a newer release can bring MCP configuration with it.
  test.each(['add', 'install', 'remove', 'rm', 'update'])('%s lists --accept-mcp', async (command) => {
    const result = await runCli([command, '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--accept-mcp')
  })
})

describe('non-interactive MCP consent', () => {
  test('without the flag it fails before mutation and prints the whole declaration', async () => {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    const source = buildServerFixture('alpha', 'filesystem')

    const result = await runCli(['add', source])

    expect(result.exitCode).toBe(1)
    // The exact thing the flag would authorize. A user cannot approve
    // execution from a failure code.
    // Delimited per value: the boundaries are part of what is being approved.
    expect(result.stderr).toContain(`stdio "${COMMAND}" "-y" "${ARGUMENT}"`)
    expect(result.stderr).toContain(`env "${ENV_NAME}"="${ENV_VALUE}"`)
    expect(result.stderr).toContain('filesystem')
    expect(result.stderr).toContain('from alpha')
    // The alternative to approving, at the exact path it is written.
    expect(result.stderr).toContain('facets["alpha"].materialization.servers["filesystem"]')
    expect(result.stderr).toContain('"filesystem": { "kind": "omitted" }')
    expect(result.stderr).toContain('--accept-mcp')
    expect(result.stderr).toContain('NOT changed')

    expect(existsSync(mcpDocumentFor('faketool'))).toBe(false)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('with the flag it configures the server', async () => {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    const source = buildServerFixture('alpha', 'filesystem')

    const result = await runCli(['add', source, '--accept-mcp'])

    expect(result.exitCode).toBe(0)
    const document = JSON.parse(readFileSync(mcpDocumentFor('faketool'), 'utf8'))
    expect(document.servers.filesystem).toEqual({
      type: 'stdio',
      command: COMMAND,
      args: ['-y', ARGUMENT],
      env: { [ENV_NAME]: ENV_VALUE },
    })
  })

  // Approval is recorded by the successful commit, so reproducing the same
  // declaration must not ask again — including without the flag.
  test('an already-approved declaration does not need the flag again', async () => {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    const source = buildServerFixture('alpha', 'filesystem')
    expect((await runCli(['add', source, '--accept-mcp'])).exitCode).toBe(0)

    const result = await runCli(['install'])
    expect(result.exitCode).toBe(0)
  })

  test('a server-only facet reports configuration work rather than a no-op', async () => {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    const source = buildServerFixture('alpha', 'filesystem')

    const result = await runCli(['add', source, '--accept-mcp'])

    expect(result.stdout).toContain('server config')
    expect(result.stdout).not.toContain('no changes')
  })
})

describe('server collisions', () => {
  // The collision report is unit-tested, but the property THIS file exists to
  // prove is that it survives piped stdio -- where the rich block goes to a
  // stream nobody reads. Asset groups were covered; server groups were not.
  test('two disagreeing declarations report every claimant and write nothing', async () => {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    const alpha = buildServerFixture('alpha', 'filesystem')
    const beta = realpathSync(mkdtempSync(join(projectRoot, 'fixture-')))
    writeFileSync(
      join(beta, 'facet.json'),
      JSON.stringify({
        name: 'beta',
        version: '0.1.0',
        servers: { filesystem: { type: 'http', url: 'https://other.example.com/mcp' } },
      }),
    )

    const result = await runCli(['add', alpha, `./${beta.split('/').pop()}`, '--accept-mcp'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('MCP servers')
    expect(result.stderr).toContain('alpha')
    expect(result.stderr).toContain('beta')
    // The editable location and a copy-pasteable resolution, per claimant.
    expect(result.stderr).toContain('materialization.servers')
    expect(result.stderr).toContain('"kind": "omitted"')
    // No winner is chosen; the alias placeholder stays a placeholder.
    expect(result.stderr).toContain('choose-a-name')
    expect(result.stderr).toContain('NOT changed')
    expect(existsSync(mcpDocumentFor('faketool'))).toBe(false)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })
})

describe('adapters that cannot configure MCP servers', () => {
  test('the failure names the adapter and both remedies', async () => {
    installFakeAdapter(adaptersDir, 'faketool')
    const source = buildServerFixture('alpha', 'filesystem')

    const result = await runCli(['add', source, '--accept-mcp'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('faketool')
    expect(result.stderr).toContain('omit')
    expect(result.stderr).toContain('filesystem')
    expect(result.stderr).toContain('NOT changed')
    // No declaration is needed to act on this, and this report reaches CI logs.
    expect(result.stderr).not.toContain(ENV_VALUE)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  // An adapter without MCP support only blocks a run that has MCP work to do.
  test('omitting every server lets an MCP-less adapter install', async () => {
    installFakeAdapter(adaptersDir, 'faketool')
    const source = buildServerFixture('alpha', 'filesystem')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({
        manifestVersion: 0.2,
        facets: {
          alpha: { source, materialization: { servers: { filesystem: { kind: 'omitted' } } } },
        },
      }),
    )

    const result = await runCli(['install'])
    expect(result.exitCode).toBe(0)
  })
})

describe('declaration secrecy', () => {
  // Verbose output is ordinary command output that lands in scrollback and
  // CI logs. The consent surfaces are the only ones allowed to disclose.
  test('verbose output does not leak the declaration', async () => {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    const source = buildServerFixture('alpha', 'filesystem')

    const result = await runCli(['add', source, '--accept-mcp', '--verbose'])

    expect(result.exitCode).toBe(0)
    const output = `${result.stdout}${result.stderr}`
    expect(output).not.toContain(ENV_VALUE)
    expect(output).not.toContain(ARGUMENT)
    // The identity is not a secret, and a summary that omitted it would be
    // useless — this is the line between naming a thing and disclosing it.
    expect(result.stdout).toContain('filesystem')
  })

  // A facet author controls every value in a declaration, and two of the
  // surfaces that reproduce one are failure reports a user reads to decide
  // what to do. Neither may hand a facet the cursor.
  test('a declaration cannot issue terminal controls on a consent surface', async () => {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    const repo = realpathSync(mkdtempSync(join(projectRoot, 'fixture-')))
    writeFileSync(
      join(repo, 'facet.json'),
      JSON.stringify({
        name: 'alpha',
        version: '0.1.0',
        servers: {
          filesystem: { type: 'stdio', command: '\u001b[2K\nforged', args: ['ok'] },
        },
      }),
    )

    const result = await runCli(['add', `./${repo.split('/').pop()}`])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toContain('\u001b[2K')
    expect(result.stderr).toContain('\\u001b[2K\\nforged')
  })
})

/**
 * The `0.4` lockfile's server inventory, written by the real binary.
 *
 * Every facet entry records every authored server — omitted ones included —
 * as name, fingerprint, and disposition only. Nothing here may launch a
 * command or contact an endpoint: configuring a server is writing a document.
 */
describe('locked server inventory', () => {
  test('records complete per-facet inventories and never runs or contacts a server', async () => {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    const { declaration: filesystem, marker } = sentinelServer(projectRoot)
    const endpoint = countingEndpoint()
    try {
      const docs: McpServerDeclaration = { type: 'http', url: endpoint.url }
      const scratch: McpServerDeclaration = { type: 'stdio', command: 'scratch-mcp' }
      writeManifest(projectRoot, {
        manifestVersion: 0.2,
        facets: {
          // Server-only, with one aliased server.
          alpha: {
            source: buildFacet(projectRoot, 'alpha', { servers: { filesystem, docs } }),
            materialization: { servers: { docs: { kind: 'aliased', as: 'team-docs' } } },
          },
          // Mixed, declaring alpha's server identically: one native entry,
          // a record for each facet.
          beta: buildFacet(projectRoot, 'beta', { skills: ['review'], servers: { filesystem } }),
          // No servers at all: an explicit empty inventory.
          gamma: buildFacet(projectRoot, 'gamma', { skills: ['notes'] }),
          // Omitted: never configured, still recorded.
          delta: {
            source: buildFacet(projectRoot, 'delta', { servers: { scratch } }),
            materialization: { servers: { scratch: { kind: 'omitted' } } },
          },
        },
      })

      const result = await runCli(['install', '--accept-mcp'])

      expect(result.exitCode).toBe(0)
      const lock = readLock(projectRoot)
      expect(lock.lockfileVersion).toBe(0.4)
      const record = (
        name: string,
        declaration: McpServerDeclaration,
        materialization: { kind: string; as?: string },
      ) => ({
        name,
        fingerprint: computeMcpServerFingerprint(declaration),
        materialization,
      })
      expect(lock.facets.alpha?.assets).toEqual([])
      expect(lock.facets.alpha?.servers).toEqual([
        record('docs', docs, { kind: 'aliased', as: 'team-docs' }),
        record('filesystem', filesystem, { kind: 'authored' }),
      ])
      expect(lock.facets.beta?.assets).toHaveLength(1)
      expect(lock.facets.beta?.servers).toEqual([record('filesystem', filesystem, { kind: 'authored' })])
      expect(lock.facets.gamma?.servers).toEqual([])
      expect(lock.facets.delta?.servers).toEqual([record('scratch', scratch, { kind: 'omitted' })])

      // Fingerprints only: no command, argument, or URL reaches a shared file.
      const lockText = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
      for (const value of [filesystem.type === 'stdio' ? filesystem.command : '', endpoint.url, 'scratch-mcp']) {
        expect(lockText).not.toContain(value)
      }

      // The native document has the selection: identical claims composed, the
      // alias applied, the omission absent.
      expect(Object.keys(readJson<{ servers: object }>(mcpDocumentFor('faketool')).servers).sort()).toEqual([
        'filesystem',
        'team-docs',
      ])
      expect(existsSync(marker)).toBe(false)
      expect(endpoint.requests()).toBe(0)
    } finally {
      endpoint.stop()
    }
  })
})

/**
 * What a valid `0.4` lockfile does NOT carry: approval, ownership, or
 * takeover authority. Each of those is machine-local, in the receipt.
 */
describe('locked records grant no machine-local authority', () => {
  async function installed(): Promise<void> {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    writeManifest(projectRoot, { facets: { alpha: buildServerFixture('alpha', 'filesystem') } })
    expect((await runCli(['install', '--accept-mcp'])).exitCode).toBe(0)
  }

  test('another machine with the same files is still asked to approve', async () => {
    await installed()
    const before = snapshot([join(projectRoot, 'facets.lock'), mcpDocumentFor('faketool')])
    // A teammate: same project files, their own FACET_DIR with no receipt.
    const teammate = realpathSync(mkdtempSync(join(tmpdir(), 'facet-mcp-teammate-')))
    try {
      installFakeAdapter(join(teammate, '.facet', 'adapters'), 'faketool', { mcp: true })
      const result = await spawnCli(['install'], {
        cwd: projectRoot,
        env: { HOME: teammate, FACET_DIR: join(teammate, '.facet') },
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('code=MCP_CONSENT_REQUIRED')
      expect(result.stderr).toContain('filesystem (not yet approved)')
      expect(snapshot([join(projectRoot, 'facets.lock'), mcpDocumentFor('faketool')])).toEqual(before)
    } finally {
      rmSync(teammate, { recursive: true, force: true })
    }
  })

  test('a matching native entry this machine does not own is a takeover, not an adoption', async () => {
    await installed()
    // The lockfile still records the server and the document still holds the
    // exact declaration — but nothing on this machine claims it any more.
    forgetConfigurationClaims(join(fakeHome, '.facet'), projectRoot, 'alpha')
    const before = snapshot([join(projectRoot, 'facets.lock'), mcpDocumentFor('faketool')])

    const result = await runCli(['install'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('code=MCP_CONSENT_REQUIRED')
    expect(result.stderr).toContain('faketool: filesystem already matches and would be adopted')
    expect(snapshot([join(projectRoot, 'facets.lock'), mcpDocumentFor('faketool')])).toEqual(before)
  })

  // Drift found when a run STARTS, at an identity the receipt owns, is repair:
  // it needs no new approval. This is not the mid-run race — a document
  // changing between a run's plan and its commit — which the engine suite
  // covers, because a subprocess cannot interleave with it deterministically.
  test('an owned entry edited between runs is repaired without asking again', async () => {
    await installed()
    const document = readJson<{ servers: Record<string, unknown> }>(mcpDocumentFor('faketool'))
    const expected = document.servers.filesystem
    document.servers.filesystem = { type: 'http', url: 'https://hand-edited.example/mcp' }
    writeFileSync(mcpDocumentFor('faketool'), JSON.stringify(document))

    const result = await runCli(['install'])

    expect(result.exitCode).toBe(0)
    expect(readJson<{ servers: Record<string, unknown> }>(mcpDocumentFor('faketool')).servers.filesystem).toEqual(
      expected,
    )
  })
})

describe('a failed migration commit', () => {
  test('restores the legacy lockfile, configuration, and assets byte-for-byte', async () => {
    installFakeAdapter(adaptersDir, 'faketool', { mcp: true })
    writeManifest(projectRoot, {
      facets: {
        alpha: buildServerFixture('alpha', 'filesystem'),
        beta: buildFacet(projectRoot, 'beta', { skills: ['review'] }),
      },
    })
    expect((await runCli(['install', '--accept-mcp'])).exitCode).toBe(0)

    // A legacy project whose configuration and asset both have to be written
    // again, so the migration has real work to roll back.
    relockLegacy(projectRoot, 0.3)
    rmSync(mcpDocumentFor('faketool'))
    rmSync(join(projectRoot, '.faketool', 'skills', 'review.md'))
    const paths = [
      join(projectRoot, 'facets.json'),
      join(projectRoot, 'facets.lock'),
      mcpDocumentFor('faketool'),
      join(projectRoot, '.faketool', 'skills', 'review.md'),
    ]
    const before = snapshot(paths)
    // The receipt is the last write of the commit. A directory where it has
    // to go makes that write fail after everything else was applied.
    const receipt = receiptFile(join(fakeHome, '.facet'), projectRoot)
    rmSync(receipt)
    mkdirSync(receipt)

    const result = await runCli(['install', '--accept-mcp'])

    expect(result.exitCode).toBe(1)
    // It got as far as committing, and walked every write back — not a
    // failure early enough that there was nothing to restore.
    expect(result.stderr).toContain('the project was restored to its previous state')
    expect(snapshot(paths)).toEqual(before)
    expect(readLock(projectRoot).lockfileVersion).toBe(0.3)
  })
})
