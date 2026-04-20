import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/**
 * Shared filesystem helpers for adapter install/read/delete.
 *
 * ASCII: how adapters use these helpers
 *
 *   adapter.installAsset(scope, type, name, body, metadata)
 *       │
 *       ▼
 *   resolve full path  (adapter decides layout per scope/type)
 *       │
 *       ▼
 *   installAssetFile({ file }, body, metadata)
 *       │
 *       ▼
 *   ┌─────────────────────────────────────────┐
 *   │  assemble YAML front-matter + body:     │
 *   │    ---                                   │
 *   │    name: planning                        │
 *   │    description: plan things              │
 *   │    (adapter extras)                      │
 *   │    ---                                   │
 *   │    <body>                                │
 *   └─────────────────────────────────────────┘
 *       │
 *       ▼
 *   mkdir -p dirname + writeFile combined content
 *
 * Front-matter is the single source of truth for per-asset metadata on disk
 * (no sidecar files). `name` + `description` are the conventional minimum;
 * adapters are free to pass any additional keys (`tools`, `model`, etc.).
 * The body is stored verbatim after the `---\n` delimiter.
 */

/** Absolute-path descriptor for a single installed asset. */
export interface AssetPath {
  /** Absolute path to the asset file on disk. */
  file: string
}

/**
 * Write `body` to `path.file`, prepending YAML front-matter assembled from
 * `metadata` when non-empty. Creates parent directories. Overwrites
 * unconditionally (idempotent by contract — see Adjustment B).
 *
 * If `body` already starts with a front-matter block, its keys are merged
 * with `metadata` (caller's metadata wins on key collision). This keeps
 * hand-authored body files safe: if someone ships a `SKILL.md` with
 * frontmatter we preserve their extras while still ensuring the caller's
 * required keys (e.g. `name`, `description`) land on disk.
 */
export async function installAssetFile(
  path: AssetPath,
  body: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path.file), { recursive: true })
  const combined = assembleAssetContent(body, metadata)
  await writeFile(path.file, combined, 'utf8')
}

/**
 * Read the asset file at `path.file` and split it into body content +
 * parsed front-matter metadata. Throws if the file is absent (read is not
 * speculative — adapters only call this for assets they believe exist).
 */
export async function readAssetFile(path: AssetPath): Promise<{ content: string; metadata?: Record<string, unknown> }> {
  const raw = await readFile(path.file, 'utf8')
  return splitAssetContent(raw)
}

/**
 * Delete the asset file at `path.file`. No-op if absent (idempotent by
 * contract — see Adjustment B). Also removes any legacy `.meta.json`
 * sidecar left behind by earlier versions so upgrades reconverge cleanly.
 */
export async function deleteAssetFile(path: AssetPath): Promise<void> {
  await rm(path.file, { force: true })
  await rm(`${path.file}.meta.json`, { force: true })
}

// --- front-matter helpers (exported for adapter-level customization) ---

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

/**
 * Assemble a full file string from optional front-matter metadata + body.
 * When `body` already contains a front-matter block, the two are merged
 * (`metadata` wins on key collision) so external keys on the body survive.
 */
export function assembleAssetContent(body: string, metadata?: Record<string, unknown>): string {
  const existing = splitAssetContent(body)
  const merged = { ...(existing.metadata ?? {}), ...(metadata ?? {}) }
  const bodyOnly = existing.content
  if (Object.keys(merged).length === 0) return bodyOnly
  const yaml = stringifyYaml(merged).trimEnd()
  const separator = bodyOnly.length === 0 || bodyOnly.startsWith('\n') ? '' : '\n'
  return `---\n${yaml}\n---\n${separator}${bodyOnly}`
}

/**
 * Parse a file string into its body + parsed front-matter metadata. Returns
 * the raw string as `content` when no front-matter is detected. Malformed
 * YAML falls back to "no front-matter."
 *
 * Known limitation (tracked as a post-alpha TODO — see plan F10): the regex
 * below is non-greedy, so if a body legitimately contains a literal line of
 * exactly `---` followed by content and another `---` line, the first
 * terminator wins and the body will be split in the wrong place. Skills and
 * commands rarely include frontmatter-shaped content inside their bodies,
 * so in practice this is benign — but replacing the regex with `gray-matter`
 * or an equivalent well-tested parser is the right fix.
 */
export function splitAssetContent(raw: string): { content: string; metadata?: Record<string, unknown> } {
  const match = raw.match(FRONT_MATTER_RE)
  if (!match) return { content: raw }
  try {
    const yamlSource = match[1] ?? ''
    const parsed = parseYaml(yamlSource) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { content: match[2] ?? '', metadata: parsed as Record<string, unknown> }
    }
    return { content: raw }
  } catch {
    return { content: raw }
  }
}
