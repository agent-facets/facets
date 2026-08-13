import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type { McpServerCapability } from '@agent-facets/adapter'
import { commitMutations, currentFileState } from './apply-plan.ts'
import { MCP_MATRIX_CASES, type McpMatrixCaseId } from './mcp-matrix.ts'

/** The native document(s) a case starts from, keyed by path relative to the project root. */
export interface McpMatrixSeed {
  readonly files: Readonly<Record<string, string>>
  /**
   * Extra assertions once the case has run — the place to prove a comment
   * survived, an unrelated setting is intact, or a native extension was
   * carried forward. Only called when the case reached `apply`.
   */
  readonly after?: (project: McpMatrixProject) => void
}

export interface McpMatrixProject {
  readonly root: string
  /** The document's text now, or `null` if it does not exist. */
  readonly read: (relativePath: string) => string | null
  /** The document's text as the seed wrote it. */
  readonly seeded: (relativePath: string) => string | null
}

export interface RunMcpServerMatrixOptions {
  readonly capability: McpServerCapability
  readonly seeds: Readonly<Record<McpMatrixCaseId, McpMatrixSeed>>
}

/**
 * Run the shared MCP fixture matrix against one adapter's capability.
 *
 * Beyond each case's own expectations, five invariants are asserted for every
 * case — they are properties of the capability contract rather than of any
 * individual fixture, so stating them per case would be noise that eventually
 * gets forgotten on the one case that needed it:
 *
 * 1. `plan` changes nothing on disk. Planning is read-only, always.
 * 2. Every planned path is absolute and stays inside the project.
 * 3. Every planned write carries the state the document was actually in, so
 *    the caller can detect a concurrent edit and restore exact prior bytes.
 * 4. Nothing is spawned and nothing is fetched — configuring a server is not
 *    running it.
 * 5. Nothing outside the project is written. MCP configuration is
 *    project-scoped, and the home directory is where a tool's user-wide
 *    config lives — the one place a plausible bug would reach for.
 *
 * The harness applies the plan itself rather than importing the engine's
 * transaction: what is under test here is the adapter's plan, and a local
 * applier keeps the adapter packages from depending on the engine to be tested.
 */
export function runMcpServerMatrix(options: RunMcpServerMatrixOptions): void {
  describe('MCP server matrix', () => {
    let root: string
    let home: string
    let originalHome: string | undefined
    let originalUserProfile: string | undefined

    beforeEach(() => {
      // `realpathSync` because macOS hands out `/var/...` temp paths that
      // resolve to `/private/var/...`; without it, comparing a disclosed
      // document path against the project root is a suffix match at best.
      root = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-matrix-')))
      home = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-matrix-home-')))
      originalHome = process.env.HOME
      originalUserProfile = process.env.USERPROFILE
      process.env.HOME = home
      process.env.USERPROFILE = home
    })

    afterEach(() => {
      if (originalHome === undefined) delete process.env.HOME
      else process.env.HOME = originalHome
      if (originalUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = originalUserProfile
      rmSync(root, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    })

    for (const matrixCase of MCP_MATRIX_CASES) {
      const seed = options.seeds[matrixCase.id]

      test(`${matrixCase.id}: ${matrixCase.describes}`, async () => {
        for (const [relativePath, contents] of Object.entries(seed.files)) {
          const file = join(root, relativePath)
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, contents)
          // Back-date so a same-millisecond rewrite cannot masquerade as "no
          // write" on a filesystem with coarse timestamps.
          const past = new Date(Date.now() - 60_000)
          utimesSync(file, past, past)
        }

        const seeded = snapshot(root)
        const project: McpMatrixProject = {
          root,
          read: (relativePath) => readIfPresent(join(root, relativePath)),
          seeded: (relativePath) => seeded.get(relativePath)?.text ?? null,
        }

        const restoreGuards = forbidExecutionAndNetwork()
        try {
          const planned = await options.capability.plan({
            projectRoot: root,
            desired: matrixCase.desired,
            previouslyOwnedNames: matrixCase.previouslyOwnedNames,
          })

          expect(snapshot(root)).toEqual(seeded)

          if (matrixCase.expect.kind === 'prepare-failed') {
            if (planned.ok) expect.unreachable()
            expect(planned.failure.code).toBe(matrixCase.expect.code)
            return
          }

          if (!planned.ok) expect.unreachable()
          const { action, outcomes } = planned.plan

          expect(outcomes).toEqual(matrixCase.expect.outcomes)
          expect(action.kind).toBe(matrixCase.expect.apply === 'changed' ? 'mutate' : 'unchanged')

          if (action.kind === 'unchanged') {
            seed.after?.(project)
            return
          }

          for (const mutation of action.mutations) {
            expect(isAbsolute(mutation.path)).toBe(true)
            expect(relative(root, mutation.path).startsWith('..')).toBe(false)
            expect(mutation.boundary).toBe(root)
            // The planned precondition must be what is genuinely on disk, or
            // the caller's concurrency check would reject a correct plan — and
            // its rollback would restore bytes that were never there.
            expect(mutation.expected).toEqual(currentFileState(mutation.path))
          }

          commitMutations(action.mutations)
          seed.after?.(project)
        } finally {
          restoreGuards()
          // Project-scoped means project-scoped. A user-wide document the
          // adapter created would otherwise sit outside every assertion this
          // harness makes, since they all walk the project tree.
          expect(snapshot(home)).toEqual(new Map())
        }
      })
    }
  })
}

function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** Every file under `root`, so "prepare wrote nothing" can be asserted whole. */
function snapshot(root: string): Map<string, { text: string }> {
  const files = new Map<string, { text: string }>()
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
      } else {
        files.set(relative(root, absolute), { text: readFileSync(absolute, 'utf8') })
      }
    }
  }
  walk(root)
  return files
}

/**
 * Make launching a process or opening a connection fail loudly for the
 * duration of a case. Materializing configuration must never do either.
 */
function forbidExecutionAndNetwork(): () => void {
  const originalFetch = globalThis.fetch
  const originalSpawn = Bun.spawn
  const originalSpawnSync = Bun.spawnSync

  const forbid = (what: string) => () => {
    throw new Error(`MCP reconciliation must not ${what}`)
  }

  globalThis.fetch = forbid('open a network connection') as unknown as typeof globalThis.fetch
  Bun.spawn = forbid('spawn a process') as unknown as typeof Bun.spawn
  Bun.spawnSync = forbid('spawn a process') as unknown as typeof Bun.spawnSync

  return () => {
    globalThis.fetch = originalFetch
    Bun.spawn = originalSpawn
    Bun.spawnSync = originalSpawnSync
  }
}
