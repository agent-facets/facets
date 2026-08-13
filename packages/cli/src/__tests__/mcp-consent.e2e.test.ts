import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnCli } from './helpers/cli-process.ts'
import { installFakeAdapter } from './helpers/fake-adapter.ts'

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
  // One definition, three commands. `rm` is included because the alias is
  // how many people invoke removal, and an alias that silently lacked the
  // flag would leave them with no non-interactive way to finish.
  test.each(['add', 'install', 'remove', 'rm'])('%s lists --accept-mcp', async (command) => {
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
})
