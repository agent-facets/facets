import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { splitFrontMatter, validateAssetName } from '@agent-facets/common'
import { stringify as stringifyYaml } from 'yaml'

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
): Promise<string> {
  await mkdir(dirname(path.file), { recursive: true })
  const combined = assembleAssetContent(body, metadata)
  await writeFile(path.file, combined, 'utf8')
  return path.file
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
export async function deleteAssetFile(path: AssetPath): Promise<string> {
  await rm(path.file, { force: true })
  await rm(`${path.file}.meta.json`, { force: true })
  return path.file
}

// --- front-matter helpers (exported for adapter-level customization) ---

/**
 * Assemble a full file string from optional front-matter metadata + body.
 * When `body` already contains a front-matter block, the two are merged
 * (`metadata` wins on key collision) so external keys on the body survive.
 *
 * The output is exactly `---\n<yaml>\n---\n<body>` — no separator newline
 * between the closing fence and the body. This is the inverse of
 * `splitAssetContent`'s regex (which consumes one `\n` after `---`), so
 * `assemble → write → read → split` is byte-stable.
 *
 * Earlier versions inserted a cosmetic blank line between the fence and
 * the body; that asymmetry caused materialize's skip-if-identical check
 * to see phantom drift on every re-install (`# body` going in, `\n# body`
 * coming out). Tests in this file's "round-trip" describe block enforce
 * the inverse contract explicitly.
 */
export function assembleAssetContent(body: string, metadata?: Record<string, unknown>): string {
  const existing = splitAssetContent(body)
  const merged = { ...(existing.metadata ?? {}), ...(metadata ?? {}) }
  const bodyOnly = existing.content
  if (Object.keys(merged).length === 0) return bodyOnly
  const yaml = stringifyYaml(merged).trimEnd()
  return `---\n${yaml}\n---\n${bodyOnly}`
}

/**
 * Parse a file string into its body + parsed front-matter metadata. Returns
 * the raw string as `content` when no front-matter is detected. Malformed
 * YAML falls back to "no front-matter."
 *
 * Thin re-export over `@agent-facets/common`'s `splitFrontMatter` so the
 * adapter SDK and `core` share one canonical implementation. Kept as a
 * named export here because adapter authors may import it directly when
 * they customize their read path; `common` is bundled into the published
 * adapter SDK so this stays a leaf import for consumers.
 */
export function splitAssetContent(raw: string): { content: string; metadata?: Record<string, unknown> } {
  return splitFrontMatter(raw)
}

/**
 * The default `normalizeForCompare` behavior: replay the YAML front-matter
 * split+merge that `installAssetFile` performs, yielding the exact
 * `{ content, metadata }` shape `readAssetFile` returns after a real
 * round-trip.
 *
 * Adapters that delegate to `installAssetFile`/`readAssetFile` never need
 * this (the install pipeline applies the same default). It's exported for
 * adapters with *mixed* serialization — e.g. an adapter whose skills use
 * the standard YAML model but whose agents are TOML can compose this for
 * the standard branches of its own `normalizeForCompare`.
 *
 * Re-exported from `@agent-facets/common` so the SDK and the engine share
 * one implementation (same pattern as `splitAssetContent`/`splitFrontMatter`).
 */
export { normalizeAssetContent } from '@agent-facets/common'

/**
 * Assert that an asset name is safe to join onto a filesystem path. Throws
 * a clear error if not. Exposed so adapter implementations can call this
 * defensively before using `name` in `path.join` — even though the CLI
 * already guards both manifest-time and lockfile-time inputs via
 * `@agent-facets/common#validateAssetName`, defense-in-depth at the I/O
 * boundary means a malicious direct caller of `installAsset` can't bypass
 * validation.
 */
export function assertSafeAssetName(name: string): void {
  const check = validateAssetName(name)
  if (!check.ok) {
    throw new Error(`asset name "${name}" ${check.reason}`)
  }
}
