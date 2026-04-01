import { parse as parseYaml } from 'yaml'

/**
 * Matches YAML front matter: opening `---`, YAML content, closing `---`.
 * Anchored to start of string. Handles optional trailing content.
 */
const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/

/** Matches empty front matter: `---\n---` with optional trailing content. */
const EMPTY_FRONT_MATTER_RE = /^---\n---(?:\n([\s\S]*))?$/

/** Normalize BOM and line endings to LF. */
function normalize(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

/** Returns true if the string contains YAML front matter. */
export function hasFrontMatter(raw: string): boolean {
  const input = normalize(raw)
  return FRONT_MATTER_RE.test(input) || EMPTY_FRONT_MATTER_RE.test(input)
}

export interface FrontMatterResult<T = Record<string, unknown>> {
  /** Parsed YAML attributes. Empty object if no front matter or parse failure. */
  data: T
  /** Markdown body with front matter stripped. Original content if no front matter. */
  content: string
}

/**
 * Extracts YAML front matter attributes and clean body from a string.
 * Returns the original content unchanged if no front matter is found.
 * Treats YAML parse failures as "no front matter" (returns empty data + original content).
 */
export function extractFrontMatter<T = Record<string, unknown>>(raw: string): FrontMatterResult<T> {
  const input = normalize(raw)

  const emptyMatch = input.match(EMPTY_FRONT_MATTER_RE)
  if (emptyMatch) {
    return { data: {} as T, content: emptyMatch[1] ?? '' }
  }

  const match = input.match(FRONT_MATTER_RE)
  if (!match) {
    return { data: {} as T, content: raw }
  }

  try {
    const yaml = match[1] ?? ''
    return { data: (parseYaml(yaml) ?? {}) as T, content: match[2] ?? '' }
  } catch {
    // Malformed YAML — treat as no front matter
    return { data: {} as T, content: raw }
  }
}
