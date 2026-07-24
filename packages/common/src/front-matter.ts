import { parse as parseYaml } from 'yaml'
import { normalizeLineEndings } from './text.ts'

/**
 * Split a string into a body without front matter and the parsed YAML
 * front-matter metadata, when present.
 *
 * Used by:
 *  - the adapter SDK's `splitAssetContent` (and via it, every adapter's
 *    read path) to recover the body + metadata from on-disk asset files.
 *  - core's materialize skip-if-identical compare to normalize the
 *    candidate write content the same way the read path would, so the
 *    body comparison is symmetric.
 *
 * Lives in `common` because both the adapter SDK and `core` need
 * identical splitting semantics. A core-side implementation that
 * imported `splitAssetContent` from the adapter SDK directly would
 * pull `yaml` and friends into `core`'s runtime graph, which collides
 * with `Bun.build` when the CLI's adapter integration tests bundle the
 * same source files in the same process. Putting the primitive here
 * means both packages get the same code without a cross-package value
 * import.
 *
 * Returns `{ content: <normalized raw> }` when no front matter is
 * detected or the YAML is malformed.
 *
 * Known limitation: the regex below is non-greedy, so a body that
 * legitimately contains a literal `---` terminator line will be split
 * at the first match. Skills and commands rarely contain frontmatter-
 * shaped content inside their bodies, so in practice this is benign;
 * a parser swap (e.g., `gray-matter`) is the right fix when needed.
 */
const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

export function splitFrontMatter(raw: string): {
  content: string
  metadata?: Record<string, unknown>
} {
  const normalized = normalizeLineEndings(raw)
  const match = normalized.match(FRONT_MATTER_RE)
  if (!match) return { content: normalized }
  try {
    const yamlSource = match[1] ?? ''
    const parsed = parseYaml(yamlSource) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { content: match[2] ?? '', metadata: parsed as Record<string, unknown> }
    }
    return { content: normalized }
  } catch {
    return { content: normalized }
  }
}

/**
 * The default `normalizeForCompare` behavior: replay the YAML front-matter
 * split+merge that the adapter SDK's `installAssetFile` performs, yielding the
 * exact `{ content, metadata }` shape `readAssetFile` returns after a real
 * install round-trip (author front matter split out of `content`, then merged
 * under the caller's `metadata`, caller wins on key collisions).
 *
 * Lives in `common` — next to `splitFrontMatter`, for the same reason — because
 * both the adapter SDK (which re-exports it so adapter authors can compose it)
 * and the engine (which applies it as the pipeline's default compare) need one
 * shared implementation. A copy in either package would let the default compare
 * contract drift from the shape the SDK exports, with nothing testing that the
 * two agree.
 */
export function normalizeAssetContent(
  content: string,
  metadata: Record<string, unknown>,
): { content: string; metadata: Record<string, unknown> } {
  const split = splitFrontMatter(content)
  return { content: split.content, metadata: { ...(split.metadata ?? {}), ...metadata } }
}
