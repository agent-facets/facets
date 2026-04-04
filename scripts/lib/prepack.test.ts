import { describe, expect, test } from 'bun:test'
import { rewriteWorkspaceDeps, type VersionResolver } from './prepack'

/** Helper: creates a resolver from a name→version map. */
function mockResolver(versions: Record<string, string>): VersionResolver {
  return async (name: string) => versions[name] ?? null
}

describe('rewriteWorkspaceDeps', () => {
  test('rewrites workspace:* to exact version in dependencies', async () => {
    const pkg = {
      name: 'my-cli',
      dependencies: {
        '@my/core': 'workspace:*',
        'some-lib': '1.0.0',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({ '@my/core': '0.2.3' }))

    expect(modified).toBe(true)
    expect((result.dependencies as Record<string, string>)['@my/core']).toBe('0.2.3')
    expect((result.dependencies as Record<string, string>)['some-lib']).toBe('1.0.0')
  })

  test('rewrites workspace:* to exact version in peerDependencies', async () => {
    const pkg = {
      name: 'my-plugin',
      peerDependencies: {
        '@my/sdk': 'workspace:*',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({ '@my/sdk': '1.0.0' }))

    expect(modified).toBe(true)
    expect((result.peerDependencies as Record<string, string>)['@my/sdk']).toBe('1.0.0')
  })

  test('rewrites workspace:* to exact version in optionalDependencies', async () => {
    const pkg = {
      name: 'my-cli',
      optionalDependencies: {
        '@my/extras': 'workspace:*',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({ '@my/extras': '3.1.0' }))

    expect(modified).toBe(true)
    expect((result.optionalDependencies as Record<string, string>)['@my/extras']).toBe('3.1.0')
  })

  test('leaves non-workspace deps untouched', async () => {
    const pkg = {
      name: 'my-cli',
      dependencies: {
        react: '19.2.4',
        ink: '6.8.0',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({}))

    expect(modified).toBe(false)
    expect((result.dependencies as Record<string, string>).react).toBe('19.2.4')
    expect((result.dependencies as Record<string, string>).ink).toBe('6.8.0')
  })

  test('returns unmodified package when no workspace:* entries exist', async () => {
    const pkg = {
      name: 'plain-pkg',
      dependencies: { lodash: '4.17.21' },
      devDependencies: { vitest: '1.0.0' },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({}))

    expect(modified).toBe(false)
    expect(result).toEqual(pkg)
  })

  test('returns unmodified package when no dep fields exist', async () => {
    const pkg = { name: 'bare-pkg', version: '1.0.0' }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({}))

    expect(modified).toBe(false)
    expect(result).toEqual(pkg)
  })

  test('throws when a workspace package cannot be resolved', async () => {
    const pkg = {
      name: 'my-cli',
      dependencies: {
        '@my/nonexistent': 'workspace:*',
      },
    }

    expect(rewriteWorkspaceDeps(pkg, mockResolver({}))).rejects.toThrow(
      'prepack: could not resolve workspace package "@my/nonexistent"',
    )
  })

  test('rewrites workspace:^ to ^<version>', async () => {
    const pkg = {
      name: 'my-cli',
      dependencies: {
        '@my/core': 'workspace:^',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({ '@my/core': '2.0.0' }))

    expect(modified).toBe(true)
    expect((result.dependencies as Record<string, string>)['@my/core']).toBe('^2.0.0')
  })

  test('rewrites workspace:~ to ~<version>', async () => {
    const pkg = {
      name: 'my-cli',
      dependencies: {
        '@my/core': 'workspace:~',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({ '@my/core': '2.0.0' }))

    expect(modified).toBe(true)
    expect((result.dependencies as Record<string, string>)['@my/core']).toBe('~2.0.0')
  })

  test('rewrites workspace:<semver> by stripping the prefix', async () => {
    const pkg = {
      name: 'my-cli',
      dependencies: {
        '@my/core': 'workspace:1.2.3',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({ '@my/core': '1.2.3' }))

    expect(modified).toBe(true)
    expect((result.dependencies as Record<string, string>)['@my/core']).toBe('1.2.3')
  })

  test('rewrites multiple workspace deps across multiple dep fields', async () => {
    const pkg = {
      name: 'my-cli',
      dependencies: {
        '@my/core': 'workspace:*',
        'some-lib': '1.0.0',
      },
      peerDependencies: {
        '@my/sdk': 'workspace:^',
      },
      optionalDependencies: {
        '@my/extras': 'workspace:~',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(
      pkg,
      mockResolver({ '@my/core': '0.1.2', '@my/sdk': '1.0.0', '@my/extras': '3.1.0' }),
    )

    expect(modified).toBe(true)
    expect((result.dependencies as Record<string, string>)['@my/core']).toBe('0.1.2')
    expect((result.dependencies as Record<string, string>)['some-lib']).toBe('1.0.0')
    expect((result.peerDependencies as Record<string, string>)['@my/sdk']).toBe('^1.0.0')
    expect((result.optionalDependencies as Record<string, string>)['@my/extras']).toBe('~3.1.0')
  })

  test('does not mutate the input package object', async () => {
    const pkg = {
      name: 'my-cli',
      dependencies: {
        '@my/core': 'workspace:*',
      },
    }

    const original = JSON.parse(JSON.stringify(pkg))
    await rewriteWorkspaceDeps(pkg, mockResolver({ '@my/core': '1.0.0' }))

    expect(pkg).toEqual(original)
  })

  test('rewrites workspace:* in devDependencies', async () => {
    const pkg = {
      name: 'my-cli',
      devDependencies: {
        '@my/core': 'workspace:*',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({ '@my/core': '1.0.0' }))

    expect(modified).toBe(true)
    expect((result.devDependencies as Record<string, string>)['@my/core']).toBe('1.0.0')
  })
})
