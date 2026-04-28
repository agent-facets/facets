import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { io } from './io'
import { extractPackFilename, packAndPublish } from './npm'
import { shellResult } from './test-helpers'

describe('extractPackFilename', () => {
  test('returns the filename when stdout is just the filename', () => {
    expect(extractPackFilename('pkg-1.0.0.tgz')).toBe('pkg-1.0.0.tgz')
  })

  test('returns the filename when stdout has a trailing newline', () => {
    expect(extractPackFilename('pkg-1.0.0.tgz\n')).toBe('pkg-1.0.0.tgz')
  })

  test('returns the filename when stdout has surrounding blank lines', () => {
    expect(extractPackFilename('\npkg-1.0.0.tgz\n')).toBe('pkg-1.0.0.tgz')
  })

  test('returns the filename from realistic noisy stdout (CircleCI 782 regression)', () => {
    // The actual 5-line shape `bun pm pack --quiet` emitted in CircleCI job 782,
    // which `npm publish` then rejected with EUNSUPPORTEDPROTOCOL because the
    // leading `prepack:` chunk parsed as a URL protocol scheme. Even after the
    // companion stderr fix in scripts/prepack.ts, this parser is the second
    // line of defense if anything else ever leaks lifecycle output to stdout.
    const stdout =
      'prepack: rewrote workspace:* dependencies; hoisted publishConfig fields to top-level; stripped devDependencies\n' +
      '\n' +
      'agent-facets-adapter-opencode-0.4.2.tgz\n' +
      '\n' +
      'postpack: restored original package.json\n'

    expect(extractPackFilename(stdout)).toBe('agent-facets-adapter-opencode-0.4.2.tgz')
  })

  test('handles indented or whitespace-padded .tgz lines', () => {
    expect(extractPackFilename('  pkg-1.0.0.tgz  \n')).toBe('pkg-1.0.0.tgz')
  })

  test('throws with the raw stdout in the message when zero .tgz lines are present', () => {
    const stdout = 'prepack: hoisted\n'
    expect(() => extractPackFilename(stdout)).toThrow(/no \.tgz filename/)
    // The raw stdout is included in the error for debugging future regressions.
    expect(() => extractPackFilename(stdout)).toThrow(JSON.stringify(stdout))
  })

  test('throws with "ambiguous" when multiple .tgz lines are present', () => {
    // Hypothetical scenario: a stale tarball name leaked into stdout alongside
    // the new one. Refusing to guess is safer than silently picking one.
    const stdout = 'pkg-1.0.0.tgz\npkg-1.0.0-old.tgz\n'
    expect(() => extractPackFilename(stdout)).toThrow(/ambiguous/)
  })
})

describe('packAndPublish', () => {
  afterEach(() => {
    mock.restore()
  })

  test('extracts the filename from realistic pack stdout and forwards to publishTarball', async () => {
    // Realistic 5-line shape that `bun pm pack --quiet` historically emitted
    // (lifecycle scripts wrote to stdout). The companion stderr fix in
    // scripts/prepack.ts means stdout SHOULD be a single line in practice,
    // but `extractPackFilename` is the defensive layer — exercise it here.
    spyOn(io.npm, 'pack').mockResolvedValue(
      'prepack: hoisted publishConfig fields to top-level; stripped devDependencies\n' +
        '\n' +
        'agent-facets-core-0.6.4.tgz\n' +
        '\n' +
        'postpack: restored original package.json\n',
    )
    const publishSpy = spyOn(io.npm, 'publishTarball').mockResolvedValue(shellResult())

    await packAndPublish('packages/core')

    expect(publishSpy).toHaveBeenCalledWith('packages/core', 'agent-facets-core-0.6.4.tgz', undefined)
  })

  test('forwards the dist-tag when provided', async () => {
    spyOn(io.npm, 'pack').mockResolvedValue('agent-facets-cli-darwin-arm64-0.4.2.tgz\n')
    const publishSpy = spyOn(io.npm, 'publishTarball').mockResolvedValue(shellResult())

    await packAndPublish('dist/@agent-facets/cli-darwin-arm64', 'latest')

    expect(publishSpy).toHaveBeenCalledWith(
      'dist/@agent-facets/cli-darwin-arm64',
      'agent-facets-cli-darwin-arm64-0.4.2.tgz',
      'latest',
    )
  })

  test('publishes exactly one filename argument — never a glob', async () => {
    // Regression guard for the EUSAGE failure mode if a stale .tgz exists.
    // `npm publish` accepts a single <package-spec>, so the captured filename
    // must be a literal string, not a `*.tgz` glob.
    spyOn(io.npm, 'pack').mockResolvedValue('pkg-1.0.0.tgz')
    const publishSpy = spyOn(io.npm, 'publishTarball').mockResolvedValue(shellResult())

    await packAndPublish('dir')

    const filename = publishSpy.mock.calls[0]?.[1]
    expect(filename).toBe('pkg-1.0.0.tgz')
    expect(filename).not.toContain('*')
  })

  test('propagates pack errors without invoking publishTarball', async () => {
    spyOn(io.npm, 'pack').mockRejectedValue(new Error('bun pm pack failed'))
    const publishSpy = spyOn(io.npm, 'publishTarball').mockResolvedValue(shellResult())

    await expect(packAndPublish('dir')).rejects.toThrow('bun pm pack failed')
    expect(publishSpy).not.toHaveBeenCalled()
  })
})
