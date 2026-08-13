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
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
// Reached by path rather than by package specifier on purpose. The test kit
// already depends on this package, so declaring the reverse edge would make the
// two mutually dependent and the task graph cyclic. Both scanners still have
// exactly one implementation, and it lives beside the adapters that share it.
import { declarationModuleSpecifiers, runtimeModuleSpecifiers } from '../../../adapter-test-kit/src/index.ts'

const DIST_DIR = join(import.meta.dir, '../../dist')

test('published declarations import nothing but the sibling api-version entry', async () => {
  const declarations = await Bun.file(join(DIST_DIR, 'index.d.mts')).text()
  expect(declarationModuleSpecifiers(declarations)).toEqual(['./api-version.mjs'])
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
  expect(declarationModuleSpecifiers(declarations)).toEqual([])
})

describe('the declaration scanner sees every reference form', () => {
  // Guards the guard. Each of these appeared, or could appear, in emitted
  // declarations, and a `from "..."` regex sees only the first.
  test('an inlined type node is detected', () => {
    const source = 'export declare const x: import("arktype/internal/deep").Foo\n'
    expect(declarationModuleSpecifiers(source)).toEqual(['arktype/internal/deep'])
  })

  test('a bare import statement is detected', () => {
    expect(declarationModuleSpecifiers('import "side-effect-pkg"\n')).toEqual(['side-effect-pkg'])
  })

  test('a typeof import query is detected', () => {
    expect(declarationModuleSpecifiers('export type Y = typeof import("bare-pkg")\n')).toEqual(['bare-pkg'])
  })

  test('type-only and re-export forms are detected', () => {
    const source = 'import type { A } from "./a.mjs"\nexport * from "./b.mjs"\n'
    expect(declarationModuleSpecifiers(source)).toEqual(['./a.mjs', './b.mjs'])
  })

  test('an import-shaped string is not a reference', () => {
    expect(declarationModuleSpecifiers('export declare const s: "import(\\"not-a-module\\")"\n')).toEqual([])
  })
})
