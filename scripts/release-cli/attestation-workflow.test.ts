import { expect, test } from 'bun:test'

test('the archive workflow builds, attests, verifies, then publishes the exact tag', async () => {
  const source = await Bun.file(new URL('../../.github/workflows/release-cli-assets.yml', import.meta.url)).text()

  expect(source).toContain('workflow_dispatch:')
  expect(source).toContain(`ref: \${{ inputs.tag }}`)
  expect(source).toContain('contents: write')
  expect(source).toContain('id-token: write')
  expect(source).toContain('attestations: write')
  expect(source).toContain('actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4')
  expect(source).toContain('subject-checksums: packages/cli/dist/release-assets/checksums.txt')
  expect(source).toContain('FACET_RELEASE_AUTH: workflow-token')
  expect(source).toContain('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/release-cli-assets.yml"')
  expect(source).toContain('--source-ref "refs/tags/$TAG"')

  const stage = source.indexOf("FACET_RELEASE_PUBLISH: 'false'")
  const attest = source.indexOf('actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6')
  const verify = source.indexOf('Verify archive provenance')
  const publish = source.indexOf('Publish the attested release draft')
  expect(stage).toBeGreaterThan(-1)
  expect(stage).toBeLessThan(attest)
  expect(attest).toBeLessThan(verify)
  expect(verify).toBeLessThan(publish)
})
