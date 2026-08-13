import ts from 'typescript'

/**
 * What a built artifact actually reaches for.
 *
 * Two scanners, because the two artifacts are two different languages and a
 * scanner that is right about one is wrong about the other.
 *
 * A regex over `from "..."` is right about neither. It cannot see a bare
 * `import "pkg"`, and — the reason this exists — it cannot see the
 * `import("pkg").Type` nodes a declaration emitter produces when it inlines a
 * type from another package. That is precisely the form of the regression the
 * SDK's packed-declaration tripwire was written to catch, so a tripwire built
 * on that regex was green for the one thing it was guarding.
 */

/** How a declaration file reaches outside itself. */
export type DeclarationReferenceKind = 'import' | 'types-directive' | 'lib-directive' | 'path-directive'

/** One thing an emitted `.d.mts` names beyond its own contents. */
export interface DeclarationReference {
  readonly kind: DeclarationReferenceKind
  /** Exactly the text between the quotes, as written. */
  readonly text: string
}

/**
 * Every external reference an emitted `.d.mts` makes, in source order.
 *
 * Uses the TypeScript preprocessor rather than a regex or a JavaScript
 * transpiler: declaration files are almost entirely type positions, and a
 * transpiler erases those before anything can look at them. The preprocessor
 * reads the same token stream the compiler does, so `import ... from`, bare
 * `import "pkg"`, `export ... from`, `import x = require("pkg")`, and
 * `import("pkg")` type nodes all count, while an import-shaped string literal
 * or comment does not.
 *
 * Triple-slash directives count too, and are tagged rather than flattened in
 * beside the module specifiers: `/// <reference types="node" />` reaches
 * another package exactly the way an import does — it is a dependency a
 * consumer must have installed — while `lib` names a compiler library and
 * `path` names a file, and neither is a module specifier at all. One list with
 * a `kind` keeps every reference visible to the tripwire without pretending
 * `es2015` is something you can import.
 *
 * An ambient `declare module "x"` is deliberately excluded. It declares a
 * module rather than depending on one, so counting it would report a
 * dependency the artifact does not have.
 *
 * All four kinds share one field set, so this is one record with a tag rather
 * than a four-armed union whose arms would be identical.
 */
export function declarationReferences(source: string): readonly DeclarationReference[] {
  const info = ts.preProcessFile(source, true, true)
  // Each array is already in source order, but they are four separate passes
  // over one file, so only their positions can interleave them correctly.
  return [
    ...tagged(info.importedFiles, 'import'),
    ...tagged(info.typeReferenceDirectives, 'types-directive'),
    ...tagged(info.libReferenceDirectives, 'lib-directive'),
    ...tagged(info.referencedFiles, 'path-directive'),
  ]
    .sort((left, right) => left.pos - right.pos)
    .map(({ kind, text }) => ({ kind, text }))
}

function tagged(
  references: readonly ts.FileReference[],
  kind: DeclarationReferenceKind,
): { kind: DeclarationReferenceKind; text: string; pos: number }[] {
  return references.map((reference) => ({ kind, text: reference.fileName, pos: reference.pos }))
}

/**
 * Every module specifier emitted JavaScript resolves at runtime, in source
 * order.
 *
 * A real scan rather than a regex for the same reason: a bundled dependency
 * can contain a template literal that reads like an import, and a CommonJS
 * dependency whose `require('./impl/...')` survived bundling looks fine until
 * the moment that code path runs. A literal `require` is caught even when it
 * is lazy and even when `require` is a UMD factory's own parameter, which is
 * the shape that matters here.
 *
 * What it cannot see is a specifier that is not a literal: `require(name)`,
 * `` require(`./impl/${part}.js`) ``, a `createRequire(...)` handle called
 * later, or an AMD `define([...])` dependency array. Nothing static can
 * resolve those, so this scan proves that no *statically resolvable*
 * specifier escaped bundling — not that no specifier did. A computed one is
 * caught only by exercising the code path, which is why each adapter's own
 * end-to-end test drives its write path through the built bundle.
 */
export function runtimeModuleSpecifiers(source: string): string[] {
  return new Bun.Transpiler({ loader: 'js' }).scanImports(source).map((reference) => reference.path)
}
