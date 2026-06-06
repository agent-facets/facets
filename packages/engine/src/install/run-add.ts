import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { loadManifest } from '../loaders/facet.ts'
import { emptyFacetsJson, FACETS_JSON_FILE, upsertFacetInManifest } from '../manifest/mutations.ts'
import { loadFacetsJson, writeFacetsJson } from '../manifest/project-files.ts'
import { describeVersionSpec } from '../registry/describe.ts'
import { parseVersionSpec } from '../sources/facet/parse-version.ts'
import { cloneFacetGitSource } from '../sources/facet/resolve-git.ts'
import { resolveLocalFacetSource } from '../sources/facet/resolve-local.ts'
import type { Source } from '../sources/facet/types.ts'
import { runInstall } from './run-install.ts'
import type { RunInstallResult, StageEvent } from './types.ts'

/**
 * The `facet add` orchestrator. Owns the entire manifest transaction for
 * the add flow on a developer's machine:
 *
 *   1. Resolve each source's facet name (the `facets.json` key).
 *   2. Snapshot `facets.json` for rollback.
 *   3. Write provisional entries, applying the per-source manifest-value
 *      rule (git/local → full specifier; registry explicit → rendered
 *      spec; registry no-version → preserve / heal / pin).
 *   4. Run the install pipeline.
 *   5. On success, rewrite the heal/pin entries with the resolved exact
 *      version read from the new lockfile.
 *   6. On failure, restore the manifest snapshot byte-for-byte.
 *
 * The source→manifest-value mapping and the manifest snapshot/restore are
 * engine concerns (manifest authoring + filesystem mutation), not CLI
 * presentation. The CLI is a thin caller that renders this result.
 *
 * Never throws. Failures are reported via the discriminated result.
 */

/**
 * A source the user asked to add, with its already-parsed `Source`. The
 * orchestrator resolves the facet name itself (it may clone git / resolve
 * a local path to read the source's `facet.json`).
 */
export interface AddSource {
  /** The raw specifier as the user typed it (manifest value for git/local). */
  specifier: string
  /** The parsed source discriminant. */
  source: Source
}

export interface RunAddOptions {
  projectRoot: string
  sources: ReadonlyArray<AddSource>
  adapters: ReadonlyArray<Adapter>
  onStage?: (event: StageEvent) => void
  onLog?: (line: string) => void
  signal?: AbortSignal
}

/**
 * Structured failure for the pre-install phase of `runAdd` (name
 * resolution and manifest read). Mirrors the shapes the CLI already
 * renders for git clone / local resolve / manifest load so the display
 * layer needs no new translation logic beyond a discriminator switch.
 */
export type AddPrepareFailure =
  | { reason: 'manifest-read'; error: string }
  | { reason: 'git-binary-missing'; specifier: string }
  | { reason: 'git-auth-required'; specifier: string; url: string }
  | { reason: 'git-clone-failed'; specifier: string; stderr: string }
  | { reason: 'git-checkout-failed'; specifier: string; commitish: string; stderr: string }
  | { reason: 'git-commit-unresolved'; specifier: string; url: string; stderr: string }
  | { reason: 'local-resolve-failed'; specifier: string; error: string }
  | { reason: 'manifest-load-failed'; specifier: string; detail: string }
  | { reason: 'composition-rejected'; specifier: string }

/**
 * Result of `runAdd`. Discriminated by `ok`.
 *
 *   - `{ ok: true; install }` — install succeeded; the manifest holds the
 *     final (pinned/preserved) values.
 *   - `{ ok: false; phase: 'prepare'; failure }` — failed before install
 *     (name resolution / manifest read); no disk mutation has occurred
 *     beyond what is already rolled back.
 *   - `{ ok: false; phase: 'install'; install; manifestRestored }` —
 *     install failed; the manifest snapshot has been restored.
 *     `install` is the underlying `runInstall` failure for the CLI to
 *     render; `manifestRestored` reports whether restore succeeded.
 */
export type RunAddResult =
  | { ok: true; install: Extract<RunInstallResult, { ok: true }> }
  | { ok: false; phase: 'prepare'; failure: AddPrepareFailure }
  | {
      ok: false
      phase: 'install'
      install: Extract<RunInstallResult, { ok: false }>
      manifestRestored: boolean
    }

/**
 * How a registry entry's manifest value is determined at provisional-write
 * time, and whether it must be rewritten with the resolved exact version
 * after a successful install.
 */
interface ProvisionalEntry {
  name: string
  /** The value to write to facets.json before install. */
  value: string
  /** When true, rewrite `value` with the resolved exact version on success. */
  rewritePinned: boolean
}

export async function runAdd(opts: RunAddOptions): Promise<RunAddResult> {
  const { projectRoot, sources, adapters, signal } = opts
  const onStage = opts.onStage
  const onLog = opts.onLog

  // 1. Resolve names for every source (may clone git / resolve local).
  const resolved: Array<{ entry: AddSource; name: string }> = []
  for (const entry of sources) {
    const nameResult = await resolveFacetName(entry.source, entry.specifier, onLog)
    if (!nameResult.ok) {
      return { ok: false, phase: 'prepare', failure: nameResult.failure }
    }
    resolved.push({ entry, name: nameResult.name })
  }

  // 2. Snapshot facets.json for rollback.
  const facetsJsonPath = join(projectRoot, FACETS_JSON_FILE)
  const snapshot: Buffer | null = existsSync(facetsJsonPath) ? readFileSync(facetsJsonPath) : null

  // 3. Load (or skeleton) the manifest and compute + write provisional entries.
  const loaded = loadFacetsJson(projectRoot)
  if (!loaded.ok) {
    return { ok: false, phase: 'prepare', failure: { reason: 'manifest-read', error: loaded.error } }
  }
  const json = loaded.existed ? loaded.data : emptyFacetsJson()

  const provisional: ProvisionalEntry[] = []
  for (const { entry, name } of resolved) {
    const existingValue = json.facets[name]
    const planned = planManifestValue(entry, existingValue)
    upsertFacetInManifest(json, name, planned.value)
    provisional.push({ name, value: planned.value, rewritePinned: planned.rewritePinned })
  }
  writeFacetsJson(projectRoot, json)

  // 4. Run install.
  const install = await runInstall({
    projectRoot,
    adapters,
    ...(onStage ? { onStage } : {}),
    ...(onLog ? { onLog } : {}),
    ...(signal ? { signal } : {}),
  })

  // 5/6. Rewrite pinned on success, restore on failure.
  if (!install.ok) {
    const manifestRestored = restoreSnapshot(facetsJsonPath, snapshot)
    return { ok: false, phase: 'install', install, manifestRestored }
  }

  rewritePinnedEntries(projectRoot, provisional, install)
  return { ok: true, install }
}

/**
 * Determine the manifest value to write for a source, and whether it must
 * be rewritten with the resolved exact version after install.
 *
 *   - git / local              → the full specifier, unconditional.
 *   - registry explicit version → the rendered spec, unconditional.
 *   - registry no-version (latest):
 *       - existing value is a valid version spec → preserve it (no rewrite).
 *       - existing value invalid, or no entry     → write `latest`, rewrite-pin.
 */
function planManifestValue(
  entry: AddSource,
  existingValue: string | undefined,
): { value: string; rewritePinned: boolean } {
  const { source, specifier } = entry
  if (source.kind !== 'registry') {
    // git / local: the manifest value is the full source specifier.
    return { value: specifier, rewritePinned: false }
  }

  if (source.version.kind !== 'latest') {
    // Explicit version (exact / wildcards): render as written; no rewrite.
    return { value: describeVersionSpec(source.version), rewritePinned: false }
  }

  // No-version registry add (bare name / @latest): preserve / heal / pin.
  if (existingValue !== undefined && parseVersionSpec(existingValue).ok) {
    // Existing value is a valid version spec — preserve the user's choice.
    return { value: existingValue, rewritePinned: false }
  }
  // No entry, or an invalid existing value (e.g. the facet name leaked
  // into the version position) — write `latest` provisionally and pin the
  // resolved exact version after install.
  return { value: describeVersionSpec(source.version), rewritePinned: true }
}

/**
 * Rewrite the heal/pin entries with the exact resolved version read from
 * the freshly-written lockfile. Re-loads the manifest so comment metadata
 * is preserved, mutates in place, and writes back. Best-effort: a rewrite
 * failure leaves the provisional `latest` value (which the lockfile still
 * backstops), and a subsequent bare re-add heals it.
 */
function rewritePinnedEntries(
  projectRoot: string,
  provisional: ReadonlyArray<ProvisionalEntry>,
  install: Extract<RunInstallResult, { ok: true }>,
): void {
  const toPin = provisional.filter((p) => p.rewritePinned)
  if (toPin.length === 0) return

  const loaded = loadFacetsJson(projectRoot)
  if (!loaded.ok) return
  const json = loaded.existed ? loaded.data : emptyFacetsJson()

  let changed = false
  for (const p of toPin) {
    const lockEntry = install.lockfile.facets[p.name]
    if (lockEntry === undefined) continue
    upsertFacetInManifest(json, p.name, lockEntry.version)
    changed = true
  }
  if (changed) writeFacetsJson(projectRoot, json)
}

/**
 * Restore the manifest snapshot. Returns whether the restore succeeded so
 * the CLI can warn the user when the project may be in a partial state.
 */
function restoreSnapshot(path: string, snapshot: Buffer | null): boolean {
  try {
    if (snapshot === null) {
      if (existsSync(path)) rmSync(path)
      return true
    }
    writeFileSync(path, snapshot)
    return true
  } catch {
    return false
  }
}

type ResolveNameResult = { ok: true; name: string } | { ok: false; failure: AddPrepareFailure }

/**
 * Resolve a source's facet name (the `facets.json` key).
 *
 *   - registry: the canonical name on the parsed source IS the facet name
 *     (the registry keys by canonical name); no I/O. `runInstall` verifies
 *     the downloaded manifest's declared name matches.
 *   - git: clone, read `facet.json`, return its `name`; clean up the clone.
 *   - local: resolve the path, read `facet.json`, return its `name`.
 *
 * Composition (a facet that declares other facets) is rejected — the same
 * constraint the install pipeline enforces.
 */
async function resolveFacetName(
  source: Source,
  specifier: string,
  onLog: ((line: string) => void) | undefined,
): Promise<ResolveNameResult> {
  if (source.kind === 'registry') {
    return { ok: true, name: source.name }
  }

  let sourceDir: string
  let cleanup: (() => Promise<void>) | undefined

  if (source.kind === 'git') {
    const cloned = await cloneFacetGitSource(source.url, source.ref)
    if (!cloned.ok) {
      switch (cloned.reason) {
        case 'git-binary-missing':
          return { ok: false, failure: { reason: 'git-binary-missing', specifier } }
        case 'auth-required':
          return { ok: false, failure: { reason: 'git-auth-required', specifier, url: cloned.url } }
        case 'clone-failed':
          return { ok: false, failure: { reason: 'git-clone-failed', specifier, stderr: cloned.stderr } }
        case 'checkout-failed':
          return {
            ok: false,
            failure: { reason: 'git-checkout-failed', specifier, commitish: cloned.commitish, stderr: cloned.stderr },
          }
        case 'commit-unresolved':
          // The clone succeeded but HEAD couldn't be pinned to a commit.
          // Surface it as its own failure (not `git-clone-failed`) so the
          // CLI renders an accurate message and keeps the repository URL,
          // consistent with the install-phase `GIT_COMMIT_UNRESOLVED` code.
          return {
            ok: false,
            failure: { reason: 'git-commit-unresolved', specifier, url: cloned.url, stderr: cloned.stderr },
          }
      }
    }
    sourceDir = cloned.dir
    cleanup = async () => {
      await rm(cloned.dir, { recursive: true, force: true }).catch(() => {})
    }
  } else {
    const resolvedLocal = await resolveLocalFacetSource(source.path, process.cwd())
    if (!resolvedLocal.ok) {
      return { ok: false, failure: { reason: 'local-resolve-failed', specifier, error: resolvedLocal.error } }
    }
    sourceDir = resolvedLocal.dir
  }

  try {
    const manifest = await loadManifest(sourceDir)
    if (!manifest.ok) {
      const detail = manifest.errors.map((e) => e.message).join('; ')
      return { ok: false, failure: { reason: 'manifest-load-failed', specifier, detail } }
    }
    if (manifest.data.facets && manifest.data.facets.length > 0) {
      return { ok: false, failure: { reason: 'composition-rejected', specifier } }
    }
    onLog?.(`[verbose]   resolved name "${manifest.data.name}" from ${specifier}`)
    return { ok: true, name: manifest.data.name }
  } finally {
    if (cleanup) await cleanup()
  }
}
