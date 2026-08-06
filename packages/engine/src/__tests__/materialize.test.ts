import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION, deleteAssetFile, installAssetFile, readAssetFile } from '@agent-facets/adapter'
import type { ResolvedFacetManifest } from '@agent-facets/protocol'
import { adapterKey, type MaterializedAsset } from '@agent-facets/protocol'
import { SUPPORTED_ADAPTER_APIS } from '../adapters/api-compatibility.ts'
import type { PreviousOwnership } from '../install/commit/ownership.ts'
import { InstallJournal } from '../install/journal.ts'
import { materialize } from '../install/materialize.ts'

/**
 * The plan a facet contributes when every asset keeps its authored name.
 *
 * Built as `MaterializedAsset[]` — the real Compose output — rather than a
 * test-local identity shape, so these tests exercise the same values the
 * pipeline passes and cannot drift from it.
 */
function authoredPlan(facet: string, manifest: ResolvedFacetManifest): MaterializedAsset[] {
  const assets: MaterializedAsset[] = []
  const groups: ReadonlyArray<['skill' | 'agent' | 'command', Record<string, unknown> | undefined]> = [
    ['skill', manifest.skills],
    ['agent', manifest.agents],
    ['command', manifest.commands],
  ]
  for (const [type, group] of groups) {
    for (const name of Object.keys(group ?? {}).sort()) {
      assets.push({
        facet,
        scope: 'project',
        type,
        authoredName: name,
        effectiveName: name,
        disposition: { kind: 'authored' },
        adapterKey: adapterKey('project', type, name),
      })
    }
  }
  return assets
}

/**
 * A previous-ownership index for assets already on disk at their conventional
 * authored layout — no companions, so a replacement removes nothing extra.
 */
function ownershipIndex(assets: readonly MaterializedAsset[]): Map<string, PreviousOwnership> {
  return new Map(
    assets.map((asset) => [
      asset.adapterKey,
      {
        scope: asset.scope,
        type: asset.type,
        effectiveName: asset.effectiveName,
        ownedCompanionPaths: [],
        facets: [asset.facet],
      },
    ]),
  )
}

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
    apiVersion: ADAPTER_API_VERSION,
    supportsInstall: true,
    mcpServers: false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset(request) {
      calls.push({ name: request.name, metadata: request.metadata })
      const file = join(projectRoot, `.${name}`, `${request.assetType}s`, `${request.name}.md`)
      mkdirSync(join(projectRoot, `.${name}`, `${request.assetType}s`), { recursive: true })
      // Persist content + metadata as a composite so readAsset can
      // round-trip them, exercising the materialize skip-if-identical
      // compare path.
      const blob = JSON.stringify({ content: request.content, metadata: request.metadata ?? {} })
      writeFileSync(file, blob)
      return { ok: true, primaryPath: file }
    },
    async readAsset(request) {
      const file = join(projectRoot, `.${name}`, `${request.assetType}s`, `${request.name}.md`)
      if (!existsSync(file)) {
        return { ok: false, failure: { code: 'not-found' } }
      }
      const blob = readFileSync(file, 'utf8')
      let content = blob
      let metadata: Record<string, unknown> | undefined
      try {
        const parsed = JSON.parse(blob) as { content: string; metadata?: Record<string, unknown> }
        content = parsed.content
        metadata = parsed.metadata
      } catch {
        // Hand-edited file (e.g., the "user edit" test); return raw bytes
        // so the compare path observes the drift.
      }
      return {
        ok: true,
        asset:
          request.assetType === 'skill'
            ? { assetType: 'skill', content, metadata, companions: {} }
            : { assetType: request.assetType, content, metadata },
      }
    },
    async deleteAsset(request) {
      const file = join(projectRoot, `.${name}`, `${request.assetType}s`, `${request.name}.md`)
      const existed = existsSync(file)
      if (existed) rmSync(file)
      return { ok: true, existed, deletedPaths: existed ? [file] : [] }
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
    apiVersion: ADAPTER_API_VERSION,
    supportsInstall: true,
    mcpServers: false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset(request) {
      installCalls++
      const p = path(request.assetType, request.name)
      await installAssetFile(p, request.content, request.metadata as Record<string, unknown> | undefined)
      return { ok: true, primaryPath: p.file }
    },
    async readAsset(request) {
      try {
        const { content, metadata } = await readAssetFile(path(request.assetType, request.name))
        return {
          ok: true,
          asset:
            request.assetType === 'skill'
              ? { assetType: 'skill', content, metadata, companions: {} }
              : { assetType: request.assetType, content, metadata },
        }
      } catch {
        return { ok: false, failure: { code: 'not-found' } }
      }
    },
    async deleteAsset(request) {
      const p = path(request.assetType, request.name)
      await deleteAssetFile(p)
      return { ok: true, existed: true, deletedPaths: [p.file] }
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
    const newAssets = authoredPlan('viper-plans', manifest)

    const first = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [fixture.adapter],
      previousOwnership: new Map(),
      newAssets,
      journal: new InstallJournal(),
    })
    if (!first.ok) expect.unreachable()
    expect(first.written).toBe(1)
    expect(first.skipped).toBe(0)

    // Second materialize against the SDK-written file. If skip-if-identical
    // is broken (adapter round-trip drifts), this would still write.
    const second = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [fixture.adapter],
      previousOwnership: ownershipIndex(newAssets),
      newAssets,
      journal: new InstallJournal(),
    })
    if (!second.ok) expect.unreachable()
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
    const newAssets = authoredPlan('viper-plans', manifest)

    const first = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [fixture.adapter],
      previousOwnership: new Map(),
      newAssets,
      journal: new InstallJournal(),
    })
    if (!first.ok) expect.unreachable()
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
      facetName: 'viper-plans',
      manifest,
      adapters: [fixture.adapter],
      previousOwnership: ownershipIndex(newAssets),
      newAssets,
      journal: new InstallJournal(),
    })
    if (!second.ok) expect.unreachable()
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
    const newAssets = authoredPlan('viper-plans', manifest)

    await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [fixture.adapter],
      previousOwnership: new Map(),
      newAssets,
      journal: new InstallJournal(),
    })
    const second = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [fixture.adapter],
      previousOwnership: ownershipIndex(newAssets),
      newAssets,
      journal: new InstallJournal(),
    })
    if (!second.ok) expect.unreachable()
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
    const newAssets = authoredPlan('viper-plans', manifest)

    // First materialize: writes once.
    const first = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [adapter],
      previousOwnership: new Map(),
      newAssets,
      journal: new InstallJournal(),
    })
    if (!first.ok) expect.unreachable()
    expect(first.written).toBe(1)
    expect(first.skipped).toBe(0)
    expect(calls).toHaveLength(1)

    // Second materialize against the same disk state: skip-if-identical fires.
    const second = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [adapter],
      previousOwnership: ownershipIndex(newAssets),
      newAssets,
      journal: new InstallJournal(),
    })
    if (!second.ok) expect.unreachable()
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
    const newAssets = authoredPlan('viper-plans', manifest)

    // First materialize.
    await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [adapter],
      previousOwnership: new Map(),
      newAssets,
      journal: new InstallJournal(),
    })
    expect(calls).toHaveLength(1)

    // Hand-edit the on-disk file so its content no longer matches.
    const file = join(projectRoot, '.drifted', 'skills', 'planning.md')
    writeFileSync(file, 'unrelated user edit\n')

    const second = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [adapter],
      previousOwnership: ownershipIndex(newAssets),
      newAssets,
      journal: new InstallJournal(),
    })
    if (!second.ok) expect.unreachable()
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
    const newAssets = authoredPlan('viper-plans', manifestA)

    await materialize({
      facetName: 'viper-plans',
      manifest: manifestA,
      adapters: [adapter],
      previousOwnership: new Map(),
      newAssets,
      journal: new InstallJournal(),
    })
    const second = await materialize({
      facetName: 'viper-plans',
      manifest: manifestB,
      adapters: [adapter],
      previousOwnership: ownershipIndex(newAssets),
      newAssets,
      journal: new InstallJournal(),
    })
    if (!second.ok) expect.unreachable()
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
    const newAssets = authoredPlan('viper-plans', manifest)
    const journal = new InstallJournal()

    await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [adapter],
      previousOwnership: new Map(),
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

describe('materialize — adapter API invariant check', () => {
  test('an incompatible adapter fails before any method is invoked', async () => {
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: { planning: { description: 'planning skill', prompt: '# planning content\n' } },
    }
    const incompatible = {
      name: 'future-adapter',
      apiVersion: '9.9',
      supportsInstall: true,
      buildAssetMetadata: () => {
        throw new Error('contract method invoked despite incompatibility')
      },
      async installAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
      async readAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
      async deleteAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
    } as unknown as Adapter

    const result = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [incompatible],
      previousOwnership: new Map(),
      newAssets: authoredPlan('viper-plans', manifest),
      journal: new InstallJournal(),
    })
    if (result.ok) expect.unreachable()
    if (result.failure.kind !== 'incompatible-adapter') expect.unreachable()
    expect(result.failure.failure).toEqual({
      kind: 'api-unsupported',
      adapter: 'future-adapter',
      found: '9.9',
      supported: SUPPORTED_ADAPTER_APIS,
    })
  })

  test('a superseded positional 0.0 adapter fails before any method is invoked', async () => {
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: { planning: { description: 'planning skill', prompt: '# planning content\n' } },
    }
    // A bundle built against the earlier positional contract declares 0.0.
    // A 0.1-only CLI must reject it before invoking any contract method,
    // exactly as it would any other unsupported API.
    const positional = {
      name: 'legacy-positional',
      apiVersion: '0.0',
      supportsInstall: true,
      buildAssetMetadata: () => {
        throw new Error('contract method invoked despite incompatibility')
      },
      async installAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
      async readAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
      async deleteAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
    } as unknown as Adapter

    const result = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [positional],
      previousOwnership: new Map(),
      newAssets: authoredPlan('viper-plans', manifest),
      journal: new InstallJournal(),
    })
    if (result.ok) expect.unreachable()
    if (result.failure.kind !== 'incompatible-adapter') expect.unreachable()
    expect(result.failure.failure).toEqual({
      kind: 'api-unsupported',
      adapter: 'legacy-positional',
      found: '0.0',
      supported: SUPPORTED_ADAPTER_APIS,
    })
  })
})

describe('materialize — journal undo surfaces structured adapter failures', () => {
  test('a failed inverse op is counted by journal.rollback (not silently swallowed)', async () => {
    // Two-asset facet: the first install succeeds and records a delete-undo;
    // the second install fails, so materialize returns `install-failed`. When
    // the caller rolls back, the first asset's inverse delete returns a
    // structured `{ ok: false }`. Before the fix, the undo closure ignored
    // `result.ok`, so the journal reported a clean rollback while the asset
    // was never removed. Now the undo throws, and the journal counts it.
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: {
        alpha: { description: 'a', prompt: '# a\n' },
        beta: { description: 'b', prompt: '# b\n' },
      },
    }

    let installCount = 0
    const adapter: Adapter = {
      name: 'flaky',
      apiVersion: ADAPTER_API_VERSION,
      supportsInstall: true,
      mcpServers: false,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      async installAsset(request) {
        installCount++
        // First forward install (alpha) succeeds; second forward install
        // (beta) fails, triggering rollback of alpha.
        if (installCount === 2) {
          return { ok: false, failure: { code: 'io-failed', operation: 'write', path: request.name, message: 'boom' } }
        }
        return { ok: true, primaryPath: join(projectRoot, `${request.name}.md`) }
      },
      async readAsset() {
        // No previous state — both assets are new, so the recorded undo is a
        // delete.
        return { ok: false, failure: { code: 'not-found' } }
      },
      async deleteAsset() {
        // The inverse of a new-asset install. Fail it to prove the undo is
        // counted rather than swallowed.
        return { ok: false, failure: { code: 'io-failed', operation: 'delete', path: 'alpha', message: 'cannot undo' } }
      },
    }

    const journal = new InstallJournal()
    const newAssets = authoredPlan('viper-plans', manifest)
    const result = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [adapter],
      previousOwnership: new Map(),
      newAssets,
      journal,
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.kind).toBe('install-failed')

    // The successful alpha install left one delete-undo on the journal.
    expect(journal.size()).toBe(1)
    const rollback = await journal.rollback()
    expect(rollback.failures).toBe(1)
    expect(rollback.ok).toBe(false)
  })

  test('a successful inverse op replays cleanly', async () => {
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: {
        alpha: { description: 'a', prompt: '# a\n' },
        beta: { description: 'b', prompt: '# b\n' },
      },
    }

    let installCount = 0
    const deleted: string[] = []
    const adapter: Adapter = {
      name: 'flaky',
      apiVersion: ADAPTER_API_VERSION,
      supportsInstall: true,
      mcpServers: false,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      async installAsset(request) {
        installCount++
        if (installCount === 2) {
          return { ok: false, failure: { code: 'io-failed', operation: 'write', path: request.name, message: 'boom' } }
        }
        return { ok: true, primaryPath: join(projectRoot, `${request.name}.md`) }
      },
      async readAsset() {
        return { ok: false, failure: { code: 'not-found' } }
      },
      async deleteAsset(request) {
        deleted.push(request.name)
        return { ok: true, existed: true, deletedPaths: [join(projectRoot, `${request.name}.md`)] }
      },
    }

    const journal = new InstallJournal()
    const result = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [adapter],
      previousOwnership: new Map(),
      newAssets: authoredPlan('viper-plans', manifest),
      journal,
    })
    if (result.ok) expect.unreachable()

    const rollback = await journal.rollback()
    expect(rollback.failures).toBe(0)
    expect(rollback.ok).toBe(true)
    expect(deleted).toContain('alpha')
  })
})
