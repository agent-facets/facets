import { describe, expect, test } from 'bun:test'
import {
  describeJsoncParseError,
  detectJsoncFormatting,
  editJsoncProperty,
  parseJsoncDocument,
  restoreJsoncBom,
  splitJsoncBom,
} from '../index.ts'

describe('splitJsoncBom / restoreJsoncBom', () => {
  test('a document without a mark round-trips unchanged', () => {
    const split = splitJsoncBom('{}\n')
    expect(split).toEqual({ bom: false, body: '{}\n' })
    expect(restoreJsoncBom(split.body, split.bom)).toBe('{}\n')
  })

  test('a document with a mark keeps it across a round trip', () => {
    const split = splitJsoncBom('\uFEFF{}\n')
    expect(split).toEqual({ bom: true, body: '{}\n' })
    expect(restoreJsoncBom(split.body, split.bom)).toBe('\uFEFF{}\n')
  })
})

describe('detectJsoncFormatting', () => {
  test('an absent document gets two-space indentation and newline endings', () => {
    expect(detectJsoncFormatting(null)).toEqual({ tabSize: 2, insertSpaces: true, eol: '\n' })
  })

  test('indentation width is taken from the document', () => {
    expect(detectJsoncFormatting('{\n    "a": 1\n}\n')).toEqual({ tabSize: 4, insertSpaces: true, eol: '\n' })
  })

  test('tab indentation is preserved as tabs', () => {
    expect(detectJsoncFormatting('{\n\t"a": 1\n}\n')).toEqual({ tabSize: 2, insertSpaces: false, eol: '\n' })
  })

  test('carriage-return line endings are preserved', () => {
    expect(detectJsoncFormatting('{\r\n  "a": 1\r\n}\r\n').eol).toBe('\r\n')
  })
})

describe('editJsoncProperty', () => {
  const formatting = { tabSize: 2, insertSpaces: true, eol: '\n' } as const

  test('an unrelated comment and member survive an edit', () => {
    const text = '{\n  // keep me\n  "other": { "deep": [1, 2] },\n  "mcp": {}\n}\n'
    const edited = editJsoncProperty(text, ['mcp', 'fs'], { type: 'local' }, formatting)

    expect(edited).toContain('// keep me')
    expect(edited).toContain('"other": { "deep": [1, 2] }')
    expect(edited).toContain('"fs"')
  })

  test('an undefined value deletes the property', () => {
    const text = '{\n  "mcp": {\n    "fs": { "type": "local" },\n    "keep": { "type": "local" }\n  }\n}\n'
    const edited = editJsoncProperty(text, ['mcp', 'fs'], undefined, formatting)

    expect(edited).not.toContain('"fs"')
    expect(edited).toContain('"keep"')
  })

  test('edits compose when applied one after another', () => {
    const first = editJsoncProperty('{}\n', ['mcp', 'a'], { type: 'local' }, formatting)
    const second = editJsoncProperty(first, ['mcp', 'b'], { type: 'local' }, formatting)
    const parsed = parseJsoncDocument(second)
    if (!parsed.ok) expect.unreachable()

    expect(parsed.value).toEqual({ mcp: { a: { type: 'local' }, b: { type: 'local' } } })
  })
})

describe('parseJsoncDocument', () => {
  test('comments and trailing commas are tolerated', () => {
    const parsed = parseJsoncDocument('{\n  // note\n  "a": 1,\n}\n')
    if (!parsed.ok) expect.unreachable()
    expect(parsed.value).toEqual({ a: 1 })
  })

  test('a syntax error is a value naming the line', () => {
    const parsed = parseJsoncDocument('{\n  "a": ,\n}\n')
    if (parsed.ok) expect.unreachable()
    expect(parsed.message).toContain('line 2')
  })
})

describe('describeJsoncParseError', () => {
  test('the reported line counts newlines before the offset', () => {
    expect(describeJsoncParseError('a\nb\nc', 4)).toContain('line 3')
  })
})
