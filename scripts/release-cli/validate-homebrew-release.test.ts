import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { verifyHomebrewReleaseProvenance } from './homebrew-provenance'
import { allTargets, releaseArchiveName, releaseAssetTargets } from './targets'
import { type HomebrewReleaseInput, validateHomebrewRelease } from './validate-homebrew-release'

const names = releaseAssetTargets(allTargets).map(releaseArchiveName)

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fixture(tag = 'agent-facets@0.36.6'): Promise<HomebrewReleaseInput> {
  const archives = names.map((name) => ({ name, bytes: new TextEncoder().encode(name) }))
  const checksums = `${archives.map(({ name, bytes }) => `${digest(bytes)}  ${name}`).join('\n')}\n`
  const verified = await verifyHomebrewReleaseProvenance({
    tag,
    assets: archives.map((asset) => ({ ...asset, path: `/release/${asset.name}` })),
    verify: async () => true,
  })
  if (!verified.ok) expect.unreachable()
  return {
    tag,
    release: {
      tagName: tag,
      isDraft: false,
      isPrerelease: false,
      isImmutable: true,
      assets: [...archives, { name: 'checksums.txt', bytes: new TextEncoder().encode(checksums) }],
    },
    provenance: verified.provenance,
  }
}

function replaceChecksums(input: HomebrewReleaseInput, checksums: string): void {
  const index = input.release.assets.findIndex((asset) => asset.name === 'checksums.txt')
  if (index === -1) expect.unreachable()
  input.release.assets[index] = { name: 'checksums.txt', bytes: new TextEncoder().encode(checksums) }
}

test('renders a formula only from a complete immutable and attested release', async () => {
  const result = validateHomebrewRelease(await fixture())

  if (!result.ok) expect.unreachable()
  expect(result.version).toBe('0.36.6')
  expect(result.formula).toContain('facet-darwin-arm64.tar.gz')
  expect(result.formula).toContain('facet-darwin-x64.tar.gz')
})

test('verifies every expected archive before minting provenance', async () => {
  const archives = names.map((name) => ({ name, bytes: new TextEncoder().encode(name), path: `/release/${name}` }))
  const calls: string[] = []
  const result = await verifyHomebrewReleaseProvenance({
    tag: 'agent-facets@0.36.6',
    assets: archives,
    verify: async (path, sourceRef, workflow) => {
      calls.push(`${path}|${sourceRef}|${workflow}`)
      return true
    },
  })

  if (!result.ok) expect.unreachable()
  expect(calls).toHaveLength(names.length)
  expect(calls[0]).toContain(
    '|refs/tags/agent-facets@0.36.6|agent-facets/facets/.github/workflows/release-cli-assets.yml',
  )
})

test('rejects a failed attestation and raw provenance-shaped data', async () => {
  const archives = names.map((name) => ({ name, bytes: new TextEncoder().encode(name), path: `/release/${name}` }))
  const firstName = names[0]
  if (firstName === undefined) expect.unreachable()
  const rejected = await verifyHomebrewReleaseProvenance({
    tag: 'agent-facets@0.36.6',
    assets: archives,
    verify: async (path) => path !== `/release/${firstName}`,
  })
  expect(rejected).toEqual({ ok: false, code: 'provenance-unverified', asset: firstName })

  const input = await fixture()
  input.provenance = {
    tag: input.tag,
    sourceRef: `refs/tags/${input.tag}`,
    workflow: 'agent-facets/facets/.github/workflows/release-cli-assets.yml',
    archiveDigests: {},
  } as unknown as NonNullable<HomebrewReleaseInput['provenance']>
  expect(validateHomebrewRelease(input)).toEqual({ ok: false, code: 'provenance-unverified' })
})

test('rejects releases that are mutable, draft, prerelease, unverified, or have unverified bytes', async () => {
  const mutations = [
    (input: HomebrewReleaseInput) => ({ ...input, release: { ...input.release, isImmutable: false } }),
    (input: HomebrewReleaseInput) => ({ ...input, release: { ...input.release, isDraft: true } }),
    (input: HomebrewReleaseInput) => ({ ...input, release: { ...input.release, isPrerelease: true } }),
    (input: HomebrewReleaseInput) => ({ ...input, provenance: null }),
    (input: HomebrewReleaseInput) => ({
      ...input,
      release: {
        ...input.release,
        assets: [
          { name: names[0] as string, bytes: new TextEncoder().encode('replaced') },
          ...input.release.assets.slice(1),
        ],
      },
    }),
  ]
  for (const mutate of mutations) expect(validateHomebrewRelease(mutate(await fixture())).ok).toBe(false)
})

test('rejects tag mismatch, missing assets, and a bad archive checksum', async () => {
  const mismatched = await fixture()
  mismatched.release.tagName = 'agent-facets@0.36.7'
  expect(validateHomebrewRelease(mismatched)).toEqual({
    ok: false,
    code: 'release-tag-mismatch',
    tag: 'agent-facets@0.36.6',
    releaseTag: 'agent-facets@0.36.7',
  })

  const missing = await fixture()
  missing.release.assets.pop()
  expect(validateHomebrewRelease(missing)).toEqual({ ok: false, code: 'release-assets-invalid' })

  const altered = await fixture()
  altered.release.assets[0] = { name: names[0] as string, bytes: new TextEncoder().encode('altered') }
  expect(validateHomebrewRelease(altered)).toEqual({ ok: false, code: 'provenance-unverified' })
})

test('preserves an invalid formula version failure', async () => {
  const input = await fixture('agent-facets@1.0.0-beta.1')
  expect(validateHomebrewRelease(input)).toEqual({ ok: false, code: 'invalid-version', version: '1.0.0-beta.1' })
})

test('rejects duplicate release archives', async () => {
  const input = await fixture()
  const archive = input.release.assets[0]
  if (archive === undefined) expect.unreachable()
  input.release.assets.push(archive)
  expect(validateHomebrewRelease(input)).toEqual({ ok: false, code: 'release-assets-invalid' })
})

test('rejects duplicate and unexpected checksum entries', async () => {
  const duplicate = await fixture()
  const duplicateArchive = duplicate.release.assets[0]
  if (duplicateArchive === undefined) expect.unreachable()
  const duplicateLines = names.map((name) => {
    const asset = duplicate.release.assets.find((candidate) => candidate.name === name)
    if (asset === undefined) expect.unreachable()
    return `${digest(asset.bytes)}  ${name}`
  })
  duplicateLines.push(`${digest(duplicateArchive.bytes)}  ${duplicateArchive.name}`)
  replaceChecksums(duplicate, `${duplicateLines.join('\n')}\n`)
  expect(validateHomebrewRelease(duplicate)).toEqual({ ok: false, code: 'checksums-invalid' })

  const unexpected = await fixture()
  const checksumAsset = unexpected.release.assets.find((asset) => asset.name === 'checksums.txt')
  if (checksumAsset === undefined) expect.unreachable()
  replaceChecksums(
    unexpected,
    `${new TextDecoder().decode(checksumAsset.bytes)}${'f'.repeat(64)}  facet-unexpected.tar.gz\n`,
  )
  expect(validateHomebrewRelease(unexpected)).toEqual({ ok: false, code: 'checksums-invalid' })
})
