import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPublishConfig, createDiskResolver, rewriteWorkspaceDeps, type VersionResolver } from './prepack'

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

    await expect(rewriteWorkspaceDeps(pkg, mockResolver({}))).rejects.toThrow(
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

  test('leaves workspace:* in devDependencies untouched', async () => {
    // devDependencies are intentionally excluded from DEP_FIELDS because
    // `npm pack` strips them from the published tarball. Rewriting them
    // would also break when a devDep references a workspace-only versionless
    // package like @agent-facets/common. See prepack.ts DEP_FIELDS docblock.
    const pkg = {
      name: 'my-cli',
      devDependencies: {
        '@my/core': 'workspace:*',
      },
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, mockResolver({ '@my/core': '1.0.0' }))

    expect(modified).toBe(false)
    expect((result.devDependencies as Record<string, string>)['@my/core']).toBe('workspace:*')
  })

  test('rewrites dependencies but skips devDependencies, even when devDep is unresolvable', async () => {
    // Regression test for CircleCI job 517: `@agent-facets/core@0.6.1`
    // prepack failed because `@agent-facets/common` was referenced in
    // devDependencies as `workspace:*` but `common` has no `version` field
    // (it's a workspace-only package, opted out of releases via PR #183).
    //
    // The fix: devDependencies are never rewritten, so an unresolvable
    // workspace-only devDep must NOT cause prepack to throw. Regular
    // dependencies in the same package must still be rewritten normally.
    const pkg = {
      name: '@my/publishable',
      dependencies: {
        '@my/runtime-sibling': 'workspace:*',
      },
      devDependencies: {
        '@my/versionless-sibling': 'workspace:*',
      },
    }

    // Resolver knows about the runtime sibling but returns null for the
    // versionless one — mirroring the `common` situation on disk.
    const resolver: VersionResolver = async (name: string) => {
      if (name === '@my/runtime-sibling') return '2.5.0'
      return null
    }

    const { pkg: result, modified } = await rewriteWorkspaceDeps(pkg, resolver)

    expect(modified).toBe(true)
    expect((result.dependencies as Record<string, string>)['@my/runtime-sibling']).toBe('2.5.0')
    // devDep is untouched — resolver was never called for it
    expect((result.devDependencies as Record<string, string>)['@my/versionless-sibling']).toBe('workspace:*')
  })
})

describe('applyPublishConfig', () => {
  test('returns unmodified when no publishConfig is present', () => {
    const pkg = { name: 'plain-pkg', version: '1.0.0' }
    const { pkg: result, modified } = applyPublishConfig(pkg)
    expect(modified).toBe(false)
    expect(result).toEqual(pkg)
  })

  test('returns unmodified when publishConfig has no override keys', () => {
    const pkg = {
      name: 'npm-only-config',
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' },
    }
    const { pkg: result, modified } = applyPublishConfig(pkg)
    expect(modified).toBe(false)
    expect(result).toEqual(pkg)
  })

  test('hoists publishConfig.exports object form to top-level exports', () => {
    const pkg = {
      name: 'adapter-opencode',
      exports: { '.': './src/index.ts' },
      publishConfig: {
        access: 'public',
        exports: {
          '.': { import: './dist/index.mjs', types: './dist/index.d.mts' },
        },
      },
    }
    const { pkg: result, modified } = applyPublishConfig(pkg)
    expect(modified).toBe(true)
    expect(result.exports).toEqual({
      '.': { import: './dist/index.mjs', types: './dist/index.d.mts' },
    })
    // publishConfig itself is preserved so npm still reads access/registry
    expect((result.publishConfig as Record<string, unknown>).access).toBe('public')
    expect((result.publishConfig as Record<string, unknown>).exports).toEqual({
      '.': { import: './dist/index.mjs', types: './dist/index.d.mts' },
    })
  })

  test('hoists publishConfig.main to top-level main', () => {
    const pkg = {
      name: 'cjs-pkg',
      publishConfig: { main: './dist/index.cjs' },
    }
    const { pkg: result, modified } = applyPublishConfig(pkg)
    expect(modified).toBe(true)
    expect(result.main).toBe('./dist/index.cjs')
  })

  test('hoists publishConfig.types to top-level types', () => {
    const pkg = {
      name: 'typed-pkg',
      publishConfig: { types: './dist/index.d.ts' },
    }
    const { pkg: result, modified } = applyPublishConfig(pkg)
    expect(modified).toBe(true)
    expect(result.types).toBe('./dist/index.d.ts')
  })

  test('hoists publishConfig.module to top-level module', () => {
    const pkg = {
      name: 'esm-pkg',
      publishConfig: { module: './dist/index.mjs' },
    }
    const { pkg: result, modified } = applyPublishConfig(pkg)
    expect(modified).toBe(true)
    expect(result.module).toBe('./dist/index.mjs')
  })

  test('hoists publishConfig.bin to top-level bin', () => {
    const pkg = {
      name: 'cli-pkg',
      publishConfig: { bin: { mycli: './dist/cli.mjs' } },
    }
    const { pkg: result, modified } = applyPublishConfig(pkg)
    expect(modified).toBe(true)
    expect(result.bin).toEqual({ mycli: './dist/cli.mjs' })
  })

  test('does not hoist npm CLI config keys (access, registry, tag, provenance)', () => {
    const pkg = {
      name: 'mixed',
      publishConfig: {
        access: 'public',
        registry: 'https://registry.npmjs.org',
        tag: 'next',
        provenance: true,
      },
    }
    const { pkg: result, modified } = applyPublishConfig(pkg)
    expect(modified).toBe(false)
    // None of these should be hoisted — they stay under publishConfig
    expect((result as Record<string, unknown>).access).toBeUndefined()
    expect((result as Record<string, unknown>).registry).toBeUndefined()
    expect((result as Record<string, unknown>).tag).toBeUndefined()
    expect((result as Record<string, unknown>).provenance).toBeUndefined()
  })

  test('hoists override keys but leaves other publishConfig keys untouched', () => {
    const pkg = {
      name: 'mixed',
      publishConfig: {
        access: 'public',
        exports: { '.': { import: './dist/index.mjs' } },
        tag: 'next',
      },
    }
    const { pkg: result, modified } = applyPublishConfig(pkg)
    expect(modified).toBe(true)
    expect(result.exports).toEqual({ '.': { import: './dist/index.mjs' } })
    const pc = result.publishConfig as Record<string, unknown>
    expect(pc.access).toBe('public')
    expect(pc.tag).toBe('next')
  })

  test('does not mutate the input package object', () => {
    const pkg = {
      name: 'immutable-input',
      exports: { '.': './src/index.ts' },
      publishConfig: { exports: { '.': { import: './dist/index.mjs' } } },
    }
    const original = JSON.parse(JSON.stringify(pkg))
    applyPublishConfig(pkg)
    expect(pkg).toEqual(original)
  })

  test('returned object-valued overrides do not share references with the input', () => {
    // Regression test for the deep-clone-defeated bug spotted by Cursor
    // in PR #142. Previously the loop pulled overrides from the ORIGINAL
    // `pkg.publishConfig`, so for object-valued keys like `exports` the
    // returned `result.exports` shared a reference with the input. That
    // meant mutating `result.exports` would propagate back to the input.
    const pkg = {
      name: 'shared-ref-check',
      publishConfig: {
        exports: { '.': { import: './dist/index.mjs', types: './dist/index.d.mts' } },
        bin: { 'my-cli': './dist/cli.mjs' },
      },
    }
    const { pkg: result } = applyPublishConfig(pkg)
    const resultExports = result.exports as { '.': { import: string; types: string } }
    const resultBin = result.bin as { 'my-cli': string }

    // Mutate the result's hoisted overrides
    resultExports['.'].import = 'mutated-import.mjs'
    resultBin['my-cli'] = 'mutated-cli.mjs'

    // The original input MUST remain untouched
    expect(pkg.publishConfig.exports['.'].import).toBe('./dist/index.mjs')
    expect(pkg.publishConfig.bin['my-cli']).toBe('./dist/cli.mjs')

    // And the references must actually be distinct objects
    expect(resultExports).not.toBe(pkg.publishConfig.exports)
    expect(resultExports['.']).not.toBe(pkg.publishConfig.exports['.'])
    expect(resultBin).not.toBe(pkg.publishConfig.bin)
  })

  test('composes with rewriteWorkspaceDeps on the same input', async () => {
    // Simulates the prepack.ts flow: rewrite deps, then apply publishConfig
    const input = {
      name: 'adapter-opencode',
      dependencies: { '@agent-facets/adapter': 'workspace:*' },
      exports: { '.': './src/index.ts' },
      publishConfig: {
        access: 'public',
        exports: { '.': { import: './dist/index.mjs' } },
      },
    }

    const { pkg: afterDeps, modified: depsModified } = await rewriteWorkspaceDeps(
      input,
      mockResolver({ '@agent-facets/adapter': '0.3.0' }),
    )
    const { pkg: afterPublishConfig, modified: publishConfigModified } = applyPublishConfig(afterDeps)

    expect(depsModified).toBe(true)
    expect(publishConfigModified).toBe(true)
    expect((afterPublishConfig.dependencies as Record<string, string>)['@agent-facets/adapter']).toBe('0.3.0')
    expect(afterPublishConfig.exports).toEqual({ '.': { import: './dist/index.mjs' } })
  })
})

describe('createDiskResolver', () => {
  /**
   * Scaffold a minimal fake monorepo in a tmpdir, invoke the callback with
   * the root path, and clean up afterwards regardless of outcome.
   */
  async function withFakeWorkspace(fn: (rootDir: string) => Promise<void>): Promise<void> {
    const rootDir = await mkdtemp(join(tmpdir(), 'prepack-resolver-test-'))
    try {
      await Bun.write(
        join(rootDir, 'package.json'),
        JSON.stringify({ name: 'fake-root', private: true, workspaces: ['packages/*'] }),
      )
      await Bun.write(
        join(rootDir, 'packages/versioned/package.json'),
        JSON.stringify({ name: '@fake/versioned', version: '1.2.3' }),
      )
      await Bun.write(join(rootDir, 'packages/versionless/package.json'), JSON.stringify({ name: '@fake/versionless' }))
      await fn(rootDir)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  }

  test('returns concrete version for a versioned workspace package', async () => {
    await withFakeWorkspace(async (rootDir) => {
      const resolver = createDiskResolver(rootDir)
      expect(await resolver('@fake/versioned')).toBe('1.2.3')
    })
  })

  test('returns undefined for a versionless workspace package', async () => {
    // Documents the resolver's contract: it's permissive — it returns
    // `candidate.version` as-is, which means `undefined` for workspace-only
    // packages like @agent-facets/common that have no `version` field.
    // The caller (`rewriteWorkspaceDeps`) is responsible for treating
    // nullish values as "unresolved" and throwing. Because devDependencies
    // are now excluded from DEP_FIELDS, this unresolved state is only
    // reachable for runtime/peer/optional deps — which should never
    // reference a versionless workspace package in the first place.
    await withFakeWorkspace(async (rootDir) => {
      const resolver = createDiskResolver(rootDir)
      expect(await resolver('@fake/versionless')).toBeUndefined()
    })
  })

  test('returns null for a name that matches no workspace package', async () => {
    await withFakeWorkspace(async (rootDir) => {
      const resolver = createDiskResolver(rootDir)
      expect(await resolver('@fake/nonexistent')).toBeNull()
    })
  })
})
