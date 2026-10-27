import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { allTargets, releaseArchiveName, releaseAssetTargets } from './targets'
import { type HomebrewReleaseInput, validateHomebrewRelease } from './validate-homebrew-release'

const names = releaseAssetTargets(allTargets).map(releaseArchiveName)

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function fixture(): HomebrewReleaseInput {
  const archives = names.map((name) => ({ name, bytes: new TextEncoder().encode(name) }))
  const checksums = `${archives.map(({ name, bytes }) => `${digest(bytes)}  ${name}`).join('\n')}\n`
  return {
    tag: 'agent-facets@0.36.6',
    release: {
      tagName: 'agent-facets@0.36.6',
      isDraft: false,
      isPrerelease: false,
      isImmutable: true,
      assets: [...archives, { name: 'checksums.txt', bytes: new TextEncoder().encode(checksums) }],
    },
    provenance: {
      tag: 'agent-facets@0.36.6',
      sourceRef: 'refs/tags/agent-facets@0.36.6',
      workflow: 'agent-facets/facets/.github/workflows/release-cli-assets.yml',
    },
  }
}

function replaceChecksums(input: HomebrewReleaseInput, checksums: string): void {
  const index = input.release.assets.findIndex((asset) => asset.name === 'checksums.txt')
  if (index === -1) expect.unreachable()
  input.release.assets[index] = { name: 'checksums.txt', bytes: new TextEncoder().encode(checksums) }
}

test('renders a formula only from a complete immutable and attested release', () => {
  const result = validateHomebrewRelease(fixture())

  if (!result.ok) expect.unreachable()
  expect(result.version).toBe('0.36.6')
  expect(result.formula).toContain('facet-darwin-arm64.tar.gz')
  expect(result.formula).toContain('facet-darwin-x64.tar.gz')
})

test('rejects releases that are mutable, draft, prerelease, or unverified', () => {
  for (const mutate of [
    (input: HomebrewReleaseInput) => ({ ...input, release: { ...input.release, isImmutable: false } }),
    (input: HomebrewReleaseInput) => ({ ...input, release: { ...input.release, isDraft: true } }),
    (input: HomebrewReleaseInput) => ({ ...input, release: { ...input.release, isPrerelease: true } }),
    (input: HomebrewReleaseInput) => ({ ...input, provenance: null }),
    (input: HomebrewReleaseInput) => ({
      ...input,
      provenance: {
        tag: input.tag,
        sourceRef: 'refs/tags/other',
        workflow: 'agent-facets/facets/.github/workflows/release-cli-assets.yml',
      },
    }),
  ]) {
    const result = validateHomebrewRelease(mutate(fixture()))
    expect(result.ok).toBe(false)
  }
})

test('rejects tag mismatch, missing assets, and a bad archive checksum', () => {
  const mismatched = fixture()
  mismatched.release.tagName = 'agent-facets@0.36.7'
  expect(validateHomebrewRelease(mismatched)).toEqual({
    ok: false,
    code: 'release-tag-mismatch',
    tag: 'agent-facets@0.36.6',
    releaseTag: 'agent-facets@0.36.7',
  })

  const missing = fixture()
  missing.release.assets.pop()
  expect(validateHomebrewRelease(missing)).toEqual({ ok: false, code: 'release-assets-invalid' })

  const altered = fixture()
  altered.release.assets[0] = { name: names[0] as string, bytes: new TextEncoder().encode('altered') }
  expect(validateHomebrewRelease(altered)).toEqual({ ok: false, code: 'checksums-invalid' })
})

test('preserves an invalid formula version failure', () => {
  const input = fixture()
  input.tag = 'agent-facets@1.0.0-beta.1'
  input.release.tagName = input.tag
  input.provenance = {
    tag: input.tag,
    sourceRef: `refs/tags/${input.tag}`,
    workflow: 'agent-facets/facets/.github/workflows/release-cli-assets.yml',
  }

  expect(validateHomebrewRelease(input)).toEqual({
    ok: false,
    code: 'invalid-version',
    version: '1.0.0-beta.1',
  })
})

test('rejects duplicate release archives', () => {
  const input = fixture()
  const archive = input.release.assets[0]
  if (archive === undefined) expect.unreachable()
  input.release.assets.push(archive)

  expect(validateHomebrewRelease(input)).toEqual({ ok: false, code: 'release-assets-invalid' })
})

test('rejects duplicate and unexpected checksum entries', () => {
  const duplicate = fixture()
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

  const unexpected = fixture()
  const checksumAsset = unexpected.release.assets.find((asset) => asset.name === 'checksums.txt')
  if (checksumAsset === undefined) expect.unreachable()
  replaceChecksums(
    unexpected,
    `${new TextDecoder().decode(checksumAsset.bytes)}${'f'.repeat(64)}  facet-unexpected.tar.gz\n`,
  )
  expect(validateHomebrewRelease(unexpected)).toEqual({ ok: false, code: 'checksums-invalid' })
})
