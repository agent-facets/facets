import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteCredentialsFile,
  readCredentialsToken,
  resolveCredential,
  writeCredentialsToken,
} from '../credentials.ts'

// `FACET_DIR` redirects the whole facet tree (incl. the credentials
// file) to a temp dir; `FACET_TOKEN` is the env credential source.
// Both are saved and restored so tests don't leak into each other or
// into the host environment.
let facetDir: string
let originalFacetDir: string | undefined
let originalFacetToken: string | undefined

const credentialsPath = () => join(facetDir, 'credentials')

beforeEach(() => {
  originalFacetDir = process.env.FACET_DIR
  originalFacetToken = process.env.FACET_TOKEN
  facetDir = mkdtempSync(join(tmpdir(), 'facet-credentials-test-'))
  process.env.FACET_DIR = facetDir
  delete process.env.FACET_TOKEN
})

afterEach(() => {
  if (originalFacetDir === undefined) {
    delete process.env.FACET_DIR
  } else {
    process.env.FACET_DIR = originalFacetDir
  }
  if (originalFacetToken === undefined) {
    delete process.env.FACET_TOKEN
  } else {
    process.env.FACET_TOKEN = originalFacetToken
  }
  rmSync(facetDir, { recursive: true, force: true })
})

describe('resolveCredential', () => {
  test('env token wins over the credentials file', () => {
    writeCredentialsToken('fct_pub_fileToken')
    process.env.FACET_TOKEN = 'fct_pub_envToken'

    const result = resolveCredential()

    expect(result.source).toBe('env')
    if (result.source !== 'env') expect.unreachable()
    expect(result.token).toBe('fct_pub_envToken')
  })

  test('falls back to the file token when no env var is set', () => {
    writeCredentialsToken('fct_pub_fileToken')

    const result = resolveCredential()

    expect(result.source).toBe('file')
    if (result.source !== 'file') expect.unreachable()
    expect(result.token).toBe('fct_pub_fileToken')
  })

  test('uses the env token when no file exists', () => {
    process.env.FACET_TOKEN = 'fct_pub_envToken'

    const result = resolveCredential()

    expect(result.source).toBe('env')
    if (result.source !== 'env') expect.unreachable()
    expect(result.token).toBe('fct_pub_envToken')
  })

  test('is absent when neither env nor file supplies a token', () => {
    const result = resolveCredential()
    expect(result.source).toBe('absent')
  })

  test('is absent with no reason when the file is missing', () => {
    const result = resolveCredential()
    if (result.source !== 'absent') expect.unreachable()
    expect(result.reason).toBeUndefined()
  })

  test('is absent with no reason for a readable file that has no token', () => {
    writeFileSync(credentialsPath(), '[default]\n')
    const result = resolveCredential()
    if (result.source !== 'absent') expect.unreachable()
    expect(result.reason).toBeUndefined()
  })

  test('is absent with an unreadable reason when the credentials path cannot be read', () => {
    // A directory at the credentials path makes `readFileSync` throw
    // EISDIR — a true read failure (as opposed to a readable file with
    // no token). This must surface as a reason, not escape as an
    // uncaught exception, and must not be confused with "not logged in".
    mkdirSync(credentialsPath())

    const result = resolveCredential()

    if (result.source !== 'absent') expect.unreachable()
    if (result.reason === undefined) expect.unreachable()
    expect(result.reason.code).toBe('unreadable')
    expect(result.reason.path).toBe(credentialsPath())
    expect(result.reason.cause.length).toBeGreaterThan(0)
  })

  test('treats a whitespace-only FACET_TOKEN as unset', () => {
    process.env.FACET_TOKEN = '   '
    expect(resolveCredential().source).toBe('absent')
  })

  test('treats an empty FACET_TOKEN as unset', () => {
    process.env.FACET_TOKEN = ''
    expect(resolveCredential().source).toBe('absent')
  })

  test('trims a surrounding-whitespace FACET_TOKEN', () => {
    process.env.FACET_TOKEN = '  fct_pub_envToken  '
    const result = resolveCredential()
    if (result.source !== 'env') expect.unreachable()
    expect(result.token).toBe('fct_pub_envToken')
  })

  test('falls through to the file when FACET_TOKEN is whitespace-only', () => {
    writeCredentialsToken('fct_pub_fileToken')
    process.env.FACET_TOKEN = '   '

    const result = resolveCredential()

    expect(result.source).toBe('file')
    if (result.source !== 'file') expect.unreachable()
    expect(result.token).toBe('fct_pub_fileToken')
  })
})

describe('readCredentialsToken', () => {
  test('returns undefined when the file is absent', () => {
    expect(readCredentialsToken()).toBeUndefined()
  })

  test('reads the token from the [default] profile', () => {
    writeCredentialsToken('fct_pub_abc')
    expect(readCredentialsToken()).toBe('fct_pub_abc')
  })

  test('returns undefined when the [default] section has no token key', () => {
    writeFileSync(credentialsPath(), '[default]\n')
    expect(readCredentialsToken()).toBeUndefined()
  })

  test('returns undefined for an empty file', () => {
    writeFileSync(credentialsPath(), '')
    expect(readCredentialsToken()).toBeUndefined()
  })

  test('returns undefined when the credentials path is unreadable', () => {
    // EISDIR via a directory at the path. The simple string|undefined
    // contract collapses unreadable to undefined; callers needing the
    // distinction use resolveCredential's reason.
    mkdirSync(credentialsPath())
    expect(readCredentialsToken()).toBeUndefined()
  })

  test('treats a whitespace-only token value as absent', () => {
    writeFileSync(credentialsPath(), '[default]\ntoken = "   "\n')
    expect(readCredentialsToken()).toBeUndefined()
  })

  test('round-trips a token containing special characters', () => {
    const token = 'fct_pub_AbC123-_=xyz'
    writeCredentialsToken(token)
    expect(readCredentialsToken()).toBe(token)
  })
})

describe('writeCredentialsToken', () => {
  test('writes the credentials file with mode 0600', () => {
    writeCredentialsToken('fct_pub_abc')

    const mode = statSync(credentialsPath()).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test('persists an INI [default] profile with a token key', () => {
    writeCredentialsToken('fct_pub_abc')

    const contents = readFileSync(credentialsPath(), 'utf8')
    expect(contents).toContain('[default]')
    expect(contents).toContain('token')
    expect(contents).toContain('fct_pub_abc')
  })

  // Snapshot of the exact on-disk bytes. The credentials file format is
  // a contract (AWS-style INI: a `[default]` profile with a single
  // `token` key, no version field — see the registry-auth design). If a
  // future serialization change reorders keys, alters `=` spacing, or
  // introduces an extra field, this assertion fails loudly rather than
  // silently shipping a format other tools (or a future multi-profile
  // reader) won't expect.
  test('writes the exact INI bytes for a plain token', () => {
    writeCredentialsToken('fct_pub_abc')

    const contents = readFileSync(credentialsPath(), 'utf8')
    expect(contents).toMatchInlineSnapshot(`
      "[default]
      token=fct_pub_abc
      "
    `)
  })

  // A token containing INI-significant characters (e.g. `=`) is quoted
  // by the serializer and round-trips losslessly. Pinning this documents
  // the quoting behavior so it can't regress unnoticed.
  test('quotes a token containing INI-significant characters', () => {
    writeCredentialsToken('fct_pub_a=b')

    const contents = readFileSync(credentialsPath(), 'utf8')
    expect(contents).toMatchInlineSnapshot(`
      "[default]
      token="fct_pub_a=b"
      "
    `)
    expect(readCredentialsToken()).toBe('fct_pub_a=b')
  })

  test('overwriting an existing file keeps mode 0600', () => {
    writeFileSync(credentialsPath(), 'stale', { mode: 0o644 })
    writeCredentialsToken('fct_pub_new')

    const mode = statSync(credentialsPath()).mode & 0o777
    expect(mode).toBe(0o600)
    expect(readCredentialsToken()).toBe('fct_pub_new')
  })

  test('creates $FACET_DIR if it does not exist', () => {
    rmSync(facetDir, { recursive: true, force: true })
    writeCredentialsToken('fct_pub_abc')
    expect(existsSync(credentialsPath())).toBe(true)
  })
})

describe('deleteCredentialsFile', () => {
  test('removes the file and reports it existed', () => {
    writeCredentialsToken('fct_pub_abc')
    expect(deleteCredentialsFile()).toBe(true)
    expect(existsSync(credentialsPath())).toBe(false)
  })

  test('reports false when there was nothing to remove', () => {
    expect(deleteCredentialsFile()).toBe(false)
  })
})
