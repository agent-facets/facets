import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { type GunzipFn, parseFacetArchive, validateFacetArchive } from '@agent-facets/protocol'
import { spawnCli } from './helpers/cli-process.ts'

/**
 * Reproducible candidate `0.2` archive / interop path (task 11.6).
 *
 * Builds a representative facet — a skill with a text companion and a binary
 * companion, plus an archive-only README — using the freshly compiled
 * candidate CLI (`dist/facet`, produced by `test:e2e`), then verifies the
 * emitted `.facet` through the SAME protocol verifier a registry stage uses
 * (`validateFacetArchive`). This proves the candidate producer emits a
 * verifiable `0.2` artifact with exact deterministic membership, WITHOUT
 * publishing or releasing the CLI — no Changeset is involved, and the binary
 * is the local compile.
 *
 * A registry stage acceptance run can reproduce this exact archive by running
 * `facet build` on the same source tree; the deterministic tar layout makes
 * the bytes stable across machines.
 */

let testDir: string

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'cli-candidate-archive-'))
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

async function runCli(cwd: string, ...args: string[]) {
  const facetDir = await mkdtemp(join(testDir, 'facet-dir-'))
  return await spawnCli(args, { cwd, env: { NO_COLOR: '1', FACET_DIR: facetDir } })
}

const REPRESENTATIVE_BINARY = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff, 0xfe])

/** Write the representative facet source tree into `dir`. */
async function writeRepresentativeFacet(dir: string): Promise<void> {
  await Bun.write(join(dir, 'skills/planning/SKILL.md'), '# planning\n\nPlan things.\n')
  await Bun.write(join(dir, 'skills/planning/references/api.md'), '# API reference\n')
  await Bun.write(join(dir, 'skills/planning/assets/logo.bin'), REPRESENTATIVE_BINARY)
  await Bun.write(join(dir, 'README.md'), '# Representative facet\n\nShips a README.\n')
  await Bun.write(
    join(dir, 'facet.json'),
    JSON.stringify(
      {
        name: 'representative',
        version: '1.0.0',
        description: 'A representative 0.2 facet for stage interop',
        files: ['README.md'],
        skills: {
          planning: { description: 'Planning skill', files: ['references/api.md', 'assets/logo.bin'] },
        },
      },
      null,
      2,
    ),
  )
}

const EXPECTED_MEMBERSHIP = [
  'README.md',
  'facet.json',
  'skills/planning/SKILL.md',
  'skills/planning/assets/logo.bin',
  'skills/planning/references/api.md',
].sort()

const gunzip: GunzipFn = async (bytes) => {
  try {
    return { ok: true, bytes: new Uint8Array(gunzipSync(bytes)) }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}

describe('candidate 0.2 archive interop', () => {
  test('the candidate CLI builds a verifiable 0.2 archive with exact membership', async () => {
    const dir = await mkdtemp(join(testDir, 'build-'))
    await writeRepresentativeFacet(dir)

    const built = await runCli(dir, 'build')
    expect(built.exitCode).toBe(0)

    const archivePath = join(dir, 'dist/representative-1.0.0.facet')
    expect(existsSync(archivePath)).toBe(true)
    const outerBytes = new Uint8Array(await Bun.file(archivePath).arrayBuffer())

    // Parse the outer container: the build manifest must be current 0.2.
    const parsed = parseFacetArchive(outerBytes)
    if (!parsed.ok) expect.unreachable()
    expect(parsed.data.manifest.facetVersion).toBe(0.2)

    // Verify through the shared registry-grade verifier.
    const verified = await validateFacetArchive(outerBytes, { gunzip })
    if (!verified.ok) expect.unreachable()
    if (verified.data.archiveVersion !== 0.2) expect.unreachable()

    // Exact 0.2 membership, including the archive-only README and both
    // skill companions (text + binary).
    const observed = verified.data.entries.map((e) => e.path).sort()
    expect(observed).toEqual(EXPECTED_MEMBERSHIP)

    // The archive-only README is classified as such (never a primary asset),
    // and the binary companion is grouped with its owning skill.
    const readme = verified.data.entries.find((e) => e.path === 'README.md')
    expect(readme?.kind).toBe('archive-only')
    const logo = verified.data.entries.find((e) => e.path === 'skills/planning/assets/logo.bin')
    if (logo?.kind !== 'skill-companion') expect.unreachable()
    expect(logo.skill).toBe('planning')
    expect(logo.bytes).toEqual(REPRESENTATIVE_BINARY)
  })

  test('two candidate builds of the same source are byte-identical (deterministic)', async () => {
    const build = async (name: string): Promise<Uint8Array> => {
      const dir = await mkdtemp(join(testDir, `${name}-`))
      await writeRepresentativeFacet(dir)
      const built = await runCli(dir, 'build')
      expect(built.exitCode).toBe(0)
      const archivePath = join(dir, 'dist/representative-1.0.0.facet')
      return new Uint8Array(await Bun.file(archivePath).arrayBuffer())
    }
    const a = await build('det-a')
    const b = await build('det-b')
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})
