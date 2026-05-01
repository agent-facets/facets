import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getAdapterBaseDir, getAdapterBundlePath, getAdapterDir } from '../placement.ts'

/**
 * Unit tests for `placement.ts`'s env-var handling. Specifically validates
 * that `FACETS_ADAPTERS_DIR` is treated robustly:
 *   - Unset → default (~/.facets/adapters)
 *   - Empty string → default
 *   - Whitespace-only → default
 *   - Whitespace-padded → trimmed
 */

const ENV_VAR = 'FACETS_ADAPTERS_DIR'
const DEFAULT_DIR = join(homedir(), '.facets', 'adapters')

let originalValue: string | undefined

beforeEach(() => {
  originalValue = process.env[ENV_VAR]
  delete process.env[ENV_VAR]
})

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[ENV_VAR]
  } else {
    process.env[ENV_VAR] = originalValue
  }
})

describe('getAdapterBaseDir — FACETS_ADAPTERS_DIR handling', () => {
  test('returns the default ~/.facets/adapters when env var is unset', () => {
    expect(getAdapterBaseDir()).toBe(DEFAULT_DIR)
  })

  test('returns the default when env var is set to empty string', () => {
    process.env[ENV_VAR] = ''
    expect(getAdapterBaseDir()).toBe(DEFAULT_DIR)
  })

  test('returns the default when env var is whitespace-only (spaces)', () => {
    process.env[ENV_VAR] = '   '
    expect(getAdapterBaseDir()).toBe(DEFAULT_DIR)
  })

  test('returns the default when env var is whitespace-only (tabs and newlines)', () => {
    process.env[ENV_VAR] = '\t\n  '
    expect(getAdapterBaseDir()).toBe(DEFAULT_DIR)
  })

  test('returns the env-var value when set to a valid path', () => {
    process.env[ENV_VAR] = '/tmp/my-custom-adapters'
    expect(getAdapterBaseDir()).toBe('/tmp/my-custom-adapters')
  })

  test('trims surrounding whitespace from the env-var value', () => {
    process.env[ENV_VAR] = '  /tmp/padded-adapters  '
    expect(getAdapterBaseDir()).toBe('/tmp/padded-adapters')
  })
})

describe('getAdapterDir / getAdapterBundlePath — env-var propagation', () => {
  test('getAdapterDir uses the resolved base dir when no override is passed', () => {
    process.env[ENV_VAR] = '/tmp/from-env'
    expect(getAdapterDir('opencode')).toBe('/tmp/from-env/opencode')
  })

  test('getAdapterBundlePath uses the resolved base dir when no override is passed', () => {
    process.env[ENV_VAR] = '/tmp/from-env'
    expect(getAdapterBundlePath('opencode')).toBe('/tmp/from-env/opencode/adapter.js')
  })

  test('getAdapterDir prefers the explicit baseDir argument over the env var', () => {
    process.env[ENV_VAR] = '/tmp/from-env'
    expect(getAdapterDir('opencode', '/tmp/explicit')).toBe('/tmp/explicit/opencode')
  })

  test('falls back to default when env var is empty AND no explicit baseDir is passed', () => {
    process.env[ENV_VAR] = ''
    expect(getAdapterDir('opencode')).toBe(join(DEFAULT_DIR, 'opencode'))
  })
})
