import { describe, expect, type Mock, spyOn, test } from 'bun:test'
import { resolveMiseInstall } from '../mise.ts'

const metadata = JSON.stringify({
  backend: 'github:agent-facets/facets',
  config_source: { path: '/workspace/mise.toml' },
  tool_options: { version_prefix: 'agent-facets@' },
})

function runFor(which: string | null, tool: string | null = metadata, plugin = 'github:agent-facets/facets') {
  return async (command: string[]) => {
    if (command.join(' ') === 'mise which facet') return which
    if (command.join(' ') === 'mise which facet --plugin') return plugin
    if (command.join(' ') === 'mise tool github:agent-facets/facets --json') return tool
    return null
  }
}

describe('resolveMiseInstall', () => {
  test.each([1, 137])('failed or timed-out probe (exit %s) does not claim mise ownership', async (exitCode) => {
    type ProbeSpawn = (command: string[], options: unknown) => { stdout: Uint8Array; exited: Promise<number> }
    const spawn = spyOn(Bun, 'spawn') as unknown as Mock<ProbeSpawn>
    spawn.mockImplementation(() => ({
      stdout: new TextEncoder().encode('/mise/facet\n'),
      exited: Promise.resolve(exitCode),
    }))
    try {
      const result = await resolveMiseInstall({ execPath: '/mise/facet', realpath: (path) => path })
      expect(result).toEqual({ kind: 'not-mise' })
      expect(spawn).toHaveBeenCalledTimes(1)
      expect(spawn.mock.calls[0]).toEqual([
        ['mise', 'which', 'facet'],
        { stdout: 'pipe', stderr: 'ignore', timeout: 3000, killSignal: 'SIGKILL' },
      ])
    } finally {
      spawn.mockRestore()
    }
  })

  test('all metadata probes are bounded and successful stdout is trimmed', async () => {
    type ProbeSpawn = (command: string[], options: unknown) => { stdout: Uint8Array; exited: Promise<number> }
    const spawn = spyOn(Bun, 'spawn') as unknown as Mock<ProbeSpawn>
    spawn.mockImplementation((command) => ({
      stdout: new TextEncoder().encode(
        command.includes('--json')
          ? metadata
          : command.includes('--plugin')
            ? 'github:agent-facets/facets\n'
            : '/mise/facet\n',
      ),
      exited: Promise.resolve(0),
    }))
    try {
      const result = await resolveMiseInstall({ execPath: '/mise/facet', realpath: (path) => path })
      if (result.kind !== 'updatable') expect.unreachable()
      expect(result.install.configPath).toBe('/workspace/mise.toml')
      expect(spawn).toHaveBeenCalledTimes(3)
      for (const [, options] of spawn.mock.calls) {
        expect(options).toEqual({ stdout: 'pipe', stderr: 'ignore', timeout: 3000, killSignal: 'SIGKILL' })
      }
    } finally {
      spawn.mockRestore()
    }
  })

  test('accepts only the verified backend, option, and owning executable', async () => {
    const result = await resolveMiseInstall({
      execPath: '/mise/installs/github-agent-facets-facets/0.36.3/facet',
      realpath: (path) => path,
      run: runFor('/mise/installs/github-agent-facets-facets/0.36.3/facet'),
    })

    expect(result).toEqual({
      kind: 'updatable',
      install: {
        backend: 'github:agent-facets/facets',
        versionPrefix: 'agent-facets@',
        configPath: '/workspace/mise.toml',
      },
    })
  })

  test('does not claim an npm binary merely because mise is available', async () => {
    const result = await resolveMiseInstall({
      execPath: '/npm/bin/facet',
      realpath: (path) => path,
      run: runFor('/mise/installs/node/22/bin/facet'),
    })

    expect(result).toEqual({ kind: 'not-mise' })
  })

  test('returns guidance for unavailable or malformed ownership metadata', async () => {
    const unavailable = await resolveMiseInstall({
      execPath: '/mise/facet',
      realpath: (path) => path,
      run: runFor('/mise/facet', null),
    })
    const malformed = await resolveMiseInstall({
      execPath: '/mise/facet',
      realpath: (path) => path,
      run: runFor('/mise/facet', '{'),
    })

    expect(unavailable).toEqual({ kind: 'guidance', reason: 'metadata-unavailable' })
    expect(malformed).toEqual({ kind: 'guidance', reason: 'invalid-metadata' })
  })

  test('returns guidance for a near-match backend or version prefix', async () => {
    const result = await resolveMiseInstall({
      execPath: '/mise/facet',
      realpath: (path) => path,
      run: runFor(
        '/mise/facet',
        JSON.stringify({
          backend: 'github:agent-facets/facets',
          config_source: { path: '/workspace/mise.toml' },
          tool_options: { version_prefix: 'facet@' },
        }),
      ),
    })

    expect(result).toEqual({ kind: 'guidance', reason: 'unsupported-tool' })
  })

  test('returns guidance when another mise tool owns the executable', async () => {
    const result = await resolveMiseInstall({
      execPath: '/mise/facet',
      realpath: (path) => path,
      run: runFor('/mise/facet', metadata, 'github:someone-else/facet'),
    })

    expect(result).toEqual({ kind: 'guidance', reason: 'unsupported-tool' })
  })
})
