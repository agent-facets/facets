import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type { McpServerCapability } from '@agent-facets/adapter'
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
  readonly capability: McpServerCapability<unknown>
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
 * 1. `prepare` changes nothing on disk.
 * 2. `documentPaths` is non-empty and stays inside the project.
 * 3. Every changed path was disclosed by `documentPaths` first.
 * 4. Nothing is spawned and nothing is fetched — configuring a server is not
 *    running it.
 * 5. Nothing outside the project is written. MCP configuration is
 *    project-scoped, and the home directory is where a tool's user-wide
 *    config lives — the one place a plausible bug would reach for.
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
          const preparation = await options.capability.prepare({
            projectRoot: root,
            desired: matrixCase.desired,
            previouslyOwnedNames: matrixCase.previouslyOwnedNames,
          })

          expect(snapshot(root)).toEqual(seeded)

          if (matrixCase.expect.kind === 'prepare-failed') {
            if (preparation.ok) expect.unreachable()
            expect(preparation.failure.code).toBe(matrixCase.expect.code)
            return
          }

          if (!preparation.ok) expect.unreachable()
          const { plan, documentPaths, outcomes } = preparation.preparation

          expect(outcomes).toEqual(matrixCase.expect.outcomes)
          expect(documentPaths.length).toBeGreaterThan(0)
          for (const path of documentPaths) {
            expect(isAbsolute(path)).toBe(true)
            expect(relative(root, path).startsWith('..')).toBe(false)
          }

          const before = documentPaths.map((path) => [path, identity(path)] as const)

          const applied = await options.capability.apply({ plan })
          if (!applied.ok) expect.unreachable()
          expect(applied.status).toBe(matrixCase.expect.apply)

          if (applied.status === 'changed') {
            for (const path of applied.changedPaths) {
              expect(documentPaths).toContain(path)
            }
          } else {
            // "Unchanged" is a claim about the filesystem, not just a label:
            // an adapter that rewrote identical bytes would still change the
            // inode, and one that touched the file would change the mtime.
            for (const [path, snapshotBefore] of before) {
              expect(identity(path)).toEqual(snapshotBefore)
            }
          }

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

/** A document's write identity: absent, or its bytes plus inode and mtime. */
type DocumentIdentity =
  | { readonly present: false }
  | { readonly present: true; readonly text: string; readonly ino: number; readonly mtimeMs: number }

function identity(path: string): DocumentIdentity {
  if (!existsSync(path)) return { present: false }
  const stats = statSync(path)
  return { present: true, text: readFileSync(path, 'utf8'), ino: stats.ino, mtimeMs: stats.mtimeMs }
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
