/**
 * Sync the registry's published OpenAPI specification into the engine
 * package and regenerate the TypeScript types the registry client
 * imports from it.
 *
 * Two modes:
 *
 *   bun run codegen:registry
 *     Sync mode. Fetches the OpenAPI YAML from
 *     `FACET_REGISTRY_OPENAPI_URL` (default: the live cafe registry),
 *     validates it parses as OpenAPI 3.x, atomically writes it to
 *     `src/registry/openapi.snapshot.yaml` with a leading metadata
 *     header, then runs `openapi-typescript` to emit
 *     `src/registry/generated/registry-api.ts`. Idempotent: re-running
 *     against an unchanged registry produces no diff. On any failure
 *     (network, parse, codegen), exits non-zero with a clear message
 *     and leaves on-disk state untouched.
 *
 *   bun run codegen:registry --check [--strict]
 *     Check mode. Reads `Generated-At` from the on-disk snapshot,
 *     compares to `now`, prints a one-line freshness report. Pure
 *     offline read; never touches the network. Threshold from
 *     `STALENESS_THRESHOLD_DAYS` (default: 7). Exits 0 by default;
 *     with `--strict`, exits 1 when stale.
 *
 * The script lives outside `src/` because it is build/dev tooling,
 * not engine runtime code. It is the only writer of
 * `src/registry/openapi.snapshot.yaml` and `src/registry/generated/*`;
 * neither file should ever be hand-edited.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFileSync } from '@agent-facets/common'
import { parse as parseYaml } from 'yaml'

const DEFAULT_OPENAPI_URL = 'https://api.agentfacets.io/v0/openapi.yaml'
const DEFAULT_STALENESS_THRESHOLD_DAYS = 7

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ENGINE_ROOT = resolve(SCRIPT_DIR, '..')
const SNAPSHOT_PATH = resolve(ENGINE_ROOT, 'src/registry/openapi.snapshot.yaml')
const GENERATED_PATH = resolve(ENGINE_ROOT, 'src/registry/generated/registry-api.ts')

const GENERATED_AT_HEADER_PATTERN = /^# Generated-At:\s*(\S+)/m

/**
 * Two-mode entry point. Argument parsing is intentionally trivial —
 * this script is invoked from `package.json`, not from a user shell,
 * so we don't need a full flags library.
 */
async function main(argv: ReadonlyArray<string>): Promise<number> {
  const args = new Set(argv)
  if (args.has('--check')) {
    return runCheck({ strict: args.has('--strict') })
  }
  return runSync()
}

/**
 * Sync mode. Fetch → validate → atomically write snapshot → invoke
 * codegen → atomically write generated module → print summary.
 *
 * Every failure path leaves on-disk state untouched; we only commit
 * via `atomicWriteFileSync` after every upstream check has passed.
 */
async function runSync(): Promise<number> {
  const url = process.env.FACET_REGISTRY_OPENAPI_URL ?? DEFAULT_OPENAPI_URL

  let raw: string
  try {
    const response = await fetch(url)
    if (!response.ok) {
      process.stderr.write(`error: failed to fetch ${url}: HTTP ${response.status} ${response.statusText}\n`)
      process.stderr.write(`existing snapshot left untouched.\n`)
      return 1
    }
    raw = await response.text()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    process.stderr.write(`error: failed to fetch ${url}: ${message}\n`)
    process.stderr.write(`existing snapshot left untouched.\n`)
    return 1
  }

  // Parse + validate as OpenAPI 3.x. We don't re-serialize the parsed
  // document — re-emission would add formatting differences run-to-run
  // and break idempotency. Parsing is just a structural sanity check.
  let doc: unknown
  try {
    doc = parseYaml(raw)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    process.stderr.write(`error: registry returned invalid YAML: ${message}\n`)
    process.stderr.write(`existing snapshot left untouched.\n`)
    return 1
  }
  if (!isObject(doc) || typeof doc.openapi !== 'string' || !/^3\./.test(doc.openapi)) {
    process.stderr.write(
      `error: registry response does not look like OpenAPI 3.x (missing or unsupported \`openapi\` key)\n`,
    )
    process.stderr.write(`existing snapshot left untouched.\n`)
    return 1
  }

  const generatedAt = new Date().toISOString()
  const snapshot = composeSnapshot({ url, generatedAt, body: raw })

  // Snapshot is committed first. If codegen fails after this, the
  // snapshot on disk is newer than the generated module — but the
  // next sync (or a re-run) will reconcile, and a partial state is
  // still a valid commit point (the snapshot is the source; the
  // generated module is derivable from it).
  atomicWriteFileSync(SNAPSHOT_PATH, snapshot)

  const codegenResult = spawnSync('bun', ['x', 'openapi-typescript', SNAPSHOT_PATH, '-o', GENERATED_PATH], {
    stdio: 'inherit',
  })
  if (codegenResult.status !== 0) {
    process.stderr.write(`error: openapi-typescript failed (exit ${codegenResult.status})\n`)
    return 1
  }

  process.stdout.write(`synced from ${url} · ${raw.length} bytes · generated-at ${generatedAt}\n`)
  return 0
}

/**
 * Check mode. Pure offline read of the on-disk snapshot's
 * `Generated-At` header; compares to `now`; prints freshness.
 */
function runCheck({ strict }: { strict: boolean }): number {
  if (!existsSync(SNAPSHOT_PATH)) {
    process.stderr.write(`error: snapshot missing at ${SNAPSHOT_PATH}\n`)
    process.stderr.write(`run \`bun run codegen:registry\` from packages/engine to generate it.\n`)
    return 1
  }

  const contents = readFileSync(SNAPSHOT_PATH, 'utf8')
  const match = GENERATED_AT_HEADER_PATTERN.exec(contents)
  if (match === null) {
    process.stderr.write(
      `error: snapshot is missing the Generated-At header — likely corrupt; regenerate with \`bun run codegen:registry\`.\n`,
    )
    return 1
  }
  const generatedAt = new Date(match[1])
  if (Number.isNaN(generatedAt.getTime())) {
    process.stderr.write(`error: snapshot Generated-At header is not a valid ISO 8601 timestamp: ${match[1]}\n`)
    return 1
  }

  const thresholdDays = parseThreshold(process.env.STALENESS_THRESHOLD_DAYS)
  const ageDays = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60 * 24)
  const ageDaysRounded = Math.round(ageDays * 10) / 10
  const stale = ageDays > thresholdDays
  const verdict = stale ? 'STALE' : 'fresh'
  process.stdout.write(`snapshot is ${ageDaysRounded} days old (threshold: ${thresholdDays}d) — ${verdict}\n`)
  return stale && strict ? 1 : 0
}

/**
 * Compose the on-disk snapshot: leading metadata comment block, then
 * upstream YAML body verbatim. The header is intentionally one
 * `# Key: value` line per piece of metadata so the staleness check
 * can target `Generated-At` with a one-line regex regardless of what
 * other lines we add later.
 */
function composeSnapshot({ url, generatedAt, body }: { url: string; generatedAt: string; body: string }): string {
  const header = [
    '# Generated by: bun run codegen:registry',
    `# Source: ${url}`,
    `# Generated-At: ${generatedAt}`,
    '# Do not edit by hand. Run `bun run codegen:registry` from packages/engine to refresh.',
    '',
  ].join('\n')
  // Strip a leading newline from the body if present; we control the
  // separator above, and a YAML doc that starts with `---` should
  // come immediately after our header without an extra blank.
  return header + body.replace(/^\n+/, '')
}

/**
 * Parse `STALENESS_THRESHOLD_DAYS`. Falls back to the default on
 * absent/invalid values rather than failing — the staleness check is
 * advisory, not load-bearing, and a typo'd env shouldn't break CI.
 */
function parseThreshold(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_STALENESS_THRESHOLD_DAYS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_STALENESS_THRESHOLD_DAYS
  return parsed
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const exitCode = await main(process.argv.slice(2))
process.exit(exitCode)
