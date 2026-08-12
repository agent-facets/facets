import ts from 'typescript'

/**
 * Which modules a built artifact actually reaches for.
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

/**
 * Every module specifier an emitted `.d.mts` references, in source order.
 *
 * Uses the TypeScript preprocessor rather than a regex or a JavaScript
 * transpiler: declaration files are almost entirely type positions, and a
 * transpiler erases those before anything can look at them. The preprocessor
 * reads the same token stream the compiler does, so `import ... from`, bare
 * `import "pkg"`, `export ... from`, and `import("pkg")` type nodes all count,
 * while an import-shaped string literal or comment does not.
 */
export function declarationModuleSpecifiers(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((reference) => reference.fileName)
}

/**
 * Every module specifier emitted JavaScript resolves at runtime, in source
 * order.
 *
 * A real scan rather than a regex for the same reason: a bundled dependency
 * can contain a template literal that reads like an import, and a CommonJS
 * dependency whose lazy `require('./impl/...')` survived bundling looks fine
 * until the moment that code path runs.
 */
export function runtimeModuleSpecifiers(source: string): string[] {
  return new Bun.Transpiler({ loader: 'js' }).scanImports(source).map((reference) => reference.path)
}
