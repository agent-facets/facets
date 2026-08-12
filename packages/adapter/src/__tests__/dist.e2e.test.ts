/**
 * Packed-artifact coverage for the SDK's dependency invariant.
 *
 * `@agent-facets/adapter` is the one package third-party adapter authors
 * install. Its published declarations inline every workspace type they
 * reference — `@agent-facets/common` for the asset primitives, and
 * `@agent-facets/protocol`'s portable MCP declaration — so an author needs
 * neither package, and neither package's own dependencies.
 *
 * That invariant is invisible in source: it holds or breaks purely as a
 * function of how the declaration bundler resolves a type. It broke once
 * already, when the MCP declaration type was inferred from an arktype schema
 * and the inferred form carried a deep `import("arktype/internal/...")` node
 * into the emitted declarations. This test is the tripwire.
 *
 * Requires `bun run build` first — wired via the `test:e2e` script.
 */
import { expect, test } from 'bun:test'
import { join } from 'node:path'

const DIST_DIR = join(import.meta.dir, '../../dist')

/** Module specifiers in `import`/`export ... from` statements, comments excluded. */
function moduleSpecifiers(source: string): string[] {
  const withoutComments = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/[^\n]*/g, '')
  return [...withoutComments.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((match) => match[1] ?? '')
}

test('published declarations import nothing but the sibling api-version entry', async () => {
  const declarations = await Bun.file(join(DIST_DIR, 'index.d.mts')).text()
  expect(moduleSpecifiers(declarations)).toEqual(['./api-version.mjs'])
})

test('published JavaScript pulls in no workspace or validator runtime', async () => {
  const bundle = await Bun.file(join(DIST_DIR, 'index.mjs')).text()
  const external = moduleSpecifiers(bundle).filter((specifier) => !specifier.startsWith('.'))
  // `yaml` is the SDK's one declared runtime dependency; node builtins are
  // always fair game. Anything else means a workspace package or one of its
  // dependencies escaped bundling.
  const unexpected = external.filter((specifier) => specifier !== 'yaml' && !specifier.startsWith('node:'))
  expect(unexpected).toEqual([])
})

test('the api-version entry stays dependency-free', async () => {
  // Release tooling imports this entry by relative path with no node_modules
  // resolution available, so it must not reach for anything.
  const declarations = await Bun.file(join(DIST_DIR, 'api-version.d.mts')).text()
  expect(moduleSpecifiers(declarations)).toEqual([])
})
