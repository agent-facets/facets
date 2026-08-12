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
// Reached by path rather than by package specifier on purpose. The test kit
// already depends on this package, so declaring the reverse edge would make the
// two mutually dependent and the task graph cyclic. Both scanners still have
// exactly one implementation, and it lives beside the adapters that share it —
// as does their own coverage, which needs no build output.
import { declarationReferences, runtimeModuleSpecifiers } from '../../../adapter-test-kit/src/index.ts'

const DIST_DIR = join(import.meta.dir, '../../dist')

test('published declarations reach nothing but the sibling entries', async () => {
  const declarations = await Bun.file(join(DIST_DIR, 'index.d.mts')).text()
  const texts = declarationReferences(declarations).map((reference) => reference.text)
  expect(texts.toSorted()).toEqual(['./api-version.mjs', './terminal.mjs'])
})

test('published JavaScript pulls in no workspace or validator runtime', async () => {
  const bundle = await Bun.file(join(DIST_DIR, 'index.mjs')).text()
  const external = runtimeModuleSpecifiers(bundle).filter((specifier) => !specifier.startsWith('.'))
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
  expect(declarationReferences(declarations)).toEqual([])
})

test('the terminal entry stays dependency-free', async () => {
  // The CLI imports this one to render a value safely. Reaching it through the
  // full SDK entry would pull the whole module graph in for a string function,
  // so the subpath only earns its keep while it resolves nothing at all —
  // not even a Node builtin.
  const declarations = await Bun.file(join(DIST_DIR, 'terminal.d.mts')).text()
  expect(declarationReferences(declarations)).toEqual([])
  const bundle = await Bun.file(join(DIST_DIR, 'terminal.mjs')).text()
  expect(runtimeModuleSpecifiers(bundle)).toEqual([])
})
