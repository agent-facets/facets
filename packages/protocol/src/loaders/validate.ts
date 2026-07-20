import type { ValidationError } from '@agent-facets/common'
import type { type } from 'arktype'

/**
 * Maps ArkType errors to our public ValidationError type.
 * Decouples the public API from ArkType internals.
 */
export function mapArkErrors(errors: InstanceType<typeof type.errors>): ValidationError[] {
  return errors.map((err) => ({
    path: err.path.join('.'),
    // For predicate errors (.narrow()), err.message includes the full data object.
    // Use err.expected directly — it's our clean sentence from ctx.mustBe().
    message: err.code === 'predicate' ? (err.expected ?? err.message) : err.message,
    expected: err.expected ?? 'unknown',
    actual: err.code === 'predicate' ? 'constraint not met' : (err.actual ?? 'unknown'),
  }))
}

/**
 * Scans a KNOWN-VALID JSON document for duplicate object member names.
 * `JSON.parse` silently collapses duplicates (last member wins), which lets
 * two parsers see different data in one document — a smuggling vector for
 * security-relevant artifacts (facet manifests, build manifests, lockfiles).
 *
 * Precondition: `text` has already been accepted by `JSON.parse`. The scan
 * assumes well-formed input and only tracks strings, object/array nesting,
 * and member-key positions. Escaped keys are decoded before comparison so
 * `"\u0066iles"` and `"files"` are detected as duplicates.
 *
 * Returns one ValidationError per duplicated member, with `path` pointing at
 * the enclosing object's location (dot-separated, array indices numeric).
 */
export function findDuplicateJsonMembers(text: string): ValidationError[] {
  const errors: ValidationError[] = []

  type Frame =
    | { kind: 'object'; keys: Set<string>; pathSegment: string }
    | { kind: 'array'; index: number; pathSegment: string }

  const stack: Frame[] = []
  let expectKey = false
  let pendingSegment = ''
  let i = 0

  const currentPath = (): string =>
    stack
      .map((f) => f.pathSegment)
      .filter((s) => s !== '')
      .join('.')

  while (i < text.length) {
    const ch = text[i] as string
    if (ch === '"') {
      // Scan the string token, honoring escapes.
      let j = i + 1
      while (j < text.length) {
        const c = text[j]
        if (c === '\\') {
          j += 2
          continue
        }
        if (c === '"') break
        j++
      }
      const raw = text.slice(i, j + 1)
      const top = stack[stack.length - 1]
      if (top?.kind === 'object' && expectKey) {
        const key = JSON.parse(raw) as string
        if (top.keys.has(key)) {
          errors.push({
            path: currentPath(),
            message: `Duplicate JSON object member "${key}". Documents with duplicate members are rejected because parsers disagree on which member wins.`,
            expected: 'unique object member names',
            actual: `member "${key}" declared more than once`,
          })
        }
        top.keys.add(key)
        pendingSegment = key
        expectKey = false
      }
      i = j + 1
      continue
    }
    if (ch === '{') {
      stack.push({ kind: 'object', keys: new Set(), pathSegment: pendingSegment })
      pendingSegment = ''
      expectKey = true
      i++
      continue
    }
    if (ch === '[') {
      stack.push({ kind: 'array', index: 0, pathSegment: pendingSegment })
      pendingSegment = '0'
      i++
      continue
    }
    if (ch === '}' || ch === ']') {
      stack.pop()
      pendingSegment = ''
      i++
      continue
    }
    if (ch === ',') {
      const top = stack[stack.length - 1]
      if (top?.kind === 'object') {
        expectKey = true
      } else if (top?.kind === 'array') {
        top.index++
        pendingSegment = String(top.index)
      }
      i++
      continue
    }
    i++
  }

  return errors
}

/**
 * Parses a JSON string. Returns the parsed data or a ValidationError array.
 */
export function parseJson(jsonContent: string): { ok: true; data: unknown } | { ok: false; errors: ValidationError[] } {
  try {
    const parsed = JSON.parse(jsonContent)
    return { ok: true, data: parsed }
  } catch (err) {
    const message = err instanceof SyntaxError ? err.message : 'Unknown JSON parse error'
    return {
      ok: false,
      errors: [
        {
          path: '',
          message: `JSON syntax error: ${message}`,
          expected: 'valid JSON',
          actual: 'malformed JSON',
        },
      ],
    }
  }
}
