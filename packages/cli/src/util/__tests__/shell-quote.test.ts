import { describe, expect, test } from 'bun:test'
import { quoteShellArg } from '../shell-quote.ts'

describe('quoteShellArg', () => {
  test('renders an empty string as ""', () => {
    expect(quoteShellArg('')).toBe("''")
  })

  test.each([
    'opencode',
    '@agent-facets/adapter-opencode',
    'my-adapter@1.2.3',
    'name@latest',
    './dist/index.mjs',
    'a_b-c.d',
  ])('passes shell-inert specifier %s through unquoted', (value) => {
    expect(quoteShellArg(value)).toBe(value)
  })

  test('quotes a glob selector so the shell does not expand it', () => {
    expect(quoteShellArg('my-adapter@1.*')).toBe("'my-adapter@1.*'")
  })

  test('quotes a git URL with a ref fragment', () => {
    expect(quoteShellArg('git+https://github.com/x/y.git#v1')).toBe("'git+https://github.com/x/y.git#v1'")
  })

  test('quotes a local path containing whitespace', () => {
    expect(quoteShellArg('./My Adapters/tool')).toBe("'./My Adapters/tool'")
  })

  test('splices embedded single quotes', () => {
    expect(quoteShellArg("./it's here")).toBe("'./it'\\''s here'")
  })

  test('quotes command-substitution metacharacters', () => {
    expect(quoteShellArg('$(rm -rf ~)')).toBe("'$(rm -rf ~)'")
  })

  test('quotes a newline', () => {
    expect(quoteShellArg('a\nb')).toBe("'a\nb'")
  })
})
