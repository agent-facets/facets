import type { Adapter } from '@agent-facets/adapter'
import type { Lockfile } from '@agent-facets/protocol'
import { parseFacetSource } from '../../sources/facet/parse-source.ts'
import { parseVersionSpec } from '../../sources/facet/parse-version.ts'
import type { OnLog, StageEvent } from '../types.ts'
import { resolveEffectiveLocked } from './effective-locked.ts'
import { resolveGitFacet } from './resolve-git.ts'
import { resolveLocalFacet } from './resolve-local.ts'
import { resolveRegistryFacet } from './resolve-registry.ts'
import type { ResolveFacetResult } from './types.ts'

export interface ResolveFacetArgs {
  facetName: string
  specifier: string
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  previousLockfile: Lockfile
  isExplicitAddition: boolean
  frozenLockfile: boolean
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * Per-facet commit-phase resolution: parse → structural discriminator →
 * kind-dispatch to the source resolvers.
 *
 * The manifest is a `name → value` map. For a registry source the value
 * is a bare version specifier (`1.2.3`, `1.*`, `*`, `latest`) and the
 * facet name lives in the KEY — so when the value parses as a bare
 * VersionSpec we reconstruct the full source as `${facetName}@${value}`.
 * For git/local sources the value is a self-contained source string
 * (URL, `file:` path) and the key is just a label; we parse the value
 * standalone. This keeps `facets.json` values semver-shaped for registry
 * entries (the value the user sees is `1.2.3`, not `cowsay@1.2.3`) while
 * still round-tripping through source resolution.
 */
export async function resolveFacet(args: ResolveFacetArgs): Promise<ResolveFacetResult> {
  const { facetName, specifier, projectRoot, adapters, frozenLockfile, onStage, onLog } = args

  onStage({ kind: 'facet-stage', facet: facetName, stage: 'parse' })
  const sourceString = parseVersionSpec(specifier).ok ? `${facetName}@${specifier}` : specifier
  const parsed = parseFacetSource(sourceString)
  if (!parsed.ok) {
    return {
      ok: false,
      failure: { code: 'PARSE_ERROR', facet: facetName, specifier, error: parsed.error },
    }
  }
  const source = parsed.value

  // The structural discriminator + staleness rules live in one place;
  // a cleared entry makes the facet resolve like a fresh add.
  const effectiveLocked = resolveEffectiveLocked({
    locked: args.previousLockfile.facets[facetName],
    source,
    isExplicitAddition: args.isExplicitAddition,
  })

  switch (source.kind) {
    case 'registry':
      return resolveRegistryFacet({ facetName, source, effectiveLocked, onStage, onLog })
    case 'git':
      return resolveGitFacet({ facetName, source, adapters, effectiveLocked, onStage, onLog })
    case 'local':
      return resolveLocalFacet({
        facetName,
        source,
        projectRoot,
        adapters,
        effectiveLocked,
        frozenLockfile,
        onStage,
        onLog,
      })
  }
}
