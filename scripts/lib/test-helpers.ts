import { spyOn } from 'bun:test'
import type { $ } from 'bun'
import dedent from 'dedent'
import { io } from './io'

/** Fake a successful Bun.$ result for test mocks. */
export function shellResult(stdout = '', exitCode = 0): $.ShellOutput {
  return { stdout: Buffer.from(stdout), exitCode } as $.ShellOutput
}

export function shellPromise(stdout = '', exitCode = 0) {
  return Promise.resolve({ stdout: Buffer.from(stdout), exitCode }) as $.ShellPromise
}

/** Silence io.log and io.error for test output. */
export function silenceIO() {
  spyOn(io, 'log').mockImplementation(() => {})
  spyOn(io, 'error').mockImplementation(() => {})
}

/** Sample CHANGELOG.md content for release pipeline tests. */
export const SAMPLE_CHANGELOG = dedent`
  # @agent-facets/core

  ## 1.1.0

  ### Minor Changes

  - Added a cool new feature

  ## 1.0.0

  ### Minor Changes

  - Initial release
`
