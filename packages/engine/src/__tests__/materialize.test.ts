import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION, planSingleFileInstall, planSingleFileRemoval } from '@agent-facets/adapter'
import type { ResolvedFacetManifest } from '@agent-facets/protocol'
import { adapterKey, type MaterializedAsset } from '@agent-facets/protocol'
import { SUPPORTED_ADAPTER_APIS } from '../adapters/api-compatibility.ts'
import { FileTransaction } from '../fs/index.ts'
import type { PreviousOwnership } from '../install/commit/ownership.ts'
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
  const baseDir = () => join(projectRoot, `.${name}`)
  const file = (type: string, n: string) => join(baseDir(), `${type}s`, `${n}.md`)
  const adapter: Adapter = {
    name,
    apiVersion: ADAPTER_API_VERSION,
    mcpServers: false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    assets: {
      async planInstall(request) {
        calls.push({ name: request.name, metadata: request.metadata })
        return planSingleFileInstall(
          { file: file(request.assetType, request.name), boundary: baseDir() },
          request.content,
          request.metadata as Record<string, unknown>,
        )
      },
      async planRemoval(request) {
        return planSingleFileRemoval({ file: file(request.assetType, request.name), boundary: baseDir() })
      },
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
  const file = (type: string, n: string) => join(baseDir(), `${type}s`, `${n}.md`)
  const adapter: Adapter = {
    name,
    apiVersion: ADAPTER_API_VERSION,
    mcpServers: false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    assets: {
      async planInstall(request) {
        installCalls++
        return planSingleFileInstall(
          { file: file(request.assetType, request.name), boundary: baseDir() },
          request.content,
          request.metadata as Record<string, unknown>,
        )
      },
      async planRemoval(request) {
        return planSingleFileRemoval({ file: file(request.assetType, request.name), boundary: baseDir() })
      },
    },
  }
  return {
    adapter,
    get installCalls() {
      return installCalls
    },
  }
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
      projectRoot,
      transaction: new FileTransaction(),
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
      projectRoot,
      transaction: new FileTransaction(),
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
      projectRoot,
      transaction: new FileTransaction(),
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
      projectRoot,
      transaction: new FileTransaction(),
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
      projectRoot,
      transaction: new FileTransaction(),
    })
    const second = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [fixture.adapter],
      previousOwnership: ownershipIndex(newAssets),
      newAssets,
      projectRoot,
      transaction: new FileTransaction(),
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
      projectRoot,
      transaction: new FileTransaction(),
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
      projectRoot,
      transaction: new FileTransaction(),
    })
    if (!second.ok) expect.unreachable()
    expect(second.written).toBe(0)
    expect(second.skipped).toBe(1)
    // Planning ran twice — it is read-only and cheap — but the second plan
    // concluded there was nothing to do, so nothing was written.
    expect(calls).toHaveLength(2)
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
      projectRoot,
      transaction: new FileTransaction(),
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
      projectRoot,
      transaction: new FileTransaction(),
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
      projectRoot,
      transaction: new FileTransaction(),
    })
    const second = await materialize({
      facetName: 'viper-plans',
      manifest: manifestB,
      adapters: [adapter],
      previousOwnership: ownershipIndex(newAssets),
      newAssets,
      projectRoot,
      transaction: new FileTransaction(),
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

    await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [adapter],
      previousOwnership: new Map(),
      newAssets,
      projectRoot,
      transaction: new FileTransaction(),
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
      buildAssetMetadata: () => {
        throw new Error('contract method invoked despite incompatibility')
      },
      assets: {
        async planInstall() {
          throw new Error('contract method invoked despite incompatibility')
        },
        async planRemoval() {
          throw new Error('contract method invoked despite incompatibility')
        },
      },
    } as unknown as Adapter

    const result = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [incompatible],
      previousOwnership: new Map(),
      newAssets: authoredPlan('viper-plans', manifest),
      projectRoot,
      transaction: new FileTransaction(),
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
      buildAssetMetadata: () => {
        throw new Error('contract method invoked despite incompatibility')
      },
      assets: {
        async planInstall() {
          throw new Error('contract method invoked despite incompatibility')
        },
        async planRemoval() {
          throw new Error('contract method invoked despite incompatibility')
        },
      },
    } as unknown as Adapter

    const result = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [positional],
      previousOwnership: new Map(),
      newAssets: authoredPlan('viper-plans', manifest),
      projectRoot,
      transaction: new FileTransaction(),
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

describe('materialize — a failed batch leaves nothing behind', () => {
  test('a plan refused mid-facet rolls the earlier asset back and journals nothing', async () => {
    const manifest: ResolvedFacetManifest = {
      name: 'viper-plans',
      version: '0.1.0',
      skills: {
        alpha: { description: 'a', prompt: '# a\n' },
        beta: { description: 'b', prompt: '# b\n' },
      },
    }

    // Alpha plans and commits; beta refuses. The transaction holds alpha's
    // transition, so the caller can put it back — which is the whole reason
    // the adapter no longer needs an inverse operation of its own.
    let planCount = 0
    const baseDir = join(projectRoot, '.flaky')
    const adapter: Adapter = {
      name: 'flaky',
      apiVersion: ADAPTER_API_VERSION,
      mcpServers: false,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      assets: {
        async planInstall(request) {
          planCount++
          if (planCount === 2) {
            return { ok: false, failure: { code: 'io-failed', path: request.name, message: 'boom' } }
          }
          return planSingleFileInstall(
            { file: join(baseDir, 'skills', `${request.name}.md`), boundary: baseDir },
            request.content,
            request.metadata as Record<string, unknown>,
          )
        },
        async planRemoval(request) {
          return planSingleFileRemoval({ file: join(baseDir, 'skills', `${request.name}.md`), boundary: baseDir })
        },
      },
    }

    const transaction = new FileTransaction()
    const result = await materialize({
      facetName: 'viper-plans',
      manifest,
      adapters: [adapter],
      previousOwnership: new Map(),
      newAssets: authoredPlan('viper-plans', manifest),
      projectRoot,
      transaction,
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.kind).toBe('plan-failed')

    // Alpha is on disk and journaled; rolling back removes it and leaves the
    // directory it created behind it clean.
    expect(existsSync(join(baseDir, 'skills', 'alpha.md'))).toBe(true)
    expect(transaction.journal()).toHaveLength(1)

    expect(transaction.rollback().kind).toBe('complete')
    expect(existsSync(join(baseDir, 'skills', 'alpha.md'))).toBe(false)
    expect(existsSync(baseDir)).toBe(false)
  })
})
