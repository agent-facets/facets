import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { type DetectDependencies, detectInstallMethod } from '../detect.ts'
import type { MethodKind } from '../methods/types.ts'

/**
 * Build a fake `spawn` from a map of `argv0 → return value`. Any command
 * not in the map returns null (treated as "not installed" / probe failure).
 *
 * The map key is the FIRST argv element so we can ignore the rest of the
 * command line (which differs slightly per package manager). That's enough
 * to identify which probe is being asked.
 */
function fakeSpawn(table: Record<string, string | null>): DetectDependencies['spawn'] {
  return async (cmd) => {
    const [first] = cmd
    if (first === undefined) return null
    return table[first] ?? null
  }
}

/**
 * Build a deps object for a non-curl, non-dev scenario. Caller overrides
 * any field they care about. `realpath` defaults to identity so tests don't
 * touch the real filesystem.
 */
function makeDeps(overrides: Partial<DetectDependencies>): Partial<DetectDependencies> {
  return {
    execPath: '/some/path/to/facet',
    env: {},
    homedir: '/home/test',
    realpath: (p) => p,
    spawn: fakeSpawn({}),
    ...overrides,
  }
}

describe('detectInstallMethod', () => {
  test('returns local-dev when FACET_BIN_PATH is set', async () => {
    const result = await detectInstallMethod(makeDeps({ env: { FACET_BIN_PATH: '/dev/build/facet' } }))
    expect(result).toBe<MethodKind>('local-dev')
  })

  test('returns local-dev even when FACET_BIN_PATH is set to a curl-shaped path', async () => {
    // Edge case: dev short-circuit must win regardless of where the path points.
    const result = await detectInstallMethod(
      makeDeps({
        execPath: '/home/test/.facet/bin/facet',
        homedir: '/home/test',
        env: { FACET_BIN_PATH: '/home/test/.facet/bin/facet' },
      }),
    )
    expect(result).toBe<MethodKind>('local-dev')
  })

  test('does NOT return local-dev when FACET_BIN_PATH is the empty string', async () => {
    // Empty string is not "set" per the env-var contract — fall through to detection.
    const result = await detectInstallMethod(
      makeDeps({
        env: { FACET_BIN_PATH: '' },
        spawn: fakeSpawn({}),
      }),
    )
    expect(result).toBe<MethodKind>('unknown')
  })

  test('returns curl when execPath is under the default install dir', async () => {
    const home = '/home/test'
    const result = await detectInstallMethod(
      makeDeps({
        execPath: join(home, '.facet', 'bin', 'facet'),
        homedir: home,
      }),
    )
    expect(result).toBe<MethodKind>('curl')
  })

  test('returns curl when execPath is under FACET_INSTALL_DIR/bin', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        execPath: '/opt/facet-custom/bin/facet',
        env: { FACET_INSTALL_DIR: '/opt/facet-custom' },
      }),
    )
    expect(result).toBe<MethodKind>('curl')
  })

  test('follows symlinks via realpath when matching the curl dir', async () => {
    const home = '/home/test'
    const real = join(home, '.facet', 'bin', 'facet')
    const result = await detectInstallMethod(
      makeDeps({
        execPath: '/usr/local/bin/facet', // symlink
        realpath: (p) => (p === '/usr/local/bin/facet' ? real : p),
        homedir: home,
      }),
    )
    expect(result).toBe<MethodKind>('curl')
  })

  test('a single npm probe match returns npm', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        spawn: fakeSpawn({
          npm: 'foo@1.0.0\nagent-facets@0.7.3\nbar@2.0.0',
        }),
      }),
    )
    expect(result).toBe<MethodKind>('npm')
  })

  test('a single pnpm probe match returns pnpm', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        spawn: fakeSpawn({
          pnpm: '/home/test/.local/share/pnpm/global/5\nagent-facets 0.7.3',
        }),
      }),
    )
    expect(result).toBe<MethodKind>('pnpm')
  })

  test('a single bun probe match returns bun', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        spawn: fakeSpawn({
          bun: '/home/test node_modules (3)\n├── agent-facets@0.7.3',
        }),
      }),
    )
    expect(result).toBe<MethodKind>('bun')
  })

  test('a single yarn probe match returns yarn', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        spawn: fakeSpawn({
          yarn: 'yarn global v1.22.19\ninfo "agent-facets@0.7.3" has binaries:\n   - facet',
        }),
      }),
    )
    expect(result).toBe<MethodKind>('yarn')
  })

  test('substring match is case-insensitive', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        spawn: fakeSpawn({
          npm: 'AGENT-FACETS@0.7.3', // mixed case
        }),
      }),
    )
    expect(result).toBe<MethodKind>('npm')
  })

  test('multiple probe matches without a hint use the default order (npm first)', async () => {
    // Both npm and bun report the package; with no path hint, npm wins
    // because it sits first in the default PROBES order.
    const result = await detectInstallMethod(
      makeDeps({
        execPath: '/some/non-hinted/path/facet',
        spawn: fakeSpawn({
          npm: 'agent-facets@0.7.3',
          bun: 'agent-facets@0.7.3',
        }),
      }),
    )
    expect(result).toBe<MethodKind>('npm')
  })

  test('a /pnpm/ path hint promotes pnpm over npm', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        execPath: '/home/test/.local/share/pnpm/global/5/node_modules/agent-facets/bin/facet',
        spawn: fakeSpawn({
          npm: 'agent-facets@0.7.3',
          pnpm: 'agent-facets 0.7.3',
        }),
      }),
    )
    expect(result).toBe<MethodKind>('pnpm')
  })

  test('a /bun/install/ path hint promotes bun over npm', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        execPath: '/home/test/.bun/install/global/node_modules/agent-facets/bin/facet',
        spawn: fakeSpawn({
          npm: 'agent-facets@0.7.3',
          bun: 'agent-facets@0.7.3',
        }),
      }),
    )
    expect(result).toBe<MethodKind>('bun')
  })

  test('a /yarn/ path hint promotes yarn over npm', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        execPath: '/home/test/.config/yarn/global/node_modules/agent-facets/bin/facet',
        spawn: fakeSpawn({
          npm: 'agent-facets@0.7.3',
          yarn: 'info "agent-facets@0.7.3"',
        }),
      }),
    )
    expect(result).toBe<MethodKind>('yarn')
  })

  test('all four probes fail returns unknown', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        spawn: fakeSpawn({}), // every probe returns null
      }),
    )
    expect(result).toBe<MethodKind>('unknown')
  })

  test('probes that succeed but do not mention agent-facets return unknown', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        spawn: fakeSpawn({
          npm: 'lodash@4.17.21\nexpress@4.18.2',
          bun: 'something-else@1.0.0',
        }),
      }),
    )
    expect(result).toBe<MethodKind>('unknown')
  })

  test('a missing probe binary (spawn returns null) does not block other probes', async () => {
    // Simulates: yarn is not installed (spawn -> null) but npm has the package.
    const result = await detectInstallMethod(
      makeDeps({
        spawn: async (cmd) => {
          const [first] = cmd
          if (first === 'yarn') return null // explicitly missing
          if (first === 'npm') return 'agent-facets@0.7.3'
          return null
        },
      }),
    )
    expect(result).toBe<MethodKind>('npm')
  })

  test('probe timeout (spawn returns null on timeout) does not block other probes', async () => {
    // Bun.spawn's native timeout produces a non-zero exit, which our
    // defaultSpawn translates to null. Simulating that here.
    const result = await detectInstallMethod(
      makeDeps({
        spawn: async (cmd) => {
          const [first] = cmd
          if (first === 'pnpm') return null // pretend pnpm timed out
          if (first === 'bun') return 'agent-facets@0.7.3'
          return null
        },
      }),
    )
    expect(result).toBe<MethodKind>('bun')
  })

  test('realpath failure does not crash detection', async () => {
    const result = await detectInstallMethod(
      makeDeps({
        execPath: '/nonexistent/path/facet',
        realpath: () => {
          throw new Error('ENOENT')
        },
      }),
    )
    expect(result).toBe<MethodKind>('unknown')
  })

  test('FACET_INSTALL_DIR with trailing slash still matches the curl bin dir', async () => {
    // path.resolve normalizes the trailing slash; the join+resolve should
    // produce the same dir whether or not the env var ends in /.
    const result = await detectInstallMethod(
      makeDeps({
        execPath: '/opt/facet-custom/bin/facet',
        env: { FACET_INSTALL_DIR: '/opt/facet-custom/' },
      }),
    )
    expect(result).toBe<MethodKind>('curl')
  })
})
