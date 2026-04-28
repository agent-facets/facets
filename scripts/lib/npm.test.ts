import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { io } from './io'
import { packAndPublish } from './npm'
import { shellResult } from './test-helpers'

describe('packAndPublish', () => {
  afterEach(() => {
    mock.restore()
  })

  test('passes the trimmed pack stdout to publishTarball as the filename', async () => {
    // `bun pm pack --quiet` prints a leading blank line + the filename.
    // The helper must trim before forwarding, otherwise `npm publish`
    // sees an empty arg and fails with EUSAGE.
    spyOn(io.npm, 'pack').mockResolvedValue('\nagent-facets-core-0.6.4.tgz\n')
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
