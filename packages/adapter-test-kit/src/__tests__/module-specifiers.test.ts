import { describe, expect, test } from 'bun:test'
import { declarationReferences, runtimeModuleSpecifiers } from '../module-specifiers.ts'

/**
 * Guards the guard.
 *
 * Every case here is a form that appeared, or could appear, in a built
 * artifact, and a `from "..."` regex sees only the first of them. These are
 * pure-function tests: they read no build output, so they live beside the
 * scanner rather than inside the SDK's packed-artifact suite.
 */

describe('declarationReferences', () => {
  test('an inlined type node is detected', () => {
    const source = 'export declare const x: import("arktype/internal/deep").Foo\n'
    expect(declarationReferences(source)).toEqual([{ kind: 'import', text: 'arktype/internal/deep' }])
  })

  test('a bare import statement is detected', () => {
    expect(declarationReferences('import "side-effect-pkg"\n')).toEqual([{ kind: 'import', text: 'side-effect-pkg' }])
  })

  test('a typeof import query is detected', () => {
    expect(declarationReferences('export type Y = typeof import("bare-pkg")\n')).toEqual([
      { kind: 'import', text: 'bare-pkg' },
    ])
  })

  test('type-only and re-export forms are detected', () => {
    const source = 'import type { A } from "./a.mjs"\nexport * from "./b.mjs"\n'
    expect(declarationReferences(source)).toEqual([
      { kind: 'import', text: './a.mjs' },
      { kind: 'import', text: './b.mjs' },
    ])
  })

  test('an import-equals-require form is detected', () => {
    // TypeScript-only, and legal in an emitted `.d.mts`.
    expect(declarationReferences('import x = require("pkg")\nexport { x }\n')).toEqual([
      { kind: 'import', text: 'pkg' },
    ])
  })

  test('an import-shaped string is not a reference', () => {
    expect(declarationReferences('export declare const s: "import(\\"not-a-module\\")"\n')).toEqual([])
  })

  test('a types directive reaches another package and is reported', () => {
    // The leak this was blind to: a `types` directive is a dependency the
    // consumer must have installed, exactly like an import.
    expect(declarationReferences('/// <reference types="node" />\n')).toEqual([
      { kind: 'types-directive', text: 'node' },
    ])
  })

  test('a lib directive is reported as its own kind', () => {
    expect(declarationReferences('/// <reference lib="es2015" />\n')).toEqual([
      { kind: 'lib-directive', text: 'es2015' },
    ])
  })

  test('a path directive is reported as its own kind', () => {
    expect(declarationReferences('/// <reference path="./local.d.ts" />\n')).toEqual([
      { kind: 'path-directive', text: './local.d.ts' },
    ])
  })

  test('mixed forms come back in source order', () => {
    const source = [
      '/// <reference lib="es2015" />',
      '/// <reference types="node" />',
      '/// <reference path="./local.d.ts" />',
      'import "first-pkg"',
      'export * from "./second.mjs"',
      '',
    ].join('\n')

    expect(declarationReferences(source)).toEqual([
      { kind: 'lib-directive', text: 'es2015' },
      { kind: 'types-directive', text: 'node' },
      { kind: 'path-directive', text: './local.d.ts' },
      { kind: 'import', text: 'first-pkg' },
      { kind: 'import', text: './second.mjs' },
    ])
  })

  test('a directive after the first statement is not reported', () => {
    // TypeScript only reads directives out of a file's leading trivia, which
    // is why the ordering case above puts them all first. Pinned so that
    // arrangement reads as deliberate rather than lucky.
    expect(declarationReferences('import "m1"\n/// <reference lib="es2015" />\n')).toEqual([
      { kind: 'import', text: 'm1' },
    ])
  })

  test('a repeated reference is reported once per occurrence', () => {
    // Collapsing duplicates would hide a second path to the same package.
    expect(declarationReferences('import "dup"\nimport "dup"\n')).toHaveLength(2)
  })

  test('an ambient module declaration is not a reference', () => {
    // It declares a module rather than depending on one.
    expect(declarationReferences('declare module "amb" {}\n')).toEqual([])
  })
})

describe('runtimeModuleSpecifiers', () => {
  test('static, bare, dynamic, and require forms are all detected', () => {
    const source = [
      'import a from "static-pkg"',
      'import "bare-pkg"',
      'export const load = async () => import("dynamic-pkg")',
      'const b = require("require-pkg")',
      'export { a, b }',
      '',
    ].join('\n')

    expect(runtimeModuleSpecifiers(source)).toEqual(['static-pkg', 'bare-pkg', 'dynamic-pkg', 'require-pkg'])
  })

  test('a lazy require inside a UMD factory is detected', () => {
    // The exact shape of the bundled JSONC parser: `require` is the factory's
    // own parameter and the call happens long after load.
    const source = [
      '(function (factory) { factory(null, require); })(function (exports, require) {',
      '  exports.format = function () { return require("./impl/format"); };',
      '});',
      '',
    ].join('\n')

    expect(runtimeModuleSpecifiers(source)).toContain('./impl/format')
  })

  test('an import-shaped template literal is not a specifier', () => {
    expect(runtimeModuleSpecifiers('export const s = `import "not-real"`\n')).toEqual([])
  })

  test('a non-literal specifier is invisible to the scan', () => {
    // Documents a limitation, not a desired property: nothing static can
    // resolve these. If a future Bun release starts reporting one, this fails
    // and the scanner's documentation gets corrected rather than quietly
    // overstating what the tripwire proves.
    const source = [
      'export const byName = async (name) => import(name)',
      'export const byVar = (name) => require(name)',
      `export const byTemplate = (part) => require(\`./impl/${'$'}{part}.js\`)`,
      '',
    ].join('\n')

    expect(runtimeModuleSpecifiers(source)).toEqual([])
  })
})
