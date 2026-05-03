import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { deleteAssetFile, installAssetFile, readAssetFile } from '@agent-facets/adapter'
import { InstallJournal } from '../install/journal.ts'
import { computeAssetList, materialize } from '../install/materialize.ts'
import type { ResolvedFacetManifest } from '../loaders/facet.ts'

let projectRoot: string

beforeEach(() => {
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'materialize-test-')))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

/**
 * Records every metadata bag passed to `installAsset` so tests can
 * assert on what front-matter the manifest produces.
 */
function buildRecordingAdapter(name: string): {
  adapter: Adapter
  calls: Array<{ name: string; metadata: unknown }>
} {
  const calls: Array<{ name: string; metadata: unknown }> = []
  const adapter: Adapter = {
    name,
    supportsInstall: true,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset(_scope, type, n, content, metadata) {
      calls.push({ name: n, metadata })
      const file = join(projectRoot, `.${name}`, `${type}s`, `${n}.md`)
      mkdirSync(join(projectRoot, `.${name}`, `${type}s`), { recursive: true })
      // Persist content + metadata as a composite so readAsset can
      // round-trip them, exercising the materialize skip-if-identical
      // compare path.
      const blob = JSON.stringify({ content, metadata: metadata ?? {} })
      writeFileSync(file, blob)
    },
    async readAsset(_scope, type, n) {
      const file = join(projectRoot, `.${name}`, `${type}s`, `${n}.md`)
      if (!existsSync(file)) {
        const err: NodeJS.ErrnoException = new Error('ENOENT')
        err.code = 'ENOENT'
        throw err
      }
      const blob = readFileSync(file, 'utf8')
      try {
        const parsed = JSON.parse(blob) as { content: string; metadata?: Record<string, unknown> }
        return { content: parsed.content, metadata: parsed.metadata }
      } catch {
        // Hand-edited file (e.g., the "user edit" test); return raw bytes
        // so the compare path observes the drift.
        return { content: blob }
      }
    },
    async deleteAsset(_scope, type, n) {
      const file = join(projectRoot, `.${name}`, `${type}s`, `${n}.md`)
      if (existsSync(file)) rmSync(file)
    },
  }
  return { adapter, calls }
}

/**
 * An adapter that uses the published `@agent-facets/adapter` SDK
 * helpers verbatim — exactly how every real adapter (claude-code,
 * opencode, …) writes and reads asset files. Tests using this adapter
 * exercise the full SDK round-trip (front-matter assemble → write →
 * read → split) so they catch round-trip mismatches that an
 * in-memory recording adapter would miss.
 */
function buildSdkAdapter(name: string): {
  adapter: Adapter
  installCalls: number
} {
  let installCalls = 0
  const baseDir = () => join(projectRoot, `.${name}`)
  const path = (type: string, n: string) => ({
    file: join(baseDir(), `${type}s`, `${n}.md`),
  })
  const adapter: Adapter = {
    name,
    supportsInstall: true,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset(_scope, type, n, content, metadata) {
      installCalls++
      await installAssetFile(path(type, n), content, metadata as Record<string, unknown> | undefined)
    },
    async readAsset(_scope, type, n) {
      return readAssetFile(path(type, n))
    },
    async deleteAsset(_scope, type, n) {
      await deleteAssetFile(path(type, n))
    },
  }
  return {
    adapter,
    get installCalls() {
      return installCalls
    },
  } as { adapter: Adapter; installCalls: number }
}

describe('materialize — skip-if-identical via real SDK round-trip', () => {
  test('second materialize call against unchanged disk reports skipped:1, written:0', async () => {
    // This is the bug-catching test. The recording adapter we use in the
    // other tests round-trips content and metadata losslessly because it
    // serializes the whole object as JSON. Real adapters use the SDK's
    // front-matter assemble/split, which can subtly mutate metadata
    // (key ordering, string normalization, optional-field semantics).
    // If skip-if-identical compares the post-write read against what we'd
    // write next, the SDK's round-trip must produce identical bytes for
    // the second materialize to skip. If it doesn't, every facet install
    // will report 'repaired' forever.
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: { planning: { description: 'planning skill', prompt: '# planning content\n' } },
    }
    const fixture = buildSdkAdapter('sdk-test')
    const newAssets = computeAssetList(manifest)

    const first = await materialize({
      manifest,
      adapters: [fixture.adapter],
      oldAssets: [],
      newAssets,
      journal: new InstallJournal(),
    })
    expect(first.written).toBe(1)
    expect(first.skipped).toBe(0)

    // Second materialize against the SDK-written file. If skip-if-identical
    // is broken (adapter round-trip drifts), this would still write.
    const second = await materialize({
      manifest,
      adapters: [fixture.adapter],
      oldAssets: newAssets,
      newAssets,
      journal: new InstallJournal(),
    })
    expect(second.written).toBe(0)
    expect(second.skipped).toBe(1)
  })

  test('author front matter in the prompt body survives, manifest wins on conflict, and re-install skips', async () => {
    // The user-shipped scenario: an author writes a `commands/foo.md` with
    // their own YAML front matter (e.g., `agent: cowsay`), maybe also
    // including their own `name`/`description` that conflict with what
    // the manifest says. The build pipeline preserves the file verbatim;
    // materialize merges the manifest's canonical name + description on
    // top, the adapter SDK serializes the merged metadata to the file's
    // front matter, and the body is preserved. A second install must
    // skip — proving that the skip-if-identical comparison handles the
    // body-vs-merged-content asymmetry correctly.
    const promptBody = '---\nagent: cowsay\nname: bogus\n---\n# foo body\n'
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      commands: { foo: { description: 'real desc', prompt: promptBody } },
    }
    const fixture = buildSdkAdapter('sdk-author-fm')
    const newAssets = computeAssetList(manifest)

    const first = await materialize({
      manifest,
      adapters: [fixture.adapter],
      oldAssets: [],
      newAssets,
      journal: new InstallJournal(),
    })
    expect(first.written).toBe(1)
    expect(first.skipped).toBe(0)

    // Inspect on-disk file directly: manifest wins on name/description,
    // author's other front-matter keys survive, body is preserved.
    const file = join(projectRoot, '.sdk-author-fm', 'commands', 'foo.md')
    const onDisk = readFileSync(file, 'utf8')
    expect(onDisk).toContain('name: foo')
    expect(onDisk).toContain('description: real desc')
    expect(onDisk).toContain('agent: cowsay')
    expect(onDisk).not.toContain('name: bogus')
    expect(onDisk).toContain('# foo body')

    // Second materialize against the same disk state must skip — this
    // exercises the skip-if-identical fix in materialize.ts.
    const second = await materialize({
      manifest,
      adapters: [fixture.adapter],
      oldAssets: newAssets,
      newAssets,
      journal: new InstallJournal(),
    })
    expect(second.written).toBe(0)
    expect(second.skipped).toBe(1)
  })

  test('SDK round-trip with adapter extras reports skipped:1 on re-install', async () => {
    // The case that production hit: a facet declares an `adapters.<name>`
    // block. materialize merges those extras into the metadata bag. The
    // SDK serializes them as YAML front-matter, then splits them back on
    // read. If that round-trip isn't byte-identical, every re-install
    // fires 'repaired'.
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: {
        planning: {
          description: 'planning skill',
          prompt: '# planning content\n',
          adapters: { 'sdk-extras-test': { customField: 'hello', enabled: true } },
        },
      },
    }
    const fixture = buildSdkAdapter('sdk-extras-test')
    const newAssets = computeAssetList(manifest)

    await materialize({
      manifest,
      adapters: [fixture.adapter],
      oldAssets: [],
      newAssets,
      journal: new InstallJournal(),
    })
    const second = await materialize({
      manifest,
      adapters: [fixture.adapter],
      oldAssets: newAssets,
      newAssets,
      journal: new InstallJournal(),
    })
    expect(second.written).toBe(0)
    expect(second.skipped).toBe(1)
  })
})

describe('materialize — skip-if-identical', () => {
  test('returns skipped:1, written:0 when content + metadata match on disk', async () => {
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: { planning: { description: 'planning skill', prompt: '# planning content' } },
    }
    const { adapter, calls } = buildRecordingAdapter('repeat')
    const newAssets = computeAssetList(manifest)

    // First materialize: writes once.
    const first = await materialize({
      manifest,
      adapters: [adapter],
      oldAssets: [],
      newAssets,
      journal: new InstallJournal(),
    })
    expect(first.written).toBe(1)
    expect(first.skipped).toBe(0)
    expect(calls).toHaveLength(1)

    // Second materialize against the same disk state: skip-if-identical fires.
    const second = await materialize({
      manifest,
      adapters: [adapter],
      oldAssets: newAssets,
      newAssets,
      journal: new InstallJournal(),
    })
    expect(second.written).toBe(0)
    expect(second.skipped).toBe(1)
    // Still only 1 install call total — the second materialize didn't write.
    expect(calls).toHaveLength(1)
  })

  test('returns written:1 when on-disk content differs (e.g., user edited the file)', async () => {
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: { planning: { description: 'planning skill', prompt: '# planning content' } },
    }
    const { adapter, calls } = buildRecordingAdapter('drifted')
    const newAssets = computeAssetList(manifest)

    // First materialize.
    await materialize({
      manifest,
      adapters: [adapter],
      oldAssets: [],
      newAssets,
      journal: new InstallJournal(),
    })
    expect(calls).toHaveLength(1)

    // Hand-edit the on-disk file so its content no longer matches.
    const file = join(projectRoot, '.drifted', 'skills', 'planning.md')
    writeFileSync(file, 'unrelated user edit\n')

    const second = await materialize({
      manifest,
      adapters: [adapter],
      oldAssets: newAssets,
      newAssets,
      journal: new InstallJournal(),
    })
    expect(second.written).toBe(1)
    expect(second.skipped).toBe(0)
    expect(calls).toHaveLength(2)
  })

  test('returns written:1 when content matches but metadata differs', async () => {
    const manifestA: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: {
        planning: {
          description: 'planning skill',
          prompt: '# planning content',
          adapters: { 'meta-test': { extra: 'first' } },
        },
      },
    }
    const manifestB: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: {
        planning: {
          description: 'planning skill',
          prompt: '# planning content',
          adapters: { 'meta-test': { extra: 'second' } },
        },
      },
    }
    const { adapter, calls } = buildRecordingAdapter('meta-test')
    const newAssets = computeAssetList(manifestA)

    await materialize({
      manifest: manifestA,
      adapters: [adapter],
      oldAssets: [],
      newAssets,
      journal: new InstallJournal(),
    })
    const second = await materialize({
      manifest: manifestB,
      adapters: [adapter],
      oldAssets: newAssets,
      newAssets,
      journal: new InstallJournal(),
    })
    expect(second.written).toBe(1)
    expect(second.skipped).toBe(0)
    expect(calls).toHaveLength(2)
  })
})

describe('materialize — adapter-extras cannot override computed identity', () => {
  test('asset name and description from manifest always win over adapters block', async () => {
    // Manifest declares an asset with adapters.<name> trying to override
    // the computed name and description. The materializer must ignore
    // those override attempts and emit the canonical values.
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: {
        planning: {
          description: 'planning skill',
          prompt: '# planning content',
          adapters: {
            recorder: {
              name: 'OVERRIDDEN_NAME',
              description: 'OVERRIDDEN_DESCRIPTION',
              extra: 'allowed-extra',
            },
          },
        },
      },
    }

    const { adapter, calls } = buildRecordingAdapter('recorder')
    const newAssets = computeAssetList(manifest)
    const journal = new InstallJournal()

    await materialize({
      manifest,
      adapters: [adapter],
      oldAssets: [],
      newAssets,
      journal,
    })

    expect(calls).toHaveLength(1)
    const meta = calls[0]?.metadata as Record<string, unknown>
    // Computed values always win.
    expect(meta.name).toBe('planning')
    expect(meta.description).toBe('planning skill')
    // Non-conflicting extras are passed through.
    expect(meta.extra).toBe('allowed-extra')
  })
})
