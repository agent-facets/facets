/**
 * Packed-artifact coverage for the SDK's dependency invariant and its
 * published factory contract.
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
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
// Reached by path rather than by package specifier on purpose. The test kit
// already depends on this package, so declaring the reverse edge would make the
// two mutually dependent and the task graph cyclic. Both scanners still have
// exactly one implementation, and it lives beside the adapters that share it —
// as does their own coverage, which needs no build output.
//
// The scanner module itself rather than the kit's barrel: the barrel also
// carries the adapter conformance harness, which is written against adapter
// planning, and this file needs nothing of it.
import { declarationReferences, runtimeModuleSpecifiers } from '../../../adapter-test-kit/src/module-specifiers.ts'

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

// --- The published factory returns a result, never a bare adapter ---

test('the built factory returns results and throws for no invalid definition', async () => {
  const sdk = (await import(join(DIST_DIR, 'index.mjs'))) as typeof import('../index.ts')
  const valid = sdk.defineAdapter({
    name: 'published',
    assets: false,
    mcpServers: false,
    buildAssetMetadata: () => ({ ok: true, data: {} }),
  })
  if (!valid.ok) expect.unreachable()
  expect(valid.data.apiVersion).toBe('0.4')

  for (const definition of [null, [], 'adapter', { name: '' }]) {
    // biome-ignore lint/suspicious/noExplicitAny: simulating untyped JavaScript input
    const invalid = sdk.defineAdapter(definition as any)
    if (invalid.ok) expect.unreachable()
    expect(invalid.errors.length).toBeGreaterThan(0)
  }
})

let consumerDir: string

beforeAll(() => {
  consumerDir = realpathSync(mkdtempSync(join(tmpdir(), 'facet-adapter-dist-')))
})

afterAll(() => {
  if (consumerDir !== undefined) rmSync(consumerDir, { recursive: true, force: true })
})

/**
 * A strict consumer of the emitted declarations. Each `@ts-expect-error` is a
 * check of its own: were the factory still declared to return a bare adapter,
 * the directive would be unused, and that is itself a compile error.
 */
function consumer(): string {
  const entry = JSON.stringify(join(DIST_DIR, 'index.mjs'))
  return `
import { defineAdapter, type Adapter, type PlanningContext } from ${entry}

const result = defineAdapter({
  name: 'consumer',
  assets: false,
  mcpServers: {
    supportedScopes: ['user'],
    locationEnvironment: ['XDG_CONFIG_HOME'],
    async plan() {
      return { ok: true, plan: { outcomes: [], documentPaths: ['/a'], action: { kind: 'unchanged' } } }
    },
  },
  buildAssetMetadata: () => ({ ok: true, data: {} }),
})

// @ts-expect-error a factory result is not an adapter until it has been checked
export const unchecked: Adapter = result

export const checked: Adapter | undefined = result.ok ? result.data : undefined
export const errors = result.ok ? [] : result.errors.map((error) => error.path)

export const user: PlanningContext = { target: { scope: 'user' }, homeDirectory: '/h', environment: {} }
// @ts-expect-error a user target carries no project root
export const mixed: PlanningContext = { target: { scope: 'user', projectRoot: '/w' }, homeDirectory: '/h', environment: {} }
// @ts-expect-error system-wide installation is not a target
export const system: PlanningContext = { target: { scope: 'system' }, homeDirectory: '/h', environment: {} }
`
}

test('a strict consumer type-checks against the published declarations', () => {
  const file = join(consumerDir, 'consumer.mts')
  writeFileSync(file, consumer())
  const tsgo = join(dirname(Bun.resolveSync('@typescript/native-preview/package.json', import.meta.dir)), 'bin', 'tsgo')
  // Explicit options, an explicit file, and no project: nothing here may pick
  // up a workspace tsconfig, a path alias, or ambient types.
  const run = Bun.spawnSync(
    [
      tsgo,
      '--noEmit',
      '--strict',
      '--target',
      'es2022',
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
      file,
    ],
    { cwd: consumerDir, stdout: 'pipe', stderr: 'pipe' },
  )
  expect(`${run.stdout.toString()}${run.stderr.toString()}`).toBe('')
  expect(run.exitCode).toBe(0)
})
