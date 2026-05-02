import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type CliError, formatCliError, writeCliError } from '../errors.ts'

const ORIGINAL_NO_COLOR = process.env.NO_COLOR

beforeEach(() => {
  process.env.NO_COLOR = '1'
})

afterEach(() => {
  if (ORIGINAL_NO_COLOR === undefined) {
    delete process.env.NO_COLOR
  } else {
    process.env.NO_COLOR = ORIGINAL_NO_COLOR
  }
})

describe('formatCliError', () => {
  test('produces the canonical 3-line format', () => {
    const err: CliError = {
      what: 'facet integrity check failed for viper-plans',
      detail: 'expected sha256:abc, got sha256:def',
      fix: 'artifact may be corrupted; try re-cloning the source',
    }
    expect(formatCliError(err)).toBe(
      [
        'error: facet integrity check failed for viper-plans',
        '  expected sha256:abc, got sha256:def',
        '  fix: artifact may be corrupted; try re-cloning the source',
      ].join('\n'),
    )
  })

  test('substitutes (no detail) when detail is omitted', () => {
    const err: CliError = {
      what: 'viper-plans.facet archive is malformed',
      fix: "rebuild with 'facet build' and try again",
    }
    expect(formatCliError(err)).toBe(
      [
        'error: viper-plans.facet archive is malformed',
        '  (no detail)',
        "  fix: rebuild with 'facet build' and try again",
      ].join('\n'),
    )
  })

  test('substitutes (no detail) when detail is the empty string', () => {
    expect(formatCliError({ what: 'x', detail: '', fix: 'y' })).toContain('(no detail)')
  })

  test('appends a docs: line when docsUrl is provided', () => {
    const err: CliError = {
      what: 'facet not found in registry',
      detail: 'no facet "viper-plans" published',
      fix: "try 'facet search <term>' to find available facets",
      docsUrl: 'https://agentfacets.io/errors/E_FACET_NOT_FOUND',
    }
    expect(formatCliError(err)).toBe(
      [
        'error: facet not found in registry',
        '  no facet "viper-plans" published',
        "  fix: try 'facet search <term>' to find available facets",
        '  docs: https://agentfacets.io/errors/E_FACET_NOT_FOUND',
      ].join('\n'),
    )
  })

  test('omits the docs line when docsUrl is the empty string', () => {
    const out = formatCliError({ what: 'x', fix: 'y', docsUrl: '' })
    expect(out).not.toContain('docs:')
  })
})

describe('writeCliError', () => {
  test('writes to stderr and does not touch stdout', () => {
    const stderrChunks: string[] = []
    const stdoutChunks: string[] = []
    const origStderr = process.stderr.write.bind(process.stderr)
    const origStdout = process.stdout.write.bind(process.stdout)

    process.stderr.write = ((chunk: unknown) => {
      stderrChunks.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    process.stdout.write = ((chunk: unknown) => {
      stdoutChunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write

    try {
      writeCliError({ what: 'w', detail: 'd', fix: 'f' })
    } finally {
      process.stderr.write = origStderr
      process.stdout.write = origStdout
    }

    expect(stderrChunks.join('')).toContain('error: w')
    expect(stdoutChunks).toHaveLength(0)
  })

  test('appends a trailing newline so following output starts clean', () => {
    const chunks: string[] = []
    const origStderr = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      writeCliError({ what: 'w', fix: 'f' })
    } finally {
      process.stderr.write = origStderr
    }
    expect(chunks.join('')).toMatch(/\n$/)
  })
})
