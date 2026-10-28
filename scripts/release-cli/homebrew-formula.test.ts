import { describe, expect, test } from 'bun:test'
import { renderHomebrewFormula } from './homebrew-formula'

const arm64 = 'facet-darwin-arm64.tar.gz'
const x64 = 'facet-darwin-x64.tar.gz'
const arm64Digest = 'a'.repeat(64)
const x64Digest = 'b'.repeat(64)

function checksums(...lines: string[]): string {
  return `${lines.join('\n')}\n`
}

describe('renderHomebrewFormula', () => {
  test('renders immutable macOS archive URLs and checksums', () => {
    const result = renderHomebrewFormula('0.36.6', checksums(`${arm64Digest}  ${arm64}`, `${x64Digest}  ${x64}`))

    if (!result.ok) expect.unreachable()
    expect(result.content).toContain('class Facet < Formula')
    expect(result.content).toContain('depends_on :macos')
    expect(result.content).toContain(
      'https://github.com/agent-facets/facets/releases/download/agent-facets%400.36.6/facet-darwin-arm64.tar.gz',
    )
    expect(result.content).toContain(
      'https://github.com/agent-facets/facets/releases/download/agent-facets%400.36.6/facet-darwin-x64.tar.gz',
    )
    expect(result.content).toContain(`sha256 "${arm64Digest}"`)
    expect(result.content).toContain(`sha256 "${x64Digest}"`)
    expect(result.content).toContain('bin.install "facet"')
    expect(result.content).toContain('assert_equal version.to_s, shell_output("#{bin}/facet --version").strip')
    expect(result.content).toContain('facet --help')
  })

  test.each([
    'latest',
    '0.36',
    '0.36.6-rc.1',
    'v0.36.6',
    '01.2.3',
    '1.02.3',
    '1.2.03',
  ])('rejects non-stable version %s', (version) => {
    expect(renderHomebrewFormula(version, checksums(`${arm64Digest}  ${arm64}`, `${x64Digest}  ${x64}`))).toEqual({
      ok: false,
      code: 'invalid-version',
      version,
    })
  })

  test('rejects missing macOS archives', () => {
    expect(renderHomebrewFormula('0.36.6', checksums(`${arm64Digest}  ${arm64}`))).toEqual({
      ok: false,
      code: 'invalid-checksums',
    })
  })

  test('rejects duplicate or malformed checksum entries', () => {
    expect(renderHomebrewFormula('0.36.6', checksums(`${arm64Digest}  ${arm64}`, `${arm64Digest}  ${arm64}`))).toEqual({
      ok: false,
      code: 'invalid-checksums',
    })
    expect(renderHomebrewFormula('0.36.6', checksums(`not-a-hash  ${arm64}`, `${x64Digest}  ${x64}`))).toEqual({
      ok: false,
      code: 'invalid-checksums',
    })
  })
})
