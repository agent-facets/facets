import { releaseArchiveName, type Target } from './targets'

const RELEASE_REPOSITORY = 'agent-facets/facets'
const FORMULA_NAME = 'facet'

const macosTargets = [
  { os: 'darwin', arch: 'arm64' },
  { os: 'darwin', arch: 'x64', avx2: false },
] as const satisfies Target[]

export type RenderHomebrewFormulaResult =
  | { ok: true; content: string }
  | { ok: false; code: 'invalid-version'; version: string }
  | { ok: false; code: 'invalid-checksums' }

function isStableVersion(version: string): boolean {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)
}

function releaseUrl(version: string, archive: string): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/agent-facets%40${version}/${archive}`
}

function parseChecksums(checksums: string): Map<string, string> | undefined {
  const entries = new Map<string, string>()
  const lines = checksums.trim().split('\n')
  if (lines.length === 0 || lines[0] === '') return undefined

  for (const line of lines) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line)
    if (!match?.[1] || !match[2] || entries.has(match[2])) return undefined
    entries.set(match[2], match[1])
  }
  return entries
}

function renderArchive(version: string, checksum: string, target: Target): string {
  const archive = releaseArchiveName(target)
  return `    url "${releaseUrl(version, archive)}"\n    sha256 "${checksum}"`
}

/** Render the official-tap formula from verified archive checksums. */
export function renderHomebrewFormula(version: string, checksums: string): RenderHomebrewFormulaResult {
  if (!isStableVersion(version)) return { ok: false, code: 'invalid-version', version }

  const entries = parseChecksums(checksums)
  const arm64Archive = releaseArchiveName(macosTargets[0])
  const x64Archive = releaseArchiveName(macosTargets[1])
  const arm64Checksum = entries?.get(arm64Archive)
  const x64Checksum = entries?.get(x64Archive)
  if (!entries || !arm64Checksum || !x64Checksum) return { ok: false, code: 'invalid-checksums' }

  return {
    ok: true,
    content: `class Facet < Formula
  desc "Install and manage AI coding-tool configuration"
  homepage "https://github.com/${RELEASE_REPOSITORY}"
  version "${version}"
  license "MIT"

  depends_on :macos

  on_arm do
${renderArchive(version, arm64Checksum, macosTargets[0])}
  end

  on_intel do
${renderArchive(version, x64Checksum, macosTargets[1])}
  end

  def install
    bin.install "${FORMULA_NAME}"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/facet --version").strip
    assert_match "Usage:", shell_output("#{bin}/facet --help")
  end
end
`,
  }
}
