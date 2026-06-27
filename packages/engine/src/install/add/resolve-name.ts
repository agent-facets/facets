import { rm } from 'node:fs/promises'
import { loadManifest } from '../../loaders/facet.ts'
import { cloneFacetGitSource } from '../../sources/facet/resolve-git.ts'
import { resolveLocalFacetSource } from '../../sources/facet/resolve-local.ts'
import type { Source } from '../../sources/facet/types.ts'
import type { OnLog } from '../types.ts'

/**
 * Structured failure for facet name resolution. Tagged on `reason` so
 * the CLI can render each arm without parsing message strings.
 */
export type ResolveNameFailure =
  | { reason: 'git-binary-missing'; specifier: string }
  | { reason: 'git-auth-required'; specifier: string; url: string }
  | { reason: 'git-clone-failed'; specifier: string; stderr: string }
  | { reason: 'git-checkout-failed'; specifier: string; commitish: string; stderr: string }
  | { reason: 'git-commit-unresolved'; specifier: string; url: string; stderr: string }
  | { reason: 'local-resolve-failed'; specifier: string; error: string }
  | { reason: 'manifest-load-failed'; specifier: string; detail: string }
  | { reason: 'composition-rejected'; specifier: string }

export type ResolveNameResult = { ok: true; name: string } | { ok: false; failure: ResolveNameFailure }

/**
 * Resolve a source's facet name (the `facets.json` key).
 *
 *   - registry: the canonical name on the parsed source IS the facet name;
 *     no I/O.
 *   - git: clone, read `facet.json`, return its `name`; clean up the clone.
 *   - local: resolve the path, read `facet.json`, return its `name`.
 *
 * Composition (a facet that declares other facets) is rejected.
 * Never throws.
 */
export async function resolveFacetName(source: Source, specifier: string, onLog?: OnLog): Promise<ResolveNameResult> {
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
    onLog?.(() => `[verbose]   resolved name "${manifest.data.name}" from ${specifier}`)
    return { ok: true, name: manifest.data.name }
  } finally {
    if (cleanup) await cleanup()
  }
}
