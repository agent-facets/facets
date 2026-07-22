import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { bundleAdapter, resolveEntryPoint } from '../bundler.ts'

/**
 * Unit tests for `resolveEntryPoint()`.
 *
 * Each test builds a minimal fixture directory with a `package.json` (and
 * sometimes fixture source files) and confirms the resolver picks the
 * expected entry point with the right `kind` classification.
 */

async function makeFixture(pkg: Record<string, unknown>, files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'facet-bundler-test-'))
  await Bun.write(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative)
    // Ensure parent dir exists. Use `dirname()` rather than slicing on '/'
    // so this works on any platform (and matches the convention used
    // elsewhere in the codebase).
    await mkdir(dirname(absolute), { recursive: true })
    await Bun.write(absolute, content)
  }
  return dir
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

describe('resolveEntryPoint', () => {
  test('exports as a string pointing at a prebuilt .mjs', async () => {
    const dir = await makeFixture({ name: 'a', exports: './dist/index.mjs' }, { 'dist/index.mjs': 'export default {}' })
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'dist/index.mjs'))
      expect(resolved.kind).toBe('prebuilt')
    } finally {
      await cleanup(dir)
    }
  })

  test('exports["."] as a string pointing at a prebuilt .mjs', async () => {
    const dir = await makeFixture(
      { name: 'a', exports: { '.': './dist/index.mjs' } },
      { 'dist/index.mjs': 'export default {}' },
    )
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'dist/index.mjs'))
      expect(resolved.kind).toBe('prebuilt')
    } finally {
      await cleanup(dir)
    }
  })

  test('exports["."] as a conditional object with .import', async () => {
    const dir = await makeFixture(
      {
        name: 'a',
        exports: { '.': { import: './dist/index.mjs', types: './dist/index.d.mts' } },
      },
      { 'dist/index.mjs': 'export default {}' },
    )
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'dist/index.mjs'))
      expect(resolved.kind).toBe('prebuilt')
    } finally {
      await cleanup(dir)
    }
  })

  test('exports["."] pointing at TypeScript source is classified as source', async () => {
    const dir = await makeFixture(
      { name: 'a', exports: { '.': './src/index.ts' } },
      { 'src/index.ts': 'export default {}' },
    )
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'src/index.ts'))
      expect(resolved.kind).toBe('source')
    } finally {
      await cleanup(dir)
    }
  })

  test('main field only, pointing at prebuilt .mjs', async () => {
    const dir = await makeFixture({ name: 'a', main: './dist/index.mjs' }, { 'dist/index.mjs': 'export default {}' })
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'dist/index.mjs'))
      expect(resolved.kind).toBe('prebuilt')
    } finally {
      await cleanup(dir)
    }
  })

  test('disk fallback to dist/index.mjs when no exports/main', async () => {
    const dir = await makeFixture({ name: 'a' }, { 'dist/index.mjs': 'export default {}' })
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'dist/index.mjs'))
      expect(resolved.kind).toBe('prebuilt')
    } finally {
      await cleanup(dir)
    }
  })

  test('disk fallback to dist/index.js when dist/index.mjs missing', async () => {
    const dir = await makeFixture({ name: 'a' }, { 'dist/index.js': 'export default {}' })
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'dist/index.js'))
      expect(resolved.kind).toBe('prebuilt')
    } finally {
      await cleanup(dir)
    }
  })

  test('disk fallback to src/index.ts is classified as source', async () => {
    const dir = await makeFixture({ name: 'a' }, { 'src/index.ts': 'export default {}' })
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'src/index.ts'))
      expect(resolved.kind).toBe('source')
    } finally {
      await cleanup(dir)
    }
  })

  test('prebuilt path declared in package.json but not on disk falls through', async () => {
    // exports points at dist/index.mjs but the file doesn't exist — resolver
    // should fall through to the disk-fallback stage and find src/index.ts.
    const dir = await makeFixture(
      { name: 'a', exports: { '.': { import: './dist/index.mjs' } } },
      { 'src/index.ts': 'export default {}' },
    )
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'src/index.ts'))
      expect(resolved.kind).toBe('source')
    } finally {
      await cleanup(dir)
    }
  })

  test('fails with no-entry-point when nothing resolves, listing what was tried', async () => {
    const dir = await makeFixture({ name: 'a', exports: './does-not-exist.mjs', main: './also-missing.js' })
    try {
      const result = await resolveEntryPoint(dir)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'no-entry-point') expect.unreachable()
      expect(result.failure.tried.join('\n')).toContain('does-not-exist.mjs')
      expect(result.failure.tried.join('\n')).toContain('also-missing.js')
      expect(result.failure.tried.join('\n')).toContain('dist/index.mjs')
    } finally {
      await cleanup(dir)
    }
  })

  test('fails with no-package-json when package.json is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'facet-bundler-test-'))
    try {
      const result = await resolveEntryPoint(dir)
      if (result.ok) expect.unreachable()
      expect(result.failure.kind).toBe('no-package-json')
    } finally {
      await cleanup(dir)
    }
  })

  test('fails with invalid-package-json when package.json is malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'facet-bundler-test-'))
    await Bun.write(join(dir, 'package.json'), '{ not json')
    try {
      const result = await resolveEntryPoint(dir)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'invalid-package-json') expect.unreachable()
      expect(result.failure.sourceDir).toBe(dir)
      expect(result.failure.cause).not.toBe('')
    } finally {
      await cleanup(dir)
    }
  })

  test.each([
    ['null'],
    ['"just a string"'],
    ['42'],
  ])('fails with invalid-package-json when package.json is valid but non-object JSON (%s)', async (body) => {
    const dir = await mkdtemp(join(tmpdir(), 'facet-bundler-test-'))
    await Bun.write(join(dir, 'package.json'), body)
    try {
      const result = await resolveEntryPoint(dir)
      if (result.ok) expect.unreachable()
      if (result.failure.kind !== 'invalid-package-json') expect.unreachable()
      expect(result.failure.cause).toBe('package.json is not a JSON object')
    } finally {
      await cleanup(dir)
    }
  })

  test('prefers exports over main when both are set', async () => {
    const dir = await makeFixture(
      {
        name: 'a',
        exports: { '.': './dist/index.mjs' },
        main: './dist/fallback.js',
      },
      {
        'dist/index.mjs': 'export default {}',
        'dist/fallback.js': 'export default {}',
      },
    )
    try {
      const result = await resolveEntryPoint(dir)
      if (!result.ok) expect.unreachable()
      const resolved = result.entry
      expect(resolved.path).toBe(join(dir, 'dist/index.mjs'))
    } finally {
      await cleanup(dir)
    }
  })
})

/**
 * Slow-path ordering: the build runs BEFORE any `bun install`. A source
 * tree whose dependencies are already satisfied (an installed workspace,
 * a zero-dep adapter) must bundle without spawning a package manager —
 * an unconditional install would re-enter the enclosing workspace's
 * lifecycle scripts (the repo's own postinstall → adapter install →
 * bun install recursion). The fallback install must still fire for a
 * standalone source dir with uninstalled dependencies.
 *
 * Both fixtures carry a root `postinstall` script that writes a marker
 * file, so "did an install run?" is directly observable.
 */
describe('rebundleAdapter — build-first, install only on failure', () => {
  test('source with satisfied deps bundles without running bun install', async () => {
    const dir = await makeFixture(
      {
        name: 'no-install-needed',
        exports: { '.': './src/index.ts' },
        scripts: { postinstall: 'bun marker.ts' },
      },
      {
        'src/index.ts': 'export default { name: "no-install-needed" }',
        'marker.ts': `await Bun.write('install-ran.marker', '1')`,
      },
    )
    try {
      const result = await bundleAdapter(dir)
      if (!result.ok) expect.unreachable()
      try {
        const stats = await stat(result.bundlePath)
        expect(stats.isFile()).toBe(true)
        // No package manager ran: the fixture's postinstall never fired.
        await expect(stat(join(dir, 'install-ran.marker'))).rejects.toThrow()
      } finally {
        await result.cleanup()
      }
    } finally {
      await cleanup(dir)
    }
  })

  test('source with missing deps installs them and succeeds on retry', async () => {
    const dir = await makeFixture(
      {
        name: 'needs-install',
        exports: { '.': './src/index.ts' },
        scripts: { postinstall: 'bun marker.ts' },
        // file: dependency — installable offline.
        dependencies: { 'tiny-dep': 'file:./vendor/tiny-dep' },
      },
      {
        'src/index.ts': `import { greeting } from 'tiny-dep'\nexport default { name: greeting }`,
        'marker.ts': `await Bun.write('install-ran.marker', '1')`,
        'vendor/tiny-dep/package.json': JSON.stringify({
          name: 'tiny-dep',
          version: '1.0.0',
          main: 'index.js',
        }),
        'vendor/tiny-dep/index.js': 'export const greeting = "from-tiny-dep"',
      },
    )
    try {
      const result = await bundleAdapter(dir)
      if (!result.ok) expect.unreachable()
      try {
        const stats = await stat(result.bundlePath)
        expect(stats.isFile()).toBe(true)
        // The fallback install DID run (first build failed on the
        // unresolved import, install linked the file: dep, retry passed).
        const marker = await stat(join(dir, 'install-ran.marker'))
        expect(marker.isFile()).toBe(true)
        // The bundle is self-contained: the dep got inlined.
        const bundled = await Bun.file(result.bundlePath).text()
        expect(bundled).toContain('from-tiny-dep')
      } finally {
        await result.cleanup()
      }
    } finally {
      await cleanup(dir)
    }
  })
})

/**
 * Tests for the BundleResult.cleanup contract introduced in PR #142
 * follow-up: every bundler entry point returns `{ bundlePath, cleanup }`,
 * and callers MUST be able to invoke `cleanup()` safely (whether or not
 * a temp dir was created).
 *
 * The slow-path `rebundleAdapter` cleanup is exercised end-to-end by the
 * adapter-install-cli test suite (which checks that `facet-adapter-build-*`
 * dirs don't accumulate in tmpdir across installs). Here we cover the fast
 * path: it must return a no-op cleanup that doesn't throw and doesn't
 * delete anything in the source tree.
 */
describe('bundleAdapter — fast path returns a safe no-op cleanup', () => {
  test('cleanup is callable and resolves without throwing', async () => {
    const dir = await makeFixture(
      { name: 'noop-cleanup-fixture', exports: { '.': { import: './dist/index.mjs' } } },
      { 'dist/index.mjs': 'export default { name: "noop-cleanup-fixture" }' },
    )
    try {
      const result = await bundleAdapter(dir)
      if (!result.ok) expect.unreachable()
      // Fast path: bundlePath should point AT the source tree's prebuilt
      expect(result.bundlePath).toBe(join(dir, 'dist/index.mjs'))
      // Cleanup must not throw
      await expect(result.cleanup()).resolves.toBeUndefined()
      // And critically: the prebuilt file must still exist after cleanup,
      // because the fast path doesn't own the source tree.
      const stats = await stat(result.bundlePath)
      expect(stats.isFile()).toBe(true)
    } finally {
      await cleanup(dir)
    }
  })

  test('cleanup is idempotent — calling it multiple times is safe', async () => {
    const dir = await makeFixture(
      { name: 'idempotent-cleanup', exports: { '.': { import: './dist/index.mjs' } } },
      { 'dist/index.mjs': 'export default { name: "idempotent-cleanup" }' },
    )
    try {
      const result = await bundleAdapter(dir)
      if (!result.ok) expect.unreachable()
      await result.cleanup()
      await expect(result.cleanup()).resolves.toBeUndefined()
      await expect(result.cleanup()).resolves.toBeUndefined()
    } finally {
      await cleanup(dir)
    }
  })
})
