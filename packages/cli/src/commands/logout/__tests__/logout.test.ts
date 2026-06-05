import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCredentialsToken } from '@agent-facets/engine'
import { captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { logoutCommand } from '../index.ts'

const ORIGINAL_TOKEN = process.env.FACET_TOKEN
const ORIGINAL_FACET_DIR = process.env.FACET_DIR

let facetDir: string
const credentialsPath = () => join(facetDir, 'credentials')

beforeEach(() => {
  facetDir = mkdtempSync(join(tmpdir(), 'facet-logout-test-'))
  process.env.FACET_DIR = facetDir
  delete process.env.FACET_TOKEN
})

afterEach(() => {
  rmSync(facetDir, { recursive: true, force: true })
  restore('FACET_TOKEN', ORIGINAL_TOKEN)
  restore('FACET_DIR', ORIGINAL_FACET_DIR)
})

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

describe('logoutCommand', () => {
  test('removes the saved credentials file and reports it', async () => {
    writeCredentialsToken('fct_pub_abc')
    expect(existsSync(credentialsPath())).toBe(true)

    const { result, stdout } = await captureStdout(() => logoutCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('Signed out')
    expect(existsSync(credentialsPath())).toBe(false)
  })

  test('reports plainly when there was nothing to remove', async () => {
    const { result, stdout } = await captureStdout(() => logoutCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('No saved credential to remove')
  })

  test('warns that FACET_TOKEN is still active after removing the file', async () => {
    writeCredentialsToken('fct_pub_abc')
    process.env.FACET_TOKEN = 'fct_pub_envtoken'

    const { result, stdout } = await captureStdout(() => logoutCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('FACET_TOKEN is still set')
    expect(stdout).toContain('unset FACET_TOKEN')
  })

  test('makes no network call (no fetch needed)', async () => {
    // Sanity: logout must not touch the network. We assert indirectly by
    // running with no fetch stub and confirming success.
    writeCredentialsToken('fct_pub_abc')
    const { result } = await captureStdout(() => logoutCommand.run([], {}))
    expect(result).toBe(0)
  })
})
